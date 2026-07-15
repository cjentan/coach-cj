import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { simplifyTrackPoints } from "@/lib/simplify-trackpoints";
import type { TrackPoint } from "@/lib/gpx-parser";

/**
 * Backfill simplified trackpoints and bounding box columns for activities
 * that were ingested before these columns were added to the schema.
 *
 * Processes in batches to avoid memory pressure — each batch loads rawJson
 * for 50 activities, computes simplified coords + bbox, and updates the row.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const BATCH_SIZE = 50;
  let processed = 0;
  let skipped = 0;

  while (true) {
    // Load a batch of rawJson-only activities. We avoid filtering on the
    // simplifiedTrackPoints column directly (Prisma's JsonNullableFilter
    // doesn't accept bare null in Record<string, unknown>) — instead we
    // select both columns and filter in memory.
    const batch = await prisma.trainingLog.findMany({
      where: {
        userId: session.user.id,
        mergedIntoId: null,
        rawJson: { not: Prisma.DbNull },
      },
      take: BATCH_SIZE,
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        rawJson: true,
        simplifiedTrackPoints: true,
      },
    });

    if (batch.length === 0) break;

    // Filter to only those without simplified trackpoints
    const pending = batch.filter(
      (log) => log.simplifiedTrackPoints == null,
    );

    if (pending.length === 0) {
      // All activities in this batch are already processed, no more left
      if (batch.length < BATCH_SIZE) break;
      continue;
    }

    const updates = pending.map((log) => {
      const data = log.rawJson as { trackPoints?: TrackPoint[] } | null;
      const trackPoints = data?.trackPoints;
      const simplified = simplifyTrackPoints(trackPoints, 500);

      if (simplified.coords.length < 3) {
        // Mark with empty array so we don't reprocess it
        return prisma.trainingLog.update({
          where: { id: log.id },
          data: {
            simplifiedTrackPoints: [] as any,
            trackMinLat: null,
            trackMaxLat: null,
            trackMinLng: null,
            trackMaxLng: null,
          },
        }).then(() => ({ id: log.id, status: "skipped" as const }));
      }

      return prisma.trainingLog.update({
        where: { id: log.id },
        data: {
          simplifiedTrackPoints: simplified.coords as any,
          trackMinLat: simplified.bbox?.minLat ?? null,
          trackMaxLat: simplified.bbox?.maxLat ?? null,
          trackMinLng: simplified.bbox?.minLng ?? null,
          trackMaxLng: simplified.bbox?.maxLng ?? null,
        },
      }).then(() => ({ id: log.id, status: "processed" as const }));
    });

    const results = await Promise.all(updates);
    for (const r of results) {
      if (r.status === "processed") processed++;
      else skipped++;
    }
  }

  return NextResponse.json({ processed, skipped });
}
