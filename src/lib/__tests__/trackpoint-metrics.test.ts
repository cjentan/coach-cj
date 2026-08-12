import { describe, it, expect } from 'vitest';
import {
  computeHrTss,
  computeIntensityDistribution,
  computePowerMetrics,
  computeDecoupling,
  computeEfficiencyFactor,
  computeBestTss,
  extractMetrics,
  computePrecomputedTrackpointMetrics,
} from '../trackpoint-metrics';
import { buildTrackPoints } from '@/test/factories';

describe('computeHrTss', () => {
  it('returns null for fewer than 10 HR points', () => {
    const points = [{ hr: 130 }, { hr: 140 }];
    expect(computeHrTss(points, 180)).toBeNull();
  });

  it('returns null for invalid maxHr', () => {
    const points = buildTrackPoints(100);
    expect(computeHrTss(points, 0)).toBeNull();
  });

  it('computes hrTss from trackpoint data', () => {
    const points = buildTrackPoints(3600, { baseHr: 130 });
    const result = computeHrTss(points, 180);
    expect(result).not.toBeNull();
    expect(result!.hrTss).toBeGreaterThan(0);
    expect(result!.timeInZones).toHaveLength(5);
    expect(result!.zonePct).toHaveLength(5);
    expect(result!.zoneHrRanges).toHaveLength(5);
  });

  it('computes zone percentages that sum to ~100%', () => {
    const points = buildTrackPoints(3600, { baseHr: 130 });
    const result = computeHrTss(points, 180);
    const total = result!.zonePct.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('distributes very low HR points into Z1', () => {
    const lowPoints = buildTrackPoints(100, { baseHr: 90 });
    const lowResult = computeHrTss(lowPoints, 200);
    // With maxHr=200, Z1 upper is 136. baseHr=90 ± 20 = 70-110, all in Z1
    expect(lowResult!.zonePct[0]).toBe(100);
  });

  it('distributes high HR points mostly into Z4+Z5', () => {
    const highPoints = buildTrackPoints(100, { baseHr: 190 });
    const highResult = computeHrTss(highPoints, 200);
    // With maxHr=200, Z4 = 188-210, Z5 > 210
    // baseHr=190 ± 20 = 170-210 — spans Z3-Z5
    const highZonePct = highResult!.zonePct[3] + highResult!.zonePct[4];
    expect(highZonePct).toBeGreaterThan(50);
  });

  it('computes zone HR ranges correctly', () => {
    const points = buildTrackPoints(100, { baseHr: 140 });
    const result = computeHrTss(points, 180);
    expect(result!.zoneHrRanges[0]).toBeLessThan(result!.zoneHrRanges[1]);
    expect(result!.zoneHrRanges[3]).toBeGreaterThan(170);
  });

  it('uses resting HR when provided (Karvonen method)', () => {
    const points = buildTrackPoints(100, { baseHr: 120 });
    const withoutRhr = computeHrTss(points, 180);
    const withRhr = computeHrTss(points, 180, 50);
    expect(withRhr!.zoneHrRanges).not.toEqual(withoutRhr!.zoneHrRanges);
  });
});

describe('computeIntensityDistribution', () => {
  it('returns null for fewer than 30 HR points', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ hr: 120 + i }));
    expect(computeIntensityDistribution(points, 180)).toBeNull();
  });

  it('returns null for invalid maxHr', () => {
    const points = buildTrackPoints(100);
    expect(computeIntensityDistribution(points, 0)).toBeNull();
  });

  it('returns a valid distribution for normal data', () => {
    const points = buildTrackPoints(600, { baseHr: 130 });
    const result = computeIntensityDistribution(points, 180);
    expect(result).not.toBeNull();
    expect(result!.analyzedDuration).toBeGreaterThanOrEqual(30);
  });

  it('sums zone percentages to ~100%', () => {
    const points = buildTrackPoints(600, { baseHr: 130 });
    const result = computeIntensityDistribution(points, 180);
    const total = result!.zone1Pct + result!.zone2Pct + result!.zone3Pct + result!.zone4Pct + result!.zone5Pct;
    expect(total).toBeCloseTo(100, 0);
  });

  it('returns a classification type', () => {
    const points = buildTrackPoints(600, { baseHr: 130 });
    const result = computeIntensityDistribution(points, 180);
    expect(['polarized', 'pyramidal', 'threshold-heavy', 'insufficient_data']).toContain(
      result!.distributionType,
    );
  });
});

