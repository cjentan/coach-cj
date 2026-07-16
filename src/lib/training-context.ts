/**
 * Shared training context gatherer.
 *
 * Consolidates data-gathering patterns from:
 *   /api/dashboard/load
 *   /api/dashboard/notes
 *   /api/dashboard/plan/adjust
 *   workers/entrypoint.ts  (sunday-review)
 *
 * Returns a single TrainingContext object that the AI coach service
 * uses for analysis, chat, and plan suggestions.
 */
import { prisma } from "./prisma";
import { getWeekStart } from "./utils";
import { computePMC } from "./pmc";

// ── Types ──────────────────────────────────────────────

export interface WeeklyPlanInfo {
  targetVolumeMeters: number;
  targetElevationMeters: number;
  plannedSessions: Array<{
    dayOfWeek: number;
    type: string;
    description: string;
    targetDistance: number | null;
    targetElevation: number | null;
    targetDuration: number;
    facility: string | null;
  }>;
  adjustments: string[];
}

export interface EnrichedGoal {
  id: string;
  name: string;
  targetDate: string;
  distanceMeters: number;
  elevationGainMeters: number | null;
  priority: string;
  goalStatement?: string | null;
  targetTimeSeconds?: number | null;
  courseProfileSummary?: {
    distanceMeters: number;
    elevationGainMeters: number;
    maxElevation: number;
    minElevation: number;
  } | null;
  /** Best previous performance at this distance or similar, if any */
  bestPrevious?: {
    timeSeconds: number;
    pacePerKm: string;
    date: string;
    activityName: string;
    distanceMeters: number;
  } | null;
}

export interface PlanWeekSummary {
  weekStartDate: string;
  targetVolumeMeters: number | null;
  sessionCount: number;
  adjustmentSummary: string | null;
}

export interface TrainingContext {
  athleteName: string;
  goals: EnrichedGoal[];
  planWeeks: PlanWeekSummary[];
  recentWeeks: Array<{
    label: string;
    volumeMeters: number;
    elevationMeters: number;
    durationSeconds: number;
    activityCount: number;
  }>;
  currentWeek: {
    volumeMeters: number;
    elevationMeters: number;
    durationSeconds: number;
    activityCount: number;
  };
  pmc: {
    ctl: number;
    atl: number;
    tsb: number;
    tsbTrend: string;
  };
  fatigue: {
    severity: string;
    signals: string[];
    recommendations: string[];
  } | null;
  readinessScore: number;
  volumeAdherence: number;
  consistencyScore: number;
  dailyHealth?: {
    sleepAvg: number;
    hrvAvg: number;
    bodyBatteryAvg: number;
    stressAvg: number;
    restingHrAvg: number;
    sleepScoreAvg: number | null;
    hrvStatus: string | null;
  };
  recentRemarks?: Array<{ date: string; activity: string; remarks: string }>;
  trainingContext?: string;
  weeklyPlan: WeeklyPlanInfo | null;
  adjustmentHistory: Array<{ timestamp: string; prompt: string; summary: string }>;
}

// ── Gather ─────────────────────────────────────────────

