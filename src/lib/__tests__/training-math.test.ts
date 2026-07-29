import { describe, it, expect } from 'vitest';
import {
  estimateTss,
  computePowerTss,
  computeHrTssEstimate,
  computeHrTss,
  computeNormalizedPower,
  computeNormalizedPowerFloat,
} from '../training-math';

describe('estimateTss', () => {
  it('returns 0 for 0 seconds', () => {
    expect(estimateTss(0)).toBe(0);
  });

  it('returns ~50 for 1 hour (3600s)', () => {
    expect(estimateTss(3600)).toBe(50);
  });

  it('returns ~100 for 2 hours (7200s)', () => {
    expect(estimateTss(7200)).toBe(100);
  });

  it('returns ~25 for 30 minutes', () => {
    expect(estimateTss(1800)).toBe(25);
  });

  it('rounds correctly for partial hours', () => {
    expect(estimateTss(5400)).toBe(75);
  });
});

describe('computePowerTss', () => {
  it('computes TSS for a typical workout', () => {
    const tss = computePowerTss(3600, 200, 250);
    // IF = 200/250 = 0.8
    // TSS = (3600 * 200 * 0.8) / (250 * 36) = 576000 / 9000 = 64
    expect(tss).toBe(64);
  });

  it('returns 0 for zero duration', () => {
    expect(computePowerTss(0, 200, 250)).toBe(0);
  });

  it('handles high FTP', () => {
    const tss = computePowerTss(3600, 200, 350);
    expect(tss).toBe(33);
  });

  it('handles NP equal to FTP (intensity 1.0)', () => {
    const tss = computePowerTss(3600, 250, 250);
    expect(tss).toBe(100);
  });
});

describe('computeHrTssEstimate', () => {
  it('computes HR-based TSS estimate', () => {
    const tss = computeHrTssEstimate(3600, 140, 180);
    // intensity = 140/180 ≈ 0.778
    // TSS = (3600 * 0.778²) / 36 ≈ 60
    expect(tss).toBe(60);
  });

  it('returns higher TSS for higher HR intensity', () => {
    const easy = computeHrTssEstimate(3600, 120, 180);
    const hard = computeHrTssEstimate(3600, 165, 180);
    expect(hard).toBeGreaterThan(easy);
  });

  it('scales with duration', () => {
    const short = computeHrTssEstimate(1800, 140, 180);
    const long = computeHrTssEstimate(3600, 140, 180);
    expect(long).toBeGreaterThan(short);
  });
});

describe('computeHrTss', () => {
  it('computes hrTSS from zone times', () => {
    const result = computeHrTss([0, 0, 3600, 0, 0], 3600);
    expect(result.hrTss).toBe(80);
    expect(result.zonePct).toEqual([0, 0, 100, 0, 0]);
  });

  it('computes zone percentages correctly', () => {
    const result = computeHrTss([1800, 0, 0, 0, 1800], 3600);
    expect(result.hrTss).toBe(90);
    expect(result.zonePct).toEqual([50, 0, 0, 0, 50]);
  });

  it('handles all zones equally distributed', () => {
    const result = computeHrTss([720, 720, 720, 720, 720], 3600);
    expect(result.hrTss).toBe(85);
    expect(result.zonePct).toEqual([20, 20, 20, 20, 20]);
  });

  it('handles zero time in all zones gracefully', () => {
    const result = computeHrTss([0, 0, 0, 0, 0], 0);
    expect(result.hrTss).toBe(0);
    expect(result.zonePct).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('computeNormalizedPower', () => {
  it('returns null for fewer than 30 power values', () => {
    expect(computeNormalizedPower(Array.from({ length: 29 }, (_, i) => 200))).toBeNull();
  });

  it('computes NP for 30+ power values', () => {
    const values = Array.from({ length: 60 }, (_, i) => 200 + Math.sin(i) * 50);
    const np = computeNormalizedPower(values);
    expect(np).toBeGreaterThan(0);
    expect(Number.isInteger(np)).toBe(true);
  });

  it('returns exact NP for constant power', () => {
    const values = Array.from({ length: 60 }, () => 200);
    expect(computeNormalizedPower(values)).toBe(200);
  });

  it('NP is higher than average for variable power', () => {
    // Use a pattern where the 30s rolling avg itself varies (not constant 200)
    const variable = Array.from({ length: 120 }, (_, i) =>
      i < 60 ? 100 : 300,
    );
    const np = computeNormalizedPower(variable)!;
    const avg = variable.reduce((a, b) => a + b, 0) / variable.length;
    // Rolling 30s avg transitions from 100 → 300 across the boundary
    expect(np).toBeGreaterThan(avg);
  });
});

describe('computeNormalizedPowerFloat', () => {
  it('returns simple average for fewer than 30 values', () => {
    const values = [200, 210, 190];
    expect(computeNormalizedPowerFloat(values)).toBe(200);
  });

  it('returns NP float for 30+ values', () => {
    const values = Array.from({ length: 60 }, () => 200);
    expect(computeNormalizedPowerFloat(values)).toBe(200);
  });

  it('falls back to average when data is insufficient', () => {
    const values = [100, 200, 300];
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    expect(computeNormalizedPowerFloat(values)).toBe(avg);
  });
});
