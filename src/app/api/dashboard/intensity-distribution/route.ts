import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "90");
  const since = new Date(Date.now() - days * 86400000);

  // Zone % columns are precomputed at ingestion (and backfilled), so this route
  // never loads the rawJson trackpoint blobs — the reason it used to OOM the web
  // container (up to 100 × 10MB+ blobs on the heap) when changing the timeframe.
  const logs = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      startDate: { gte: since },
      mergedIntoId: null,
      rawJson: { not: Prisma.DbNull },
    },
    orderBy: { startDate: "desc" },
    take: 100,
    select: {
      zone1Pct: true,
      zone2Pct: true,
      zone3Pct: true,
      zone4Pct: true,
      zone5Pct: true,
      intensityAnalyzedSeconds: true,
    },
  });

  // Aggregate across activities with computed intensity data.
  let totalZ1 = 0,
    totalZ2 = 0,
    totalZ3 = 0,
    totalZ4 = 0,
    totalZ5 = 0;
  let analyzedCount = 0;
  let totalAnalyzedSec = 0;

  // All five zone columns are written together from a single intensity
  // computation, so zone1Pct != null is exactly the "was computed and usable"
  // signal the old route got from calling computeIntensityDistribution() live
  // (which skipped <30 trackpoints, missing maxHr, and insufficient_data).
  for (const log of logs) {
    if (
      log.zone1Pct == null ||
      log.zone2Pct == null ||
      log.zone3Pct == null ||
      log.zone4Pct == null ||
      log.zone5Pct == null ||
      log.intensityAnalyzedSeconds == null
    )
      continue;

    totalZ1 += log.zone1Pct;
    totalZ2 += log.zone2Pct;
    totalZ3 += log.zone3Pct;
    totalZ4 += log.zone4Pct;
    totalZ5 += log.zone5Pct;
    totalAnalyzedSec += log.intensityAnalyzedSeconds;
    analyzedCount++;
  }

  if (analyzedCount === 0) {
    return NextResponse.json({ distribution: null });
  }

  const distribution = {
    zone1Pct: Math.round((totalZ1 / analyzedCount) * 10) / 10,
    zone2Pct: Math.round((totalZ2 / analyzedCount) * 10) / 10,
    zone3Pct: Math.round((totalZ3 / analyzedCount) * 10) / 10,
    zone4Pct: Math.round((totalZ4 / analyzedCount) * 10) / 10,
    zone5Pct: Math.round((totalZ5 / analyzedCount) * 10) / 10,
    distributionType:
      (totalZ1 + totalZ2) / analyzedCount >= 75 && (totalZ4 + totalZ5) / analyzedCount >= 5
        ? ("polarized" as const)
        : totalZ3 / analyzedCount >= 30
          ? ("threshold-heavy" as const)
          : ("pyramidal" as const),
    activityCount: analyzedCount,
    analyzedHours: Math.round((totalAnalyzedSec / 3600) * 10) / 10,
  };

  return NextResponse.json({ distribution });
}
