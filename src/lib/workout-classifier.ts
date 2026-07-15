/**
 * Workout Type Classifier
 *
 * Classifies training activities into workout types (easy, long_run, intervals,
 * tempo, fartlek, recovery, race, cross_training) using available data.
 *
 * Uses HR zone distribution from trackpoints when available, falls back to
 * summary metrics (duration, type, HR) otherwise.
 */
import { TrackPoint } from "./gpx-parser";
import { computeIntensityDistribution } from "./trackpoint-metrics";

export type WorkoutType =
  | "easy"
  | "long_run"
  | "intervals"
  | "tempo"
  | "fartlek"
  | "recovery"
  | "race"
  | "cross_training";

export interface ClassifierInput {
  type: string;
  subType?: string | null;
  durationSeconds: number;
  distanceMeters?: number | null;
  averageHr?: number | null;
  maxHr?: number | null;
  averagePower?: number | null;
  normalizedPower?: number | null;
  trackPoints?: TrackPoint[] | null;
}

/**
 * Classify an activity into a workout type based on available data.
 * Returns null when there isn't enough data to classify confidently.
 */
export function classifyWorkoutType(input: ClassifierInput): WorkoutType | null {
  const { type, subType, durationSeconds, trackPoints, maxHr } = input;
  const durationMinutes = durationSeconds / 60;

  // Non-running/riding activities → cross_training
  if (type !== "run" && type !== "ride") {
    return "cross_training";
  }

  // Try trackpoint-based classification if HR data is available
  if (trackPoints && trackPoints.length >= 30 && maxHr && maxHr > 0) {
    const distribution = computeIntensityDistribution(trackPoints, maxHr);
    if (distribution && distribution.analyzedDuration >= 60) {
      return classifyFromZones(distribution, durationMinutes, type, subType);
    }
  }

  // Fallback: classify from summary data
  return classifyFromSummary(input, durationMinutes);
}

function classifyFromZones(
  distribution: { zone1Pct: number; zone2Pct: number; zone3Pct: number; zone4Pct: number; zone5Pct: number },
  durationMinutes: number,
  type: string,
  subType?: string | null,
): WorkoutType {
  const { zone1Pct, zone2Pct, zone3Pct, zone4Pct, zone5Pct } = distribution;

  // Hard effort zones (Z4 + Z5)
  const hardPct = zone4Pct + zone5Pct;
  // Endurance zones (Z1 + Z2)
  const easyPct = zone1Pct + zone2Pct;
  // Tempo zone
  const tempoPct = zone3Pct;

  // Recovery: almost entirely Z1, short duration
  if (zone1Pct >= 70 && durationMinutes <= 45) {
    return "recovery";
  }

  // Race: maximal effort — very high hard zone %, signficant Z5
  if (hardPct >= 50 && zone5Pct >= 15) {
    return "race";
  }

  // Intervals: significant time in Z4+Z5, with alternating intensities
  if (hardPct >= 25 && zone5Pct >= 8) {
    return "intervals";
  }

  // Fartlek: mixed zones, no single zone dominates (>50%), moderate-hard blend
  if (hardPct >= 15 && hardPct <= 45 && tempoPct >= 15 && easyPct >= 20) {
    return "fartlek";
  }

  // Tempo: Z3 dominant
  if (tempoPct >= 40 && hardPct < 25) {
    return "tempo";
  }

  // Long run: Z2 dominant (>50%), extended duration, minimal hard effort
  if (zone2Pct >= 50 && hardPct <= 15 && durationMinutes >= 75) {
    return "long_run";
  }

  // Easy: Z1+Z2 dominant
  if (easyPct >= 70 && hardPct <= 10) {
    return "easy";
  }

  // Default for runs
  if (type === "run") {
    return durationMinutes >= 60 ? "long_run" : "easy";
  }

  return "easy";
}

function classifyFromSummary(
  input: ClassifierInput,
  durationMinutes: number,
): WorkoutType | null {
  const { type, subType, distanceMeters, averageHr, maxHr } = input;

  // Very short activities → recovery
  if (durationMinutes <= 25) {
    return "recovery";
  }

  // Running classification
  if (type === "run") {
    // Long run: longer than 75 min
    if (durationMinutes >= 75) {
      return "long_run";
    }
    // Check HR intensity if available
    if (averageHr && maxHr && maxHr > 0) {
      const hrRatio = averageHr / maxHr;
      if (hrRatio >= 0.90) return "race";
      if (hrRatio >= 0.84) return "tempo";   // Z3-ish
      if (hrRatio >= 0.75) return "fartlek"; // moderate-hard blend
    }
    // Easy: shorter, moderate pace
    return "easy";
  }

  // Cycling classification
  if (type === "ride") {
    if (durationMinutes >= 120) return "long_run";
    if (averageHr && maxHr && maxHr > 0) {
      const hrRatio = averageHr / maxHr;
      if (hrRatio >= 0.84) return "tempo";
    }
    return "easy";
  }

  return "easy";
}
