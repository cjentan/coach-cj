import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT, DELETE } from '../route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { buildTrainingLog } from '@/test/factories';
import { createRequest, jsonRequest } from '@/test/utils';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingLog: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));
vi.mock('@/lib/metrics-snapshot', () => ({
  snapshotWeek: vi.fn().mockResolvedValue(undefined),
}));

const mockActivity = buildTrainingLog({ id: 'act-1' });

describe('GET /api/activities/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const res = await GET(createRequest('/api/activities/act-1'), { params: { id: 'act-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 404 when activity not found', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findUnique).mockResolvedValue(null);
    const res = await GET(createRequest('/api/activities/act-1'), { params: { id: 'act-1' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('returns activity when found', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findUnique).mockResolvedValue(mockActivity);
    const res = await GET(createRequest('/api/activities/act-1'), { params: { id: 'act-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('act-1');
    expect(body.name).toBe('Morning Run');
  });

  it('scopes query to the authenticated user', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-42' } } as any);
    vi.mocked(prisma.trainingLog.findUnique).mockResolvedValue(mockActivity);
    await GET(createRequest('/api/activities/act-1'), { params: { id: 'act-1' } });
    expect(vi.mocked(prisma.trainingLog.findUnique).mock.calls[0][0]?.where).toMatchObject({
      id: 'act-1',
      userId: 'user-42',
    });
  });

  it('returns neighbors when neighbors=true', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findUnique).mockResolvedValue(mockActivity);
    vi.mocked(prisma.trainingLog.findFirst).mockResolvedValue({ id: 'prev-id' });

    const res = await GET(createRequest('/api/activities/act-1?neighbors=true'), {
      params: { id: 'act-1' },
    });
    const body = await res.json();
    expect(body.prevId).toBe('prev-id');
    expect(body.log.id).toBe('act-1');
  });
});

describe('PUT /api/activities/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const res = await PUT(jsonRequest('/api/activities/act-1', { remarks: 'Great run' }), {
      params: { id: 'act-1' },
    });
    expect(res.status).toBe(401);
  });

  it('updates remarks', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.update).mockResolvedValue({ ...mockActivity, remarks: 'Great run' });

    const res = await PUT(jsonRequest('/api/activities/act-1', { remarks: 'Great run' }), {
      params: { id: 'act-1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.remarks).toBe('Great run');
    expect(vi.mocked(prisma.trainingLog.update).mock.calls[0][0]?.data).toMatchObject({
      remarks: 'Great run',
    });
  });

  it('returns 400 for invalid body', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    const res = await PUT(jsonRequest('/api/activities/act-1', { remarks: 123 }), {
      params: { id: 'act-1' },
    });
    expect(res.status).toBe(400);
  });

  it('sets isRace when provided', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.update).mockResolvedValue({ ...mockActivity, isRace: true });

    await PUT(jsonRequest('/api/activities/act-1', { remarks: 'Race!', isRace: true }), {
      params: { id: 'act-1' },
    });
    expect(vi.mocked(prisma.trainingLog.update).mock.calls[0][0]?.data).toMatchObject({
      isRace: true,
    });
  });
});

describe('DELETE /api/activities/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const res = await DELETE(createRequest('/api/activities/act-1'), { params: { id: 'act-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 404 when activity not found', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findUnique).mockResolvedValue(null);
    const res = await DELETE(createRequest('/api/activities/act-1'), { params: { id: 'act-1' } });
    expect(res.status).toBe(404);
  });

  it('deletes activity and returns success', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'test-user' } } as any);
    vi.mocked(prisma.trainingLog.findUnique).mockResolvedValue(mockActivity);
    vi.mocked(prisma.trainingLog.delete).mockResolvedValue(mockActivity);

    const res = await DELETE(createRequest('/api/activities/act-1'), { params: { id: 'act-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
