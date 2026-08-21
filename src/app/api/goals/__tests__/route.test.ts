import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "../route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { buildRaceGoal } from "@/test/factories";
import { createRequest, jsonRequest } from "@/test/utils";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    raceGoal: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe("GET /api/goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns all goals for the user", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    const mockGoals = [
      buildRaceGoal({ id: "g1", name: "Marathon" }),
      buildRaceGoal({ id: "g2", name: "10K" }),
    ];
    vi.mocked(prisma.raceGoal.findMany).mockResolvedValue(mockGoals);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe("Marathon");
  });

  it("scopes query to the authenticated user", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-42" } } as any);
    vi.mocked(prisma.raceGoal.findMany).mockResolvedValue([]);

    await GET();
    expect(vi.mocked(prisma.raceGoal.findMany).mock.calls[0][0]?.where).toMatchObject({
      userId: "user-42",
    });
  });

  it("orders by status then target date", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.raceGoal.findMany).mockResolvedValue([]);

    await GET();
    const orderBy = vi.mocked(prisma.raceGoal.findMany).mock.calls[0][0]?.orderBy;
    expect(orderBy).toEqual([{ status: "asc" }, { targetDate: "asc" }]);
  });
});

describe("POST /api/goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await POST(jsonRequest("/api/goals", { name: "Test" }));
    expect(res.status).toBe(401);
  });

  it("creates a goal with valid data", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    const goalData = {
      name: "Test Marathon",
      raceType: "road_run",
      targetDate: "2025-06-01T00:00:00.000Z",
      distanceMeters: 42195,
      targetTimeSeconds: 14400,
    };
    vi.mocked(prisma.raceGoal.create).mockResolvedValue(
      buildRaceGoal({ id: "new-goal", ...goalData, targetDate: new Date(goalData.targetDate) })
    );

    const res = await POST(jsonRequest("/api/goals", goalData));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Test Marathon");
  });

  it("returns 400 for empty name", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    const res = await POST(
      jsonRequest("/api/goals", {
        name: "",
        raceType: "road_run",
        targetDate: "2025-06-01",
        distanceMeters: 42195,
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative distance", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    const res = await POST(
      jsonRequest("/api/goals", {
        name: "Test",
        raceType: "road_run",
        targetDate: "2025-06-01",
        distanceMeters: -100,
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing required fields", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    const res = await POST(jsonRequest("/api/goals", {}));
    expect(res.status).toBe(400);
  });

  it("includes userId in the created goal", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-42" } } as any);
    vi.mocked(prisma.raceGoal.create).mockResolvedValue(buildRaceGoal());

    await POST(
      jsonRequest("/api/goals", {
        name: "Test",
        raceType: "road_run",
        targetDate: "2025-06-01",
        distanceMeters: 10000,
      })
    );
    expect(vi.mocked(prisma.raceGoal.create).mock.calls[0][0]?.data).toMatchObject({
      userId: "user-42",
    });
  });
});
