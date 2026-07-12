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
  availability: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    facilityIds: string[];
  }>;
  facilities: Array<{
    id: string;
    name: string;
    type: string;
    distanceMeters: number | null;
    elevationGainMeters: number | null;
  }>;
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
  facility: string | null;
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

  // Generate sessions based on availability
  const sessions: PlannedSession[] = [];
  const sortedAvailability = [...input.availability].sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  // Find long-run day (day with most available time)
  const longRunDay = [...sortedAvailability].sort((a, b) => {
    const durA = timeToMinutes(a.endTime) - timeToMinutes(a.startTime);
    const durB = timeToMinutes(b.endTime) - timeToMinutes(b.startTime);
    return durB - durA;
  })[0];

  let remainingVolume = targetVolume;
  let remainingElevation = targetElevation;

  for (const slot of sortedAvailability) {
    const slotDurationMin = timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime);
    const slotFacilities = input.facilities.filter((f) => slot.facilityIds.includes(f.id));

    const hasTrail = slotFacilities.some((f) => f.type === "trail");
    const hasTrainer = slotFacilities.some((f) => f.type === "trainer");
    const hasRoad = slotFacilities.some((f) => f.type === "road");
    const hasElevation = slotFacilities.some((f) => (f.elevationGainMeters || 0) > 100);

    let sessionType = "rest";
    let description = "";
    let targetDist: number | null = null;
    let targetVert: number | null = null;
    let facilityName: string | null = null;

    if (isFatigued && sessions.length >= sortedAvailability.length * 0.5) {
      // Skip second half of available slots if fatigued
      sessions.push({
        dayOfWeek: slot.dayOfWeek,
        type: "rest",
        description: "Rest / Recovery",
        targetDistance: null,
        targetElevation: null,
        targetDuration: 0,
        facility: null,
      });
      continue;
    }

    if (slot.dayOfWeek === longRunDay?.dayOfWeek && remainingVolume > 5000) {
      // Long run day
      const longRunDist = Math.min(remainingVolume * 0.4, slotDurationMin * 150); // ~150m/min running pace
      sessionType = "long_run";
      description = hasTrail ? "Long trail run" : "Long run";
      targetDist = Math.round(longRunDist);
      targetVert = hasElevation ? Math.round(remainingElevation * 0.35) : Math.round(remainingElevation * 0.15);
      facilityName = hasTrail ? slotFacilities.find((f) => f.type === "trail")?.name || null : slotFacilities[0]?.name || null;
      remainingVolume -= longRunDist;
      remainingElevation -= targetVert || 0;
    } else if (hasTrainer && sessions.filter((s) => s.type === "intervals").length < 2) {
      // Trainer intervals
      sessionType = "intervals";
      description = isFatigued ? "Easy spin" : "Power trainer intervals";
      targetDist = null;
      targetVert = null;
      facilityName = slotFacilities.find((f) => f.type === "trainer")?.name || null;
      remainingVolume -= 5000;
    } else if (hasElevation && remainingElevation > 200 && !isFatigued) {
      // Hill repeats
      sessionType = "hill_repeats";
      description = "Hill repeats";
      targetDist = Math.round(Math.min(remainingVolume * 0.2, 15000));
      targetVert = Math.round(Math.min(remainingElevation * 0.25, 800));
      facilityName = slotFacilities.find((f) => (f.elevationGainMeters || 0) > 100)?.name || null;
      remainingVolume -= targetDist;
      remainingElevation -= targetVert;
    } else if (remainingVolume > 3000) {
      // Easy/tempo run
      sessionType = isFatigued ? "easy" : "tempo";
      description = isFatigued ? "Easy recovery run" : (sessions.filter((s) => s.type === "tempo").length === 0 ? "Tempo run" : "Easy run");
      targetDist = Math.round(Math.min(remainingVolume * 0.15, 15000));
      targetVert = hasElevation ? Math.round(remainingElevation * 0.1) : 0;
      facilityName = slotFacilities[0]?.name || null;
      remainingVolume -= targetDist;
      remainingElevation -= targetVert;
    }

    sessions.push({
      dayOfWeek: slot.dayOfWeek,
      type: sessionType,
      description,
      targetDistance: targetDist,
      targetElevation: targetVert,
      targetDuration: Math.round(slotDurationMin * 60),
      facility: facilityName,
    });
  }

  // Fill rest days
  for (let day = 0; day <= 6; day++) {
    if (!sessions.some((s) => s.dayOfWeek === day)) {
      sessions.push({
        dayOfWeek: day,
        type: "rest",
        description: "Rest",
        targetDistance: null,
        targetElevation: null,
        targetDuration: 0,
        facility: null,
      });
    }
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

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
