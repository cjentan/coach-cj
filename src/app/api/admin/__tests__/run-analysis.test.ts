import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../run-analysis/route";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { sundayQueue } from "@/lib/review-queue";

// Fixed "next Monday" anchor shared by the mocked nextReviewWeekStart and the
// assertions below. vi.hoisted keeps it defined before the (hoisted) mocks run.
const { FIXED_WEEK } = vi.hoisted(() => ({
  FIXED_WEEK: new Date("2026-08-31T00:00:00.000Z"),
}));

vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    weeklyPlan: { findMany: vi.fn() },
  },
}));

// Mock the shared review-queue so the route never opens a real Redis/BullMQ
// connection; keep nextReviewWeekStart as a pure reimplementation.
vi.mock("@/lib/review-queue", () => ({
  sundayQueue: { add: vi.fn() },
  nextReviewWeekStart: () => FIXED_WEEK,
  REVIEW_QUEUE: "sunday-review",
}));

const adminUser = { id: "admin-1", role: "admin" } as any;

describe("POST /api/admin/run-analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sundayQueue.add).mockResolvedValue({} as any);
  });

  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(sundayQueue.add).not.toHaveBeenCalled();
  });

  it("skips only reviews that already passed (non-empty coachNotes), retrying the rest", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol" },
    ] as any);
    // u2 already reviewed this week (coachNotes set) → skipped.
    // u3 has a target-week plan but no coachNotes → that review failed / never
    //   produced analysis, so it MUST be retried (enqueued again).
    vi.mocked(prisma.weeklyPlan.findMany).mockResolvedValue([
      { userId: "u2", coachNotes: "analysis text from a passed review" },
      { userId: "u3", coachNotes: null },
    ] as any);

    const res = await POST();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.enqueued).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.users).toEqual([
      { id: "u1", name: "Alice" },
      { id: "u3", name: "Carol" },
    ]);

    expect(sundayQueue.add).toHaveBeenCalledTimes(2);
    expect(sundayQueue.add).toHaveBeenCalledWith("review", { userId: "u1" });
    expect(sundayQueue.add).toHaveBeenCalledWith("review", { userId: "u3" });
    expect(sundayQueue.add).not.toHaveBeenCalledWith("review", { userId: "u2" });
  });

  it("enqueues all eligible users when none have passed a review this week", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u1", name: "Alice" }] as any);
    vi.mocked(prisma.weeklyPlan.findMany).mockResolvedValue([] as any);

    const res = await POST();
    const body = await res.json();
    expect(body.enqueued).toBe(1);
    expect(body.skipped).toBe(0);
    expect(sundayQueue.add).toHaveBeenCalledTimes(1);
  });
});
