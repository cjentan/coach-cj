import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT, DELETE } from "../route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { buildRaceGoal } from "@/test/factories";
import { createRequest, jsonRequest } from "@/test/utils";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    raceGoal: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const mockGoal = buildRaceGoal({ id: "goal-1" });

describe("GET /api/goals/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await GET(createRequest("/api/goals/goal-1"), { params: { id: "goal-1" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when goal not found", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.raceGoal.findUnique).mockResolvedValue(null);
    const res = await GET(createRequest("/api/goals/goal-1"), { params: { id: "goal-1" } });
    expect(res.status).toBe(404);
  });

  it("returns goal when found", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.raceGoal.findUnique).mockResolvedValue(mockGoal);
    const res = await GET(createRequest("/api/goals/goal-1"), { params: { id: "goal-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("goal-1");
  });

  it("scopes query to user", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-42" } } as any);
    vi.mocked(prisma.raceGoal.findUnique).mockResolvedValue(mockGoal);
    await GET(createRequest("/api/goals/goal-1"), { params: { id: "goal-1" } });
    expect(vi.mocked(prisma.raceGoal.findUnique).mock.calls[0][0]?.where).toMatchObject({
      id: "goal-1",
      userId: "user-42",
    });
  });
});

describe("PUT /api/goals/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await PUT(jsonRequest("/api/goals/goal-1", { name: "Updated" }), {
      params: { id: "goal-1" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when goal not found", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.raceGoal.findUnique).mockResolvedValue(null);
    const res = await PUT(jsonRequest("/api/goals/goal-1", { name: "Updated" }), {
      params: { id: "goal-1" },
    });
    expect(res.status).toBe(404);
  });

  it("updates goal fields", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.raceGoal.findUnique).mockResolvedValue(mockGoal);
    vi.mocked(prisma.raceGoal.update).mockResolvedValue({ ...mockGoal, name: "Updated" });

    const res = await PUT(jsonRequest("/api/goals/goal-1", { name: "Updated" }), {
      params: { id: "goal-1" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Updated");
  });
});

describe("DELETE /api/goals/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await DELETE(createRequest("/api/goals/goal-1"), { params: { id: "goal-1" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when goal not found", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.raceGoal.findUnique).mockResolvedValue(null);
    const res = await DELETE(createRequest("/api/goals/goal-1"), { params: { id: "goal-1" } });
    expect(res.status).toBe(404);
  });

  it("deletes goal and returns success", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.raceGoal.findUnique).mockResolvedValue(mockGoal);
    vi.mocked(prisma.raceGoal.delete).mockResolvedValue(mockGoal);

    const res = await DELETE(createRequest("/api/goals/goal-1"), { params: { id: "goal-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
