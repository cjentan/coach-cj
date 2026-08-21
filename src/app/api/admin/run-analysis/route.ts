import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { sundayQueue, nextReviewWeekStart } from "@/lib/review-queue";

/**
 * Manually trigger a full weekly review for every user with an active race
 * goal. Enqueues one "review" job per eligible user into the sunday-review
 * queue; the background worker (src/workers/entrypoint.ts) picks them up and
 * runs the unified flow — rule-based next-week plan upsert plus the AI coach
 * analysis (analysis text + recommendations) — exactly as the per-user
 * scheduled review does.
 *
 * Robustness against double runs:
 *  - The dedup registers only after a review *passes*. The worker writes a
 *    non-empty `coachNotes` onto the target week's plan only when its LLM
 *    analysis succeeds, so that is the "already reviewed" signal used here and
 *    by the worker's own guard. A review that failed (analysis never ran)
 *    leaves coachNotes empty, so this trigger will enqueue it again — i.e. a
 *    failed review can be retried, while a successful one is never re-run.
 *  - Users whose target-week plan already has coachNotes are skipped here (and
 *    reported), and colliding duplicate jobs from a double-click or the
 *    scheduler are neutralized by the worker's success check rather than at
 *    enqueue time.
 */
export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const weekStart = nextReviewWeekStart();

  const users = await prisma.user.findMany({
    where: { raceGoals: { some: { status: "active" } } },
    select: { id: true, name: true },
  });

  // Who already passed their review this week: target-week plan with a
  // non-empty coachNotes (only written on analysis success).
  const existing = await prisma.weeklyPlan.findMany({
    where: { userId: { in: users.map((u) => u.id) }, weekStartDate: weekStart },
    select: { userId: true, coachNotes: true },
  });
  const alreadyReviewed = new Set(existing.filter((e) => e.coachNotes).map((e) => e.userId));

  const enqueued: Array<{ id: string; name: string }> = [];
  let skipped = 0;

  for (const user of users) {
    if (alreadyReviewed.has(user.id)) {
      skipped++;
      continue;
    }
    await sundayQueue.add("review", { userId: user.id });
    enqueued.push({ id: user.id, name: user.name });
  }

  return NextResponse.json({
    enqueued: enqueued.length,
    skipped,
    weekStart: weekStart.toISOString(),
    users: enqueued,
  });
}
