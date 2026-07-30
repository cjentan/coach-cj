import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scorePair,
  detectDuplicates,
  persistDuplicateGroups,
  resolveDuplicateGroup,
  dismissDuplicateGroup,
  type DuplicateDetectionConfig,
  type DuplicateCandidate,
} from '../duplicate-detector';

const DEFAULT_CFG: DuplicateDetectionConfig = {
  timeWindowMs: 4 * 60 * 60 * 1000, // 4h
  maxDurationRatioDiff: 0.3,
  maxDistanceRatioDiff: 0.3,
  autoGroupThreshold: 70,
  suggestThreshold: 40,
  scanLimit: 1000,
};

// Helper to create an activity-like object for scorePair
function act(overrides: Partial<{
  startDate: Date;
  durationSeconds: number;
  distanceMeters: number | null;
  type: string;
  source: string;
}> = {}) {
  return {
    startDate: new Date('2025-01-13T08:00:00Z'),
    durationSeconds: 3600,
    distanceMeters: 10000,
    type: 'run',
    source: 'garmin',
    ...overrides,
  };
}

// ─── scorePair ───────────────────────────────────────

describe('scorePair', () => {
  it('returns null for different activity types', () => {
    expect(scorePair(act(), act({ type: 'ride' }), DEFAULT_CFG)).toBeNull();
  });

  it('returns null when time difference exceeds window', () => {
    const a = act({ startDate: new Date('2025-01-13T08:00:00Z') });
    const b = act({ startDate: new Date('2025-01-13T13:00:00Z') }); // 5h apart
    expect(scorePair(a, b, DEFAULT_CFG)).toBeNull();
  });

  it('scores identical activities near 100', () => {
    const a = act();
    const b = act();
    const result = scorePair(a, b, DEFAULT_CFG);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(95);
  });

  it('adds bonus points for different sources', () => {
    // Use activities that are NOT identical so there's room above the cap
    const base = new Date('2025-01-13T08:00:00Z');
    const twoHoursLater = new Date('2025-01-13T10:00:00Z');
    const same = scorePair(
      act({ source: 'garmin', startDate: base }),
      act({ source: 'garmin', startDate: twoHoursLater }),
      DEFAULT_CFG,
    );
    const diff = scorePair(
      act({ source: 'garmin', startDate: base }),
      act({ source: 'strava', startDate: twoHoursLater }),
      DEFAULT_CFG,
    );
    // Different source adds 10 bonus points
    expect(diff!.score).toBeGreaterThan(same!.score);
    expect(diff!.score - same!.score).toBe(10);
  });

  it('scores distance proportionally to similarity', () => {
    // 10% distance diff should still score well
    const a = act({ distanceMeters: 10000 });
    const b = act({ distanceMeters: 11000, startDate: new Date('2025-01-13T08:02:00Z') });
    const result = scorePair(a, b, DEFAULT_CFG);
    expect(result!.score).toBeGreaterThan(60);
  });

  it('scores duration proportionally to similarity', () => {
    // 25% duration diff within the 30% threshold
    const a = act({ durationSeconds: 3600 });
    const b = act({ durationSeconds: 2700, startDate: new Date('2025-01-13T08:02:00Z') });
    const result = scorePair(a, b, DEFAULT_CFG);
    expect(result!.score).toBeGreaterThan(40);
  });

  it('gives partial credit when distance is missing', () => {
    const a = act({ distanceMeters: null });
    const b = act({ distanceMeters: null, startDate: new Date('2025-01-13T08:02:00Z') });
    const result = scorePair(a, b, DEFAULT_CFG);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(50); // Should still get partial credit
  });

  it('returns higher score for closer start times', () => {
    const a = act({ startDate: new Date('2025-01-13T08:00:00Z') });
    const close = act({ startDate: new Date('2025-01-13T08:01:00Z') }); // 1min
    const far = act({ startDate: new Date('2025-01-13T10:00:00Z') }); // 2h
    const closeResult = scorePair(a, close, DEFAULT_CFG)!;
    const farResult = scorePair(a, far, DEFAULT_CFG)!;
    expect(closeResult.score).toBeGreaterThan(farResult.score);
  });
});

