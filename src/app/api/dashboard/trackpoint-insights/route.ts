import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWeightAtDate } from "@/lib/body-metrics";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const tzOffset = parseInt(url.searchParams.get("tzOffset") || "0", 10) || 0;

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
      trackpointNormalizedPower: true,
    },
  });

  if (logs.length === 0) {
    return NextResponse.json({
      available: false,
      message:
        "No activities with trackpoint data found. Upload a Strava export ZIP or GPX/TCX/FIT files to enable detailed metrics.",
    });
  }

  // ── Intensity Distribution (aggregate across all recent activities) ──
  let totalZ1 = 0,
    totalZ2 = 0,
    totalZ3 = 0,
    totalZ4 = 0,
    totalZ5 = 0;
  let totalAnalyzedSec = 0;
  // The old route also returned a per-activity distribution list with each
  // activity's date; no frontend consumer renders it and the per-activity
  // data is derivable from the aggregate, so it's dropped — only the count is
  // needed for averaging below.
  let count = 0;

  for (const log of logs) {
    if (
      log.zone1Pct == null ||
      log.zone2Pct == null ||
      log.zone3Pct == null ||
      log.zone4Pct == null ||
      log.zone5Pct == null
    )
      continue;

    totalZ1 += log.zone1Pct;
    totalZ2 += log.zone2Pct;
    totalZ3 += log.zone3Pct;
    totalZ4 += log.zone4Pct;
    totalZ5 += log.zone5Pct;
    totalAnalyzedSec += log.intensityAnalyzedSeconds ?? 0;
    count++;
  }
  const avgDistribution =
    count > 0
      ? {
          zone1Pct: Math.round((totalZ1 / count) * 10) / 10,
          zone2Pct: Math.round((totalZ2 / count) * 10) / 10,
          zone3Pct: Math.round((totalZ3 / count) * 10) / 10,
          zone4Pct: Math.round((totalZ4 / count) * 10) / 10,
          zone5Pct: Math.round((totalZ5 / count) * 10) / 10,
          // 3-zone classification uses mapped zones: Easy=Z1+Z2, Moderate=Z3, Hard=Z4+Z5
          distributionType:
            (totalZ1 + totalZ2) / count >= 75 && (totalZ4 + totalZ5) / count >= 5
              ? ("polarized" as const)
              : totalZ3 / count >= 30
                ? ("threshold-heavy" as const)
                : ("pyramidal" as const),
          activityCount: count,
          totalAnalyzedHours: Math.round((totalAnalyzedSec / 3600) * 10) / 10,
        }
      : null;

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

  const avgDecoupling =
    decouplingCount > 0
      ? {
          avgDecouplingPct: Math.round((decouplingSum / decouplingCount) * 10) / 10,
          status:
            decouplingSum / decouplingCount < 5
              ? "excellent"
              : decouplingSum / decouplingCount < 10
                ? "good"
                : "elevated",
          activityCount: decouplingCount,
        }
      : null;

  // ── Power Metrics Summary ──
  // trackpointNormalizedPower is stored only when computePowerMetrics() found
  // >= 30 power points, matching the old live computation.
  let powerActivities = 0;
  let bestFtp: number | null = null;
  let bestFtpWkg: number | null = null;

  // Look up current weight for w/kg computation
  const weightResult = await getWeightAtDate(session.user.id, now);
  const weightKg =
    weightResult?.weightKg && weightResult.weightKg > 0 ? weightResult.weightKg : null;

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
  const estimatedFtpWkg =
    estimatedFtp && weightKg
      ? Math.round((estimatedFtp / weightKg) * 10) / 10
      : bestFtpWkg
        ? Math.round(bestFtpWkg * 0.95 * 10) / 10
        : null;

  return NextResponse.json({
    available: true,
    activityCount: logs.length,
    intensityDistribution: avgDistribution,
    decoupling: avgDecoupling,
    powerActivities,
    estimatedFtp,
    estimatedFtpWkg,
    weightSource: weightResult?.source ?? null,
  });
}
