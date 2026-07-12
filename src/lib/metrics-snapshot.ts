/**
 * Weekly metrics snapshot utility.
 *
 * Computes a full week's training metrics and stores them in WeeklyAssessment
 * so historical trend charts can query pre-computed data instead of
 * recomputing from raw logs on every page load.
 */
import { prisma } from "@/lib/prisma";
import { computePMC } from "@/lib/pmc";
import { computeBestTss } from "@/lib/trackpoint-metrics";
import { getWeekStart } from "@/lib/utils";

/** Snapshots the given week's metrics for the user. Idempotent (upsert). */
export async function snapshotWeek(
  userId: string,
  weekStartDate: Date,
): Promise<void> {
  const weekStart = getWeekStart(weekStartDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7); // Monday 00:00 of next week

  // ── Fetch data ──────────────────────────────────────────────
  const ninetyDaysBeforeEnd = new Date(weekEnd.getTime() - 90 * 86400000);

  const [weekLogs, pmcLogs, goals, bodyMetrics, availabilityCount] =
    await Promise.all([
      // This week's logs
      prisma.trainingLog.findMany({
        where: {
          userId,
          startDate: { gte: weekStart, lt: weekEnd },
        },
        select: {
          id: true,
          startDate: true,
          distanceMeters: true,
          elevationGainMeters: true,
          durationSeconds: true,
          averageHr: true,
          maxHr: true,
          tss: true,
          rawJson: true,
        },
      }),
      // Logs for PMC computation (90 days before snapshot week end)
      prisma.trainingLog.findMany({
        where: {
          userId,
          startDate: { gte: ninetyDaysBeforeEnd, lt: weekEnd },
        },
        orderBy: { startDate: "asc" },
        select: {
          startDate: true,
          tss: true,
          durationSeconds: true,
          averageHr: true,
          maxHr: true,
          rawJson: true,
        },
      }),
      // Active goals
      prisma.raceGoal.findMany({
        where: { userId, status: "active" },
        orderBy: { priority: "asc" },
      }),
      // Body metrics for the user
      prisma.bodyMetric.findMany({
        where: { userId },
        orderBy: { recordedAt: "desc" },
        take: 30,
      }),
      // Availability count
      prisma.trainingAvailability.count({ where: { userId } }),
    ]);

  // ── Weekly aggregates ───────────────────────────────────────
  const weeklyVolume = weekLogs.reduce(
    (sum, l) => sum + (l.distanceMeters || 0),
    0,
  );
  const weeklyElevation = weekLogs.reduce(
    (sum, l) => sum + (l.elevationGainMeters || 0),
    0,
  );
  const weeklyDuration = weekLogs.reduce(
    (sum, l) => sum + (l.durationSeconds || 0),
    0,
  );
  const weeklyCount = weekLogs.length;

  // ── TSS computation (trackpoint-aware, per-log) ─────────────
  let weeklyTss = 0;
  for (const log of weekLogs) {
    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as any[] | undefined;
    const tss =
      trackPoints && trackPoints.length >= 2
        ? computeBestTss(
            trackPoints as any,
            log.averageHr,
            log.maxHr,
            log.durationSeconds,
          )
        : log.tss || Math.round((log.durationSeconds / 3600) * 50);
    weeklyTss += tss;
  }
  weeklyTss = Math.round(weeklyTss);

  // ── PMC computation (as-of the end of this snapshot week) ───
  const tssByDate: Record<string, number> = {};
  for (const log of pmcLogs) {
    const dateKey = log.startDate.toISOString().split("T")[0];
    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as any[] | undefined;
    const tss =
      trackPoints && trackPoints.length >= 2
        ? computeBestTss(
            trackPoints as any,
            log.averageHr,
            log.maxHr,
            log.durationSeconds,
          )
        : log.tss || Math.round((log.durationSeconds / 3600) * 50);
    tssByDate[dateKey] = (tssByDate[dateKey] || 0) + tss;
  }

  const pmcInput = Object.entries(tssByDate).map(([date, tss]) => ({
    date,
    tss,
  }));
  const pmcResults = computePMC(pmcInput);
  const latestPmc = pmcResults[pmcResults.length - 1] || {
    ctl: 0,
    atl: 0,
    tsb: 0,
  };

  // ── Readiness score (same algorithm as /api/dashboard/readiness) ──
  const { readinessScore, volumeAdherence, consistency } = computeReadiness({
    weekLogs,
    weekStart,
    weekEnd,
    goals,
    availabilityCount,
    weeklyVolume,
    weeklyTss,
  });

  // ── Fatigue signals (same algorithm as /api/dashboard/fatigue) ──
  const { fatigueSeverity, fatigueSignals, fatigueRecommendations } =
    computeFatigue({
      weekLogs,
      weekStart,
      weekEnd,
      bodyMetrics,
      pmcResults,
      tssByDate,
      availabilityCount,
      weeklyTss,
      weeklyCount,
    });

  // ── Goal progress ───────────────────────────────────────────
  const goalProgressPct: Record<string, number> = {};
  for (const goal of goals) {
    const weeksUntil = Math.max(
      1,
      Math.ceil(
        (goal.targetDate.getTime() - weekEnd.getTime()) / (7 * 86400000),
      ),
    );
    const totalDistance = pmcLogs
      .filter((l) => l.startDate >= goal.createdAt || true)
      .reduce((s, l) => s + ((l as any).distanceMeters || 0), 0);
    goalProgressPct[goal.id] = Math.min(
      100,
      Math.round((totalDistance / (goal.distanceMeters * 0.7)) * 100),
    );
  }

  // ── Avg HR for the week ─────────────────────────────────────
  const hrLogs = weekLogs.filter((l) => l.averageHr != null);
  const avgHr =
    hrLogs.length > 0
      ? Math.round(
          hrLogs.reduce((sum, l) => sum + (l.averageHr || 0), 0) /
            hrLogs.length,
        )
      : null;

  // ── Persist snapshot ────────────────────────────────────────
  await prisma.weeklyAssessment.upsert({
    where: {
      userId_weekStartDate: { userId, weekStartDate: weekStart },
    },
    create: {
      userId,
      weekStartDate: weekStart,
      acuteTrainingLoad: Math.round(latestPmc.atl * 10) / 10,
      chronicTrainingLoad: Math.round(latestPmc.ctl * 10) / 10,
      tsb: Math.round(latestPmc.tsb * 10) / 10,
      readinessScore,
      fitnessScore: Math.round(latestPmc.ctl * 10) / 10,
      fatigueScore: weeklyTss,
      formScore: Math.round(latestPmc.tsb * 10) / 10,
      weeklyVolumeMeters: weeklyVolume,
      weeklyElevationMeters: weeklyElevation,
      weeklyDurationSeconds: weeklyDuration,
      goalProgressPct: Object.keys(goalProgressPct).length > 0 ? (goalProgressPct as any) : null,
      recommendations: fatigueRecommendations,
      rawData: {
        weeklyCount,
        weeklyTss,
        avgDailyTss: weeklyCount > 0 ? Math.round(weeklyTss / 7) : 0,
        avgHr,
        volumeAdherence,
        consistency,
        activeGoals: goals.length,
        latestWeight: bodyMetrics[0]?.weightKg || null,
        fatigueSeverity,
        fatigueSignals,
        rampRate: latestPmc.rampRate,
      } as any,
    },
    update: {
      acuteTrainingLoad: Math.round(latestPmc.atl * 10) / 10,
      chronicTrainingLoad: Math.round(latestPmc.ctl * 10) / 10,
      tsb: Math.round(latestPmc.tsb * 10) / 10,
      readinessScore,
      fitnessScore: Math.round(latestPmc.ctl * 10) / 10,
      fatigueScore: weeklyTss,
      formScore: Math.round(latestPmc.tsb * 10) / 10,
      weeklyVolumeMeters: weeklyVolume,
      weeklyElevationMeters: weeklyElevation,
      weeklyDurationSeconds: weeklyDuration,
      goalProgressPct: Object.keys(goalProgressPct).length > 0 ? (goalProgressPct as any) : null,
      recommendations: fatigueRecommendations,
      rawData: {
        weeklyCount,
        weeklyTss,
        avgDailyTss: weeklyCount > 0 ? Math.round(weeklyTss / 7) : 0,
        avgHr,
        volumeAdherence,
        consistency,
        activeGoals: goals.length,
        latestWeight: bodyMetrics[0]?.weightKg || null,
        fatigueSeverity,
        fatigueSignals,
        rampRate: latestPmc.rampRate,
      } as any,
    },
  });
}

