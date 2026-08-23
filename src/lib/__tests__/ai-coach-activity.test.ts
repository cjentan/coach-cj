import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeActivity } from "../ai-coach-activity";

// Hoisted mocks so the vi.mock factories (which run before the test body) can
// reference them without TDZ issues.
const mocks = vi.hoisted(() => {
  const makeModel = () => ({ findUnique: vi.fn(), update: vi.fn() });
  return {
    ask: vi.fn(),
    resolveUserLlmConfig: vi.fn(),
    isLlmConfigured: vi.fn(),
    gatherTrainingContext: vi.fn(),
    prisma: {
      trainingLog: makeModel(),
      user: makeModel(),
      weeklyPlan: makeModel(),
      appSetting: makeModel(),
    },
  };
});

vi.mock("@/lib/llm", () => ({
  ask: mocks.ask,
  resolveUserLlmConfig: mocks.resolveUserLlmConfig,
  isLlmConfigured: mocks.isLlmConfigured,
  chatWithTools: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

vi.mock("@/lib/training-context", () => ({
  gatherTrainingContext: mocks.gatherTrainingContext,
}));

const minimalCtx = {
  athleteName: "Test Athlete",
  goals: [],
  planWeeks: [],
  recentWeeks: [],
  longTermVolumeKm: 50,
  currentWeek: { volumeMeters: 0, elevationMeters: 0, durationSeconds: 0, activityCount: 0 },
  pmc: { ctl: 90, atl: 100, tsb: -10, tsbTrend: "rising" },
  fatigue: null,
  readinessScore: 80,
  volumeAdherence: 1,
  consistencyScore: 80,
  weeklyPlan: null,
  adjustmentHistory: [],
};

const VALID_ANALYSIS_JSON = JSON.stringify({
  trainingType: "easy_recovery",
  trainingTypeLabel: "Easy Recovery Run",
  analysis: "Solid easy run — good effort and pacing.",
  flags: ["Good adherence"],
  verdict: "productive",
});

const fullActivity = {
  userId: "user-1",
  name: "HarbourFront Evening Run",
  type: "run",
  subType: null,
  isRace: false,
  startDate: new Date("2026-08-20T09:28:14.000Z"),
  distanceMeters: 14008,
  durationSeconds: 5516,
  elevationGainMeters: 55,
  averageHr: 141,
  maxHr: 160,
  averagePower: null,
  tss: 112,
};

// A run recorded 2026-08-21T21:09 UTC — which is Sat Aug 22, 05:09 in UTC+8.
// Its UTC day-of-week is Friday (5), but the athlete's local day is Saturday (6).
const saturdayLocalRun = {
  userId: "user-1",
  name: "Taman Ekoflora Morning Trail Run",
  type: "run",
  subType: null,
  isRace: false,
  startDate: new Date("2026-08-21T21:09:01.000Z"),
  distanceMeters: 8000,
  durationSeconds: 3600,
  elevationGainMeters: 90,
  averageHr: 140,
  maxHr: 165,
  averagePower: null,
  tss: 90,
};

describe("analyzeActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveUserLlmConfig.mockResolvedValue({
      apiKey: "test-key",
      provider: "openai",
      baseUrl: null,
      model: "gpt-4o-mini",
    });
    mocks.isLlmConfigured.mockReturnValue(true);
    mocks.gatherTrainingContext.mockResolvedValue(minimalCtx);
    mocks.prisma.user.findUnique.mockResolvedValue({ locale: "en" });
    mocks.prisma.weeklyPlan.findUnique.mockResolvedValue(null);
    mocks.prisma.trainingLog.update.mockResolvedValue({});
    mocks.prisma.trainingLog.findUnique.mockResolvedValue(fullActivity);
  });

  it("returns a successful analysis when the first LLM response parses", async () => {
    mocks.ask.mockResolvedValueOnce(VALID_ANALYSIS_JSON);

    const result = await analyzeActivity("user-1", "activity-1", "en", { persist: false });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    expect(result.analysis).toContain("Easy Recovery Run");
    // Only one LLM call needed — no retry
    expect(mocks.ask).toHaveBeenCalledTimes(1);
  });

  it("keeps the activity summary in the JSON-parse retry call", async () => {
    // First attempt returns invalid JSON, retry returns a valid analysis
    mocks.ask
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce(VALID_ANALYSIS_JSON);

    const result = await analyzeActivity("user-1", "activity-1", "en", { persist: false });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    expect(result.analysis).toContain("Easy Recovery Run");
    expect(mocks.ask).toHaveBeenCalledTimes(2);

    // The retry's system prompt must still contain the activity's data, so the
    // model analyzes the real session instead of a generic "no metrics" reply.
    const retrySystemPrompt = mocks.ask.mock.calls[1][0] as string;
    expect(retrySystemPrompt).toContain("HarbourFront Evening Run");
    expect(retrySystemPrompt).toContain("14.01km");
    expect(retrySystemPrompt).toContain("TSS: 112");
  });

  it("produces a data-grounded analysis after a malformed first response", async () => {
    mocks.ask
      .mockResolvedValueOnce("{not json")
      .mockResolvedValueOnce(VALID_ANALYSIS_JSON);

    const result = await analyzeActivity("user-1", "activity-1", "en", { persist: false });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    // Retry still has the activity name + distance available to the model
    const retrySystemPrompt = mocks.ask.mock.calls[1][0] as string;
    expect(retrySystemPrompt).toContain("HarbourFront Evening Run");
    expect(retrySystemPrompt).toContain("14.01km");
  });

  it("matches the planned session by the athlete's local day-of-week", async () => {
    mocks.ask.mockResolvedValueOnce(VALID_ANALYSIS_JSON);
    mocks.prisma.trainingLog.findUnique.mockResolvedValue(saturdayLocalRun);
    // Plan has a Saturday session. The run's UTC day is Friday, but its local
    // day is Saturday — with tzOffset it must match.
    mocks.prisma.weeklyPlan.findUnique.mockResolvedValue({
      plannedSessions: [
        { dayOfWeek: 6, type: "Long Run", description: "20km easy", targetDistance: 20000 },
      ],
    });

    const result = await analyzeActivity("user-1", "activity-1", "en", {
      persist: false,
      tzOffset: -480, // UTC+8
    });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    const systemPrompt = mocks.ask.mock.calls[0][0] as string;
    expect(systemPrompt).toContain("Long Run");
    expect(systemPrompt).toContain("20km easy");
    expect(systemPrompt).not.toContain("No specific plan set for this day");
  });

  it("without tzOffset the UTC day-of-week misses a local-Saturday plan", async () => {
    mocks.ask.mockResolvedValueOnce(VALID_ANALYSIS_JSON);
    mocks.prisma.trainingLog.findUnique.mockResolvedValue(saturdayLocalRun);
    mocks.prisma.weeklyPlan.findUnique.mockResolvedValue({
      plannedSessions: [
        { dayOfWeek: 6, type: "Long Run", description: "20km easy", targetDistance: 20000 },
      ],
    });

    const result = await analyzeActivity("user-1", "activity-1", "en", { persist: false });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    const systemPrompt = mocks.ask.mock.calls[0][0] as string;
    expect(systemPrompt).toContain("No specific plan set for this day");
  });
});
