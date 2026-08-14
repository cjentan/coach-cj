/**
 * Trackpoint-based training metrics.
 *
 * These functions operate on the rawJson.trackPoints array stored in TrainingLog.
 * They provide significantly more accurate metrics than summary-field estimates:
 *
 *   hrTSS — HR-based TSS from time-in-zone instead of avgHR/maxHR ratio
 *   NP   — Normalized Power® (30s rolling 4th-power average)
 *   VI   — Variability Index (NP / avgPower)
 *   EF   — Efficiency Factor (NP / avgHR)
 *   Intensity distribution — % time in HR/power zones (polarization analysis)
 *   Aerobic decoupling — HR drift vs pace/power (Pw:Hr / Pa:Hr)
 */

import { TrackPoint } from "./gpx-parser";
import {
  computeNormalizedPower as sharedComputeNormalizedPower,
  computeNormalizedPowerFloat,
  computeHrTssEstimate,
  estimateTss,
} from "@/lib/training-math";

/**
 * Trackpoints with optional fields.
 *
 * These metric functions only read the subset of fields they need (hr, power,
 * speed, distance) and treat each as nullable, so they accept partial
 * trackpoints. Full TrackPoint[] from parsers is a valid input too.
 */
export type TrackpointInput = Array<Partial<TrackPoint>>;

// ─── Types ──────────────────────────────────────────────────

export interface HrTssResult {
  hrTss: number;
  timeInZones: number[];   // seconds in each zone
  zonePct: number[];        // % of total time in each zone
  zoneHrRanges: number[];   // upper HR bound for each zone
}

export interface PowerMetrics {
  avgPower: number;
  maxPower: number;
  normalizedPower: number | null;
  variabilityIndex: number | null;
  intensityFactor: number | null;
  tss: number | null;        // power-based TSS
  timeInZones: number[];     // seconds in each power zone
  zonePct: number[];
  /** Estimated FTP in absolute watts */
  estimatedFtp: number;
  /** FTP in w/kg — only set when weightKg is provided */
  ftpWkg: number | null;
  /** Average power in w/kg */
  avgPowerWkg: number | null;
  /** Normalized Power in w/kg */
  normalizedPowerWkg: number | null;
}

export interface DecouplingResult {
  /** Pw:Hr — HR drift relative to pace/power. Positive = cardiac drift. */
  decouplingRate: number | null;
  /** First-half avg HR */
  firstHalfHr: number | null;
  /** Second-half avg HR */
  secondHalfHr: number | null;
  /** First-half avg pace (min/km) or power (watts) */
  firstHalfOutput: number | null;
  /** Second-half output */
  secondHalfOutput: number | null;
  /** Percentage change in HR:output ratio */
  decouplingPct: number | null;
}

export interface EfficiencyFactorResult {
  /** Normalized Power / Average HR — higher = more efficient */
  ef: number | null;
  /** Trend: weekly EF values over the last N weeks */
  efTrend: { weekStart: string; ef: number }[];
}

export interface IntensityDistribution {
  zone1Pct: number;
  zone2Pct: number;
  zone3Pct: number;
  zone4Pct: number;
  zone5Pct: number;
  /** Whether this follows polarized (80/20) or pyramidal distribution */
  distributionType: "polarized" | "pyramidal" | "threshold-heavy" | "insufficient_data";
  /** Total trackpoint duration analyzed (seconds) */
  analyzedDuration: number;
}

// ─── HR Zones ───────────────────────────────────────────────

/**
 * Default HR zone bands (standard Garmin/Polar 5-zone model). Each value is a
 * fraction of the HR range, applied with the Karvonen method when a resting HR
 * is available:  boundary = rest + (max − rest) × band. Without a resting HR
 * they degrade to the same bands as % of max HR.
 *   Zone 1: Active Recovery  (50-60%)
 *   Zone 2: Endurance        (60-70%)
 *   Zone 3: Tempo            (70-80%)
 *   Zone 4: Threshold        (80-90%)
 *   Zone 5: VO2Max/Anaerobic (90-100%)
 */
const HR_ZONE_PCTS = [0.60, 0.70, 0.80, 0.90, 1.0]; // upper bounds as fraction of HR range

/**
 * Convert a zone-band fraction into a bpm boundary.
 *
 * Karvonen (heart-rate reserve) when a valid resting HR is supplied:
 *   rest + (max − rest) × pct
 * Otherwise % of max HR. A resting HR is only honored when it lies strictly
 * between 0 and maxHr, so missing/out-of-range rest values degrade to %maxHR
 * instead of producing NaN or inverted zones.
 */
