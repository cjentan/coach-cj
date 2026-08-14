/**
 * Performance Management Chart (PMC) — computes CTL, ATL, TSB from daily TSS.
 * Keep this in a SEPARATE file so importing it doesn't pull in computeLinearRegression,
 * which causes minifier TDZ collisions when bundled with the assessment route.
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

const CTL_TC = 42;
const ATL_TC = 7;

/**
 * Fill in missing dates between the first activity and today with tss: 0, so
 * rest days are counted and CTL/ATL/TSB decay to reflect recovery.
 *
 * Extends through today even when the last activity was earlier, so the
 * dashboard scores and PMC chart reflect the current date rather than
 * stopping at the last workout.
 *
 * `todayKey` defaults to today in UTC; pass a local "YYYY-MM-DD" (e.g. via
 * `localDateStr`) when the input dates are bucketed by the user's timezone so
 * the series extends to the user's today.
 */
export function fillDailyTss(input: { date: string; tss: number }[], todayKey?: string): { date: string; tss: number }[] {
  if (input.length === 0) return [];

  const startDate = new Date(input[0].date);
  const lastActivityDate = input[input.length - 1].date;
  const resolvedToday = todayKey ?? new Date().toISOString().split("T")[0];
  // Don't truncate if an activity is dated after today (clock skew)
  const endKey = lastActivityDate > resolvedToday ? lastActivityDate : resolvedToday;
  const endDate = new Date(endKey);

  const inputMap = new Map(input.map((d) => [d.date, d.tss]));
  const filled: { date: string; tss: number }[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const key = cursor.toISOString().split("T")[0];
    filled.push({ date: key, tss: inputMap.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return filled;
}

export function computePMC(dailyTss: DailyTss[], initialCtl: number = 30, initialAtl: number = 30): PmcResult[] {
  if (dailyTss.length === 0) return [];

  const sorted = [...dailyTss].sort(
    (first, second) => new Date(first.date).getTime() - new Date(second.date).getTime()
  );

  const ctlLambda = Math.exp(-1 / CTL_TC);
  const atlLambda = Math.exp(-1 / ATL_TC);

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
