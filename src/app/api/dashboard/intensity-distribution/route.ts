import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeIntensityDistribution } from "@/lib/trackpoint-metrics";
import { TrackPoint } from "@/lib/gpx-parser";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "90");
  const since = new Date(Date.now() - days * 86400000);

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
      id: true,
      name: true,
      type: true,
      startDate: true,
      maxHr: true,
      rawJson: true,
    },
  });

  // Compute intensity distribution (aggregate across activities with trackpoint data)
  let totalZ1 = 0, totalZ2 = 0, totalZ3 = 0, totalZ4 = 0, totalZ5 = 0;
  let analyzedCount = 0;
  let totalAnalyzedSec = 0;

  for (const log of logs) {
    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as TrackPoint[] | undefined;
    if (!trackPoints || trackPoints.length < 30 || !log.maxHr) continue;

    const dist = computeIntensityDistribution(trackPoints, log.maxHr);
    if (!dist || dist.distributionType === "insufficient_data") continue;

    totalZ1 += dist.zone1Pct;
    totalZ2 += dist.zone2Pct;
    totalZ3 += dist.zone3Pct;
    totalZ4 += dist.zone4Pct;
    totalZ5 += dist.zone5Pct;
    totalAnalyzedSec += dist.analyzedDuration;
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
    distributionType: ((totalZ1 + totalZ2) / analyzedCount >= 75 && (totalZ4 + totalZ5) / analyzedCount >= 5)
      ? "polarized" as const
      : totalZ3 / analyzedCount >= 30
      ? "threshold-heavy" as const
      : "pyramidal" as const,
    activityCount: analyzedCount,
    analyzedHours: Math.round(totalAnalyzedSec / 3600 * 10) / 10,
  };

  return NextResponse.json({ distribution });
}