describe('computePowerMetrics', () => {
  it('returns null for fewer than 30 power points', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ power: 150 + i }));
    expect(computePowerMetrics(points)).toBeNull();
  });

  it('returns power metrics for sufficient data', () => {
    const points = buildTrackPoints(3600, { basePower: 200 });
    const result = computePowerMetrics(points);
    expect(result).not.toBeNull();
    expect(result!.avgPower).toBeGreaterThan(0);
    expect(result!.maxPower).toBeGreaterThan(0);
    expect(result!.estimatedFtp).toBeGreaterThan(0);
  });

  it('computes NP, VI, IF for valid data', () => {
    const points = buildTrackPoints(3600, { basePower: 200 });
    const result = computePowerMetrics(points);
    expect(result!.normalizedPower).not.toBeNull();
    expect(result!.variabilityIndex).not.toBeNull();
    expect(result!.intensityFactor).not.toBeNull();
  });

  it('computes weight-normalized values when weight is provided', () => {
    const points = buildTrackPoints(3600, { basePower: 200 });
    const result = computePowerMetrics(points, 250, 70);
    expect(result!.ftpWkg).toBeCloseTo(250 / 70, 0);
    expect(result!.avgPowerWkg).not.toBeNull();
    expect(result!.normalizedPowerWkg).not.toBeNull();
  });

  it('estimates FTP from 20-min best power', () => {
    const points = buildTrackPoints(3600, { basePower: 200 });
    const result = computePowerMetrics(points);
    expect(result!.estimatedFtp).toBeGreaterThan(170);
    expect(result!.estimatedFtp).toBeLessThan(210);
  });

  it('computes power TSS', () => {
    const points = buildTrackPoints(3600, { basePower: 200 });
    const result = computePowerMetrics(points);
    expect(result!.tss).not.toBeNull();
    expect(result!.tss).toBeGreaterThan(0);
  });

  it('computes time in power zones', () => {
    const points = buildTrackPoints(3600, { basePower: 200 });
    const result = computePowerMetrics(points);
    expect(result!.timeInZones).toHaveLength(6);
    expect(result!.zonePct).toHaveLength(6);
    const total = result!.zonePct.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 0);
  });
});

describe('computeDecoupling', () => {
  it('returns null for fewer than 60 valid points', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      hr: 140 + i,
      speed: 3.5,
    }));
    expect(computeDecoupling(points)).toBeNull();
  });

  it('returns null when HR or output data is missing', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ hr: null, speed: null }));
    expect(computeDecoupling(points as any)).toBeNull();
  });

  it('computes decoupling from speed data', () => {
    const points = Array.from({ length: 120 }, (_, i) => ({
      hr: 145 + (i > 60 ? 15 : 0),
      speed: 3.5,
    }));
    const result = computeDecoupling(points);
    expect(result).not.toBeNull();
    expect(result!.firstHalfHr!).toBeLessThan(result!.secondHalfHr!);
  });

  it('computes decoupling from power data', () => {
    const points = Array.from({ length: 120 }, (_, i) => ({
      hr: 145 + (i > 60 ? 10 : 0),
      power: 200,
    }));
    const result = computeDecoupling(points, true);
    expect(result).not.toBeNull();
    expect(result!.decouplingPct).not.toBeNull();
  });

  it('returns negative decoupling for negative splits', () => {
    const points = Array.from({ length: 120 }, (_, i) => ({
      hr: 145,
      power: i > 60 ? 250 : 200,
    }));
    const result = computeDecoupling(points, true);
    expect(result).not.toBeNull();
    expect(result!.decouplingPct).toBeLessThan(0);
  });
});

