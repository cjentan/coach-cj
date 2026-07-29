import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE } from '../wipe-data/route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { jsonRequest, createRequest } from '@/test/utils';

vi.mock('next-auth');
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingLog: { deleteMany: vi.fn() },
    duplicateGroup: { deleteMany: vi.fn() },
    raceGoal: { deleteMany: vi.fn() },
    bodyMetric: { deleteMany: vi.fn() },
    dailyHealth: { deleteMany: vi.fn() },
    weeklyAssessment: { deleteMany: vi.fn() },
    weeklyPlan: { deleteMany: vi.fn() },
    fatigueAlert: { deleteMany: vi.fn() },
    analysisReport: { deleteMany: vi.fn() },
    apiKey: { deleteMany: vi.fn() },
    coachConversation: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe('DELETE /api/settings/wipe-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const res = await DELETE(createRequest('/api/settings/wipe-data'));
    expect(res.status).toBe(401);
  });

  it('wipes all data types by default when no body provided', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.$transaction).mockResolvedValue(Array(11).fill({ count: 5 }));

    const res = await DELETE(createRequest('/api/settings/wipe-data', {
      method: 'DELETE',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('wipes only specified data types', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.$transaction).mockResolvedValue([{ count: 3 }]);

    const res = await DELETE(jsonRequest('/api/settings/wipe-data', {
      types: ['trainingLogs'],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.counts.trainingLogs).toBe(3);
  });

  it('returns 400 for empty types array', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    const res = await DELETE(jsonRequest('/api/settings/wipe-data', { types: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid data types', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    const res = await DELETE(jsonRequest('/api/settings/wipe-data', { types: ['invalidType'] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid data types');
  });
});
