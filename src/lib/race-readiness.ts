/**
 * Race Readiness Computation
 *
 * Computes per-goal readiness scores based on current training trajectory
 * vs goal requirements. Used on the dashboard to show "how ready am I"
 * for each specific race goal.
 */
export interface RaceReadinessInput {
  goal: {
    name: string;
    distanceMeters: number;
    elevationGainMeters: number | null;
    targetDate: Date;
    goalStatement?: string | null;
  };
  pmc: {
    ctl: number;
    atl: number;
    tsb: number;
  };
  weeklyVolume: number;       // current week's volume in meters
  weeklyElevation: number;    // current week's elevation in meters
  consistency: number;        // 0-100
  volumeAdherence: number;    // 0-100
}

export interface RaceReadinessResult {
  readinessPct: number;       // 0-100
  status: string;             // "on_track" | "needs_work" | "behind"
  volumeGap: number;          // % of target weekly volume achieved
  elevationGap: number | null; // % of target elevation achieved
  tsbStatus: string;          // "fresh" | "balanced" | "fatigued"
  recommendations: string[];
}

/**
 * Compute how ready an athlete is for a specific race goal.
 * Combines volume progression, elevation, freshness (TSB), and consistency.
 */
export function computeRaceReadiness(input: RaceReadinessInput): RaceReadinessResult {
  const { goal, pmc, weeklyVolume, weeklyElevation, consistency, volumeAdherence } = input;
  const recommendations: string[] = [];

  // How many weeks until race
  const now = new Date();
  const msUntilRace = goal.targetDate.getTime() - now.getTime();
  const weeksUntilRace = Math.max(1, Math.ceil(msUntilRace / (7 * 86400000)));

  // Volume progression: what weekly volume should they be hitting
  const targetPeakWeekly = goal.distanceMeters * 0.7;
  const volumeProgress = weeksUntilRace <= 4
    ? targetPeakWeekly  // taper/reduce if close to race
    : targetPeakWeekly * (1 - (weeksUntilRace - 4) * 0.02); // linear ramp
  const volumeGap = volumeProgress > 0
    ? Math.min(100, Math.round((weeklyVolume / volumeProgress) * 100))
    : 0;

  // Elevation progression
  let elevationGap: number | null = null;
  if (goal.elevationGainMeters && goal.elevationGainMeters > 0) {
    const targetElevation = goal.elevationGainMeters * 0.5;
    elevationGap = targetElevation > 0
      ? Math.min(100, Math.round((weeklyElevation / targetElevation) * 100))
      : 0;
  }

  // TSB freshness assessment
  let tsbStatus: string;
  if (pmc.tsb > 10) tsbStatus = "fresh";
  else if (pmc.tsb > -10) tsbStatus = "balanced";
  else tsbStatus = "fatigued";

  // Composite readiness score
  const volumeScore = Math.min(100, volumeGap) * 0.45;
  const elevationScore = elevationGap != null ? Math.min(100, elevationGap) * 0.20 : 15; // 15% default if no elevation goal
  const tsbScore = pmc.tsb > 10 ? 20 : pmc.tsb > -5 ? 15 : pmc.tsb > -15 ? 10 : 5;
  const consistencyScore = Math.min(100, consistency) * 0.15;
  const adherenceScore = Math.min(100, volumeAdherence) * 0.10;

  const readinessPct = Math.max(0, Math.min(100, Math.round(
    volumeScore + elevationScore + tsbScore + (consistencyScore / 100 * 15) + (adherenceScore / 100 * 10)
  )));

  // Status label
  let status: string;
  if (readinessPct >= 70) status = "on_track";
  else if (readinessPct >= 45) status = "needs_work";
  else status = "behind";

  // Generate recommendations
  if (volumeGap < 50 && weeksUntilRace > 4) {
    recommendations.push(`Current weekly volume (${(weeklyVolume / 1000).toFixed(0)}km) is well below goal target. Consider adding an extra session.`);
  } else if (volumeGap < 80 && weeksUntilRace > 4) {
    recommendations.push(`Gradually increase weekly volume toward ${Math.round(targetPeakWeekly / 1000)}km peak.`);
  }
  const elevationTarget = goal.elevationGainMeters;
  if (elevationGap != null && elevationGap < 50 && elevationTarget != null && elevationTarget > 500 && weeksUntilRace > 4) {
    recommendations.push(`Increase weekly vert to match race elevation profile — target ${Math.round(elevationTarget * 0.05 / 100) * 100}m+ per week.`);
  }
  if (pmc.tsb < -15) {
    recommendations.push("TSB is deeply negative. Consider a deload week before resuming build phase.");
  } else if (pmc.tsb < -5 && weeksUntilRace <= 4) {
    recommendations.push("Entering race prep with elevated fatigue. Prioritize recovery and sharpening.");
  }
  if (consistency < 60 && weeksUntilRace > 2) {
    recommendations.push(`Training consistency is ${consistency}%. Aim for more regular sessions to build routine.`);
  }
  if (readinessPct >= 70 && recommendations.length === 0) {
    recommendations.push("You're on track. Maintain consistency and trust the process.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Keep building — consistency is key as race day approaches.");
  }

  return {
    readinessPct,
    status,
    volumeGap,
    elevationGap,
    tsbStatus,
    recommendations,
  };
}
