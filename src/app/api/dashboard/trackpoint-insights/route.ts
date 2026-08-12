import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWeightAtDate } from "@/lib/body-metrics";

/**
 * Reconstruct the 3-zone classification for an activity from its stored zone
 * percentages, matching computeIntensityDistribution()'s rules. The
 * "insufficient_data" branch can't occur here: zone columns are only written
 * when the distribution was usable (>= 60 HR points at ingestion).
 */
function classifyDistribution(
  z1: number, z2: number, z3: number, z4: number, z5: number,
): "polarized" | "pyramidal" | "threshold-heavy" {
  const easy = z1 + z2;
  const moderate = z3;
  const hard = z4 + z5;

  if (easy >= 75 && hard >= 5) return "polarized";
  if (easy >= moderate && moderate >= hard) return "pyramidal";
  if (moderate >= 30) return "threshold-heavy";
  return "pyramidal";
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);

  // All trackpoint-derived metrics are precomputed scalar columns, so this route
  // only touches tiny numeric columns — never the rawJson blobs.
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
      zone1Pct: true,
      zone2Pct: true,
      zone3Pct: true,
      zone4Pct: true,
      zone5Pct: true,
      intensityAnalyzedSeconds: true,
      decouplingPct: true,
      efficiencyFactor: true,
      trackpointNormalizedPower: true,
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
    if (
      log.zone1Pct == null || log.zone2Pct == null || log.zone3Pct == null ||
      log.zone4Pct == null || log.zone5Pct == null
    ) continue;

    totalZ1 += log.zone1Pct;
    totalZ2 += log.zone2Pct;
    totalZ3 += log.zone3Pct;
    totalZ4 += log.zone4Pct;
    totalZ5 += log.zone5Pct;
    totalAnalyzedSec += log.intensityAnalyzedSeconds ?? 0;

    activityDistributions.push({
      id: log.id,
      name: log.name,
      date: log.startDate.toISOString().split("T")[0],
      type: log.type,
      zone1Pct: log.zone1Pct,
      zone2Pct: log.zone2Pct,
      zone3Pct: log.zone3Pct,
      zone4Pct: log.zone4Pct,
      zone5Pct: log.zone5Pct,
      distributionType: classifyDistribution(
        log.zone1Pct, log.zone2Pct, log.zone3Pct, log.zone4Pct, log.zone5Pct,
      ),
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
  // The old route also required >= 120 total trackpoints and returned a per-
  // activity list with first/second-half HR; those half-HR values are not stored
  // and no frontend consumer renders the list, so it is dropped. decouplingPct
  // itself is persisted only when computeDecoupling() produced a valid result
  // (>= 60 valid HR+output points), so null-skipping reproduces the filter.
  let decouplingSum = 0;
  let decouplingCount = 0;

  for (const log of logs) {
    if (log.decouplingPct == null) continue;

    decouplingSum += log.decouplingPct;
    decouplingCount++;
  }

  const avgDecoupling = decouplingCount > 0 ? {
    avgDecouplingPct: Math.round((decouplingSum / decouplingCount) * 10) / 10,
    status: decouplingSum / decouplingCount < 5 ? "excellent"
      : decouplingSum / decouplingCount < 10 ? "good"
      : "elevated",
    activityCount: decouplingCount,
  } : null;

  // ── Efficiency Factor Trend ──
  // Group by week for trend analysis. efficiencyFactor is stored only when
  // computeEfficiencyFactor() succeeded (>= 60 HR+power points), which implies
  // the old route's >= 60-trackpoint gate too.
  const efByWeek: Map<string, number[]> = new Map();
  for (const log of logs) {
    if (log.efficiencyFactor == null) continue;

    const weekStart = new Date(log.startDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekKey = weekStart.toISOString().split("T")[0];

    if (!efByWeek.has(weekKey)) efByWeek.set(weekKey, []);
    efByWeek.get(weekKey)!.push(log.efficiencyFactor);
  }

  const efTrend = Array.from(efByWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, values]) => ({
      weekStart,
      ef: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
      activityCount: values.length,
    }));

  // ── Power Metrics Summary ──
  // trackpointNormalizedPower is stored only when computePowerMetrics() found
  // >= 30 power points, matching the old live computation.
  let powerActivities = 0;
  let bestFtp: number | null = null;
  let bestFtpWkg: number | null = null;

  // Look up current weight for w/kg computation
  const weightResult = await getWeightAtDate(session.user.id, now);
  const weightKg = weightResult?.weightKg && weightResult.weightKg > 0
    ? weightResult.weightKg
    : null;

  for (const log of logs) {
    if (log.trackpointNormalizedPower == null) continue;

    powerActivities++;
    if (bestFtp == null || log.trackpointNormalizedPower > bestFtp) {
      bestFtp = log.trackpointNormalizedPower;
      bestFtpWkg = weightKg
        ? Math.round((log.trackpointNormalizedPower / weightKg) * 10) / 10
        : null;
    }
  }

  const estimatedFtp = bestFtp ? Math.round(bestFtp * 0.95) : null; // 95% of max NP ≈ FTP
  const estimatedFtpWkg = estimatedFtp && weightKg
    ? Math.round((estimatedFtp / weightKg) * 10) / 10
    : bestFtpWkg
      ? Math.round(bestFtpWkg * 0.95 * 10) / 10
      : null;

  return NextResponse.json({
    available: true,
    activityCount: logs.length,
    intensityDistribution: avgDistribution,
    decoupling: avgDecoupling,
    efTrend,
    powerActivities,
    estimatedFtp,
    estimatedFtpWkg,
    weightSource: weightResult?.source ?? null,
  });
}
