import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart, getMonthStart, getMonthEnd } from "@/lib/utils";
import { computePMC } from "@/lib/pmc";
import { computeReadinessScore } from "@/lib/training-health";

interface PeriodStats {
  weeklyDistance: number;
  weeklyElevation: number;
  weeklyDuration: number;
  weeklyCount: number;
  weeklyTss: number;
  avgDailyTss: number;
  avgHr: number | null;
}

function aggregateLogs(
  logs: { distanceMeters: number | null; elevationGainMeters: number | null; durationSeconds: number; averageHr: number | null; tss: number | null }[],
  daysInPeriod: number,
): PeriodStats {
  const weeklyDistance = logs.reduce((sum, log) => sum + (log.distanceMeters || 0), 0);
  const weeklyElevation = logs.reduce((sum, log) => sum + (log.elevationGainMeters || 0), 0);
  const weeklyDuration = logs.reduce((sum, log) => sum + (log.durationSeconds || 0), 0);
  const weeklyCount = logs.length;
  const weeklyTss = Math.round(logs.reduce((sum, log) => sum + (log.tss || 50), 0));
  const avgDailyTss = weeklyCount > 0 ? Math.round(weeklyTss / Math.max(1, daysInPeriod)) : 0;
  const hrLogs = logs.filter((log) => log.averageHr != null);
  const avgHr = hrLogs.length > 0
    ? Math.round(hrLogs.reduce((sum, log) => sum + (log.averageHr || 0), 0) / hrLogs.length)
    : null;

  return { weeklyDistance, weeklyElevation, weeklyDuration, weeklyCount, weeklyTss, avgDailyTss, avgHr };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const weekStart = getWeekStart(now);
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

  // Period boundaries for stats (all UTC-based)
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
  const lastWeekEnd = new Date(weekStart.getTime() - 1);
  const monthStart = getMonthStart(now);
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthEnd = getMonthEnd(lastMonthStart);

  // Single batch of parallel queries — covers all dashboard data
  const [
    weekLogs,
    pmcLogs,
    goals,
    bodyMetrics,
    latestPlan,
    maxHrLog,
    latestAnalysisReport,
  ] = await Promise.all([
    // This week's logs — merged display + stats query
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: weekStart }, mergedIntoId: null },
      orderBy: { startDate: "desc" },
      select: {
        id: true, name: true, type: true, startDate: true,
        distanceMeters: true, durationSeconds: true,
        elevationGainMeters: true, averageHr: true,
        tss: true, remarks: true, workoutType: true,
      },
    }),
    // PMC — last 90 days (wider select to derive other periods in JS)
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: ninetyDaysAgo }, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: { startDate: true, distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    // Active goals
    prisma.raceGoal.findMany({
      where: { userId: session.user.id, status: "active" },
      orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
    }),
    // Body metrics (for fatigue + weight)
    prisma.bodyMetric.findMany({
      where: { userId: session.user.id },
      orderBy: { recordedAt: "desc" },
      take: 14,
      select: { recordedAt: true, restingHr: true, weightKg: true },
    }),
    // Latest coach notes
    prisma.weeklyPlan.findFirst({
      where: { userId: session.user.id, coachNotes: { not: null } },
      orderBy: { generatedAt: "desc" },
      select: { coachNotes: true, generatedAt: true },
    }),
    // Max HR estimate (highest maxHr from last 2 years)
    prisma.trainingLog.findFirst({
      where: {
        userId: session.user.id, maxHr: { not: null },
        startDate: { gte: new Date(now.getTime() - 2 * 365 * 86400000) },
        mergedIntoId: null,
      },
      orderBy: { maxHr: "desc" },
      select: { maxHr: true },
    }),
    // Latest analysis report for reasoning/metadata display
    prisma.analysisReport.findFirst({
      where: { userId: session.user.id, reportType: "coach_notes" },
      orderBy: { createdAt: "desc" },
      select: { id: true, reasoning: true, metrics: true, createdAt: true },
    }),
  ]);

  // Derive last-week, this-month, and last-month logs from the 90-day PMC data
  const lastWeekLogs = pmcLogs.filter(
    (l) => l.startDate >= lastWeekStart && l.startDate < weekStart
  );
  const monthLogs = pmcLogs.filter(
    (l) => l.startDate >= monthStart
  );
  const lastMonthLogs = pmcLogs.filter(
    (l) => l.startDate >= lastMonthStart && l.startDate <= lastMonthEnd
  );

  // ── Stats ─────────────────────────────────────────────────────────
  const daysThisMonth = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / 86400000));
  const daysLastMonth = Math.max(1, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate());

  const goalCount = goals.length;
  const latestWeight = bodyMetrics[0]?.weightKg || null;
  const latestRestingHr = bodyMetrics.find((m) => m.restingHr != null)?.restingHr || null;
  const estimatedMaxHr = maxHrLog?.maxHr || null;

  const stats = {
    weeklyDistance: aggregateLogs(weekLogs, 7).weeklyDistance,
    weeklyElevation: aggregateLogs(weekLogs, 7).weeklyElevation,
    weeklyDuration: aggregateLogs(weekLogs, 7).weeklyDuration,
    weeklyCount: aggregateLogs(weekLogs, 7).weeklyCount,
    weeklyTss: aggregateLogs(weekLogs, 7).weeklyTss,
    avgDailyTss: aggregateLogs(weekLogs, 7).avgDailyTss,
    avgHr: aggregateLogs(weekLogs, 7).avgHr,
    activeGoals: goalCount,
    latestWeight,
    latestRestingHr,
    estimatedMaxHr,
    lastWeek: lastWeekLogs.length > 0 ? aggregateLogs(lastWeekLogs, 7) : null,
    currentMonth: monthLogs.length > 0 ? aggregateLogs(monthLogs, daysThisMonth) : null,
    lastMonth: lastMonthLogs.length > 0 ? aggregateLogs(lastMonthLogs, daysLastMonth) : null,
  };

  // ── PMC ───────────────────────────────────────────────────────────
  const tssByDate: Record<string, number> = {};
  for (const log of pmcLogs) {
    const dateKey = log.startDate.toISOString().split("T")[0];
    const tss = log.tss || Math.round(log.durationSeconds / 3600 * 50);
    tssByDate[dateKey] = (tssByDate[dateKey] || 0) + tss;
  }

  // Fill in missing dates with tss: 0 so CTL/ATL/TSB decay properly on rest days,
  // matching the PMC chart computation in pmc-history/route.ts
  const pmcInput = Object.entries(tssByDate)
    .map(([date, tss]) => ({ date, tss }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let filledInput: { date: string; tss: number }[] = [];
  if (pmcInput.length > 0) {
    const startDate = new Date(pmcInput[0].date);
    const endDate = new Date(pmcInput[pmcInput.length - 1].date);
    const inputMap = new Map(pmcInput.map((d) => [d.date, d.tss]));
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = cursor.toISOString().split("T")[0];
      filledInput.push({ date: key, tss: inputMap.get(key) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const pmcResults = computePMC(filledInput);
  const latestPmc = pmcResults.length > 0
    ? pmcResults[pmcResults.length - 1]
    : { ctl: 0, atl: 0, tsb: 0, rampRate: null };

  let ctlTrend: "up" | "down" | "stable" = "stable";
  let atlTrend: "up" | "down" | "stable" = "stable";
  let tsbTrend: "up" | "down" | "stable" = "stable";

  if (pmcResults.length > 7) {
    const prev = pmcResults[pmcResults.length - 8];
    const curr = pmcResults[pmcResults.length - 1];
    const getTrend = (current: number, previous: number): "up" | "down" | "stable" => {
      const diff = current - previous;
      if (diff > 0.5) return "up";
      if (diff < -0.5) return "down";
      return "stable";
    };
    ctlTrend = getTrend(curr.ctl, prev.ctl);
    atlTrend = getTrend(curr.atl, prev.atl);
    tsbTrend = getTrend(curr.tsb, prev.tsb);
  }

  const pmc = {
    ctl: latestPmc.ctl,
    atl: latestPmc.atl,
    tsb: latestPmc.tsb,
    rampRate: latestPmc.rampRate,
    ctlTrend,
    atlTrend,
    tsbTrend,
  };

  // ── Goal summaries ────────────────────────────────────────────────
  const goalSummaries = goals.map((goal) => {
    const weeksUntil = Math.max(1, Math.ceil((goal.targetDate.getTime() - now.getTime()) / (7 * 86400000)));
    const totalDistance = pmcLogs.reduce((sum, log) => sum + (log.tss ? (log.durationSeconds / 3600 * 50) : 0), 0);
    const peakTarget = goal.distanceMeters * 0.7;
    const progress = Math.min(100, Math.round((totalDistance / peakTarget) * 100));
    const daysUntil = Math.max(0, Math.ceil((goal.targetDate.getTime() - now.getTime()) / 86400000));
    return {
      id: goal.id, name: goal.name, targetDate: goal.targetDate,
      distanceMeters: goal.distanceMeters, elevationGainMeters: goal.elevationGainMeters,
      priority: goal.priority, progress, daysUntil, goalStatement: goal.goalStatement,
    };
  });

  // ── TSS for readiness computation ─────────────────────────────────
  const weeklyTss = weekLogs.reduce((sum, l) => sum + (l.tss || 50), 0);

  // ── Readiness ─────────────────────────────────────────────────────
  const readinessResult = computeReadinessScore({
    weeklyVolumeMeters: weekLogs.reduce((sum, l) => sum + (l.distanceMeters || 0), 0),
    weeklyTss,
    weekStartDate: weekStart,
    primaryGoal: goals[0] || null,
    activityLogs: weekLogs,
  });

  let readinessLabel: string;
  let readinessDetail: string;
  if (readinessResult.readinessScore >= 70) { readinessLabel = "On Track"; readinessDetail = "Your training trajectory is aligned with your goals."; }
  else if (readinessResult.readinessScore >= 50) { readinessLabel = "Needs Attention"; readinessDetail = "Adjust volume or consistency to get back on track."; }
  else { readinessLabel = "Off Track"; readinessDetail = "Significant adjustments needed to reach your race goals."; }

  const readiness = {
    score: readinessResult.readinessScore,
    label: readinessLabel,
    detail: readinessDetail,
    volumeAdherence: readinessResult.volumeAdherence,
  };

  // ── Response ──────────────────────────────────────────────────────
  return NextResponse.json({
    logs: weekLogs,
    stats,
    goals: goalSummaries,
    readiness,
    pmc,
    coachNotes: latestPlan?.coachNotes || null,
    coachNotesAt: latestPlan?.generatedAt?.toISOString() || null,
    analysisReport: latestAnalysisReport ? {
      id: latestAnalysisReport.id,
      reasoning: latestAnalysisReport.reasoning,
      metrics: latestAnalysisReport.metrics,
      createdAt: latestAnalysisReport.createdAt.toISOString(),
    } : null,
  });
}