describe('computeEfficiencyFactor', () => {
  it('returns null for fewer than 60 valid points', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      hr: 140,
      power: 200,
    }));
    expect(computeEfficiencyFactor(points)).toBeNull();
  });

  it('computes EF from power data', () => {
    const points = buildTrackPoints(3600, { baseHr: 140, basePower: 200 });
    const result = computeEfficiencyFactor(points);
    expect(result).not.toBeNull();
    expect(result!.ef).toBeGreaterThan(0);
  });

  it('computes EF w/kg when weight is provided', () => {
    const points = buildTrackPoints(3600, { baseHr: 140, basePower: 200 });
    const result = computeEfficiencyFactor(points, 70);
    expect(result!.efWkg).not.toBeNull();
    expect(result!.efWkg).toBeGreaterThan(0);
  });

  it('returns null when points lack both power and speed', () => {
    // Points with HR but no power or speed
    const points = Array.from({ length: 120 }, (_, i) => ({
      hr: 140,
    }));
    const result = computeEfficiencyFactor(points as any);
    expect(result).toBeNull();
  });
});

describe('computeBestTss', () => {
  it('uses power TSS when power data is available', () => {
    const points = buildTrackPoints(3600, { basePower: 200, baseHr: 140 });
    const tss = computeBestTss(points, 140, 180, 3600);
    expect(tss).toBeGreaterThan(0);
  });

  it('falls back to hrTSS when no power but HR available', () => {
    const points = Array.from({ length: 3600 }, (_, i) => ({
      hr: 130 + Math.round(Math.sin(i / 100) * 20),
    }));
    const tss = computeBestTss(points as any, 140, 180, 3600);
    expect(tss).toBeGreaterThan(0);
  });

  it('uses hr estimate when trackpoints lack both power and HR', () => {
    const tss = computeBestTss(null, 140, 180, 3600);
    expect(tss).toBe(60);
  });

  it('falls back to time estimate when even avgHR is missing', () => {
    const tss = computeBestTss(null, null, null, 3600);
    expect(tss).toBe(50);
  });

  it('handles insufficient trackpoints gracefully', () => {
    const points = [{ hr: 130 }, { hr: 140 }];
    const tss = computeBestTss(points as any, 140, 180, 3600);
    expect(tss).toBe(60);
  });
});

describe('extractMetrics', () => {
  it('returns all metrics with null for missing data', () => {
    const result = extractMetrics(null, null, null, 3600);
    expect(result.hrTss).toBeNull();
    expect(result.powerMetrics).toBeNull();
    expect(result.intensityDistribution).toBeNull();
    expect(result.decoupling).toBeNull();
    expect(result.efficiencyFactor).toBeNull();
    expect(result.bestTss).toBeGreaterThan(0);
  });

  it('returns computed metrics from rawJson with trackpoints', () => {
    const rawJson = {
      trackPoints: buildTrackPoints(3600, { baseHr: 140, basePower: 200 }),
    };
    const result = extractMetrics(rawJson as any, 180, 145, 3600);
    expect(result.hrTss).not.toBeNull();
    expect(result.powerMetrics).not.toBeNull();
    expect(result.intensityDistribution).not.toBeNull();
    expect(result.decoupling).not.toBeNull();
    expect(result.bestTss).toBeGreaterThan(0);
  });

  it('aggregates all sub-metrics into one result', () => {
    const rawJson = {
      trackPoints: buildTrackPoints(3600, { baseHr: 140, basePower: 200 }),
    };
    const result = extractMetrics(rawJson as any, 180, 145, 3600);
    expect(result.powerMetrics!.avgPower).toBeGreaterThan(0);
    expect(result.powerMetrics!.maxPower).toBeGreaterThan(0);
    expect(result.hrTss!.hrTss).toBeGreaterThan(0);
    expect(result.intensityDistribution!.zone1Pct).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyFactor).not.toBeNull();
  });
});

