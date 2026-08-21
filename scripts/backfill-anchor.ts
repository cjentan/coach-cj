/**
 * One-time backfill: set WeeklyPlan.anchorGoalId on the "active" weekly plan per
 * user to that user's current top-priority active goal (goals[0]).
 *
 * Reasoning: the anchor column only gets populated on plan creation/regeneration
 * after deploy, so existing plans have anchorGoalId = NULL and would fall back to
 * the old (drifting) goals[0]. This backfills the active plan so drift protection
 * is effective immediately. It self-corrects on the next plan regeneration.
 *
 * The "active" plan mirrors gatherTrainingContext's `latestPlan`: the earliest
 * week with weekStartDate >= the current week start; if none, the most recent plan.
 *
 * Read-only wrt logic: only writes anchorGoalId where it is currently NULL and a
 * primary active goal exists. Safe to re-run (idempotent).
 */
import { prisma } from "../src/lib/prisma";

function getWeekStart(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as week start
  out.setDate(out.getDate() + diff);
  return out;
}

async function main() {
  const weekStart = getWeekStart(new Date());

  // Users that have at least one weekly plan.
  const usersWithPlans = await prisma.weeklyPlan.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });

  let updated = 0;
  let skippedNoAnchor = 0;
  let skippedNoGoal = 0;

  for (const { userId } of usersWithPlans) {
    // Current primary active goal — same ordering as gatherTrainingContext.
    const goals = await prisma.raceGoal.findMany({
      where: { userId, status: "active" },
      orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
      select: { id: true },
    });
    const primary = goals[0];
    if (!primary) {
      skippedNoGoal++;
      continue;
    }

    // Active plan (earliest future/current week); fall back to most recent.
    const activePlan =
      (await prisma.weeklyPlan.findFirst({
        where: { userId, weekStartDate: { gte: weekStart } },
        orderBy: { weekStartDate: "asc" },
        select: { id: true, anchorGoalId: true },
      })) ??
      (await prisma.weeklyPlan.findFirst({
        where: { userId },
        orderBy: { weekStartDate: "desc" },
        select: { id: true, anchorGoalId: true },
      }));

    if (!activePlan) continue;
    if (activePlan.anchorGoalId != null) {
      // Already anchored (e.g. from a regeneration after deploy).
      skippedNoAnchor++;
      continue;
    }

    await prisma.weeklyPlan.update({
      where: { id: activePlan.id },
      data: { anchorGoalId: primary.id },
    });
    updated++;
    console.log(`[backfill] user=${userId} plan=${activePlan.id} -> anchor=${primary.id}`);
  }

  console.log(`\nDone. updated=${updated} (already-anchored or skipped=${skippedNoAnchor}, no-primary-goal=${skippedNoGoal})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
