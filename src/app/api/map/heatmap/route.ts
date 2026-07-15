import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * Heatmap metadata endpoint.
 *
 * Counts only activities with the pre-computed simplifiedTrackPoints column
 * (those that have been "backfilled"). Returns the number of unprocessed
 * GPS activities so the UI can prompt the user to build their heatmap.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const baseWhere: Record<string, unknown> = {
    userId: session.user.id,
    mergedIntoId: null,
  };
  if (type && type !== "all") baseWhere.type = type;
  if (from) baseWhere.startDate = { ...(baseWhere.startDate as object || {}), gte: new Date(from) };
  if (to) baseWhere.startDate = { ...(baseWhere.startDate as object || {}), lte: new Date(to) };

  // Count all with GPS data and those already processed (has simplifiedTrackPoints)
  const allGpsWhere = { ...baseWhere, rawJson: { not: Prisma.DbNull } };
  const processedWhere = { ...baseWhere, simplifiedTrackPoints: { not: Prisma.DbNull } };

  const [totalWithGps, totalProcessed, bboxBounds] = await Promise.all([
    prisma.trainingLog.count({ where: allGpsWhere }),
    prisma.trainingLog.count({ where: processedWhere }),
    prisma.trainingLog.aggregate({
      where: processedWhere as any,
      _min: { trackMinLat: true, trackMinLng: true },
      _max: { trackMaxLat: true, trackMaxLng: true },
    }),
  ]);

  let bounds: {
    minLat: number; maxLat: number;
    minLng: number; maxLng: number;
  } | null = null;

  if (
    bboxBounds._min.trackMinLat != null &&
    bboxBounds._max.trackMaxLat != null &&
    bboxBounds._min.trackMinLng != null &&
    bboxBounds._max.trackMaxLng != null
  ) {
    bounds = {
      minLat: bboxBounds._min.trackMinLat,
      maxLat: bboxBounds._max.trackMaxLat,
      minLng: bboxBounds._min.trackMinLng,
      maxLng: bboxBounds._max.trackMaxLng,
    };
  }

  return NextResponse.json({
    totalCount: totalProcessed,
    needsBackfill: Math.max(0, totalWithGps - totalProcessed),
    bounds,
  });
}