// ── Readiness computation (extracted from /api/dashboard/readiness) ──

export function computeReadiness(params: {
  weekLogs: any[];
  weekStart: Date;
  weekEnd: Date;
  goals: any[];
  availabilityCount: number;
  weeklyVolume: number;
  weeklyTss: number;
}) {
  const { weekLogs, weekStart, weekEnd, goals, availabilityCount, weeklyVolume, weeklyTss } = params;
  const now = new Date();

  // Volume adherence
  let volumeAdherence = 50;
  const primaryGoal = goals[0];
  if (primaryGoal) {
    const weeksUntil = Math.max(1, Math.ceil((primaryGoal.targetDate.getTime() - now.getTime()) / (7 * 86400000)));
    const targetWeekly = primaryGoal.distanceMeters / (weeksUntil * 0.7);
    volumeAdherence = Math.min(100, Math.round((weeklyVolume / Math.max(1, targetWeekly)) * 100));
  }

  // Consistency
  const elapsedDays = Math.max(1, Math.min(7, Math.ceil((Math.min(now.getTime(), weekEnd.getTime()) - weekStart.getTime()) / 86400000)));
  const activeDays = new Set(weekLogs.map((l) => l.startDate.toISOString().split("T")[0])).size;
  const consistency = Math.min(100, Math.round((activeDays / elapsedDays) * 100));

  // Rest balance
  const restBalance = Math.max(0, 100 - Math.min(100, Math.round((weeklyTss / 700) * 100)));

  // Trend score (simplified — no 4-week data available in snapshot context, use neutral)
  const trendScore = 75;

  // Fatigue penalty
  let fatiguePenalty = 0;
  if (weeklyTss > 700) fatiguePenalty = 20;
  else if (weeklyTss > 500) fatiguePenalty = 10;
  else if (weeklyTss > 350) fatiguePenalty = 5;

  let score = Math.round(
    volumeAdherence * 0.4 +
    consistency * 0.25 +
    restBalance * 0.2 +
    trendScore * 0.15 -
    fatiguePenalty,
  );
  score = Math.max(0, Math.min(100, score));

  return { readinessScore: score, volumeAdherence, consistency };
}