export async function gatherTrainingContext(userId: string): Promise<TrainingContext> {
  const now = new Date();
  const weekStart = getWeekStart(now);

  // ── Single batch of parallel queries ────────────────
  const [
    trainingLogs,
    goals,
    bodyMetrics,
    dailyHealth,
    user,
    latestPlan,
    fatigueAlert,
  ] = await Promise.all([
    // Last 90 days of logs for PMC + weekly aggregates
    prisma.trainingLog.findMany({
      where: { userId, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: {
        startDate: true,
        name: true,
        type: true,
        distanceMeters: true,
        elevationGainMeters: true,
        durationSeconds: true,
        tss: true,
        remarks: true,
      },
    }),
    // Active goals
    prisma.raceGoal.findMany({
      where: { userId, status: "active" },
      orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
    }),
    // Body metrics (for fatigue)
    prisma.bodyMetric.findMany({
      where: { userId },
      orderBy: { recordedAt: "desc" },
      take: 14,
      select: { recordedAt: true, restingHr: true, weightKg: true },
    }),
    // Daily health (last 7 days)
    prisma.dailyHealth.findMany({
      where: { userId, date: { gte: new Date(now.getTime() - 7 * 86400000) } },
      orderBy: { date: "desc" },
      select: {
        sleepSeconds: true,
        sleepScore: true,
        overnightHrv: true,
        hrvStatus: true,
        bodyBatteryMin: true,
        bodyBatteryMax: true,
        avgStress: true,
        restingHeartRate: true,
      },
    }),
    // User profile — LLM config + training context
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, trainingContext: true },
    }),
    // Latest weekly plan for current/next week
    prisma.weeklyPlan.findFirst({
      where: { userId, weekStartDate: { gte: weekStart } },
      orderBy: { weekStartDate: "asc" },
    }),
    // Latest unacknowledged fatigue alert
    prisma.fatigueAlert.findFirst({
      where: { userId, acknowledged: false },
      orderBy: { detectedAt: "desc" },
    }),
  ]);

  // Compute plan end date from goals (use nearest goal, or 12 weeks out)
  const planEndDate = goals.length > 0
    ? goals.reduce((earliest, g) => g.targetDate < earliest ? g.targetDate : earliest, goals[0].targetDate)
    : new Date(now.getTime() + 84 * 86400000);

  // All weekly plans from now until the nearest goal
  const allPlans = await prisma.weeklyPlan.findMany({
    where: {
      userId,
      weekStartDate: { gte: weekStart, lte: planEndDate },
    },
    orderBy: { weekStartDate: "asc" },
    select: {
      weekStartDate: true,
      targetVolumeMeters: true,
      plannedSessions: true,
      adjustments: true,
    },
  });

  const planWeeks: TrainingContext["planWeeks"] = allPlans.map((p) => {
    const sessions = Array.isArray(p.plannedSessions) ? p.plannedSessions : [];
    const adjSummary = p.adjustments && p.adjustments.length > 0
      ? p.adjustments[0].slice(0, 100)
      : null;
    return {
      weekStartDate: p.weekStartDate.toISOString().split("T")[0],
      targetVolumeMeters: p.targetVolumeMeters,
      sessionCount: Array.isArray(sessions) ? sessions.length : 0,
      adjustmentSummary: adjSummary,
    };
  });

  // ── PMC computation ─────────────────────────────────
  const tssByDate: Record<string, number> = {};
  for (const log of trainingLogs) {
    const dateKey = log.startDate.toISOString().split("T")[0];
    tssByDate[dateKey] = (tssByDate[dateKey] || 0) + (log.tss || 50);
  }
  const pmcInput = Object.entries(tssByDate).map(([date, tss]) => ({ date, tss }));
  const pmcResults = computePMC(pmcInput);
  const latestPmc = pmcResults.length > 0
    ? pmcResults[pmcResults.length - 1]
    : { ctl: 30, atl: 30, tsb: 0 };

  let tsbTrend = "stable";
  if (pmcResults.length >= 2) {
    const prev = pmcResults[pmcResults.length - 2].tsb;
    const curr = latestPmc.tsb;
    if (curr - prev > 0.5) tsbTrend = "rising";
    else if (curr - prev < -0.5) tsbTrend = "falling";
  }

  // ── Weekly aggregates (last 4 weeks) ─────────────────
  const recentWeeks: TrainingContext["recentWeeks"] = [];
  for (let w = 3; w >= 0; w--) {
    const start = new Date(now.getTime() - (w + 1) * 7 * 86400000);
    const end = new Date(now.getTime() - w * 7 * 86400000);
    const weekLogs = trainingLogs.filter(
      (l) => l.startDate >= start && l.startDate < end
    );
    const label = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    recentWeeks.push({
      label,
      volumeMeters: weekLogs.reduce((s, l) => s + (l.distanceMeters || 0), 0),
      elevationMeters: weekLogs.reduce((s, l) => s + (l.elevationGainMeters || 0), 0),
      durationSeconds: weekLogs.reduce((s, l) => s + l.durationSeconds, 0),
      activityCount: weekLogs.length,
    });
  }

  // ── Current week ─────────────────────────────────────
  const currentWeekLogs = trainingLogs.filter((l) => l.startDate >= weekStart);
  const currentWeek = {
    volumeMeters: currentWeekLogs.reduce((s, l) => s + (l.distanceMeters || 0), 0),
    elevationMeters: currentWeekLogs.reduce((s, l) => s + (l.elevationGainMeters || 0), 0),
    durationSeconds: currentWeekLogs.reduce((s, l) => s + l.durationSeconds, 0),
    activityCount: currentWeekLogs.length,
  };

  // ── Fatigue (simplified rule-based) ──────────────────
  const weeklyVolume = currentWeek.volumeMeters;
  const weeklyTss = currentWeekLogs.reduce((s, l) => s + (l.tss || 50), 0);
  const signals: string[] = [];
  const recommendations: string[] = [];

  if (weeklyTss > 600) {
    signals.push("High training volume this week");
    recommendations.push("Your TSS load is high. Prioritize sleep and nutrition this week.");
  }
  if (weeklyTss > 350 && currentWeekLogs.length < 3) {
    signals.push("High load with few sessions");
    recommendations.push("Consider distributing volume across more sessions.");
  }
  if (bodyMetrics.length >= 3) {
    const recentResting = bodyMetrics.slice(0, 3).reduce((s, m) => s + (m.restingHr || 0), 0) / 3;
    const olderResting = bodyMetrics.length >= 6
      ? bodyMetrics.slice(3, 6).reduce((s, m) => s + (m.restingHr || 0), 0) / 3
      : recentResting;
    if (olderResting > 0 && recentResting - olderResting > 5) {
      signals.push("Resting HR elevated");
      recommendations.push("Your resting heart rate is trending up. Consider lighter training.");
    }
  }

  let fatigueSeverity = "none";
  if (signals.length >= 3) fatigueSeverity = "high";
  else if (signals.length === 2) fatigueSeverity = "medium";
  else if (signals.length === 1) fatigueSeverity = "low";

  const fatigue = signals.length > 0
    ? { severity: fatigueSeverity, signals, recommendations }
    : null;

  // ── Readiness ───────────────────────────────────────
  let volumeAdherence = 50;
  const primaryGoal = goals[0];
  if (primaryGoal) {
    const weeksUntil = Math.max(1, Math.ceil(
      (primaryGoal.targetDate.getTime() - now.getTime()) / (7 * 86400000)
    ));
    const targetWeekly = primaryGoal.distanceMeters / (weeksUntil * 0.7);
    volumeAdherence = Math.min(100, Math.round((weeklyVolume / Math.max(1, targetWeekly)) * 100));
  }

  const elapsedDays = Math.max(1, Math.min(7, Math.ceil(
    (now.getTime() - weekStart.getTime()) / 86400000
  )));
  const activeDays = new Set(
    currentWeekLogs.map((l) => l.startDate.toISOString().split("T")[0])
  ).size;
  const consistencyScore = Math.min(100, Math.round((activeDays / elapsedDays) * 100));

  // ── Daily health averages ───────────────────────────
  let dailyHealthResult: TrainingContext["dailyHealth"] | undefined;
  if (dailyHealth.length > 0) {
    const n = dailyHealth.length;
    dailyHealthResult = {
      sleepAvg: Math.round(
        dailyHealth.reduce((s, d) => s + (d.sleepSeconds || 0), 0) /
        Math.max(1, dailyHealth.filter((d) => d.sleepSeconds).length) / 60
      ),
      hrvAvg: Math.round(
        dailyHealth.reduce((s, d) => s + (d.overnightHrv || 0), 0) /
        Math.max(1, dailyHealth.filter((d) => d.overnightHrv).length)
      ),
      bodyBatteryAvg: Math.round(
        dailyHealth.reduce((s, d) => s + ((d.bodyBatteryMin || 0) + (d.bodyBatteryMax || 0)) / 2, 0) / n
      ),
      stressAvg: Math.round(
        dailyHealth.reduce((s, d) => s + (d.avgStress || 0), 0) /
        Math.max(1, dailyHealth.filter((d) => d.avgStress).length)
      ),
      restingHrAvg: Math.round(
        dailyHealth.reduce((s, d) => s + (d.restingHeartRate || 0), 0) /
        Math.max(1, dailyHealth.filter((d) => d.restingHeartRate).length)
      ),
      sleepScoreAvg: dailyHealth.filter((d) => d.sleepScore).length > 0
        ? Math.round(
            dailyHealth.reduce((s, d) => s + (d.sleepScore || 0), 0) /
            dailyHealth.filter((d) => d.sleepScore).length
          )
        : null,
      hrvStatus: dailyHealth.find((d) => d.hrvStatus)?.hrvStatus || null,
    };
  }

  // ── Recent remarks ──────────────────────────────────
  const recentRemarks = trainingLogs
    .filter((l) => l.remarks)
    .slice(-10)
    .map((l) => ({
      date: l.startDate.toISOString().split("T")[0],
      activity: l.name,
      remarks: l.remarks!,
    }));

  // ── Readiness score ─────────────────────────────────
  const restBalance = Math.max(0, 100 - Math.min(100, Math.round((weeklyTss / 700) * 100)));
  const trendScore = 75; // neutral fallback
  let fatiguePenalty = 0;
  if (weeklyTss > 700) fatiguePenalty = 20;
  else if (weeklyTss > 500) fatiguePenalty = 10;
  else if (weeklyTss > 350) fatiguePenalty = 5;

  const readinessScore = Math.max(0, Math.min(100, Math.round(
    volumeAdherence * 0.40 +
    consistencyScore * 0.25 +
    restBalance * 0.20 +
    trendScore * 0.15 -
    fatiguePenalty
  )));

  // ── Weekly plan ─────────────────────────────────────
  let weeklyPlan: TrainingContext["weeklyPlan"] = null;
  let adjustmentHistory: TrainingContext["adjustmentHistory"] = [];

  if (latestPlan) {
    const sessions = latestPlan.plannedSessions;
    const sessionsArr = Array.isArray(sessions) ? (sessions as Array<Record<string, unknown>>) : [];
    weeklyPlan = {
      targetVolumeMeters: latestPlan.targetVolumeMeters || 0,
      targetElevationMeters: latestPlan.targetElevationMeters || 0,
      plannedSessions: sessionsArr as WeeklyPlanInfo["plannedSessions"],
      adjustments: latestPlan.adjustments || [],
    };
    adjustmentHistory = (latestPlan.adjustmentHistory as TrainingContext["adjustmentHistory"]) || [];
  }

  // ── Best previous performances for each goal ─────────
  // For each goal, find the fastest activity at a similar distance
  const bestPerformances = new Map<string, TrainingContext["goals"][number]["bestPrevious"]>();
  for (const goal of goals) {
    if (!goal.distanceMeters || goal.distanceMeters <= 0) continue;

    // Look for activities within ±10% of goal distance
    const minDist = goal.distanceMeters * 0.9;
    const maxDist = goal.distanceMeters * 1.1;

    const candidates = await prisma.trainingLog.findMany({
      where: {
        userId,
        mergedIntoId: null,
        distanceMeters: { gte: minDist, lte: maxDist },
        durationSeconds: { gte: 600 }, // at least 10 min
      },
      orderBy: { startDate: "desc" },
      select: {
        name: true,
        startDate: true,
        distanceMeters: true,
        durationSeconds: true,
      },
    });

    if (candidates.length > 0) {
      // Find the fastest (best pace) — smallest duration per meter
      const best = candidates.reduce((a, b) => {
        const paceA = a.durationSeconds / a.distanceMeters!;
        const paceB = b.durationSeconds / b.distanceMeters!;
        return paceA < paceB ? a : b;
      });

      const pacePerKm = best.distanceMeters && best.distanceMeters > 0
        ? (best.durationSeconds / (best.distanceMeters / 1000))
        : 0;

      const mins = Math.floor(pacePerKm / 60);
      const secs = Math.round(pacePerKm % 60);

      bestPerformances.set(goal.id, {
        timeSeconds: best.durationSeconds,
        pacePerKm: `${mins}:${secs.toString().padStart(2, "0")} /km`,
        date: best.startDate.toISOString().split("T")[0],
        activityName: best.name,
        distanceMeters: best.distanceMeters || 0,
      });
    }
  }

  // ── Assemble result ─────────────────────────────────
  return {
    athleteName: user?.name || "Athlete",
    goals: goals.map((g) => {
      const profile = g.courseProfile as {
        distanceMeters: number;
        elevationGainMeters: number;
        maxElevation: number;
        minElevation: number;
      } | null;

      return {
        id: g.id,
        name: g.name,
        targetDate: g.targetDate.toISOString().split("T")[0],
        distanceMeters: g.distanceMeters,
        elevationGainMeters: g.elevationGainMeters,
        targetTimeSeconds: g.targetTimeSeconds,
        priority: g.priority,
        goalStatement: g.goalStatement,
        courseProfileSummary: profile
          ? {
              distanceMeters: profile.distanceMeters,
              elevationGainMeters: profile.elevationGainMeters,
              maxElevation: profile.maxElevation,
              minElevation: profile.minElevation,
            }
          : null,
        bestPrevious: bestPerformances.get(g.id) || null,
      };
    }),
    planWeeks,
    recentWeeks,
    currentWeek,
    pmc: {
      ctl: latestPmc.ctl,
      atl: latestPmc.atl,
      tsb: latestPmc.tsb,
      tsbTrend,
    },
    fatigue,
    readinessScore,
    volumeAdherence,
    consistencyScore,
    dailyHealth: dailyHealthResult,
    recentRemarks,
    trainingContext: user?.trainingContext ?? undefined,
    weeklyPlan,
    adjustmentHistory,
  };
}
