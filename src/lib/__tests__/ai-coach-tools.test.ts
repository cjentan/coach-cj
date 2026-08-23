import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeTool } from "../ai-coach-tools";

// Hoisted mocks so the vi.mock factory (which runs before the test body) can
// reference the mock without TDZ issues.
const mocks = vi.hoisted(() => {
  return {
    prisma: {
      trainingLog: {
        findMany: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

describe("executeTool · query_activities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A plausible activity row; only fields used by the formatter matter.
    mocks.prisma.trainingLog.findMany.mockResolvedValue([
      {
        id: "activity-1",
        name: "Taman Ekoflora Morning Trail Run",
        type: "run",
        subType: null,
        startDate: new Date("2026-08-21T21:09:01.000Z"), // Sat Aug 22, 05:09 local (UTC+8)
        durationSeconds: 3600,
        distanceMeters: 8000,
        elevationGainMeters: 90,
        averageHr: 140,
        maxHr: 165,
        averagePower: null,
        normalizedPower: null,
        tss: 90,
        remarks: null,
        source: "garmin",
      },
    ]);
  });

  it("interprets since/until as athlete-local calendar dates when tzOffset is supplied", async () => {
    await executeTool(
      "query_activities",
      { since: "2026-08-22", until: "2026-08-22" },
      "user-1",
      undefined,
      -480 // UTC+8 (Malaysia): Date.getTimezoneOffset() is negative for UTC+
    );

    expect(mocks.prisma.trainingLog.findMany).toHaveBeenCalledTimes(1);
    const where = mocks.prisma.trainingLog.findMany.mock.calls[0][0].where;
    // Local midnight Aug 22 (UTC+8) == 2026-08-21T16:00:00Z
    expect(where.startDate.gte.toISOString()).toBe("2026-08-21T16:00:00.000Z");
    // End of local day Aug 22 == 2026-08-22T15:59:59.999Z
    expect(where.startDate.lte.toISOString()).toBe("2026-08-22T15:59:59.999Z");
  });

  it("falls back to UTC day boundaries when no tzOffset is given", async () => {
    await executeTool("query_activities", { since: "2026-08-22", until: "2026-08-22" }, "user-1");

    const where = mocks.prisma.trainingLog.findMany.mock.calls[0][0].where;
    expect(where.startDate.gte.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(where.startDate.lte.toISOString()).toBe("2026-08-22T23:59:59.999Z");
  });

  it("shifts an open-ended since window into the local timezone", async () => {
    await executeTool("query_activities", { since: "2026-08-22" }, "user-1", undefined, -480);

    const where = mocks.prisma.trainingLog.findMany.mock.calls[0][0].where;
    expect(where.startDate.gte.toISOString()).toBe("2026-08-21T16:00:00.000Z");
    expect(where.startDate.lte).toBeUndefined();
  });

  it("returns the formatted activity list with the count", async () => {
    const result = await executeTool(
      "query_activities",
      { since: "2026-08-22", until: "2026-08-22" },
      "user-1",
      undefined,
      -480
    );

    expect(result.success).toBe(true);
    expect(result.data?.count).toBe(1);
    expect(result.data?.activities).toHaveLength(1);
    expect((result.data?.activities as Array<Record<string, unknown>>)[0].name).toBe(
      "Taman Ekoflora Morning Trail Run"
    );
  });
});