// ── Fatigue computation (simplified from /api/dashboard/fatigue) ──

function computeFatigue(params: {
  weekLogs: any[];
  weekStart: Date;
  weekEnd: Date;
  bodyMetrics: any[];
  pmcResults: any[];
  tssByDate: Record<string, number>;
  availabilityCount: number;
  weeklyTss: number;
  weeklyCount: number;
}) {
  const { weekLogs, bodyMetrics, weeklyTss, weeklyCount, availabilityCount } = params;
  const signals: string[] = [];
  const recommendations: string[] = [];

  // High volume check
  if (weeklyTss > 600) {
    signals.push("High training volume this week");
    recommendations.push("Your TSS load is high. Prioritize sleep and nutrition this week.");
  }

  // Resting HR trend
  const restingHrValues = bodyMetrics.filter((m: any) => m.restingHr != null).slice(0, 7);
  if (restingHrValues.length >= 3) {
    const recentResting = restingHrValues.slice(0, 3).reduce((sum: number, m: any) => sum + (m.restingHr || 0), 0) / Math.min(3, restingHrValues.slice(0, 3).length);
    const olderResting = restingHrValues.length >= 6
      ? restingHrValues.slice(3, 6).reduce((sum: number, m: any) => sum + (m.restingHr || 0), 0) / 3
      : recentResting;
    const restingDrift = recentResting - olderResting;
    if (restingDrift > 5) {
      signals.push(`Resting HR +${Math.round(restingDrift)} bpm above baseline`);
      recommendations.push("Your resting heart rate is trending up — a key sign of autonomic stress. Consider a lighter training week.");
    }
  }

  // Consistency
  const expectedSessions = Math.max(1, availabilityCount);
  const consistency = Math.round((weeklyCount / expectedSessions) * 100);
  if (consistency < 50) {
    signals.push(`Low consistency (${consistency}% of planned sessions)`);
    recommendations.push("Consistency is the foundation of endurance training.");
  }

  // Severity
  let severity: string;
  let summary: string;
  if (signals.length >= 3) {
    severity = "high";
    summary = "Multiple fatigue signals detected. Strongly consider reducing volume and prioritizing recovery.";
  } else if (signals.length === 2) {
    severity = "medium";
    summary = "Some fatigue signals present. Monitor how you feel and consider adding an extra rest day.";
  } else if (signals.length === 1) {
    severity = "low";
    summary = "One minor signal — likely within normal training fluctuations.";
  } else {
    severity = "clear";
    summary = "No fatigue signals detected. You're managing your training load well.";
  }

  return { fatigueSeverity: severity, fatigueSignals: signals, fatigueRecommendations: recommendations };
}