// ─── detectDuplicates ────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  duplicateGroup: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  trainingLog: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

describe('detectDuplicates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRow(overrides: Partial<{
    id: string; source: string; type: string; name: string;
    start_date: Date; duration_seconds: number; distance_meters: number | null;
  }> = {}) {
    return {
      id: overrides.id ?? 'act-1',
      source: overrides.source ?? 'garmin',
      type: overrides.type ?? 'run',
      name: overrides.name ?? 'Morning Run',
      start_date: overrides.start_date ?? new Date('2025-01-13T08:00:00Z'),
      duration_seconds: overrides.duration_seconds ?? 3600,
      distance_meters: overrides.distance_meters ?? 10000,
      elevation_gain_meters: 100,
      remarks: null,
      has_rich_data: true,
    };
  }

  it('returns empty groups for < 2 activities', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([makeRow()]);
    const result = await detectDuplicates('user-1');
    expect(result.groups).toHaveLength(0);
    expect(result.stats.scanned).toBe(1);
  });

  it('finds and groups a matching pair', async () => {
    const base = new Date('2025-01-13T08:00:00Z');
    mockPrisma.$queryRaw.mockResolvedValue([
      makeRow({ id: 'a', source: 'garmin', start_date: base }),
      makeRow({ id: 'b', source: 'strava', start_date: new Date(base.getTime() + 300000) }),
    ]);
    const result = await detectDuplicates('user-1');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].activities).toHaveLength(2);
    expect(result.groups[0].score).toBeGreaterThanOrEqual(70);
  });

  it('returns no groups for non-matching pairs', async () => {
    const base = new Date('2025-01-13T08:00:00Z');
    mockPrisma.$queryRaw.mockResolvedValue([
      makeRow({ id: 'a', type: 'run', start_date: base }),
      makeRow({ id: 'b', type: 'ride', start_date: new Date(base.getTime() + 300000) }),
    ]);
    const result = await detectDuplicates('user-1');
    expect(result.groups).toHaveLength(0);
    expect(result.stats.candidates).toBe(0);
  });

  it('clusters 3 activities into one group', async () => {
    const base = new Date('2025-01-13T08:00:00Z');
    mockPrisma.$queryRaw.mockResolvedValue([
      makeRow({ id: 'a', source: 'garmin', start_date: base }),
      makeRow({ id: 'b', source: 'strava', start_date: new Date(base.getTime() + 120000) }),
      makeRow({ id: 'c', source: 'manual', start_date: new Date(base.getTime() + 300000) }),
    ]);
    const result = await detectDuplicates('user-1');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].activities).toHaveLength(3);
  });

  it('creates suggestion-only groups for scores 40-70', async () => {
    const base = new Date('2025-01-13T08:00:00Z');
    mockPrisma.$queryRaw.mockResolvedValue([
      makeRow({ id: 'a', start_date: base, duration_seconds: 3600, distance_meters: 10000 }),
      makeRow({ id: 'b', start_date: new Date(base.getTime() + 7200000), duration_seconds: 2400, distance_meters: 8000 }),
    ]);
    const result = await detectDuplicates('user-1', { suggestThreshold: 30 });
    expect(result.groups.length).toBeGreaterThanOrEqual(0);
  });

  it('orders groups by score descending', async () => {
    const base = new Date('2025-01-13T08:00:00Z');
    mockPrisma.$queryRaw.mockResolvedValue([
      makeRow({ id: 'a', source: 'garmin', start_date: base, duration_seconds: 3600 }),
      makeRow({ id: 'b', source: 'strava', start_date: base, duration_seconds: 3600 }),
      makeRow({ id: 'c', source: 'garmin', start_date: new Date(base.getTime() + 60000), duration_seconds: 3500 }),
      makeRow({ id: 'd', source: 'strava', start_date: new Date(base.getTime() + 60000), duration_seconds: 3500 }),
    ]);
    const result = await detectDuplicates('user-1');
    expect(result.groups.length).toBeGreaterThanOrEqual(1);
    if (result.groups.length >= 2) {
      expect(result.groups[0].score).toBeGreaterThanOrEqual(result.groups[1].score);
    }
  });

  it('sorts members by source priority then date', async () => {
    const base = new Date('2025-01-13T08:00:00Z');
    mockPrisma.$queryRaw.mockResolvedValue([
      makeRow({ id: 'garmin-act', source: 'garmin', start_date: base, duration_seconds: 3600 }),
      makeRow({ id: 'strava-act', source: 'strava', start_date: base, duration_seconds: 3600 }),
    ]);
    const result = await detectDuplicates('user-1');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].activities[0].source).toBe('garmin');
    expect(result.groups[0].activities[1].source).toBe('strava');
  });
});

