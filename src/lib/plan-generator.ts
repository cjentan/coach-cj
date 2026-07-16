import { computeLinearRegression } from "./training-load";
import { computePMC } from "./pmc";

export interface PlanInput {
  goals: Array<{
    id: string;
    name: string;
    targetDate: Date;
    distanceMeters: number;
    elevationGainMeters: number | null;
    priority: "A" | "B" | "C";
  }>;
  recentVolumeByWeek: number[]; // last 4 weeks, meters
  recentElevationByWeek: number[];
  recentDurationByWeek: number[]; // seconds
  consistencyScore: number; // 0-1
  fatigueSeverity: string | null; // "low" | "medium" | "high" | "critical" | null
}

export interface PlannedSession {
  dayOfWeek: number;
  type: string;
  description: string;
  targetDistance: number | null;
  targetElevation: number | null;
  targetDuration: number; // seconds
}

export interface PlanOutput {
  targetVolumeMeters: number;
  targetElevationMeters: number;
  targetDurationSeconds: number;
  plannedSessions: PlannedSession[];
  adjustments: string[];
  trajectoryAssessment: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function generateWeeklyPlan(input: PlanInput): PlanOutput {
  const primaryGoal = input.goals.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "A" ? -1 : 1;
    return a.targetDate.getTime() - b.targetDate.getTime();
  })[0];

  const adjustments: string[] = [];

  // Calculate required volume ramp
  const weeksUntilRace = primaryGoal
    ? Math.max(1, Math.ceil((primaryGoal.targetDate.getTime() - Date.now()) / (7 * 86400000)))
    : 12;

  const requiredWeeklyVolume = primaryGoal
    ? primaryGoal.distanceMeters / Math.max(1, weeksUntilRace * 0.7) // peak at ~70% of race distance
    : 40000;

  const requiredWeeklyElevation = primaryGoal?.elevationGainMeters
    ? primaryGoal.elevationGainMeters / Math.max(1, weeksUntilRace * 0.6)
    : 1000;

  // Analyze trajectory
  const avgVolume = input.recentVolumeByWeek.length > 0
    ? input.recentVolumeByWeek.reduce((a, b) => a + b, 0) / input.recentVolumeByWeek.length
    : 0;

  const avgElevation = input.recentElevationByWeek.length > 0
    ? input.recentElevationByWeek.reduce((a, b) => a + b, 0) / input.recentElevationByWeek.length
    : 0;

  const volumeRegression = input.recentVolumeByWeek.length >= 3
    ? computeLinearRegression(input.recentVolumeByWeek)
    : { slope: 0, intercept: avgVolume, r2: 0 };

  const volumeGap = requiredWeeklyVolume - avgVolume;
  const elevationGap = requiredWeeklyElevation - avgElevation;

  // Handle fatigue override
  const isFatigued = input.fatigueSeverity === "high" || input.fatigueSeverity === "critical";
  const recoveryFactor = input.fatigueSeverity === "critical" ? 0.4 : input.fatigueSeverity === "high" ? 0.5 : input.fatigueSeverity === "medium" ? 0.7 : 1.0;

  const targetVolume = Math.round(requiredWeeklyVolume * recoveryFactor);
  const targetElevation = Math.round(requiredWeeklyElevation * recoveryFactor);

  // Generate sessions — 6 training days (Mon–Sat) + 1 rest day (Sun)
  const sessions: PlannedSession[] = [];
  const trainingDays = [1, 2, 3, 4, 5, 6];

  let remainingVolume = targetVolume;
  let remainingElevation = targetElevation;
  const baseVolumePerDay = Math.round(targetVolume / trainingDays.length);

  for (const dayOfWeek of trainingDays) {
    if (isFatigued && sessions.length >= Math.ceil(trainingDays.length * 0.5)) {
      sessions.push({
        dayOfWeek,
        type: "rest",
        description: "Rest / Recovery",
        targetDistance: null,
        targetElevation: null,
        targetDuration: 0,
      });
      continue;
    }

    let type: string;
    let description: string;
    let targetDist: number;
    let targetVert: number;

    if (dayOfWeek === 6 && remainingVolume > 5000) {
      // Long run on Saturday
      type = "long_run";
      description = "Long run";
      targetDist = Math.round(Math.min(remainingVolume * 0.4, 27000));
      targetVert = Math.round(remainingElevation * 0.35);
    } else if (!isFatigued && sessions.filter(s => s.type === "intervals").length === 0) {
      type = "intervals";
      description = "Speedwork / intervals";
      targetDist = Math.round(Math.min(baseVolumePerDay, 12000));
      targetVert = 0;
    } else if (!isFatigued && remainingElevation > 200 && sessions.filter(s => s.type === "hill_repeats").length === 0) {
      type = "hill_repeats";
      description = "Hill repeats";
      targetDist = Math.round(Math.min(remainingVolume * 0.2, 15000));
      targetVert = Math.round(Math.min(remainingElevation * 0.25, 800));
    } else if (!isFatigued && sessions.filter(s => s.type === "tempo").length === 0) {
      type = "tempo";
      description = "Tempo run";
      targetDist = Math.round(Math.min(baseVolumePerDay, 16000));
      targetVert = Math.round(remainingElevation * 0.1);
    } else {
      type = "easy";
      description = isFatigued ? "Easy recovery run" : "Easy run";
      targetDist = Math.round(Math.min(baseVolumePerDay, 15000));
      targetVert = 0;
    }

    remainingVolume -= targetDist;
    remainingElevation -= targetVert;

    // Estimate duration based on pace (~5:00/km = 200 m/min for runs, fixed for others)
    const targetDuration = type === "intervals" || type === "hill_repeats"
      ? 3600
      : Math.max(1800, Math.round((targetDist / 200) * 60));

    sessions.push({
      dayOfWeek,
      type,
      description,
      targetDistance: targetDist,
      targetElevation: targetVert,
      targetDuration,
    });
  }

  // Fill rest day (Sunday)
  if (!sessions.some((s) => s.dayOfWeek === 0)) {
    sessions.push({
      dayOfWeek: 0,
      type: "rest",
      description: "Rest",
      targetDistance: null,
      targetElevation: null,
      targetDuration: 0,
    });
  }

  sessions.sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  // Generate adjustments
  if (volumeGap > 5000) {
    adjustments.push(`↑ Target volume ${Math.round(volumeGap / 1000)}km above last week — you're behind on volume for ${primaryGoal?.name || "your goal"}`);
  }
  if (elevationGap > 500) {
    adjustments.push(`↑ Elevation target +${Math.round(elevationGap)}m — vert is below target for the race profile`);
  }
  if (isFatigued) {
    adjustments.push(`↓ Volume reduced to ${Math.round(recoveryFactor * 100)}% — fatigue detected, prioritizing recovery`);
  }
  if (input.consistencyScore < 0.7) {
    adjustments.push(`➕ Focus on consistency — you hit ${Math.round(input.consistencyScore * 100)}% of planned sessions last week`);
  }
  if (volumeRegression.slope > 500 && volumeRegression.r2 > 0.5) {
    adjustments.push(`📈 Volume trending up (+${Math.round(volumeRegression.slope / 1000)}km/week) — ensure ramp rate stays below 10%`);
  }

  const trajectoryAssessment = primaryGoal
    ? `${Math.round(avgVolume / 1000)}km/week avg vs ${Math.round(requiredWeeklyVolume / 1000)}km/week target. ` +
      `Ramp: ${volumeRegression.slope > 0 ? '+' : ''}${Math.round(volumeRegression.slope / 1000)}km/week. ` +
      `${volumeGap > 0 ? `Behind by ${Math.round(volumeGap / 1000)}km/week.` : 'On track for volume.'}`
    : "No active goals set.";

  return {
    targetVolumeMeters: targetVolume,
    targetElevationMeters: targetElevation,
    targetDurationSeconds: sessions.reduce((sum, s) => sum + s.targetDuration, 0),
    plannedSessions: sessions,
    adjustments,
    trajectoryAssessment,
  };
}
