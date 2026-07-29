import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT } from '../route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createRequest, jsonRequest } from '@/test/utils';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('GET /api/dashboard/preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns default preferences when user has none set', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ dashboardPrefs: null } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeframeDays).toBe(30);
    expect(body.volumePeriod).toBe('week');
  });

  it('returns user preferences', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      dashboardPrefs: { timeframeDays: 90, pmcMetrics: ['ctl'], trendMetrics: [], volumePeriod: 'month' },
    } as any);

    const res = await GET();
    const body = await res.json();
    expect(body.timeframeDays).toBe(90);
    expect(body.volumePeriod).toBe('month');
  });
});

describe('PUT /api/dashboard/preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const res = await PUT(jsonRequest('/api/dashboard/preferences', {}));
    expect(res.status).toBe(401);
  });

  it('updates preferences', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ dashboardPrefs: null } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    const res = await PUT(jsonRequest('/api/dashboard/preferences', {
      timeframeDays: 90,
    }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('returns 400 for invalid timeframeDays', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    const res = await PUT(jsonRequest('/api/dashboard/preferences', {
      timeframeDays: 50,
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown keys', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    const res = await PUT(jsonRequest('/api/dashboard/preferences', {
      unknownKey: true,
    }));
    expect(res.status).toBe(400);
  });

  it('merges with existing preferences', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      dashboardPrefs: { timeframeDays: 90, pmcMetrics: ['ctl'], trendMetrics: [], volumePeriod: 'month' },
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await PUT(jsonRequest('/api/dashboard/preferences', {
      pmcMetrics: ['ctl', 'tsb'],
    }));
    const updateData = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(updateData.dashboardPrefs.timeframeDays).toBe(90); // from existing
    expect(updateData.dashboardPrefs.pmcMetrics).toEqual(['ctl', 'tsb']); // from body
  });
});
