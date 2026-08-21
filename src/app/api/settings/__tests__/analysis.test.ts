import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "../analysis/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createRequest, jsonRequest } from "@/test/utils";

vi.mock("next-auth");
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    analysisReport: {
      findFirst: vi.fn(),
    },
  },
}));

describe("GET /api/settings/analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns analysis settings with defaults", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      analysisTrigger: "weekly",
      analysisTriggerValue: 3,
      reviewDayOfWeek: 1,
      reviewTime: "18:00",
      reviewDayOfMonth: 1,
    } as any);
    vi.mocked(prisma.analysisReport.findFirst).mockResolvedValue({
      createdAt: new Date("2025-01-15"),
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysisTrigger).toBe("weekly");
    expect(body.lastAnalysisAt).toBeDefined();
  });

  it("returns null lastAnalysisAt when no reports exist", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({} as any);
    vi.mocked(prisma.analysisReport.findFirst).mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();
    expect(body.lastAnalysisAt).toBeNull();
  });
});

describe("PUT /api/settings/analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await PUT(jsonRequest("/api/settings/analysis", {}));
    expect(res.status).toBe(401);
  });

  it("updates analysis settings", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    const res = await PUT(
      jsonRequest("/api/settings/analysis", {
        analysisTrigger: "daily",
        analysisTriggerValue: 1,
        reviewTime: "06:00",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 400 for invalid trigger", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    const res = await PUT(
      jsonRequest("/api/settings/analysis", {
        analysisTrigger: "invalid_trigger",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid trigger", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    const res = await PUT(
      jsonRequest("/api/settings/analysis", {
        analysisTrigger: "daily",
        reviewTime: "abc",
      })
    );
    expect(res.status).toBe(400);
  });

  it("forces triggerValue=1 for weekly/monthly triggers", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await PUT(
      jsonRequest("/api/settings/analysis", {
        analysisTrigger: "weekly",
        analysisTriggerValue: 7,
      })
    );
    const updateData = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(updateData.analysisTriggerValue).toBe(1);
  });
});
