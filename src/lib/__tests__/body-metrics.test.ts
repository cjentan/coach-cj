import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_MAX_HR,
  getEffectiveMaxHr,
  getMaxHrInfo,
  getLatestRestingHr,
} from '../body-metrics';

const mockPrisma = vi.hoisted(() => ({
  dailyHealth: { findFirst: vi.fn() },
  bodyMetric: { findFirst: vi.fn() },
  trainingLog: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const userId = 'user-1';

describe('getEffectiveMaxHr / getMaxHrInfo — precedence', () => {
  beforeEach(() => {
    // resetAllMocks clears mockResolvedValueOnce queues so once-values from a
    // prior test can't leak into the next one.
    vi.resetAllMocks();
  });

  it('uses the data estimate when one exists (highest workout max, 2y)', async () => {
    mockPrisma.trainingLog.findFirst.mockResolvedValueOnce({ maxHr: 188 });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ maxHr: 175 });

    const info = await getMaxHrInfo(userId);
    expect(info).toEqual({
      effective: 188,
      source: 'estimated',
      userSet: 175,
      estimated: 188,
    });
    // Estimated query filters to non-null max, last 2 years, unmerged.
    const query = mockPrisma.trainingLog.findFirst.mock.calls[0]?.[0] as any;
    expect(query.where.userId).toBe(userId);
    expect(query.where.mergedIntoId).toBeNull();
    expect(query.where.maxHr.not).toBeNull();
    expect(query.where.startDate.gte).toBeDefined();
    expect(query.orderBy).toEqual({ maxHr: 'desc' });
  });

  it('falls back to the user-set value when no estimate exists', async () => {
    mockPrisma.trainingLog.findFirst.mockResolvedValueOnce(null);
    mockPrisma.user.findUnique.mockResolvedValueOnce({ maxHr: 178 });

    const info = await getMaxHrInfo(userId);
    expect(info).toEqual({
      effective: 178,
      source: 'user-set',
      userSet: 178,
      estimated: null,
    });
  });

  it('falls back to DEFAULT_MAX_HR when neither estimate nor user-set exists', async () => {
    mockPrisma.trainingLog.findFirst.mockResolvedValueOnce(null);
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    const info = await getMaxHrInfo(userId);
    expect(info).toEqual({
      effective: DEFAULT_MAX_HR,
      source: 'default',
      userSet: null,
      estimated: null,
    });
    expect(DEFAULT_MAX_HR).toBe(190);
  });

  it('getEffectiveMaxHr returns just the number', async () => {
    mockPrisma.trainingLog.findFirst.mockResolvedValueOnce({ maxHr: 190 });
    await expect(getEffectiveMaxHr(userId)).resolves.toBe(190);
  });
});

describe('getLatestRestingHr — Garmin priority', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('prefers the DailyHealth (Garmin) value over the manual body metric', async () => {
    mockPrisma.dailyHealth.findFirst.mockResolvedValueOnce({ restingHeartRate: 49 });
    mockPrisma.bodyMetric.findFirst.mockResolvedValueOnce({ restingHr: 55 });

    await expect(getLatestRestingHr(userId)).resolves.toBe(49);
    // Manual fallback must not be queried when the Garmin value is present.
    expect(mockPrisma.bodyMetric.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the manual body metric when no Garmin health data exists', async () => {
    mockPrisma.dailyHealth.findFirst.mockResolvedValueOnce(null);
    mockPrisma.bodyMetric.findFirst.mockResolvedValueOnce({ restingHr: 52 });

    await expect(getLatestRestingHr(userId)).resolves.toBe(52);
  });

  it('returns null when neither source has a resting HR', async () => {
    mockPrisma.dailyHealth.findFirst.mockResolvedValueOnce(null);
    mockPrisma.bodyMetric.findFirst.mockResolvedValueOnce(null);

    await expect(getLatestRestingHr(userId)).resolves.toBeNull();
  });
});