export function hrZoneBoundaryBpm(
  maxHr: number,
  pct: number,
  restHr?: number | null,
): number | null {
  if (maxHr <= 0) return null;
  const rest = restHr != null && restHr > 0 && restHr < maxHr ? restHr : null;
  return rest != null
    ? Math.round(rest + (maxHr - rest) * pct)
    : Math.round(maxHr * pct);
}

/**
 * Fraction of the HR range at `hr`: (hr − rest) / (max − rest) with Karvonen,
 * or hr / max when no resting HR is available.
 */
export function hrZoneRatio(
  hr: number,
  maxHr: number,
  restHr?: number | null,
): number {
  const rest = restHr != null && restHr > 0 && restHr < maxHr ? restHr : 0;
  return (hr - rest) / (maxHr - rest);
}

/**
 * Default power zones as % of FTP (Coggan 7-zone condensed to 5).
 * Zone 1: Active Recovery  (< 55%)
 * Zone 2: Endurance        (56-75%)
 * Zone 3: Tempo            (76-90%)
 * Zone 4: Threshold        (91-105%)
 * Zone 5: VO2Max           (106-120%)
 * Zone 6: Anaerobic        (121-150%)
 */
const POWER_ZONE_PCTS = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50];

// ─── hrTSS (Heart Rate Training Stress Score) ───────────────

/**
 * Compute hrTSS from trackpoint HR data using the Coggan time-in-zone method.
 * This is much more accurate than the avgHR/maxHR ratio estimate.
 *
 * hrTSS = Σ (time_in_zone_i × zone_weight_i) × 100 / 3600
 *
 * Zone weights: Z1=0.5, Z2=0.65, Z3=0.8, Z4=1.0, Z5=1.3
 *
 * `maxHr` is the user-level max HR (see `getEffectiveMaxHr` in body-metrics.ts)
 * — every caller passes the same value so zones mean the same thing across
 * activities, rather than anchoring to each activity's own observed max.
 */
export function computeHrTss(
  trackPoints: TrackpointInput,
  maxHr: number,
  restHr?: number | null
): HrTssResult | null {
  const hrPoints = trackPoints.filter((tp) => tp.hr != null && tp.hr > 0);
  if (hrPoints.length < 10 || maxHr <= 0) return null;

  // Zone boundaries use the Karvonen method (heart-rate reserve) when a resting
  // HR is available, matching computeIntensityDistribution; without one they
  // fall back to the same bands as % of max HR.
  const zones = HR_ZONE_PCTS.map(
    (pct) => hrZoneBoundaryBpm(maxHr, pct, restHr) ?? Math.round(maxHr * pct),
  );

  // Zone weights (intensity factor per zone)
  const zoneWeights = [0.5, 0.65, 0.8, 1.0, 1.3];
  const timeInZones = [0, 0, 0, 0, 0]; // seconds

  for (const tp of hrPoints) {
    const hr = tp.hr!;
    if (hr <= zones[0]) timeInZones[0]++;
    else if (hr <= zones[1]) timeInZones[1]++;
    else if (hr <= zones[2]) timeInZones[2]++;
    else if (hr <= zones[3]) timeInZones[3]++;
    else timeInZones[4]++;
  }

  // Assume 1-second sampling (most modern devices); scale later if known
  const totalSec = hrPoints.length;

  let weightedSum = 0;
  for (let i = 0; i < 5; i++) {
    weightedSum += timeInZones[i] * zoneWeights[i];
  }

  const hrTss = Math.round((weightedSum * 100) / 3600);

  const zonePct = timeInZones.map((t) => Math.round((t / totalSec) * 1000) / 10);

  return {
    hrTss,
    timeInZones,
    zonePct,
    zoneHrRanges: zones,
  };
}

// ─── Intensity Distribution (5-Zone Coggan Model) ────────────

