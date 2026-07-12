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
 * Default HR zones as % of max HR (Coggan 5-zone model).
 * Zone 1: Active Recovery    (< 68%)
 * Zone 2: Endurance          (69-83%)
 * Zone 3: Tempo              (84-94%)
 * Zone 4: Threshold          (95-105%)
 * Zone 5: VO2Max/Anaerobic   (> 106%)
 */
const HR_ZONE_PCTS = [0.68, 0.83, 0.94, 1.05, 1.0]; // upper bounds as ratio

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
 */
export function computeHrTss(
  trackPoints: TrackPoint[],
  maxHr: number,
  restingHr?: number
): HrTssResult | null {
  const hrPoints = trackPoints.filter((tp) => tp.hr != null && tp.hr > 0);
  if (hrPoints.length < 10 || maxHr <= 0) return null;

  const hrReserve = restingHr ? maxHr - restingHr : maxHr;
  const zones = HR_ZONE_PCTS.map((pct) => Math.round(restingHr ? restingHr + hrReserve * pct : maxHr * pct));

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
 * Uses the 5-zone Coggan model:
 *   Zone 1: Active Recovery    (< 68% maxHR)
 *   Zone 2: Endurance          (68-83% maxHR)
 *   Zone 3: Tempo              (83-94% maxHR)
 *   Zone 4: Threshold          (94-105% maxHR)
 *   Zone 5: VO2Max/Anaerobic   (> 105% maxHR)
 *
 * Distribution classification (3-zone polarization mapped from Coggan):
 *   Z1 (Easy)   = Coggan Z1 + Z2
 *   Z2 (Moderate) = Coggan Z3
 *   Z3 (Hard)   = Coggan Z4 + Z5
 *
 * Polarized = Easy > 75% and Hard > 5%
 * Pyramidal = Easy > Moderate > Hard
 * Threshold-heavy = Moderate > 30%
 */
export function computeIntensityDistribution(
  trackPoints: TrackPoint[],
  maxHr: number
): IntensityDistribution | null {
  const hrPoints = trackPoints.filter((tp) => tp.hr != null && tp.hr > 0);
  if (hrPoints.length < 30 || maxHr <= 0) return null;

  const thresholds = [0.68, 0.83, 0.94, 1.05]; // upper bounds as ratio of maxHR
  const zoneCount = [0, 0, 0, 0, 0];

  for (const tp of hrPoints) {
    const hr = tp.hr!;
    const ratio = hr / maxHr;
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
  trackPoints: TrackPoint[],
  ftp?: number,
  weightKg?: number,
): PowerMetrics | null {
  const powerPoints = trackPoints.filter((tp) => tp.power != null && tp.power > 0);
  if (powerPoints.length < 30) return null;

  const powers = powerPoints.map((tp) => tp.power!);

  const avgPower = Math.round(powers.reduce((a, b) => a + b, 0) / powers.length);
  const maxPower = Math.max(...powers);

  // Normalized Power®: 4th root of mean of 30s rolling 4th-power averages
  let normalizedPower: number | null = null;
  if (powers.length >= 30) {
    const rolling30s: number[] = [];
    for (let i = 29; i < powers.length; i++) {
      const slice = powers.slice(i - 29, i + 1);
      rolling30s.push(slice.reduce((a, b) => a + b, 0) / 30);
    }
    const meanFourth = rolling30s.reduce((sum, v) => sum + Math.pow(v, 4), 0) / rolling30s.length;
    normalizedPower = Math.round(Math.pow(meanFourth, 0.25));
  }

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
  trackPoints: TrackPoint[],
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

  const getOutput = (tp: TrackPoint): number => {
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
  trackPoints: TrackPoint[],
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
    const np = computeNormalizedPowerSimple(powers);
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

function computeNormalizedPowerSimple(powers: number[]): number {
  if (powers.length < 30) {
    // Not enough for 30s rolling — use straight average
    return powers.reduce((a, b) => a + b, 0) / powers.length;
  }
  const rolling30s: number[] = [];
  for (let i = 29; i < powers.length; i++) {
    const slice = powers.slice(i - 29, i + 1);
    rolling30s.push(slice.reduce((a, b) => a + b, 0) / 30);
  }
  const meanFourth = rolling30s.reduce((sum, v) => sum + Math.pow(v, 4), 0) / rolling30s.length;
  return Math.pow(meanFourth, 0.25);
}

// ─── Enhanced TSS (trackpoint-aware, replaces summary estimate) ──

/**
 * Best-available TSS: uses power TSS if power data available,
 * falls back to hrTSS if HR data available, falls back to estimate.
 */
export function computeBestTss(trackPoints: TrackPoint[] | null, avgHr: number | null, maxHr: number | null, durationSeconds: number): number {
  if (trackPoints && trackPoints.length >= 30) {
    // Try power-based TSS first
    const powerMetrics = computePowerMetrics(trackPoints);
    if (powerMetrics?.tss != null && powerMetrics.tss > 0) {
      return powerMetrics.tss;
    }

    // Try hrTSS
    if (maxHr && maxHr > 0) {
      const hrTssResult = computeHrTss(trackPoints, maxHr);
      if (hrTssResult?.hrTss != null && hrTssResult.hrTss > 0) {
        return hrTssResult.hrTss;
      }
    }
  }

  // Fallback to simple estimate
  const hours = durationSeconds / 3600;
  if (avgHr && maxHr && maxHr > 0) {
    const intensity = avgHr / maxHr;
    return Math.round((durationSeconds * intensity * intensity) / 36);
  }
  return Math.round(hours * 50);
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
  durationSeconds: number
): TrackpointMetrics {
  const trackPoints = (rawJson?.trackPoints as TrackPoint[]) || null;

  const powerMetrics = trackPoints ? computePowerMetrics(trackPoints) : null;
  const hrTss = (trackPoints && maxHr) ? computeHrTss(trackPoints, maxHr) : null;
  const intensityDistribution = (trackPoints && maxHr) ? computeIntensityDistribution(trackPoints, maxHr) : null;
  const decoupling = trackPoints ? computeDecoupling(trackPoints, powerMetrics != null) : null;
  const efResult = trackPoints ? computeEfficiencyFactor(trackPoints) : null;
  const efficiencyFactor = efResult?.ef ?? null;
  const bestTss = computeBestTss(trackPoints, avgHr, maxHr, durationSeconds);

  return {
    hrTss,
    powerMetrics,
    intensityDistribution,
    decoupling,
    efficiencyFactor,
    bestTss,
  };
}