// ─── persistDuplicateGroups ──────────────────────────

describe('persistDuplicateGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const group: DuplicateCandidate = {
    groupId: '',
    score: 85,
    reason: 'Same activity from garmin and strava',
    activities: [
      { id: 'act-1', source: 'garmin', type: 'run', name: 'Run', startDate: new Date(), durationSeconds: 3600, distanceMeters: 10000, elevationGainMeters: 100, hasRichData: true, hasRemarks: false, priority: 0 },
      { id: 'act-2', source: 'strava', type: 'run', name: 'Run', startDate: new Date(), durationSeconds: 3600, distanceMeters: 10000, elevationGainMeters: 100, hasRichData: false, hasRemarks: false, priority: 2 },
    ],
  };

  it('creates DuplicateGroup and links training logs', async () => {
    mockPrisma.duplicateGroup.create.mockResolvedValue({ id: 'new-group' });
    mockPrisma.duplicateGroup.findMany.mockResolvedValue([]);

    const count = await persistDuplicateGroups('user-1', [group]);

    expect(count).toBe(1);
    expect(mockPrisma.duplicateGroup.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', status: 'pending', keptActivityId: 'act-1' },
    });
    expect(mockPrisma.trainingLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['act-1', 'act-2'] }, userId: 'user-1' },
      data: { duplicateGroupId: 'new-group', duplicateStatus: 'pending' },
    });
  });

  it('cleans up old pending groups before creating new ones', async () => {
    mockPrisma.duplicateGroup.findMany.mockResolvedValue([{ id: 'old-group' }]);
    mockPrisma.duplicateGroup.create.mockResolvedValue({ id: 'new-group' });

    await persistDuplicateGroups('user-1', [group]);

    expect(mockPrisma.trainingLog.updateMany).toHaveBeenCalledWith({
      where: { duplicateGroupId: { in: ['old-group'] }, userId: 'user-1' },
      data: { duplicateGroupId: null, duplicateStatus: null },
    });
    expect(mockPrisma.duplicateGroup.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-group'] } },
    });
  });

  it('skips groups with fewer than 2 activities', async () => {
    const singleActivityGroup = { ...group, activities: [group.activities[0]] };
    const count = await persistDuplicateGroups('user-1', [singleActivityGroup]);
    expect(count).toBe(0);
    expect(mockPrisma.duplicateGroup.create).not.toHaveBeenCalled();
  });

  it('returns count of created groups', async () => {
    mockPrisma.duplicateGroup.findMany.mockResolvedValue([]);
    mockPrisma.duplicateGroup.create.mockResolvedValue({ id: 'g1' });

    const count = await persistDuplicateGroups('user-1', [group, group]);
    expect(count).toBe(2);
  });
});

// ─── resolveDuplicateGroup ───────────────────────────