/**
 * Compute intensity distribution from trackpoint HR data.
 * Uses the standard 5-zone model applied to heart-rate reserve (Karvonen) when
 * a resting HR is provided, else to % of max HR:
 *   Zone 1: Active Recovery  (50-60%)
 *   Zone 2: Endurance        (60-70%)
 *   Zone 3: Tempo            (70-80%)
 *   Zone 4: Threshold        (80-90%)
 *   Zone 5: VO2Max/Anaerobic (90-100%)
 *
 * Distribution classification (3-zone polarization mapped from Coggan):
 *   Z1 (Easy)   = Coggan Z1 + Z2
 *   Z2 (Moderate) = Coggan Z3
 *   Z3 (Hard)   = Coggan Z4 + Z5
 *
 * Polarized = Easy > 75% and Hard > 5%
 * Pyramidal = Easy > Moderate > Hard
 * Threshold-heavy = Moderate > 30%
 *
 * `maxHr` is the user-level max HR (see `getEffectiveMaxHr` in body-metrics.ts)
 * — every caller passes the same value so zones mean the same thing across
 * activities, rather than anchoring to each activity's own observed max.
 */
export function computeIntensityDistribution(
  trackPoints: TrackpointInput,
  maxHr: number,
  restHr?: number | null
): IntensityDistribution | null {
  const hrPoints = trackPoints.filter((tp) => tp.hr != null && tp.hr > 0);
  if (hrPoints.length < 30 || maxHr <= 0) return null;

  const thresholds = [0.60, 0.70, 0.80, 0.90]; // upper bounds as fraction of HR range
  const zoneCount = [0, 0, 0, 0, 0];

  for (const tp of hrPoints) {
    const hr = tp.hr!;
    const ratio = hrZoneRatio(hr, maxHr, restHr);
    if (ratio < thresholds[0]) zoneCount[0]++;
    else if (ratio < thresholds[1]) zoneCount[1]++;
    else if (ratio < thresholds[2]) zoneCount[2]++;
    else if (ratio < thresholds[3]) zoneCount[3]++;
    else zoneCount[4]++;
  }

  const total = zoneCount.reduce((a, b) => a + b, 0);
  const z1Pct = Math.round((zoneCount[0] / total) * 1000) / 10;
  const z2Pct = Math.round((zoneCount[1] / total) * 1000) / 10;
  const z3Pct = Math.round((zoneCount[2] / total) * 1000) / 10;
  const z4Pct = Math.round((zoneCount[3] / total) * 1000) / 10;
  const z5Pct = Math.round((zoneCount[4] / total) * 1000) / 10;

  // 3-zone polarization mapping: Easy = Z1+Z2, Moderate = Z3, Hard = Z4+Z5
  const easyPct = z1Pct + z2Pct;
  const moderatePct = z3Pct;
  const hardPct = z4Pct + z5Pct;

  let distributionType: IntensityDistribution["distributionType"];
  if (total < 60) {
    distributionType = "insufficient_data";
  } else if (easyPct >= 75 && hardPct >= 5) {
    distributionType = "polarized";
  } else if (easyPct >= moderatePct && moderatePct >= hardPct) {
    distributionType = "pyramidal";
  } else if (moderatePct >= 30) {
    distributionType = "threshold-heavy";
  } else {
    distributionType = "pyramidal";
  }

  return {
    zone1Pct: z1Pct,
    zone2Pct: z2Pct,
    zone3Pct: z3Pct,
    zone4Pct: z4Pct,
    zone5Pct: z5Pct,
    distributionType,
    analyzedDuration: total, // seconds (1 Hz assumption)
  };
}

// ─── Power Metrics ──────────────────────────────────────────

/**
 * Compute power-based metrics from trackpoint power data.
 * Includes Normalized Power®, Variability Index, Intensity Factor, and power TSS.
 *
 * Requires an estimated FTP (Functional Threshold Power). If not provided,
 * we estimate FTP as 95% of best 20-minute power from the data.
 */