describe('computePrecomputedTrackpointMetrics', () => {
  it('returns all nulls for null/undefined/empty trackpoints', () => {
    const empty = computePrecomputedTrackpointMetrics(null, 180);
    expect(empty).toEqual({
      zone1Pct: null, zone2Pct: null, zone3Pct: null, zone4Pct: null, zone5Pct: null,
      intensityAnalyzedSeconds: null, decouplingPct: null, efficiencyFactor: null,
      trackpointNormalizedPower: null,
    });
    expect(computePrecomputedTrackpointMetrics(undefined, 180)).toEqual(empty);
    expect(computePrecomputedTrackpointMetrics([], 180)).toEqual(empty);
  });

  it('returns all nulls for fewer than 30 trackpoints', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({
      hr: 140 + i, power: 200, speed: 3.5, distance: i,
    }));
    const result = computePrecomputedTrackpointMetrics(points, 180);
    expect(result.zone1Pct).toBeNull();
    expect(result.decouplingPct).toBeNull();
    expect(result.efficiencyFactor).toBeNull();
    expect(result.trackpointNormalizedPower).toBeNull();
  });

  it('nulls the zone distribution when maxHr is missing', () => {
    const points = buildTrackPoints(3600, { baseHr: 140, basePower: 200 });
    const result = computePrecomputedTrackpointMetrics(points, null);
    // Intensity needs maxHr → zones null…
    expect(result.zone1Pct).toBeNull();
    expect(result.intensityAnalyzedSeconds).toBeNull();
    // …but power/decoupling/EF are maxHr-independent and still computed.
    expect(result.trackpointNormalizedPower).not.toBeNull();
    expect(result.decouplingPct).not.toBeNull();
    expect(result.efficiencyFactor).not.toBeNull();
  });

  it('nulls zones when the distribution is insufficient_data (< 60 HR points)', () => {
    // 40 total points: enough for the 30-point gate, but computeIntensityDistribution
    // classifies total < 60 as insufficient_data, which must not be persisted.
    const points = Array.from({ length: 40 }, (_, i) => ({
      hr: 140 + (i % 10), power: 200,
    }));
    const result = computePrecomputedTrackpointMetrics(points, 180);
    expect(result.zone1Pct).toBeNull();
    expect(result.zone2Pct).toBeNull();
    expect(result.zone3Pct).toBeNull();
    expect(result.zone4Pct).toBeNull();
    expect(result.zone5Pct).toBeNull();
    expect(result.intensityAnalyzedSeconds).toBeNull();
  });

  it('computes all metrics from rich trackpoint data', () => {
    const points = buildTrackPoints(3600, { baseHr: 140, basePower: 200 });
    const result = computePrecomputedTrackpointMetrics(points, 180);

    expect(result.zone1Pct).not.toBeNull();
    expect(result.zone2Pct).not.toBeNull();
    expect(result.zone3Pct).not.toBeNull();
    expect(result.zone4Pct).not.toBeNull();
    expect(result.zone5Pct).not.toBeNull();
    expect(result.intensityAnalyzedSeconds).toBeGreaterThan(0);
    expect(result.decouplingPct).not.toBeNull();
    expect(result.efficiencyFactor).not.toBeNull();
    expect(result.trackpointNormalizedPower).not.toBeNull();
  });

  it('matches the live compute functions the old dashboard routes used', () => {
    const points = buildTrackPoints(3600, { baseHr: 140, basePower: 200 });
    const result = computePrecomputedTrackpointMetrics(points, 180);

    const dist = computeIntensityDistribution(points, 180)!;
    expect(result.zone1Pct).toBe(dist.zone1Pct);
    expect(result.zone2Pct).toBe(dist.zone2Pct);
    expect(result.zone3Pct).toBe(dist.zone3Pct);
    expect(result.zone4Pct).toBe(dist.zone4Pct);
    expect(result.zone5Pct).toBe(dist.zone5Pct);
    expect(result.intensityAnalyzedSeconds).toBe(dist.analyzedDuration);

    const hasPower = points.some((tp) => tp.power != null && tp.power > 0);
    const dec = computeDecoupling(points, hasPower)!;
    expect(result.decouplingPct).toBe(dec.decouplingPct);

    const ef = computeEfficiencyFactor(points)!;
    expect(result.efficiencyFactor).toBe(ef.ef);

    const pm = computePowerMetrics(points)!;
    expect(result.trackpointNormalizedPower).toBe(pm.normalizedPower);
  });
});