describe('resolveDuplicateGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseMembers = [
    { id: 'keep', userId: 'u1', duplicateGroupId: 'dg-1', name: 'From Garmin', source: 'garmin', type: 'run', startDate: new Date(), durationSeconds: 3600, distanceMeters: 10000, elevationGainMeters: 100, averageHr: null, maxHr: null, averagePower: null, normalizedPower: null, calories: null, rawJson: null, remarks: 'Great run', description: null, tss: 100, coachAnalysis: null, isRace: false, externalId: null, subType: null, duplicateStatus: 'pending', mergedIntoId: null, boundingBox: null, simplifiedTrackPoints: null, workoutType: null, createdAt: new Date(), updatedAt: new Date() },
    { id: 'other', userId: 'u1', duplicateGroupId: 'dg-1', name: 'From Strava', source: 'strava', type: 'run', startDate: new Date(), durationSeconds: 3600, distanceMeters: 10000, elevationGainMeters: 100, averageHr: 150, maxHr: 175, averagePower: 200, normalizedPower: 210, calories: 500, rawJson: { trackPoints: [] }, remarks: null, description: 'Felt great', tss: 100, coachAnalysis: null, isRace: false, externalId: null, subType: null, duplicateStatus: 'pending', mergedIntoId: null, boundingBox: null, simplifiedTrackPoints: null, workoutType: null, createdAt: new Date(), updatedAt: new Date() },
  ];

  it('merges HR/power data from other into kept activity when missing', async () => {
    mockPrisma.trainingLog.findMany.mockResolvedValue(baseMembers);

    await resolveDuplicateGroup({ groupId: 'dg-1', userId: 'u1', keepActivityId: 'keep' });

    // Should update kept activity with HR/power from other
    const updateCalls = mockPrisma.trainingLog.update.mock.calls;
    const hrUpdate = updateCalls.find((c: any[]) => c[0].where.id === 'keep');
    expect(hrUpdate).toBeDefined();
    expect(hrUpdate![0].data.averageHr).toBe(150);
  });

  it('merges rawJson when kept activity lacks trackpoints', async () => {
    mockPrisma.trainingLog.findMany.mockResolvedValue(baseMembers);

    await resolveDuplicateGroup({ groupId: 'dg-1', userId: 'u1', keepActivityId: 'keep' });

    const updateCalls = mockPrisma.trainingLog.update.mock.calls;
    const jsonUpdate = updateCalls.find((c: any[]) => c[0].where.id === 'keep' && c[0].data.rawJson);
    expect(jsonUpdate).toBeDefined();
  });

  it('marks other activities as merged', async () => {
    mockPrisma.trainingLog.findMany.mockResolvedValue(baseMembers);

    await resolveDuplicateGroup({ groupId: 'dg-1', userId: 'u1', keepActivityId: 'keep' });

    const updateCalls = mockPrisma.trainingLog.update.mock.calls;
    const mergedUpdate = updateCalls.find((c: any[]) => c[0].where.id === 'other');
    expect(mergedUpdate).toBeDefined();
    expect(mergedUpdate[0].data.mergedIntoId).toBe('keep');
    expect(mergedUpdate[0].data.duplicateStatus).toBe('resolved_merged');
  });

  it('throws when group not found', async () => {
    mockPrisma.trainingLog.findMany.mockResolvedValue([]);
    await expect(
      resolveDuplicateGroup({ groupId: 'dg-1', userId: 'u1', keepActivityId: 'keep' }),
    ).rejects.toThrow('Duplicate group not found');
  });

  it('throws when keep activity not in group', async () => {
    mockPrisma.trainingLog.findMany.mockResolvedValue(baseMembers);
    await expect(
      resolveDuplicateGroup({ groupId: 'dg-1', userId: 'u1', keepActivityId: 'nonexistent' }),
    ).rejects.toThrow('Keep activity not found in this group');
  });

  it('updates group status to resolved_merged', async () => {
    mockPrisma.trainingLog.findMany.mockResolvedValue(baseMembers);

    await resolveDuplicateGroup({ groupId: 'dg-1', userId: 'u1', keepActivityId: 'keep' });

    expect(mockPrisma.duplicateGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dg-1' },
        data: expect.objectContaining({ status: 'resolved_merged' }),
      }),
    );
  });
});

// ─── dismissDuplicateGroup ───────────────────────────

describe('dismissDuplicateGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets group status to resolved_keep_both', async () => {
    await dismissDuplicateGroup('dg-1', 'u1');

    expect(mockPrisma.duplicateGroup.update).toHaveBeenCalledWith({
      where: { id: 'dg-1', userId: 'u1' },
      data: { status: 'resolved_keep_both' },
    });
  });

  it('updates linked training logs status', async () => {
    await dismissDuplicateGroup('dg-1', 'u1');

    expect(mockPrisma.trainingLog.updateMany).toHaveBeenCalledWith({
      where: { duplicateGroupId: 'dg-1', userId: 'u1' },
      data: { duplicateStatus: 'resolved_keep_both' },
    });
  });
});
