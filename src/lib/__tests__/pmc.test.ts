import { describe, it, expect } from 'vitest';
import {
  computePMC,
  computeMonotony,
  computeStrain,
  fillDailyTss,
} from '../pmc';
import { computeLinearRegression } from '../training-load';

describe('computePMC', () => {
  it('returns empty array for empty input', () => {
    expect(computePMC([])).toEqual([]);
  });

  it('returns a single result for a single day', () => {
    const results = computePMC([{ date: '2025-01-15', tss: 100 }]);
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2025-01-15');
    expect(results[0].tss).toBe(100);
    expect(results[0].ctl).toBeGreaterThan(0);
    expect(results[0].atl).toBeGreaterThan(0);
  });

  it('sorts dates chronologically', () => {
    const results = computePMC([
      { date: '2025-01-17', tss: 50 },
      { date: '2025-01-15', tss: 100 },
      { date: '2025-01-16', tss: 75 },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].date).toBe('2025-01-15');
    expect(results[1].date).toBe('2025-01-16');
    expect(results[2].date).toBe('2025-01-17');
    expect(results[2].tss).toBe(50);
  });

  it('computes CTL/ATL/TSB for a known sequence', () => {
    const results = computePMC([
      { date: '2025-01-15', tss: 100 },
      { date: '2025-01-16', tss: 80 },
      { date: '2025-01-17', tss: 120 },
    ]);
    expect(results).toHaveLength(3);

    // Allow floating-point tolerance for TSB = CTL - ATL
    for (const r of results) {
      expect(Math.abs(r.tsb - (r.ctl - r.atl))).toBeLessThan(0.2);
    }

    // ATL should respond faster to changes (7-day vs 42-day time constant)
    const firstAtlRise = results[1].atl - results[0].atl;
    const firstCtlRise = results[1].ctl - results[0].ctl;
    expect(firstAtlRise).toBeGreaterThan(firstCtlRise);
  });

  it('rampRate is null for first 7 results (indices 0-6)', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({
      date: `2025-01-${String(15 + i).padStart(2, '0')}`,
      tss: 100,
    }));
    const results = computePMC(days, 30, 30);
    for (let i = 0; i < 7; i++) {
      expect(results[i].rampRate).toBeNull();
    }
  });

  it('rampRate is set from the 8th result (index 7) onward', () => {
    // Use escalating TSS so CTL changes meaningfully over 7 days
    const days = Array.from({ length: 14 }, (_, i) => ({
      date: `2025-01-${String(15 + i).padStart(2, '0')}`,
      tss: 50 + i * 10,
    }));
    const results = computePMC(days, 30, 30);
    for (let i = 7; i < results.length; i++) {
      expect(results[i].rampRate).not.toBeNull();
    }
  });

  it('handles the default initial values', () => {
    const withDefaults = computePMC([{ date: '2025-01-15', tss: 100 }]);
    const withCustom = computePMC(
      [{ date: '2025-01-15', tss: 100 }],
      30,
      30,
    );
    expect(withDefaults[0].ctl).toBe(withCustom[0].ctl);
  });

  it('returns rounded values to 1 decimal place', () => {
    const results = computePMC([
      { date: '2025-01-15', tss: 100 },
      { date: '2025-01-16', tss: 80 },
    ]);
    for (const r of results) {
      const decimals = (r.ctl.toString().split('.')[1] || '').length;
      expect(decimals).toBeLessThanOrEqual(1);
    }
  });

  it('reflects recovery on rest days after the last activity', () => {
    const results = computePMC([
      { date: '2025-01-15', tss: 200 },
      { date: '2025-01-16', tss: 0 },
      { date: '2025-01-17', tss: 0 },
      { date: '2025-01-18', tss: 0 },
    ]);
    // Fatigue (ATL) decays faster than fitness (CTL), so TSB should rise
    // across the rest days — i.e. the athlete is recovering.
    expect(results[3].atl).toBeLessThan(results[0].atl);
    expect(results[3].ctl).toBeLessThan(results[0].ctl);
    expect(results[3].tsb).toBeGreaterThan(results[0].tsb);
  });
});

