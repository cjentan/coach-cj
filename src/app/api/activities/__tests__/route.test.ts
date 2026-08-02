import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { buildTrainingLog } from '@/test/factories';
import { createRequest } from '@/test/utils';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('GET /api/activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await GET(createRequest('/api/activities'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns paginated activities with default pagination', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    const mockLogs = [
      buildTrainingLog({ id: 'a1', durationSeconds: 3600 }),
      buildTrainingLog({ id: 'a2', durationSeconds: 1800 }),
    ];
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue(mockLogs);
    vi.mocked(prisma.trainingLog.count).mockResolvedValue(2);

    const res = await GET(createRequest('/api/activities'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('filters by type when provided', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trainingLog.count).mockResolvedValue(0);

    const res = await GET(createRequest('/api/activities?type=ride'));
    expect(res.status).toBe(200);

    // Verify the where clause includes the type filter
    const findManyCall = vi.mocked(prisma.trainingLog.findMany).mock.calls[0][0];
    expect((findManyCall?.where as any)?.type).toBe('ride');
  });

  it('filters by source when provided', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trainingLog.count).mockResolvedValue(0);

    await GET(createRequest('/api/activities?source=garmin'));
    const findManyCall = vi.mocked(prisma.trainingLog.findMany).mock.calls[0][0];
    expect((findManyCall?.where as any)?.source).toBe('garmin');
  });

  it('filters by date range when from/to provided', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trainingLog.count).mockResolvedValue(0);

    await GET(createRequest('/api/activities?from=2025-01-01&to=2025-01-31'));
    const findManyCall = vi.mocked(prisma.trainingLog.findMany).mock.calls[0][0];
    const where = findManyCall?.where as any;
    expect(where.startDate.gte).toBeDefined();
    expect(where.startDate.lt).toBeDefined();
  });

  it('ignores type=all filter', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trainingLog.count).mockResolvedValue(0);

    await GET(createRequest('/api/activities?type=all'));
    const findManyCall = vi.mocked(prisma.trainingLog.findMany).mock.calls[0][0];
    expect((findManyCall?.where as any)?.type).toBeUndefined();
  });

  it('always excludes merged activities', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trainingLog.count).mockResolvedValue(0);

    await GET(createRequest('/api/activities'));
    const findManyCall = vi.mocked(prisma.trainingLog.findMany).mock.calls[0][0];
    expect((findManyCall?.where as any)?.mergedIntoId).toBeNull();
  });

  it('caps limit at 200', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trainingLog.count).mockResolvedValue(0);

    const res = await GET(createRequest('/api/activities?limit=999'));
    const body = await res.json();
    expect(body.limit).toBe(200);
  });

  it('uses the authenticated user id in the query', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-42' } } as any);
    vi.mocked(prisma.trainingLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trainingLog.count).mockResolvedValue(0);

    await GET(createRequest('/api/activities'));
    const findManyCall = vi.mocked(prisma.trainingLog.findMany).mock.calls[0][0];
    expect((findManyCall?.where as any)?.userId).toBe('user-42');
  });
});
