import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeIntensityDistribution,
  computeDecoupling,
  computeEfficiencyFactor,
  computeHrTss,
  computePowerMetrics,
} from "@/lib/trackpoint-metrics";
import { TrackPoint } from "@/lib/gpx-parser";
import { getWeightAtDate } from "@/lib/body-metrics";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);

  // Fetch recent logs that have rawJson (trackpoint data)
  const logs = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      startDate: { gte: fourWeeksAgo },
      mergedIntoId: null,
      rawJson: { not: Prisma.DbNull },
    },
    orderBy: { startDate: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      type: true,
      startDate: true,
      durationSeconds: true,
      distanceMeters: true,
      maxHr: true,
      rawJson: true,
    },
  });

  if (logs.length === 0) {
    return NextResponse.json({
      available: false,
      message: "No activities with trackpoint data found. Upload a Strava export ZIP or GPX/TCX/FIT files to enable detailed metrics.",
    });
  }

  // ── Intensity Distribution (aggregate across all recent activities) ──
  let totalZ1 = 0, totalZ2 = 0, totalZ3 = 0, totalZ4 = 0, totalZ5 = 0;
  let totalAnalyzedSec = 0;
  const activityDistributions: {
    id: string; name: string; date: string; type: string;
    zone1Pct: number; zone2Pct: number; zone3Pct: number; zone4Pct: number; zone5Pct: number; distributionType: string;
  }[] = [];

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

    activityDistributions.push({
      id: log.id,
      name: log.name,
      date: log.startDate.toISOString().split("T")[0],
      type: log.type,
      zone1Pct: dist.zone1Pct,
      zone2Pct: dist.zone2Pct,
      zone3Pct: dist.zone3Pct,
      zone4Pct: dist.zone4Pct,
      zone5Pct: dist.zone5Pct,
      distributionType: dist.distributionType,
    });
  }

  const count = activityDistributions.length;
  const avgDistribution = count > 0 ? {
    zone1Pct: Math.round((totalZ1 / count) * 10) / 10,
    zone2Pct: Math.round((totalZ2 / count) * 10) / 10,
    zone3Pct: Math.round((totalZ3 / count) * 10) / 10,
    zone4Pct: Math.round((totalZ4 / count) * 10) / 10,
    zone5Pct: Math.round((totalZ5 / count) * 10) / 10,
    // 3-zone classification uses mapped zones: Easy=Z1+Z2, Moderate=Z3, Hard=Z4+Z5
    distributionType: ((totalZ1 + totalZ2) / count >= 75 && (totalZ4 + totalZ5) / count >= 5)
      ? "polarized" as const
      : totalZ3 / count >= 30
      ? "threshold-heavy" as const
      : "pyramidal" as const,
    activityCount: count,
    totalAnalyzedHours: Math.round(totalAnalyzedSec / 3600 * 10) / 10,
  } : null;

  // ── Aerobic Decoupling (average across recent long efforts) ──
  let decouplingSum = 0;
  let decouplingCount = 0;
  const decouplingActivities: {
    id: string; name: string; date: string; decouplingPct: number;
    firstHalfHr: number; secondHalfHr: number;
  }[] = [];

  for (const log of logs) {
    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as TrackPoint[] | undefined;
    if (!trackPoints || trackPoints.length < 120) continue; // only >2min activities

    const hasPower = trackPoints.some((tp) => tp.power != null && tp.power > 0);
    const dec = computeDecoupling(trackPoints, hasPower);
    if (!dec || dec.decouplingPct == null) continue;

    decouplingSum += dec.decouplingPct;
    decouplingCount++;
    decouplingActivities.push({
      id: log.id,
      name: log.name,
      date: log.startDate.toISOString().split("T")[0],
      decouplingPct: dec.decouplingPct,
      firstHalfHr: dec.firstHalfHr || 0,
      secondHalfHr: dec.secondHalfHr || 0,
    });
  }

  const avgDecoupling = decouplingCount > 0 ? {
    avgDecouplingPct: Math.round((decouplingSum / decouplingCount) * 10) / 10,
    status: decouplingSum / decouplingCount < 5 ? "excellent"
      : decouplingSum / decouplingCount < 10 ? "good"
      : "elevated",
    activityCount: decouplingCount,
  } : null;

  // ── Efficiency Factor Trend ──
  // Group by week for trend analysis
  const efByWeek: Map<string, number[]> = new Map();
  for (const log of logs) {
    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as TrackPoint[] | undefined;
    if (!trackPoints || trackPoints.length < 60) continue;

    const efResult = computeEfficiencyFactor(trackPoints);
    if (efResult == null) continue;

    const weekStart = new Date(log.startDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekKey = weekStart.toISOString().split("T")[0];

    if (!efByWeek.has(weekKey)) efByWeek.set(weekKey, []);
    efByWeek.get(weekKey)!.push(efResult.ef);
  }

  const efTrend = Array.from(efByWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, values]) => ({
      weekStart,
      ef: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
      activityCount: values.length,
    }));

  // ── Power Metrics Summary ──
  let powerActivities = 0;
  let bestFtp: number | null = null;
  let bestFtpWkg: number | null = null;

  // Look up current weight for w/kg computation
  const weightResult = await getWeightAtDate(session.user.id, now);

  for (const log of logs) {
    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as TrackPoint[] | undefined;
    if (!trackPoints) continue;

    const pm = computePowerMetrics(trackPoints, undefined, weightResult?.weightKg);
    if (!pm) continue;
    powerActivities++;
    if (pm.normalizedPower && (!bestFtp || pm.normalizedPower > bestFtp)) {
      bestFtp = pm.normalizedPower;
      bestFtpWkg = pm.normalizedPowerWkg;
    }
  }

  const estimatedFtp = bestFtp ? Math.round(bestFtp * 0.95) : null; // 95% of max NP ≈ FTP
  const estimatedFtpWkg = estimatedFtp && weightResult?.weightKg
    ? Math.round((estimatedFtp / weightResult.weightKg) * 10) / 10
    : bestFtpWkg
      ? Math.round(bestFtpWkg * 0.95 * 10) / 10
      : null;

  return NextResponse.json({
    available: true,
    activityCount: logs.length,
    intensityDistribution: avgDistribution,
    decoupling: avgDecoupling,
    decouplingActivities: decouplingActivities.slice(0, 5),
    efTrend,
    powerActivities,
    estimatedFtp,
    estimatedFtpWkg,
    weightSource: weightResult?.source ?? null,
  });
}
