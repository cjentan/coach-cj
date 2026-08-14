/**
 * Recompute precomputed zone distributions under the Karvonen model.
 *
 * The zone % columns on TrainingLog (zone1Pct..zone5Pct,
 * intensityAnalyzedSeconds) are written at ingestion time from the zone model
 * that was current then. When the zone model changes (e.g. the switch from
 * % of max HR to Karvonen / heart-rate reserve), every already-imported
 * activity still carries stale thresholds. This script recomputes them from
 * each activity's stored trackpoints using the user's current resting HR.
 *
 * Scope: only the Karvonen-affected columns are rewritten. decouplingPct,
 * efficiencyFactor and trackpointNormalizedPower are independent of the zone
 * model and are left untouched.
 *
 * Memory safety: only one rawJson blob is loaded at a time (via a per-row
 * findUnique) and released before the next row, so a 1-2GB heap is never
 * threatened even with thousands of 10MB+ blobs.
 *
 * Run from repo root (local, loads .env):
 *   npm run db:recompute-zones
 *   # or directly:
 *   node --env-file=.env --import tsx src/workers/recompute-trackpoint-metrics.ts
 *
 * Production — run inside the WORKER container. The worker image ships
 * dist-workers (compiled via tsconfig.worker.json) plus full node_modules and
 * the Prisma engine, so plain node works:
 *
 *   docker compose exec worker node --expose-gc --max-old-space-size=1024 \
 *     dist-workers/workers/recompute-trackpoint-metrics.js
 *
 * Safe to re-run — the recompute is deterministic, so re-running after an
 * interruption simply redoes the remaining rows (no partial state to clean up).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getEffectiveMaxHr, getLatestRestingHr } from "../lib/body-metrics";
import { computePrecomputedTrackpointMetrics } from "../lib/trackpoint-metrics";
import type { TrackPoint } from "../lib/gpx-parser";

async function main(): Promise<void> {
  // Scalar-only pass: ids + userId + maxHr, no rawJson blobs.
  const rows = await prisma.trainingLog.findMany({
    where: {
      rawJson: { not: Prisma.DbNull },
      maxHr: { not: null },
    },
    select: { id: true, userId: true, maxHr: true },
    orderBy: { startDate: "desc" },
  });

  console.log(`[recompute] ${rows.length} training logs to recompute`);

  // Cache each user's latest resting HR and effective max HR so each is
  // queried once, not per row.
  const restHrCache = new Map<string, number | null>();
  const restHrFor = async (userId: string): Promise<number | null> => {
    if (!restHrCache.has(userId)) {
      restHrCache.set(userId, await getLatestRestingHr(userId));
    }
    return restHrCache.get(userId) ?? null;
  };
  const maxHrCache = new Map<string, number>();
  const maxHrFor = async (userId: string): Promise<number> => {
    if (!maxHrCache.has(userId)) {
      maxHrCache.set(userId, await getEffectiveMaxHr(userId));
    }
    return maxHrCache.get(userId) as number;
  };

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const { id, userId } = rows[i];

    // Load one activity's rawJson at a time so only a single blob is ever on
    // the heap. Free it before the next iteration.
    const log = await prisma.trainingLog.findUnique({
      where: { id },
      select: { rawJson: true },
    });
    if (!log?.rawJson) {
      continue; // rawJson was cleared since the scan; nothing to compute
    }

    const trackPoints = (log.rawJson as Record<string, unknown>)
      .trackPoints as TrackPoint[] | undefined;
    const restHr = await restHrFor(userId);
    // Anchor to the user-level max HR (estimated > user-set > default), not
    // this activity's own observed max, so every activity's zones mean the
    // same thing.
    const effectiveMaxHr = await maxHrFor(userId);
    const metrics = computePrecomputedTrackpointMetrics(trackPoints, effectiveMaxHr, restHr);

    try {
      await prisma.trainingLog.update({
        where: { id },
        data: {
          zone1Pct: metrics.zone1Pct,
          zone2Pct: metrics.zone2Pct,
          zone3Pct: metrics.zone3Pct,
          zone4Pct: metrics.zone4Pct,
          zone5Pct: metrics.zone5Pct,
          intensityAnalyzedSeconds: metrics.intensityAnalyzedSeconds,
        },
      });
      ok++;
    } catch (err) {
      failed++;
      console.error(`[recompute] update failed for ${id}: ${(err as Error).message}`);
    }

    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(
        `[recompute] ${i + 1}/${rows.length} (${ok} updated, ${failed} failed)`,
      );
    }
  }

  console.log(`[recompute] done: ${ok} updated, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error("[recompute] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
