import { describe, it, expect, vi, beforeEach } from 'vitest';
import { snapshotWeek } from '../metrics-snapshot';
import { getWeekStart } from '../utils';
import { buildTrainingLog, buildRaceGoal, buildBodyMetric } from '@/test/factories';

const mockPrisma = vi.hoisted(() => ({
  trainingLog: { findMany: vi.fn() },
  raceGoal: { findMany: vi.fn() },
  bodyMetric: { findMany: vi.fn() },
  weeklyAssessment: { upsert: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

describe('snapshotWeek', () => {
  const userId = 'test-user';
  const weekStart = new Date('2025-01-13T00:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockData(overrides: {
    weekLogs?: any[];
    pmcLogs?: any[];
    goals?: any[];
    bodyMetrics?: any[];
  }) {
    mockPrisma.trainingLog.findMany.mockResolvedValueOnce(overrides.weekLogs ?? []);
    mockPrisma.trainingLog.findMany.mockResolvedValueOnce(overrides.pmcLogs ?? []);
    mockPrisma.raceGoal.findMany.mockResolvedValueOnce(overrides.goals ?? []);
    mockPrisma.bodyMetric.findMany.mockResolvedValueOnce(overrides.bodyMetrics ?? []);
    mockPrisma.weeklyAssessment.upsert.mockResolvedValue({} as any);
  }

  function getUpsertCall() {
    return mockPrisma.weeklyAssessment.upsert.mock.calls[0]?.[0] as any;
  }

  it('computes and persists a weekly snapshot', async () => {
    mockData({
      weekLogs: [
        buildTrainingLog({ durationSeconds: 3600, distanceMeters: 10000, elevationGainMeters: 100, tss: 50 }),
        buildTrainingLog({ durationSeconds: 1800, distanceMeters: 5000, elevationGainMeters: 50, tss: 25 }),
      ],
      pmcLogs: Array.from({ length: 10 }, (_, i) => ({
        startDate: new Date(weekStart.getTime() - i * 86400000),
        tss: 40 + i * 5,
        durationSeconds: 3600,
      })),
      goals: [buildRaceGoal()],
      bodyMetrics: [buildBodyMetric()],
    });

    await snapshotWeek(userId, weekStart);

    const upsert = getUpsertCall();
    expect(upsert.where).toEqual({
      userId_weekStartDate: { userId, weekStartDate: getWeekStart(weekStart) },
    });
    expect(upsert.create.weeklyVolumeMeters).toBe(15000);
    expect(upsert.create.weeklyDurationSeconds).toBe(5400);
    expect(upsert.create.weeklyElevationMeters).toBe(150);
    expect(upsert.create.readinessScore).toBeGreaterThanOrEqual(0);
    expect(upsert.create.readinessScore).toBeLessThanOrEqual(100);
    expect(upsert.create.acuteTrainingLoad).toEqual(
      Math.round(upsert.create.acuteTrainingLoad * 10) / 10,
    );
    expect(upsert.create.fatigueScore).toBe(75);
    expect(upsert.create.goalProgressPct).not.toBeNull();
    expect(upsert.create.rawData.weeklyCount).toBe(2);
    expect(upsert.create.rawData.activeGoals).toBe(1);
    expect(upsert.create.rawData.latestWeight).toBe(70);
    expect(upsert.create.rawData.avgHr).toBe(150);
  });

  it('calls upsert', async () => {
    mockData({});
    await snapshotWeek(userId, weekStart);
    expect(mockPrisma.weeklyAssessment.upsert).toHaveBeenCalledTimes(1);
  });

  it('handles empty week gracefully', async () => {
    mockData({});
    await snapshotWeek(userId, weekStart);
    const upsert = getUpsertCall();
    expect(upsert.create.weeklyVolumeMeters).toBe(0);
    expect(upsert.create.weeklyDurationSeconds).toBe(0);
    expect(upsert.create.rawData.weeklyCount).toBe(0);
    expect(upsert.create.rawData.fatigueSeverity).toBe('low');
    expect(upsert.create.readinessScore).toBeGreaterThanOrEqual(0);
  });

  it('handles no active goals', async () => {
    mockData({ goals: [] });
    await snapshotWeek(userId, weekStart);
    const upsert = getUpsertCall();
    expect(upsert.create.goalProgressPct).toBeNull();
    expect(upsert.create.rawData.activeGoals).toBe(0);
  });

  it('handles no body metrics', async () => {
    mockData({ bodyMetrics: [] });
    await snapshotWeek(userId, weekStart);
    const upsert = getUpsertCall();
    expect(upsert.create.rawData.latestWeight).toBeNull();
  });

  it('uses trackpoint-aware TSS when rawJson has trackPoints', async () => {
    mockData({
      weekLogs: [buildTrainingLog({
        tss: null, averageHr: 150, maxHr: 180, durationSeconds: 3600,
        rawJson: { trackPoints: [{ hr: 140, power: 200, speed: 3.5, distance: 1000 }] } as any,
      })],
    });
    await snapshotWeek(userId, weekStart);
    expect(getUpsertCall().create.fatigueScore).toBeGreaterThan(0);
  });

  it('falls back to estimateTss', async () => {
    mockData({ weekLogs: [buildTrainingLog({ tss: null, durationSeconds: 3600, rawJson: null })] });
    await snapshotWeek(userId, weekStart);
    expect(getUpsertCall().create.fatigueScore).toBe(50);
  });

  it('computes average HR from non-null values', async () => {
    mockData({
      weekLogs: [
        buildTrainingLog({ averageHr: 140 }),
        buildTrainingLog({ averageHr: null }),
        buildTrainingLog({ averageHr: 160 }),
      ],
    });
    await snapshotWeek(userId, weekStart);
    expect(getUpsertCall().create.rawData.avgHr).toBe(150);
  });

  it('sets avgHr null when no HR data', async () => {
    mockData({ weekLogs: [buildTrainingLog({ averageHr: null })] });
    await snapshotWeek(userId, weekStart);
    expect(getUpsertCall().create.rawData.avgHr).toBeNull();
  });

  it('handles multiple active goals', async () => {
    mockData({
      weekLogs: [buildTrainingLog({ distanceMeters: 10000 })],
      goals: [
        buildRaceGoal({ id: 'goal-a', priority: 'A' as any, distanceMeters: 42195 }),
        buildRaceGoal({ id: 'goal-b', priority: 'B' as any, distanceMeters: 21098 }),
      ],
    });
    await snapshotWeek(userId, weekStart);
    expect(getUpsertCall().create.goalProgressPct).toHaveProperty('goal-a');
    expect(getUpsertCall().create.goalProgressPct).toHaveProperty('goal-b');
  });

  it('excludes merged activities from query', async () => {
    mockData({});
    await snapshotWeek(userId, weekStart);
    const query = mockPrisma.trainingLog.findMany.mock.calls[0]?.[0] as any;
    expect(query.where.mergedIntoId).toBeNull();
    expect(query.where.startDate.gte).toBeDefined();
  });

  it('generates fatigue signals for high TSS', async () => {
    mockData({
      weekLogs: [
        buildTrainingLog({ tss: 300, durationSeconds: 7200 }),
        buildTrainingLog({ tss: 300, durationSeconds: 7200 }),
      ],
    });
    await snapshotWeek(userId, weekStart);
    const upsert = getUpsertCall();
    expect(upsert.create.rawData.fatigueSignals.length).toBeGreaterThan(0);
    expect(upsert.create.recommendations.length).toBeGreaterThan(0);
  });

  it('has both create and update paths', async () => {
    mockData({});
    await snapshotWeek(userId, weekStart);
    const upsert = getUpsertCall();
    expect(upsert.create).toBeDefined();
    expect(upsert.update).toBeDefined();
  });
});