export function computePowerMetrics(
  trackPoints: TrackpointInput,
  ftp?: number,
  weightKg?: number,
): PowerMetrics | null {
  const powerPoints = trackPoints.filter((tp) => tp.power != null && tp.power > 0);
  if (powerPoints.length < 30) return null;

  const powers = powerPoints.map((tp) => tp.power!);

  const avgPower = Math.round(powers.reduce((a, b) => a + b, 0) / powers.length);
  const maxPower = Math.max(...powers);

  // Normalized Power®: 4th root of mean of 30s rolling 4th-power averages
  const normalizedPower = sharedComputeNormalizedPower(powers);

  // Estimate FTP if not provided: 95% of best 20-minute power
  const estimatedFtp = ftp || (() => {
    if (powers.length < 20 * 60) return avgPower; // not enough data
    let best20min = 0;
    for (let i = 0; i <= powers.length - 20 * 60; i++) {
      const slice = powers.slice(i, i + 20 * 60);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      if (avg > best20min) best20min = avg;
    }
    return Math.round(best20min * 0.95);
  })();

  const variabilityIndex = avgPower > 0 ? Math.round((normalizedPower! / avgPower) * 100) / 100 : null;
  const intensityFactor = estimatedFtp > 0 && normalizedPower ? Math.round((normalizedPower / estimatedFtp) * 100) / 100 : null;

  // Power TSS® = (duration_sec × NP × IF) / (FTP × 3600) × 100
  let tss: number | null = null;
  if (normalizedPower && intensityFactor && estimatedFtp > 0) {
    tss = Math.round((powerPoints.length * normalizedPower * intensityFactor) / (estimatedFtp * 36));
  }

  // Time in power zones
  const zoneUpperBounds = POWER_ZONE_PCTS.map((pct) => Math.round(estimatedFtp * pct));
  const timeInZones = [0, 0, 0, 0, 0, 0];
  for (const p of powers) {
    if (p <= zoneUpperBounds[0]) timeInZones[0]++;
    else if (p <= zoneUpperBounds[1]) timeInZones[1]++;
    else if (p <= zoneUpperBounds[2]) timeInZones[2]++;
    else if (p <= zoneUpperBounds[3]) timeInZones[3]++;
    else if (p <= zoneUpperBounds[4]) timeInZones[4]++;
    else timeInZones[5]++;
  }
  const zonePct = timeInZones.map((t) => Math.round((t / powers.length) * 1000) / 10);

  // Weight-normalized values (w/kg)
  const hasWeight = weightKg && weightKg > 0;
  const ftpWkg = hasWeight ? Math.round((estimatedFtp / weightKg) * 10) / 10 : null;
  const avgPowerWkg = hasWeight ? Math.round((avgPower / weightKg) * 10) / 10 : null;
  const normalizedPowerWkg = hasWeight && normalizedPower
    ? Math.round((normalizedPower / weightKg) * 10) / 10
    : null;

  return {
    avgPower,
    maxPower,
    normalizedPower,
    variabilityIndex,
    intensityFactor,
    tss,
    timeInZones,
    zonePct,
    estimatedFtp,
    ftpWkg,
    avgPowerWkg,
    normalizedPowerWkg,
  };
}

// ─── Aerobic Decoupling (Pw:Hr / Pa:Hr) ────────────────────

/**
 * Compute HR:output decoupling between first and second half of an activity.
 *
 * Decoupling = (HR₂/Output₂ - HR₁/Output₁) / (HR₁/Output₁) × 100
 *
 * Positive = cardiac drift (HR rising faster than output)
 * Negative = negative split / warm-up effect
 *
 * < 5%  = excellent aerobic endurance
 * 5-10% = good, normal for long efforts
 * > 10% = significant decoupling — possible dehydration, fatigue, or lack of endurance
 */
export function computeDecoupling(
  trackPoints: TrackpointInput,
  usePower: boolean = false
): DecouplingResult | null {
  const validPoints = trackPoints.filter((tp) => {
    const output = usePower ? tp.power : (tp.speed || (tp.distance != null ? 1 : null));
    return tp.hr != null && tp.hr > 0 && output != null && output > 0;
  });

  if (validPoints.length < 60) return null;

  const mid = Math.floor(validPoints.length / 2);
  const firstHalf = validPoints.slice(0, mid);
  const secondHalf = validPoints.slice(mid);

  const firstAvgHr = firstHalf.reduce((s, tp) => s + tp.hr!, 0) / firstHalf.length;
  const secondAvgHr = secondHalf.reduce((s, tp) => s + tp.hr!, 0) / secondHalf.length;

  const getOutput = (tp: Partial<TrackPoint>): number => {
    if (usePower) return tp.power!;
    return tp.speed || 1; // fallback to speed
  };

  const firstOutputs = firstHalf.map(getOutput);
  const secondOutputs = secondHalf.map(getOutput);
  const firstAvgOutput = firstOutputs.reduce((a, b) => a + b, 0) / firstOutputs.length;
  const secondAvgOutput = secondOutputs.reduce((a, b) => a + b, 0) / secondOutputs.length;

  if (firstAvgHr <= 0 || firstAvgOutput <= 0) return null;

  const firstRatio = firstAvgHr / firstAvgOutput;
  const secondRatio = secondAvgHr / secondAvgOutput;

  const decouplingPct = Math.round(((secondRatio - firstRatio) / firstRatio) * 1000) / 10;

  return {
    decouplingRate: decouplingPct,
    firstHalfHr: Math.round(firstAvgHr),
    secondHalfHr: Math.round(secondAvgHr),
    firstHalfOutput: Math.round(firstAvgOutput * 10) / 10,
    secondHalfOutput: Math.round(secondAvgOutput * 10) / 10,
    decouplingPct,
  };
}

