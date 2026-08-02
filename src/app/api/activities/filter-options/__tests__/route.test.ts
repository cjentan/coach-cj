import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createRequest } from '@/test/utils';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingLog: {
      findMany: vi.fn(),
    },
  },
}));

describe('GET /api/activities/filter-options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns aggregated filter options for the user', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany)
      .mockResolvedValueOnce([{ type: 'run' }, { type: 'ride' }] as any)
      .mockResolvedValueOnce([{ source: 'garmin' }, { source: 'strava' }] as any)
      .mockResolvedValueOnce([{ subType: 'trail_running' }, { subType: 'road_cycling' }] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.types).toEqual(['run', 'ride']);
    expect(body.sources).toEqual(['garmin', 'strava']);
    expect(body.subTypes).toEqual(['trail_running', 'road_cycling']);
  });

  it('filters empty values from results', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany)
      .mockResolvedValueOnce([{ type: null }, { type: 'run' }] as any)
      .mockResolvedValueOnce([{ source: 'garmin' }] as any)
      .mockResolvedValueOnce([]);

    const res = await GET();
    const body = await res.json();
    expect(body.types).toEqual(['run']);
  });

  it('queries with mergedIntoId: null filter', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue([]);

    await GET();
    for (const call of vi.mocked(prisma.trainingLog.findMany).mock.calls) {
      expect((call[0]?.where as any)?.mergedIntoId).toBeNull();
    }
  });
});
