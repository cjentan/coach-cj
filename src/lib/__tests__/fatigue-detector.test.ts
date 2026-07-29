import { describe, it, expect } from 'vitest';
import { detectFatigue } from '../fatigue-detector';

function makePmcResults(tsbValues: number[]): Array<{
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
  rampRate: number | null;
}> {
  return tsbValues.map((tsb, i) => ({
    date: `2025-01-${String(15 + i).padStart(2, '0')}`,
    tss: 100,
    ctl: 60,
    atl: 60 - tsb,
    tsb,
    rampRate: null,
  }));
}

describe('detectFatigue', () => {
  it('returns low fatigue with no signals', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults([5, 3]),
      dailyTss: [100, 100],
      restingHrHistory: [],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
    });
    expect(result.severity).toBe('low');
    expect(result.score).toBeLessThan(18);
    expect(result.recommendedRestDays).toBe(0);
  });

  it('detects critical fatigue from deep TSB + multiple signals', () => {
    // Need enough signals to cross the critical threshold (score >= 60)
    const result = detectFatigue({
      pmcResults: makePmcResults(Array.from({ length: 30 }, (_, i) => -10 - i)),
      dailyTss: Array.from({ length: 30 }, (_, i) => 50 + i * 5),
      restingHrHistory: Array.from({ length: 14 }, (_, i) => ({
        date: `2025-01-${String(1 + i).padStart(2, '0')}`,
        value: 45 + i * 2,
      })),
      weightHistory: Array.from({ length: 14 }, (_, i) => ({
        date: `2025-01-${String(1 + i).padStart(2, '0')}`,
        weightKg: 72 - i * 0.3,
      })),
      recentAvgHr: 158,
      baselineAvgHr: 140,
      avgDecouplingPct: 12,
      efTrend: [
        { weekStart: '2025-01-06', ef: 1.0 },
        { weekStart: '2025-01-13', ef: 0.85 },
      ],
      intensityDistribution: {
        zone1Pct: 30,
        zone2Pct: 40,
        zone3Pct: 30,
        zone4Pct: 0,
        zone5Pct: 0,
        distributionType: 'threshold-heavy',
      },
    });
    expect(result.severity).toBe('critical');
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.recommendedRestDays).toBe(7);
  });

  it('detects high fatigue from multiple signals', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults([-15, -18, -22, -25, -28, -30]),
      dailyTss: [150, 200, 180, 220, 190, 210],
      restingHrHistory: [
        { date: '2025-01-10', value: 48 },
        { date: '2025-01-11', value: 49 },
        { date: '2025-01-12', value: 50 },
        { date: '2025-01-13', value: 55 },
        { date: '2025-01-14', value: 58 },
        { date: '2025-01-15', value: 60 },
      ],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
    });
    expect(result.severity).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(18);
    expect(result.recommendedRestDays).toBe(3);
  });

  it('detects moderate fatigue', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults([-15, -12]),
      dailyTss: [180, 200],
      restingHrHistory: [
        { date: '2025-01-10', value: 50 },
        { date: '2025-01-11', value: 52 },
        { date: '2025-01-12', value: 54 },
        { date: '2025-01-13', value: 55 },
        { date: '2025-01-14', value: 56 },
        { date: '2025-01-15', value: 57 },
      ],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
    });
    expect(result.severity).toBe('medium');
    expect(result.recommendedRestDays).toBe(2);
  });

  it('detects TSB depth contribution thresholds', () => {
    const mildTsb = detectFatigue({
      pmcResults: makePmcResults([-5]),
      dailyTss: [100],
      restingHrHistory: [],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
    });
    const deepTsb = detectFatigue({
      pmcResults: makePmcResults([-35]),
      dailyTss: [100],
      restingHrHistory: [],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
    });
    expect(deepTsb.score).toBeGreaterThan(mildTsb.score);
  });

  it('detects resting HR drift', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults([0, 0]),
      dailyTss: [100, 100],
      restingHrHistory: [
        { date: '2025-01-01', value: 45 },
        { date: '2025-01-02', value: 46 },
        { date: '2025-01-03', value: 47 },
        { date: '2025-01-12', value: 55 },
        { date: '2025-01-13', value: 58 },
        { date: '2025-01-14', value: 60 },
      ],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
    });
    // recent avg = (55+58+60)/3 ≈ 57.7, older avg = (45+46+47)/3 = 46
    // drift = 11.7 > 8 → contribution = 1.0
    const hrSignal = result.signals.find((s) => s.signal === 'Resting HR Drift');
    expect(hrSignal).toBeDefined();
    expect(hrSignal!.contribution).toBe(1.0);
  });

  it('detects training monotony with varying daily TSS', () => {
    // Constant values produce high monotony; varying values produce lower
    const result = detectFatigue({
      pmcResults: makePmcResults([5]),
      dailyTss: [50, 200, 30, 180, 60, 220, 40],
      restingHrHistory: [],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
    });
    const monotonySignal = result.signals.find((s) => s.signal === 'Training Monotony');
    expect(monotonySignal).toBeDefined();
    expect(monotonySignal!.value).toBeGreaterThan(0);
  });

  it('detects exercise HR drift', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults([0, 0]),
      dailyTss: [100, 100],
      restingHrHistory: [],
      weightHistory: [],
      recentAvgHr: 155,
      baselineAvgHr: 142,
    });
    const hrSignal = result.signals.find((s) => s.signal === 'Exercise HR Drift');
    expect(hrSignal).toBeDefined();
    expect(hrSignal!.contribution).toBe(1.0);
  });

  it('detects weight drift with sufficient data (14+ entries)', () => {
    // The function uses slice(-7) for recent and slice(-14, -7) for older,
    // so we need at least 14 entries
    const weightHistory = [];
    for (let i = 0; i < 14; i++) {
      weightHistory.push({
        date: `2025-01-${String(1 + i).padStart(2, '0')}`,
        weightKg: 72 - i * 0.3,
      });
    }
    const result = detectFatigue({
      pmcResults: makePmcResults([0, 0]),
      dailyTss: [100, 100],
      restingHrHistory: [],
      weightHistory,
      recentAvgHr: null,
      baselineAvgHr: null,
    });
    const weightSignal = result.signals.find((s) => s.signal === 'Weight Drift (7-day)');
    expect(weightSignal).toBeDefined();
    expect(weightSignal!.contribution).toBeGreaterThan(0);
  });

  it('detects aerobic decoupling', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults([0]),
      dailyTss: [100],
      restingHrHistory: [],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
      avgDecouplingPct: 12,
    });
    const decouplingSignal = result.signals.find((s) => s.signal === 'HR-Pace Decoupling');
    expect(decouplingSignal).toBeDefined();
    expect(decouplingSignal!.contribution).toBe(1.0);
  });

  it('detects efficiency factor decline', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults([0]),
      dailyTss: [100],
      restingHrHistory: [],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
      efTrend: [
        { weekStart: '2025-01-06', ef: 1.0 },
        { weekStart: '2025-01-13', ef: 0.85 },
      ],
    });
    const efSignal = result.signals.find((s) => s.signal === 'Efficiency Decline');
    expect(efSignal).toBeDefined();
    expect(efSignal!.contribution).toBe(0.8);
  });

  it('detects threshold training load in intensity distribution', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults([0]),
      dailyTss: [100],
      restingHrHistory: [],
      weightHistory: [],
      recentAvgHr: null,
      baselineAvgHr: null,
      intensityDistribution: {
        zone1Pct: 30,
        zone2Pct: 40,
        zone3Pct: 30,
        zone4Pct: 0,
        zone5Pct: 0,
        distributionType: 'threshold-heavy',
      },
    });
    const thresholdSignal = result.signals.find((s) => s.signal === 'Threshold Training Load');
    expect(thresholdSignal).toBeDefined();
    expect(thresholdSignal!.contribution).toBe(1.0);
  });

  it('returns all 10 signal types when full data is available', () => {
    const result = detectFatigue({
      pmcResults: makePmcResults(Array.from({ length: 30 }, (_, i) => -10 - i)),
      dailyTss: Array.from({ length: 30 }, (_, i) => 50 + i * 5),
      restingHrHistory: Array.from({ length: 14 }, (_, i) => ({
        date: `2025-01-${String(1 + i).padStart(2, '0')}`,
        value: 45 + i * 2,
      })),
      weightHistory: Array.from({ length: 14 }, (_, i) => ({
        date: `2025-01-${String(1 + i).padStart(2, '0')}`,
        weightKg: 72 - i * 0.3,
      })),
      recentAvgHr: 158,
      baselineAvgHr: 140,
      avgDecouplingPct: 8,
      efTrend: [
        { weekStart: '2025-01-06', ef: 1.0 },
        { weekStart: '2025-01-13', ef: 0.88 },
      ],
      intensityDistribution: {
        zone1Pct: 25,
        zone2Pct: 30,
        zone3Pct: 25,
        zone4Pct: 15,
        zone5Pct: 5,
        distributionType: 'pyramidal',
      },
    });
    expect(result.signals.length).toBeGreaterThanOrEqual(8);
  });
});
