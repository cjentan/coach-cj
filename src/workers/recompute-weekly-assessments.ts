/**
 * Recompute historical weekly assessments under the zone-anchored TSS model.
 *
 * snapshotWeek derives each week's TSS from trackpoints via computeBestTss,
 * which is anchored to the user-level max HR and resting HR. Before the anchor
 * change, that weeklyTss (and everything derived from it — fatigueScore,
 * readinessScore, recommendations, rawData.weeklyTss/fatigueSignals) was
 * computed with each activity's own observed max HR, so every historical
 * weeklyAssessment row is stale. The scheduled snapshot only refreshes the
 * current week, so historical weeks stay wrong without this backfill.
 *
 * This script re-runs snapshotWeek for every existing (userId, weekStartDate)
 * row in the table. Weeks with no assessment row are left alone — snapshotWeek
 * would fabricate an empty-week row for them (snapshotWeek is an idempotent
 * upsert, so re-running is safe).
 *
 * NOTE: acuteTrainingLoad/chronicTrainingLoad/tsb/formScore come from the PMC
 * model over stored device TSS, which the zone change does not touch, so those
 * fields change only if the PMC inputs did. The recompute is deterministic.
 *
 * Run from repo root (local, loads .env):
 *   npm run db:recompute-weekly-assessments
 *   # or directly:
 *   node --env-file=.env --import tsx src/workers/recompute-weekly-assessments.ts
 *
 * Production — run inside the WORKER container:
 *   docker compose exec worker node --expose-gc --max-old-space-size=1024 \
 *     dist-workers/workers/recompute-weekly-assessments.js
 */

import { prisma } from "../lib/prisma";
import { snapshotWeek } from "../lib/metrics-snapshot";

async function main(): Promise<void> {
  // Distinct (userId, weekStartDate) pairs that already have an assessment.
  const groups = await prisma.weeklyAssessment.groupBy({
    by: ["userId", "weekStartDate"],
    _count: { id: true },
  });

  console.log(`[recompute-weekly] ${groups.length} weekly assessments to recompute`);

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < groups.length; i++) {
    const { userId, weekStartDate } = groups[i];

    // Snapshot before/after for a concise per-week delta log.
    const before = await prisma.weeklyAssessment.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate } },
      select: {
        fatigueScore: true,
        readinessScore: true,
        acuteTrainingLoad: true,
      },
    });

    try {
      await snapshotWeek(userId, weekStartDate);
      ok++;
    } catch (err) {
      failed++;
      console.error(
        `[recompute-weekly] failed for ${userId} @ ${weekStartDate.toISOString()}: ${(err as Error).message}`
      );
      continue;
    }

    const after = await prisma.weeklyAssessment.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate } },
      select: {
        fatigueScore: true,
        readinessScore: true,
        acuteTrainingLoad: true,
      },
    });

    console.log(
      `[recompute-weekly] ${weekStartDate.toISOString().slice(0, 10)}: ` +
        `fatigue ${before?.fatigueScore ?? "null"}→${after?.fatigueScore ?? "null"}, ` +
        `readiness ${before?.readinessScore ?? "null"}→${after?.readinessScore ?? "null"}, ` +
        `atl ${before?.acuteTrainingLoad ?? "null"}→${after?.acuteTrainingLoad ?? "null"}`
    );

    if ((i + 1) % 20 === 0 || i === groups.length - 1) {
      console.log(`[recompute-weekly] ${i + 1}/${groups.length} (${ok} ok, ${failed} failed)`);
    }
  }

  console.log(`[recompute-weekly] done: ${ok} recomputed, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error("[recompute-weekly] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
