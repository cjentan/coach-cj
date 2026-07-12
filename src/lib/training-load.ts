/**
 * Performance Management Chart (PMC) model.
 * CTL (Chronic Training Load) = 42-day EWMA of daily TSS
 * ATL (Acute Training Load)  = 7-day EWMA of daily TSS
 * TSB (Training Stress Balance) = CTL - ATL
 */

export interface DailyTss {
  date: string;
  tss: number;
}

export interface PmcResult {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
  rampRate: number | null;
}

const CTL_TIME_CONSTANT = 42;
const ATL_TIME_CONSTANT = 7;

export function computePMC(dailyTss: DailyTss[], initialCtl: number = 30, initialAtl: number = 30): PmcResult[] {
  if (dailyTss.length === 0) return [];

  const sorted = [...dailyTss].sort(
    (first, second) => new Date(first.date).getTime() - new Date(second.date).getTime()
  );

  const ctlLambda = Math.exp(-1 / CTL_TIME_CONSTANT);
  const atlLambda = Math.exp(-1 / ATL_TIME_CONSTANT);

  let currentCtl = initialCtl;
  let currentAtl = initialAtl;

  // Use a for-of loop instead of .map() to avoid TDZ:
  // accessing the results array inside the map callback references
  // a const/let variable before it's initialized, which Terser then
  // mangles to `Cannot access 'l' before initialization` in prod builds.
  const results: PmcResult[] = [];
  for (const day of sorted) {
    currentCtl = day.tss * (1 - ctlLambda) + currentCtl * ctlLambda;
    currentAtl = day.tss * (1 - atlLambda) + currentAtl * atlLambda;
    const tsb = currentCtl - currentAtl;

    let rampRate: number | null = null;
    if (results.length >= 7) {
      rampRate = currentCtl - results[results.length - 7].ctl;
    }

    results.push({
      date: day.date,
      tss: day.tss,
      ctl: Math.round(currentCtl * 10) / 10,
      atl: Math.round(currentAtl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      rampRate: rampRate !== null ? Math.round(rampRate * 10) / 10 : null,
    });
  }

  return results;
}

export function computeMonotony(dailyTssValues: number[]): number {
  if (dailyTssValues.length < 2) return 0;
  const total = dailyTssValues.reduce((sum, val) => sum + val, 0);
  const mean = total / dailyTssValues.length;
  if (mean === 0) return 0;
  const sqDiffs = dailyTssValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);
  const variance = sqDiffs / dailyTssValues.length;
  const stdDev = Math.sqrt(variance);
  return Math.round((mean / (stdDev || 1)) * 100) / 100;
}

export function computeStrain(dailyTssValues: number[]): number {
  const monotony = computeMonotony(dailyTssValues);
  const total = dailyTssValues.reduce((sum, val) => sum + val, 0);
  return Math.round(total * monotony);
}

export function computeLinearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const count = values.length;
  if (count < 2) return { slope: 0, intercept: values[0] || 0, r2: 0 };

  const xValues = Array.from({ length: count }, (_, pos) => pos);
  const xMean = xValues.reduce((sum, val) => sum + val, 0) / count;
  const yMean = values.reduce((sum, val) => sum + val, 0) / count;

  let ssxx = 0;
  let ssyy = 0;
  let ssxy = 0;

  for (let idx = 0; idx < count; idx++) {
    const dx = xValues[idx] - xMean;
    const dy = values[idx] - yMean;
    ssxx += dx * dx;
    ssyy += dy * dy;
    ssxy += dx * dy;
  }

  const slope = ssxx === 0 ? 0 : ssxy / ssxx;
  const intercept = yMean - slope * xMean;
  const r2 = ssyy === 0 ? 0 : (ssxy * ssxy) / (ssxx * ssyy);

  return { slope, intercept, r2 };
}