// ─── Efficiency Factor ──────────────────────────────────────

/**
 * Efficiency Factor = Normalized Power / Average Heart Rate
 * Higher EF = more power output per heartbeat = better aerobic efficiency.
 *
 * Track EF over time — a rising trend means improving fitness.
 *
 * When weightKg is provided, computes EF in w/kg per bpm (weight-normalized),
 * which is more comparable as body weight changes.
 */
export function computeEfficiencyFactor(
  trackPoints: TrackpointInput,
  weightKg?: number,
): { ef: number; efWkg: number | null } | null {
  const valid = trackPoints.filter((tp) => tp.hr != null && tp.hr > 0 && tp.power != null && tp.power > 0);
  if (valid.length < 60) return null;

  const powers = valid.map((tp) => tp.power!);
  const hrs = valid.map((tp) => tp.hr!);

  const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;
  const avgHr = hrs.reduce((a, b) => a + b, 0) / hrs.length;

  if (avgHr <= 0) return null;

  // For HR-based (no power): use speed / HR
  let ef: number;
  let efWkg: number | null = null;

  if (avgPower > 0) {
    // NP / HR
    const np = computeNormalizedPowerFloat(powers);
    ef = Math.round((np / avgHr) * 100) / 100;
    if (weightKg && weightKg > 0) {
      efWkg = Math.round((np / weightKg / avgHr) * 100) / 100;
    }
  } else {
    // Speed(m/s) / HR × 100 (scale for readability)
    const speeds = valid.filter((tp) => tp.speed != null && tp.speed > 0).map((tp) => tp.speed!);
    if (speeds.length < 30) return null;
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    ef = Math.round((avgSpeed / avgHr) * 1000) / 10;
  }

  return { ef, efWkg };
}

// ─── Enhanced TSS (trackpoint-aware, replaces summary estimate) ──

/**
 * Best-available TSS: uses power TSS if power data available,
 * falls back to hrTSS if HR data available, falls back to estimate.
 */
export function computeBestTss(trackPoints: TrackpointInput | null, avgHr: number | null, maxHr: number | null, durationSeconds: number, restHr?: number | null): number {
  if (trackPoints && trackPoints.length >= 30) {
    // Try power-based TSS first
    const powerMetrics = computePowerMetrics(trackPoints);
    if (powerMetrics?.tss != null && powerMetrics.tss > 0) {
      return powerMetrics.tss;
    }

    // Try hrTSS
    if (maxHr && maxHr > 0) {
      const hrTssResult = computeHrTss(trackPoints, maxHr, restHr);
      if (hrTssResult?.hrTss != null && hrTssResult.hrTss > 0) {
        return hrTssResult.hrTss;
      }
    }
  }

  // Fallback to simple estimate
  if (avgHr && maxHr && maxHr > 0) {
    return computeHrTssEstimate(durationSeconds, avgHr, maxHr);
  }
  return estimateTss(durationSeconds);
}

// ─── Batch: extract all metrics from rawJson ────────────────

export interface TrackpointMetrics {
  hrTss: HrTssResult | null;
  powerMetrics: PowerMetrics | null;
  intensityDistribution: IntensityDistribution | null;
  decoupling: DecouplingResult | null;
  efficiencyFactor: number | null;
  bestTss: number;
}

/**
 * Extract all available metrics from a TrainingLog's rawJson trackpoint data.
 */
