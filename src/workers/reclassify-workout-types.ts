/**
 * Reclassify stored workout types under the user-level max HR model.
 *
 * workoutType is written at ingestion time by classifyWorkoutType, which runs
 * the HR zone distribution through classifyFromZones (or the avg/max ratio
 * fallback in classifyFromSummary). Before the max-HR anchor change, every
 * activity's zones were built from its own observed max HR, so already-imported
 * runs/rides carry classifications computed from the wrong reserve (e.g. an
 * easy run whose broken Z4-heavy distribution was tagged "intervals").
 *
 * This script re-runs classifyWorkoutType for every run/ride activity with the
 * user's current effective max HR and resting HR (cached per user) and updates
 * the stored workoutType where it differs. Only run/ride types are touched —
 * every other type classifies to the constant "cross_training" and cannot change.
 *
 * Memory safety: only one rawJson blob is loaded at a time (via a per-row
 * findUnique) and released before the next row, matching
 * recompute-trackpoint-metrics.
 *
 * Run from repo root (local, loads .env):
 *   npm run db:reclassify-workout-types
 *   # or directly:
 *   node --env-file=.env --import tsx src/workers/reclassify-workout-types.ts
 *
 * Production — run inside the WORKER container:
 *   docker compose exec worker node --expose-gc --max-old-space-size=1024 \
 *     dist-workers/workers/reclassify-workout-types.js
 *
 * Safe to re-run — classification is deterministic, so re-running after an
 * interruption simply redoes the remaining rows.
 */

import { prisma } from "../lib/prisma";
import { getEffectiveMaxHr, getLatestRestingHr } from "../lib/body-metrics";
import { classifyWorkoutType } from "../lib/workout-classifier";
import type { TrackPoint } from "../lib/gpx-parser";

async function main(): Promise<void> {
  // Scalar-only pass: no rawJson blobs. Only displayed rows (merged-away
  // duplicates are hidden and their classification is irrelevant).
  const rows = await prisma.trainingLog.findMany({
    where: {
      type: { in: ["run", "ride"] },
      mergedIntoId: null,
    },
    select: {
      id: true,
      userId: true,
      type: true,
      subType: true,
      durationSeconds: true,
      distanceMeters: true,
      averageHr: true,
      averagePower: true,
      normalizedPower: true,
      workoutType: true,
    },
    orderBy: { startDate: "desc" },
  });

  console.log(`[reclassify] ${rows.length} run/ride activities to reclassify`);

  // Cache each user's effective max HR and resting HR so each is queried once,
  // not per row.
  const maxHrCache = new Map<string, number>();
  const maxHrFor = async (userId: string): Promise<number> => {
    if (!maxHrCache.has(userId)) {
      maxHrCache.set(userId, await getEffectiveMaxHr(userId));
    }
    return maxHrCache.get(userId) as number;
  };
  const restHrCache = new Map<string, number | null>();
  const restHrFor = async (userId: string): Promise<number | null> => {
    if (!restHrCache.has(userId)) {
      restHrCache.set(userId, await getLatestRestingHr(userId));
    }
    return restHrCache.get(userId) ?? null;
  };

  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Load one activity's rawJson at a time so only a single blob is ever on
    // the heap. Activities without trackpoints classify from summary metrics.
    const log = await prisma.trainingLog.findUnique({
      where: { id: row.id },
      select: { rawJson: true },
    });
    const trackPoints = (log?.rawJson as Record<string, unknown> | null)?.trackPoints as
      TrackPoint[] | undefined;

    const restHr = await restHrFor(row.userId);
    // Anchor to the user-level max HR (estimated > user-set > default), not
    // this activity's own observed max — same values ingestion uses now.
    const maxHr = await maxHrFor(row.userId);
    const workoutType = classifyWorkoutType({
      type: row.type,
      subType: row.subType,
      durationSeconds: row.durationSeconds,
      distanceMeters: row.distanceMeters,
      averageHr: row.averageHr,
      maxHr,
      restHr,
      averagePower: row.averagePower,
      normalizedPower: row.normalizedPower,
      trackPoints,
    });

    if (workoutType === row.workoutType) {
      unchanged++;
      continue;
    }

    try {
      await prisma.trainingLog.update({
        where: { id: row.id },
        data: { workoutType },
      });
      changed++;
      console.log(`[reclassify] ${row.id}: ${row.workoutType ?? "null"} → ${workoutType}`);
    } catch (err) {
      failed++;
      console.error(`[reclassify] update failed for ${row.id}: ${(err as Error).message}`);
    }

    if ((i + 1) % 200 === 0 || i === rows.length - 1) {
      console.log(
        `[reclassify] ${i + 1}/${rows.length} (${changed} changed, ${unchanged} unchanged, ${failed} failed)`
      );
    }
  }

  console.log(`[reclassify] done: ${changed} changed, ${unchanged} unchanged, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error("[reclassify] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
