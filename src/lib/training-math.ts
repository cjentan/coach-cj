/**
 * Shared training-math functions.
 *
 * Consolidates the duplicated TSS and Normalized Power algorithms that were
 * scattered across csv-parser, fit-parser, gpx-parser, and trackpoint-metrics
 * into a single authoritative module.
 *
 * Formulas follow Dr. Andrew Coggan's Training Stress Score (TSS) and
 * Normalized Power (NP) definitions.
 */

// ─── Zone weights for HR-based TSS (Coggan 5-zone) ────────────
const HR_ZONE_WEIGHTS = [0.5, 0.65, 0.8, 1.0, 1.3];

// ─── Fallback TSS ─────────────────────────────────────────────

/**
 * Estimate TSS from duration alone when no HR or power data is available.
 *
 * TSS = hours × 50  (equivalent to a constant intensity of ~0.71 IF)
 */
export function estimateTss(durationSeconds: number): number {
  return Math.round((durationSeconds / 3600) * 50);
}

// ─── Power-based TSS ──────────────────────────────────────────

/**
 * Compute TSS from normalized power and FTP.
 *
 * TSS = (duration_sec × NP × IF) / (FTP × 3600) × 100
 *     = (duration_sec × NP²) / (FTP² × 36)
 *
 * where IF (Intensity Factor) = NP / FTP.
 */
export function computePowerTss(
  durationSeconds: number,
  normalizedPower: number,
  ftp: number
): number {
  const intensityFactor = normalizedPower / ftp;
  return Math.round((durationSeconds * normalizedPower * intensityFactor) / (ftp * 36));
}

// ─── HR-based TSS estimate (avg/max ratio) ────────────────────

/**
 * Compute a simple HR-based TSS estimate from average and max heart rate.
 *
 * TSS = duration_sec × (avgHr / maxHr)² / 36
 *
 * This is the simpler alternative to the zone-based hrTSS — it relies on
 * just two summary values rather than full trackpoint data.
 */
export function computeHrTssEstimate(
  durationSeconds: number,
  avgHr: number,
  maxHr: number
): number {
  const intensity = avgHr / maxHr;
  return Math.round((durationSeconds * intensity * intensity) / 36);
}

// ─── Zone-based HR TSS ────────────────────────────────────────

/**
 * Compute HR-based TSS from pre-computed time-in-zone data.
 *
 * hrTSS = Σ (time_in_zone_i × zone_weight_i) × 100 / 3600
 *
 * Zone weights (Coggan 5-zone): Z1=0.5, Z2=0.65, Z3=0.8, Z4=1.0, Z5=1.3
 *
 * @param timeInZones Seconds spent in each of the 5 HR zones.
 * @param durationSeconds Total duration of the activity (for percentage).
 */
export function computeHrTss(
  timeInZones: number[],
  durationSeconds: number
): { hrTss: number; zonePct: number[] } {
  let weightedSum = 0;
  for (let i = 0; i < 5; i++) {
    weightedSum += (timeInZones[i] || 0) * HR_ZONE_WEIGHTS[i];
  }
  const hrTss = Math.round((weightedSum * 100) / 3600);

  const totalSec = timeInZones.reduce((a, b) => a + b, 0) || 1;
  const zonePct = timeInZones.map((t) => Math.round((t / totalSec) * 1000) / 10);

  return { hrTss, zonePct };
}

// ─── Normalized Power (NP) ───────────────────────────────────

/**
 * Compute Normalized Power (30-second rolling 4th-power average).
 *
 * NP = (mean of (30s rolling avg power)⁴) ^ 0.25
 *
 * Returns null when fewer than 30 power values are available.
 * The result is rounded to the nearest integer.
 */
export function computeNormalizedPower(powerValues: number[]): number | null {
  if (powerValues.length < 30) return null;

  const rolling30s: number[] = [];
  for (let i = 29; i < powerValues.length; i++) {
    const slice = powerValues.slice(i - 29, i + 1);
    rolling30s.push(slice.reduce((a, b) => a + b, 0) / 30);
  }
  const meanFourth = rolling30s.reduce((sum, v) => sum + Math.pow(v, 4), 0) / rolling30s.length;
  return Math.round(Math.pow(meanFourth, 0.25));
}

/**
 * Compute Normalized Power as an unrounded float.
 *
 * Unlike `computeNormalizedPower`, this returns a raw float (not rounded)
 * and falls back to the simple arithmetic average when fewer than 30
 * power values are available.  Useful for intermediate calculations such
 * as Efficiency Factor where rounding would introduce error.
 */
export function computeNormalizedPowerFloat(powerValues: number[]): number {
  if (powerValues.length < 30) {
    return powerValues.reduce((a, b) => a + b, 0) / powerValues.length;
  }

  const rolling30s: number[] = [];
  for (let i = 29; i < powerValues.length; i++) {
    const slice = powerValues.slice(i - 29, i + 1);
    rolling30s.push(slice.reduce((a, b) => a + b, 0) / 30);
  }
  const meanFourth = rolling30s.reduce((sum, v) => sum + Math.pow(v, 4), 0) / rolling30s.length;
  return Math.pow(meanFourth, 0.25);
}