describe('fillDailyTss', () => {
  it('returns empty for empty input', () => {
    expect(fillDailyTss([])).toEqual([]);
  });

  it('preserves activity TSS and fills gaps and rest days with 0', () => {
    const input = [
      { date: '2026-07-28', tss: 100 },
      { date: '2026-07-30', tss: 80 },
    ];
    const result = fillDailyTss(input);
    // Gaps between activities and days after the last activity get tss 0
    const byDate = new Map(result.map((d) => [d.date, d.tss]));
    expect(byDate.get('2026-07-28')).toBe(100);
    expect(byDate.get('2026-07-29')).toBe(0);
    expect(byDate.get('2026-07-30')).toBe(80);
    expect(byDate.get('2026-07-31')).toBe(0);
    // First and last entries match the input boundaries / today
    expect(result[0].date).toBe('2026-07-28');
    expect(result[0].tss).toBe(100);
    expect(result[result.length - 1].date).toBe(
      new Date().toISOString().split('T')[0]
    );
    expect(result[result.length - 1].tss).toBe(0);
  });

  it('extends the series through today (UTC) with tss 0 on rest days', () => {
    const input = [{ date: '2026-07-30', tss: 100 }];
    const result = fillDailyTss(input);
    const todayKey = new Date().toISOString().split('T')[0];
    expect(result[result.length - 1].date).toBe(todayKey);
    expect(result[result.length - 1].tss).toBe(0);
    // All dates are consecutive
    for (let i = 1; i < result.length; i++) {
      const prev = new Date(result[i - 1].date);
      const curr = new Date(result[i].date);
      expect((curr.getTime() - prev.getTime()) / 86400000).toBe(1);
    }
  });

  it('does not truncate when the last activity is dated after today', () => {
    const futureDate = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];
    const result = fillDailyTss([{ date: futureDate, tss: 50 }]);
    expect(result[result.length - 1].date).toBe(futureDate);
    expect(result[result.length - 1].tss).toBe(50);
  });
});

describe('computeMonotony', () => {
  it('returns 0 for fewer than 2 values', () => {
    expect(computeMonotony([])).toBe(0);
    expect(computeMonotony([100])).toBe(0);
  });

  it('returns a value for constant daily TSS (not NaN)', () => {
    // With equal values, stddev = 0, so mean / (stddev || 1) = mean
    const result = computeMonotony([100, 100, 100, 100, 100]);
    expect(result).toBeGreaterThan(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it('returns lower monotony for more varied training', () => {
    // Higher variation → lower monotony
    const repetitive = computeMonotony([95, 100, 105, 98, 102]);
    const varied = computeMonotony([30, 150, 80, 200, 40]);
    expect(repetitive).toBeGreaterThan(varied);
  });

  it('handles zero mean gracefully', () => {
    expect(computeMonotony([0, 0, 0])).toBe(0);
  });
});

describe('computeStrain', () => {
  it('returns 0 for fewer than 2 values', () => {
    expect(computeStrain([100])).toBe(0);
  });

  it('strain = total * monotony for non-constant values', () => {
    const values = [50, 100, 150, 80, 120];
    const strain = computeStrain(values);
    const total = values.reduce((a, b) => a + b, 0);
    const monotony = computeMonotony(values);
    expect(strain).toBe(Math.round(total * monotony));
  });

  it('returns higher strain for higher volume at same monotony', () => {
    const low = computeStrain([50, 100, 50]);
    const high = computeStrain([500, 1000, 500]);
    expect(high).toBeGreaterThan(low);
  });
});

describe('computeLinearRegression', () => {
  it('returns slope=0 for single value', () => {
    const result = computeLinearRegression([42]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(42);
    expect(result.r2).toBe(0);
  });

  it('returns slope=1 for perfect diagonal', () => {
    const result = computeLinearRegression([0, 1, 2, 3, 4]);
    expect(result.slope).toBe(1);
    expect(result.r2).toBe(1);
  });

  it('returns slope=0 for flat line', () => {
    const result = computeLinearRegression([5, 5, 5, 5, 5]);
    expect(result.slope).toBe(0);
    expect(result.r2).toBe(0);
  });

  it('computes slope and intercept correctly', () => {
    // y = 2x + 10
    const values = [10, 12, 14, 16, 18, 20];
    const result = computeLinearRegression(values);
    expect(result.slope).toBe(2);
    expect(result.intercept).toBe(10);
    expect(result.r2).toBe(1);
  });

  it('r2 is between 0 and 1', () => {
    const result = computeLinearRegression([10, 15, 13, 20, 18, 25]);
    expect(result.r2).toBeGreaterThanOrEqual(0);
    expect(result.r2).toBeLessThanOrEqual(1);
  });

  it('handles negative slope', () => {
    const result = computeLinearRegression([20, 18, 16, 14, 12, 10]);
    expect(result.slope).toBe(-2);
    expect(result.r2).toBe(1);
  });
});