export function extractMetrics(
  rawJson: Record<string, unknown> | null,
  maxHr: number | null,
  avgHr: number | null,
  durationSeconds: number,
  restHr?: number | null
): TrackpointMetrics {
  const trackPoints = (rawJson?.trackPoints as TrackPoint[]) || null;

  const powerMetrics = trackPoints ? computePowerMetrics(trackPoints) : null;
  const hrTss = (trackPoints && maxHr) ? computeHrTss(trackPoints, maxHr, restHr) : null;
  const intensityDistribution = (trackPoints && maxHr) ? computeIntensityDistribution(trackPoints, maxHr, restHr) : null;
  const decoupling = trackPoints ? computeDecoupling(trackPoints, powerMetrics != null) : null;
  const efResult = trackPoints ? computeEfficiencyFactor(trackPoints) : null;
  const efficiencyFactor = efResult?.ef ?? null;
  const bestTss = computeBestTss(trackPoints, avgHr, maxHr, durationSeconds, restHr);

  return {
    hrTss,
    powerMetrics,
    intensityDistribution,
    decoupling,
    efficiencyFactor,
    bestTss,
  };
}

// ─── Precomputed trackpoint metrics (persisted at ingestion) ────────

/**
 * The subset of trackpoint metrics stored as scalar columns on TrainingLog so
 * dashboard chart routes can aggregate them without loading the rawJson
 * trackpoint blobs (which can exceed 10MB per activity) into the server heap.
 *
 * Every field is nullable: a null means that activity's data couldn't produce
 * the metric (too few points, missing HR/power, etc.) — mirroring the skip
 * conditions the old rawJson-based dashboard routes applied live.
 */
export interface PrecomputedTrackpointMetrics {
  /** % time in HR zones 1-5 (Coggan 5-zone), null when not computable. */
  zone1Pct: number | null;
  zone2Pct: number | null;
  zone3Pct: number | null;
  zone4Pct: number | null;
  zone5Pct: number | null;
  /** Seconds of HR trackpoint data the zone distribution was computed over. */
  intensityAnalyzedSeconds: number | null;
  /** Aerobic decoupling % (HR drift vs output), null when not computable. */
  decouplingPct: number | null;
  /** Efficiency Factor (NP/HR or speed/HR), null when not computable. */
  efficiencyFactor: number | null;
  /** Normalized Power derived from trackpoints (for FTP estimation). */
  trackpointNormalizedPower: number | null;
}

const EMPTY_PRECOMPUTED_METRICS: PrecomputedTrackpointMetrics = {
  zone1Pct: null,
  zone2Pct: null,
  zone3Pct: null,
  zone4Pct: null,
  zone5Pct: null,
  intensityAnalyzedSeconds: null,
  decouplingPct: null,
  efficiencyFactor: null,
  trackpointNormalizedPower: null,
};

/**
 * Compute the precomputed trackpoint metrics from a parsed activity's
 * trackpoints. Call this at ingestion time (when the trackpoints are already
 * in memory) and store the result on the TrainingLog row.
 *
 * `maxHr` is the user-level max HR (see `getEffectiveMaxHr` in body-metrics.ts)
 * — ingestion passes the same value every site uses, so the stored zone
 * columns reflect the user's zones rather than each activity's observed max.
 */
export function computePrecomputedTrackpointMetrics(
  trackPoints: TrackpointInput | null | undefined,
  maxHr: number | null,
  restHr?: number | null,
): PrecomputedTrackpointMetrics {
  if (!trackPoints || trackPoints.length < 30) {
    return { ...EMPTY_PRECOMPUTED_METRICS };
  }

  const intensity = maxHr
    ? computeIntensityDistribution(trackPoints, maxHr, restHr)
    : null;
  // Mirror the dashboard's live logic: an "insufficient_data" distribution was
  // skipped in the aggregate, so persist null for it to reproduce that filter.
  const usableIntensity =
    intensity && intensity.distributionType !== "insufficient_data"
      ? intensity
      : null;

  const hasPower = trackPoints.some((tp) => tp.power != null && tp.power > 0);
  const decoupling = computeDecoupling(trackPoints, hasPower);
  const ef = computeEfficiencyFactor(trackPoints);
  const powerMetrics = computePowerMetrics(trackPoints);

  return {
    zone1Pct: usableIntensity?.zone1Pct ?? null,
    zone2Pct: usableIntensity?.zone2Pct ?? null,
    zone3Pct: usableIntensity?.zone3Pct ?? null,
    zone4Pct: usableIntensity?.zone4Pct ?? null,
    zone5Pct: usableIntensity?.zone5Pct ?? null,
    intensityAnalyzedSeconds: usableIntensity?.analyzedDuration ?? null,
    decouplingPct: decoupling?.decouplingPct ?? null,
    efficiencyFactor: ef?.ef ?? null,
    trackpointNormalizedPower: powerMetrics?.normalizedPower ?? null,
  };
}
