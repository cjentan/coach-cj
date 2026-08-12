/**
 * Backfill precomputed trackpoint metrics for all existing training logs.
 *
 * Dashboard chart routes now aggregate stored scalar columns (zone %, aerobic
 * decoupling, efficiency factor, trackpoint normalized power) instead of
 * loading each activity's rawJson trackpoint blob into the server heap. Every
 * activity that already carries rawJson needs its metrics computed once.
 *
 * Memory safety: this script loads only one rawJson blob at a time and releases
 * it before moving on, so a 1-2GB heap is never threatened even with thousands
 * of 10MB+ blobs.
 *
 * Run from repo root (local):
 *   npx tsx src/workers/backfill-trackpoint-metrics.ts
 *
 * Production — run inside the WORKER container after a deploy has applied the
 * migration. The worker image ships dist-workers (this file is compiled there
 * via tsconfig.worker.json) plus full node_modules and the Prisma engine, so
 * plain node works:
 *
 *   docker compose exec worker node --expose-gc --max-old-space-size=1024 \
 *     dist-workers/workers/backfill-trackpoint-metrics.js
 *
 * Safe to re-run — rows where at least one metric column is already set are
 * skipped, so an interrupted run simply resumes where it left off.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { computePrecomputedTrackpointMetrics } from "../lib/trackpoint-metrics";
import type { TrackPoint } from "../lib/gpx-parser";

async function main(): Promise<void> {
  // Scalar-only pass: ids + maxHr, no rawJson blobs.
  const rows = await prisma.trainingLog.findMany({
    where: {
      rawJson: { not: Prisma.DbNull },
      OR: [
        { zone1Pct: null },
        { zone2Pct: null },
        { zone3Pct: null },
        { zone4Pct: null },
        { zone5Pct: null },
        { intensityAnalyzedSeconds: null },
        { decouplingPct: null },
        { efficiencyFactor: null },
        { trackpointNormalizedPower: null },
      ],
    },
    select: { id: true, maxHr: true },
    orderBy: { startDate: "desc" },
  });

  console.log(
    `[backfill] ${rows.length} training logs need trackpoint metrics`,
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const { id, maxHr } = rows[i];

    // Load one activity's rawJson at a time so only a single blob is ever on
    // the heap. Free it before the next iteration.
    const log = await prisma.trainingLog.findUnique({
      where: { id },
      select: { rawJson: true },
    });
    if (!log?.rawJson) {
      skipped++;
      continue;
    }

    const trackPoints = (log.rawJson as Record<string, unknown>)
      .trackPoints as TrackPoint[] | undefined;
    const metrics = computePrecomputedTrackpointMetrics(trackPoints, maxHr);

    await prisma.trainingLog.update({
      where: { id },
      data: {
        zone1Pct: metrics.zone1Pct,
        zone2Pct: metrics.zone2Pct,
        zone3Pct: metrics.zone3Pct,
        zone4Pct: metrics.zone4Pct,
        zone5Pct: metrics.zone5Pct,
        intensityAnalyzedSeconds: metrics.intensityAnalyzedSeconds,
        decouplingPct: metrics.decouplingPct,
        efficiencyFactor: metrics.efficiencyFactor,
        trackpointNormalizedPower: metrics.trackpointNormalizedPower,
      },
    });

    ok++;
    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(
        `[backfill] ${i + 1}/${rows.length} (${ok} updated, ${skipped} skipped, ${failed} failed)`,
      );
    }
  }

  console.log(
    `[backfill] done: ${ok} updated, ${skipped} skipped, ${failed} failed`,
  );
}

main()
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
