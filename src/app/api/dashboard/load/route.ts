import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart, getMonthStart, getMonthEnd } from "@/lib/utils";
import { computePMC } from "@/lib/pmc";

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
  const sixWeeksAgo = new Date(now.getTime() - 42 * 86400000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

  // Period boundaries for stats
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
  const lastWeekEnd = new Date(weekStart.getTime() - 1);
  const monthStart = getMonthStart(now);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = getMonthEnd(lastMonthStart);

  // Single batch of parallel queries — covers all dashboard data
  const [
    recentLogs,
    statsWeekLogs,
    lastWeekLogs,
    monthLogs,
    lastMonthLogs,
    pmcLogs,
    goals,
    bodyMetrics,
    availabilityCount,
    fatigueRecentLogs,
    fatigueOlderLogs,
    latestPlan,
    maxHrLog,
  ] = await Promise.all([
    // Recent logs (for display)
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: weekStart }, mergedIntoId: null },
      orderBy: { startDate: "desc" },
      select: {
        id: true, name: true, type: true, startDate: true,
        distanceMeters: true, durationSeconds: true,
        elevationGainMeters: true, averageHr: true,
        tss: true, remarks: true,
      },
    }),
    // Stats — this week
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: weekStart }, mergedIntoId: null },
      select: { startDate: true, distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    // Stats — last week
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: lastWeekStart, lt: weekStart }, mergedIntoId: null },
      select: { distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    // Stats — this month
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: monthStart }, mergedIntoId: null },
      select: { distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    // Stats — last month
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: lastMonthStart, lte: lastMonthEnd }, mergedIntoId: null },
      select: { distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    // PMC — last 90 days (stored TSS only, no rawJson)
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: ninetyDaysAgo }, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: { startDate: true, tss: true, durationSeconds: true },
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
    // Availability count
    prisma.trainingAvailability.count({ where: { userId: session.user.id } }),
    // Fatigue — recent logs (2 weeks)
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: twoWeeksAgo() }, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: { startDate: true, tss: true, averageHr: true, distanceMeters: true },
    }),
    // Fatigue — older logs (6 weeks ago to 2 weeks ago)
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: sixWeeksAgo, lt: twoWeeksAgo() }, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: { startDate: true, tss: true, averageHr: true },
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
  ]);

  const twoWeeksAgoVal = new Date(now.getTime() - 14 * 86400000);

  // ── Stats ─────────────────────────────────────────────────────────
  const daysThisMonth = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / 86400000));
  const daysLastMonth = Math.max(1, new Date(now.getFullYear(), now.getMonth(), 0).getDate());

  const goalCount = goals.length;
  const latestWeight = bodyMetrics[0]?.weightKg || null;
  const latestRestingHr = bodyMetrics.find((m) => m.restingHr != null)?.restingHr || null;
  const estimatedMaxHr = maxHrLog?.maxHr || null;

  const stats = {
    weeklyDistance: aggregateLogs(statsWeekLogs, 7).weeklyDistance,
    weeklyElevation: aggregateLogs(statsWeekLogs, 7).weeklyElevation,
    weeklyDuration: aggregateLogs(statsWeekLogs, 7).weeklyDuration,
    weeklyCount: aggregateLogs(statsWeekLogs, 7).weeklyCount,
    weeklyTss: aggregateLogs(statsWeekLogs, 7).weeklyTss,
    avgDailyTss: aggregateLogs(statsWeekLogs, 7).avgDailyTss,
    avgHr: aggregateLogs(statsWeekLogs, 7).avgHr,
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

  const pmcInput = Object.entries(tssByDate).map(([date, tss]) => ({ date, tss }));
  const pmcResults = computePMC(pmcInput);
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
      priority: goal.priority, progress, daysUntil,
    };
  });

  // ── Fatigue ───────────────────────────────────────────────────────
  const thisWeekFatigueLogs = fatigueRecentLogs.filter((l) => l.startDate >= weekStart);
  const weeklyTss = thisWeekFatigueLogs.reduce((sum, l) => sum + (l.tss || 50), 0);

  const signals: string[] = [];
  const recommendations: string[] = [];

  // High volume check
  if (weeklyTss > 600) {
    signals.push("High training volume this week");
    recommendations.push("Your TSS load is high. Prioritize sleep and nutrition this week.");
  }

  // HR trend
  const recentHrLogs = thisWeekFatigueLogs.filter((l) => l.averageHr != null && l.averageHr > 0);
  const olderHrLogs = fatigueOlderLogs.filter((l) => l.averageHr != null && l.averageHr > 0);
  if (recentHrLogs.length >= 3 && olderHrLogs.length >= 5) {
    const recentAvg = recentHrLogs.reduce((sum, l) => sum + (l.averageHr || 0), 0) / recentHrLogs.length;
    const olderAvg = olderHrLogs.reduce((sum, l) => sum + (l.averageHr || 0), 0) / olderHrLogs.length;
    const hrDrift = recentAvg - olderAvg;
    if (hrDrift > 6) {
      signals.push(`Exercise HR +${Math.round(hrDrift)} bpm above baseline`);
      recommendations.push("Your heart rate is elevated at similar efforts. This can indicate accumulating fatigue or insufficient recovery.");
    } else if (hrDrift > 3) {
      signals.push(`Exercise HR slightly elevated (+${Math.round(hrDrift)} bpm)`);
    }
  }

  // Resting HR trend
  const restingHrValues = bodyMetrics.filter((m) => m.restingHr != null).slice(0, 7);
  if (restingHrValues.length >= 3) {
    const recentResting = restingHrValues.slice(0, 3).reduce((sum, m) => sum + (m.restingHr || 0), 0) / 3;
    const olderResting = restingHrValues.length >= 6
      ? restingHrValues.slice(3, 6).reduce((sum, m) => sum + (m.restingHr || 0), 0) / 3
      : recentResting;
    const restingDrift = recentResting - olderResting;
    if (restingDrift > 5) {
      signals.push(`Resting HR +${Math.round(restingDrift)} bpm above baseline`);
      recommendations.push("Your resting heart rate is trending up — a key sign of autonomic stress. Consider a lighter training week.");
    }
  }

  // Consistency
  const weekLogsCount = recentLogs.length;
  const expectedSessions = Math.max(1, availabilityCount);
  const consistency = Math.round((weekLogsCount / expectedSessions) * 100);
  if (consistency < 50) {
    signals.push(`Low consistency (${consistency}% of planned sessions)`);
    recommendations.push(`You've completed ${weekLogsCount} of ~${expectedSessions} planned sessions this week.`);
  }

  // Weight stability
  const recentWeights = bodyMetrics.filter((m) => m.weightKg != null).slice(0, 7);
  if (recentWeights.length >= 3) {
    const recentW = recentWeights.slice(0, 3).reduce((sum, m) => sum + (m.weightKg || 0), 0) / 3;
    const olderW = recentWeights.length >= 6
      ? recentWeights.slice(3, 6).reduce((sum, m) => sum + (m.weightKg || 0), 0) / 3
      : recentW;
    const weightLoss = olderW - recentW;
    if (weightLoss > 1.5) {
      signals.push(`Rapid weight loss (${weightLoss.toFixed(1)} kg in recent days)`);
      recommendations.push("Unexplained rapid weight loss can signal under-fueling.");
    }
  }

  let fatigueSeverity: string;
  let fatigueSummary: string;
  if (signals.length >= 3) {
    fatigueSeverity = "high";
    fatigueSummary = "Multiple fatigue signals detected. Strongly consider reducing volume.";
  } else if (signals.length === 2) {
    fatigueSeverity = "medium";
    fatigueSummary = "Some fatigue signals present. Monitor how you feel.";
  } else if (signals.length === 1) {
    fatigueSeverity = "low";
    fatigueSummary = "One minor signal — likely within normal training fluctuations.";
  } else {
    fatigueSeverity = "clear";
    fatigueSummary = "No fatigue signals detected.";
  }
  if (recommendations.length === 0 && weekLogsCount > 0) {
    recommendations.push("Training looks balanced. Keep up the consistency.");
  }

  const fatigue = {
    severity: fatigueSeverity,
    summary: fatigueSummary,
    signals,
    recommendations,
    consistency,
    weeklyTss,
  };

  // ── Readiness ─────────────────────────────────────────────────────
  // Simplified readiness computation (same logic as original)
  const weeklyVolume = statsWeekLogs.reduce((sum, l) => sum + (l.distanceMeters || 0), 0);
  const weeklyElevation = statsWeekLogs.reduce((sum, l) => sum + (l.elevationGainMeters || 0), 0);
  const weeklyDuration = statsWeekLogs.reduce((sum, l) => sum + (l.durationSeconds || 0), 0);

  let volumeAdherence = 50;
  const primaryGoal = goals[0];
  if (primaryGoal) {
    const weeksUntil = Math.max(1, Math.ceil((primaryGoal.targetDate.getTime() - now.getTime()) / (7 * 86400000)));
    const targetWeekly = primaryGoal.distanceMeters / (weeksUntil * 0.7);
    volumeAdherence = Math.min(100, Math.round((weeklyVolume / Math.max(1, targetWeekly)) * 100));
  } else {
    const avgWeeklyVolume = statsWeekLogs.length > 0
      ? statsWeekLogs.reduce((sum, l) => sum + (l.distanceMeters || 0), 0)
      : 0;
    if (avgWeeklyVolume > 0) {
      volumeAdherence = Math.min(100, 75);
    }
  }

  const elapsedDays = Math.max(1, Math.min(7, Math.ceil((now.getTime() - weekStart.getTime()) / 86400000)));
  const activeDays = new Set(statsWeekLogs.map((l) => l.startDate.toISOString().split("T")[0])).size;
  const consistencyScore = Math.min(100, Math.round((activeDays / elapsedDays) * 100));

  const restBalance = Math.max(0, 100 - Math.min(100, Math.round((weeklyTss / 700) * 100)));

  const weeklyVolumes: number[] = [];
  for (let w = 3; w >= 0; w--) {
    const start = new Date(now.getTime() - (w + 1) * 7 * 86400000);
    const end = new Date(now.getTime() - w * 7 * 86400000);
    const wLogs = pmcLogs.filter((l) => l.startDate >= start && l.startDate < end);
    weeklyVolumes.push(wLogs.reduce((s, l) => s + (l.durationSeconds || 0), 0));
  }
  const n = weeklyVolumes.length;
  const xMean = (n - 1) / 2;
  const yMean = weeklyVolumes.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (weeklyVolumes[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  const slope = den > 0 ? num / den : 0;
  const trendPct = yMean > 0 ? Math.round((slope / yMean) * 100) : 0;
  const absTrend = Math.abs(trendPct);
  let trendScore: number;
  if (absTrend <= 5) trendScore = 100;
  else if (absTrend <= 15) trendScore = 100 - (absTrend - 5) * 2;
  else if (absTrend <= 30) trendScore = 80 - (absTrend - 15) * 1;
  else trendScore = Math.max(30, 65 - (absTrend - 30) * 0.5);
  trendScore = Math.round(trendScore);

  let fatiguePenalty = 0;
  if (weeklyTss > 700) fatiguePenalty = 20;
  else if (weeklyTss > 500) fatiguePenalty = 10;
  else if (weeklyTss > 350) fatiguePenalty = 5;

  let readinessScore = Math.max(0, Math.min(100, Math.round(
    volumeAdherence * 0.40 + consistencyScore * 0.25 + restBalance * 0.20 + trendScore * 0.15 - fatiguePenalty
  )));
  let readinessLabel: string;
  let readinessDetail: string;
  if (readinessScore >= 70) { readinessLabel = "On Track"; readinessDetail = "Your training trajectory is aligned with your goals."; }
  else if (readinessScore >= 50) { readinessLabel = "Needs Attention"; readinessDetail = "Adjust volume or consistency to get back on track."; }
  else { readinessLabel = "Off Track"; readinessDetail = "Significant adjustments needed to reach your race goals."; }

  const readiness = {
    score: readinessScore,
    label: readinessLabel,
    detail: readinessDetail,
    volumeAdherence,
  };

  // ── Response ──────────────────────────────────────────────────────
  return NextResponse.json({
    logs: recentLogs,
    stats,
    goals: goalSummaries,
    fatigue,
    readiness,
    pmc,
    coachNotes: latestPlan?.coachNotes || null,
    coachNotesAt: latestPlan?.generatedAt?.toISOString() || null,
  });
}

// Helper for two-weeks-ago boundary
function twoWeeksAgo(): Date {
  return new Date(Date.now() - 14 * 86400000);
}
