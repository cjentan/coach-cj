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
import { computeReadinessScore, computeFatigueSignals } from "./training-health";

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
  /** Average weekly volume over the last ~3 months (12 completed weeks) in km.
   *  More stable than the 4-week average — reflects sustained training load. */
  longTermVolumeKm: number;
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
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000);

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
      where: { userId, mergedIntoId: null, startDate: { gte: ninetyDaysAgo } },
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
  // Fill in missing dates with tss: 0 so CTL/ATL/TSB decay properly on rest days
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

  // ── Long-term average volume (last 12 completed weeks) ─
  // More stable than 4-week — reflects sustained training load.
  const LONG_TERM_WEEKS = 12;
  let longTermVolumeBuckets = 0;
  let longTermVolumeSum = 0;
  for (let w = LONG_TERM_WEEKS; w >= 1; w--) {
    const start = new Date(Date.now() - (w + 1) * 7 * 86400000);
    const end = new Date(Date.now() - w * 7 * 86400000);
    const weekLogs = trainingLogs.filter(
      (l) => l.startDate >= start && l.startDate < end
    );
    longTermVolumeSum += weekLogs.reduce((s, l) => s + (l.distanceMeters || 0), 0);
    longTermVolumeBuckets++;
  }
  const longTermVolumeKm = Math.round(
    longTermVolumeSum / (longTermVolumeBuckets || 1) / 1000
  );

  // ── Current week ─────────────────────────────────────
  const currentWeekLogs = trainingLogs.filter((l) => l.startDate >= weekStart);
  const currentWeek = {
    volumeMeters: currentWeekLogs.reduce((s, l) => s + (l.distanceMeters || 0), 0),
    elevationMeters: currentWeekLogs.reduce((s, l) => s + (l.elevationGainMeters || 0), 0),
    durationSeconds: currentWeekLogs.reduce((s, l) => s + l.durationSeconds, 0),
    activityCount: currentWeekLogs.length,
  };

  // ── Fatigue (simplified rule-based) ──────────────────
  const weeklyTss = currentWeekLogs.reduce((s, l) => s + (l.tss || 50), 0);
  const fatigueResult = computeFatigueSignals({
    weeklyTss,
    activityCount: currentWeekLogs.length,
    bodyMetrics,
  });
  const fatigue =
    fatigueResult.signals.length > 0 ? fatigueResult : null;

  // ── Readiness ───────────────────────────────────────
  const readinessResult = computeReadinessScore({
    weeklyVolumeMeters: currentWeek.volumeMeters,
    weeklyTss,
    weekStartDate: weekStart,
    primaryGoal: goals[0] ?? null,
    activityLogs: currentWeekLogs,
  });
  let volumeAdherence = readinessResult.volumeAdherence;
  const consistencyScore = readinessResult.consistencyScore;

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

  const readinessScore = readinessResult.readinessScore;

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
  const bestPerformanceResults = await Promise.all(
    goals.map(async (goal) => {
      if (!goal.distanceMeters || goal.distanceMeters <= 0) return { goalId: goal.id, result: null };

      // Look for activities within ±10% of goal distance
      const minDist = goal.distanceMeters * 0.9;
      const maxDist = goal.distanceMeters * 1.1;

      const best = await prisma.trainingLog.findFirst({
        where: {
          userId,
          mergedIntoId: null,
          distanceMeters: { gte: minDist, lte: maxDist },
          durationSeconds: { gte: 600 }, // at least 10 min
        },
        orderBy: { durationSeconds: "asc" },
        select: {
          name: true,
          startDate: true,
          distanceMeters: true,
          durationSeconds: true,
        },
      });

      if (!best) return { goalId: goal.id, result: null };

      const pacePerKm = best.distanceMeters && best.distanceMeters > 0
        ? (best.durationSeconds / (best.distanceMeters / 1000))
        : 0;

      const mins = Math.floor(pacePerKm / 60);
      const secs = Math.round(pacePerKm % 60);

      return {
        goalId: goal.id,
        result: {
          timeSeconds: best.durationSeconds,
          pacePerKm: `${mins}:${secs.toString().padStart(2, "0")} /km`,
          date: best.startDate.toISOString().split("T")[0],
          activityName: best.name,
          distanceMeters: best.distanceMeters || 0,
        },
      };
    })
  );

  const bestPerformances = new Map<string, TrainingContext["goals"][number]["bestPrevious"]>();
  for (const { goalId, result } of bestPerformanceResults) {
    if (result) bestPerformances.set(goalId, result);
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
    longTermVolumeKm,
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
