/**
 * Weekly metrics snapshot utility.
 *
 * Computes a full week's training metrics and stores them in WeeklyAssessment
 * so historical trend charts can query pre-computed data instead of
 * recomputing from raw logs on every page load.
 */
import { prisma } from "./prisma";
import { computePMC } from "./pmc";
import { computeBestTss } from "./trackpoint-metrics";
import { estimateTss } from "@/lib/training-math";
import { getEffectiveMaxHr, getLatestRestingHr } from "./body-metrics";
import { getWeekStart } from "./utils";
import { computeReadinessScore, computeFatigueSignals } from "./training-health";

/** Snapshots the given week's metrics for the user. Idempotent (upsert). */
export async function snapshotWeek(userId: string, weekStartDate: Date): Promise<void> {
  const weekStart = getWeekStart(weekStartDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7); // Monday 00:00 of next week

  // ── Fetch data ──────────────────────────────────────────────
  const ninetyDaysBeforeEnd = new Date(weekEnd.getTime() - 90 * 86400000);

  const [weekLogs, pmcLogs, goals, bodyMetrics, restHr, maxHr, anchorPlan] = await Promise.all([
    // This week's logs (exclude merged duplicates)
    prisma.trainingLog.findMany({
      where: {
        userId,
        mergedIntoId: null,
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
    // NOTE: rawJson is intentionally omitted here — loading trackpoints for
    // 90 days of activities is extremely memory-intensive. The database
    // already stores pre-computed tss from the import, which is adequate
    // for historical PMC trend computation.
    prisma.trainingLog.findMany({
      where: {
        userId,
        mergedIntoId: null,
        startDate: { gte: ninetyDaysBeforeEnd, lt: weekEnd },
      },
      orderBy: { startDate: "asc" },
      select: {
        startDate: true,
        tss: true,
        durationSeconds: true,
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
    // Karvonen anchors — fetched from the same helpers every other
    // zone-consuming site uses. restHr prioritises the Garmin API value;
    // maxHr is the user-level effective max (estimated > user-set > default).
    getLatestRestingHr(userId),
    getEffectiveMaxHr(userId),
    // Most recent plan's anchor race — the race the current plan was created
    // for, so the "primary goal" stays fixed even if new races are added.
    prisma.weeklyPlan.findFirst({
      where: { userId, anchorGoalId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { anchorGoalId: true },
    }),
  ]);

  // Keep the anchored race as the primary goal (goals[0]) when it's still active.
  const anchorGoal = anchorPlan?.anchorGoalId
    ? goals.find((g) => g.id === anchorPlan.anchorGoalId)
    : undefined;
  if (anchorGoal) {
    const anchorIndex = goals.indexOf(anchorGoal);
    if (anchorIndex > 0) {
      goals.splice(anchorIndex, 1);
      goals.unshift(anchorGoal);
    }
  }

  // ── Weekly aggregates ───────────────────────────────────────
  const weeklyVolume = weekLogs.reduce((sum, l) => sum + (l.distanceMeters || 0), 0);
  const weeklyElevation = weekLogs.reduce((sum, l) => sum + (l.elevationGainMeters || 0), 0);
  const weeklyDuration = weekLogs.reduce((sum, l) => sum + (l.durationSeconds || 0), 0);
  const weeklyCount = weekLogs.length;

  // ── TSS computation (trackpoint-aware, per-log) ─────────────
  // Zone math anchors to the user-level max HR (maxHr above), not each
  // activity's own observed max, so all TSS across the app means the same thing.
  let weeklyTss = 0;
  for (const log of weekLogs) {
    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as any[] | undefined;
    const tss =
      trackPoints && trackPoints.length >= 2
        ? computeBestTss(trackPoints as any, log.averageHr, maxHr, log.durationSeconds, restHr)
        : log.tss || estimateTss(log.durationSeconds);
    weeklyTss += tss;
  }
  weeklyTss = Math.round(weeklyTss);

  // ── PMC computation (as-of the end of this snapshot week) ───
  const tssByDate: Record<string, number> = {};
  for (const log of pmcLogs) {
    const dateKey = log.startDate.toISOString().split("T")[0];
    const tss = log.tss || estimateTss(log.durationSeconds);
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

  // ── Readiness score ──
  const {
    readinessScore,
    volumeAdherence,
    consistencyScore: consistency,
  } = computeReadinessScore({
    weeklyVolumeMeters: weeklyVolume,
    weeklyTss,
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    primaryGoal: goals[0] ?? null,
    activityLogs: weekLogs,
  });

  // ── Fatigue signals ──
  const fatigueResult = computeFatigueSignals({
    weeklyTss,
    activityCount: weeklyCount,
    bodyMetrics,
  });
  const {
    severity: fatigueSeverity,
    signals: fatigueSignals,
    recommendations: fatigueRecommendations,
  } = fatigueResult;

  // ── Goal progress ───────────────────────────────────────────
  const goalProgressPct: Record<string, number> = {};
  for (const goal of goals) {
    const weeksUntil = Math.max(
      1,
      Math.ceil((goal.targetDate.getTime() - weekEnd.getTime()) / (7 * 86400000))
    );
    const totalDistance = pmcLogs
      .filter((l) => l.startDate >= goal.createdAt || true)
      .reduce((s, l) => s + ((l as any).distanceMeters || 0), 0);
    goalProgressPct[goal.id] = Math.min(
      100,
      Math.round((totalDistance / (goal.distanceMeters * 0.7)) * 100)
    );
  }

  // ── Avg HR for the week ─────────────────────────────────────
  const hrLogs = weekLogs.filter((l) => l.averageHr != null);
  const avgHr =
    hrLogs.length > 0
      ? Math.round(hrLogs.reduce((sum, l) => sum + (l.averageHr || 0), 0) / hrLogs.length)
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
