import { describe, it, expect } from "vitest";
import {
  computeReadinessScore,
  computeFatigueSignals,
  recentWeeklyVolume,
} from "../training-health";

describe("computeReadinessScore", () => {
  it("returns a score of 100 for perfect adherence", () => {
    const result = computeReadinessScore({
      weeklyVolumeMeters: 50000,
      weeklyTss: 300,
      weekStartDate: new Date("2025-01-13"),
      primaryGoal: {
        targetDate: new Date("2025-06-01"),
        distanceMeters: 42195,
      },
      activityLogs: [
        { startDate: new Date("2025-01-13") },
        { startDate: new Date("2025-01-14") },
        { startDate: new Date("2025-01-15") },
        { startDate: new Date("2025-01-16") },
        { startDate: new Date("2025-01-17") },
        { startDate: new Date("2025-01-18") },
        { startDate: new Date("2025-01-19") },
      ],
    });
    expect(result.readinessScore).toBeGreaterThanOrEqual(0);
    expect(result.readinessScore).toBeLessThanOrEqual(100);
  });

  it("returns a low score for zero volume and no training", () => {
    const result = computeReadinessScore({
      weeklyVolumeMeters: 0,
      weeklyTss: 0,
      weekStartDate: new Date("2025-01-13"),
      primaryGoal: {
        targetDate: new Date("2025-06-01"),
        distanceMeters: 42195,
      },
      activityLogs: [],
    });
    expect(result.readinessScore).toBeLessThan(50);
    expect(result.volumeAdherence).toBeLessThan(100);
  });

  it("applies fatigue penalty for high TSS", () => {
    const moderate = computeReadinessScore({
      weeklyVolumeMeters: 40000,
      weeklyTss: 300,
      weekStartDate: new Date("2025-01-13"),
      activityLogs: [{ startDate: new Date("2025-01-13") }],
    });
    const high = computeReadinessScore({
      weeklyVolumeMeters: 40000,
      weeklyTss: 800,
      weekStartDate: new Date("2025-01-13"),
      activityLogs: [{ startDate: new Date("2025-01-13") }],
    });
    expect(high.readinessScore).toBeLessThan(moderate.readinessScore);
  });

  it("handles missing primary goal gracefully", () => {
    const result = computeReadinessScore({
      weeklyVolumeMeters: 30000,
      weeklyTss: 300,
      weekStartDate: new Date("2025-01-13"),
      primaryGoal: null,
      activityLogs: [{ startDate: new Date("2025-01-13") }],
    });
    expect(result.readinessScore).toBeGreaterThanOrEqual(0);
    expect(result.readinessScore).toBeLessThanOrEqual(100);
  });

  it("computes consistency based on active days", () => {
    const singleDay = computeReadinessScore({
      weeklyVolumeMeters: 10000,
      weeklyTss: 50,
      weekStartDate: new Date("2025-01-13"),
      activityLogs: [{ startDate: new Date("2025-01-13") }],
    });
    const fullWeek = computeReadinessScore({
      weeklyVolumeMeters: 70000,
      weeklyTss: 350,
      weekStartDate: new Date("2025-01-13"),
      activityLogs: [
        { startDate: new Date("2025-01-13") },
        { startDate: new Date("2025-01-14") },
        { startDate: new Date("2025-01-15") },
        { startDate: new Date("2025-01-16") },
        { startDate: new Date("2025-01-17") },
        { startDate: new Date("2025-01-18") },
        { startDate: new Date("2025-01-19") },
      ],
    });
    expect(fullWeek.consistencyScore).toBeGreaterThan(singleDay.consistencyScore);
  });

  it("projects a partial week's volume to a full-week equivalent before scoring adherence", () => {
    const now = Date.now();
    // Race within the week → weekly target = 42,195 / 0.7 ≈ 60 km
    const goal = {
      targetDate: new Date(now + 3 * 86400000),
      distanceMeters: 42195,
    };
    // Same raw 20 km, but over 7 elapsed days vs ~2 elapsed days.
    const fullWeek = computeReadinessScore({
      weeklyVolumeMeters: 20000,
      weeklyTss: 200,
      weekStartDate: new Date(now - 8 * 86400000),
      primaryGoal: goal,
      activityLogs: Array.from({ length: 7 }, (_, i) => ({
        startDate: new Date(now - (7 - i) * 86400000),
      })),
    });
    const partialWeek = computeReadinessScore({
      weeklyVolumeMeters: 20000,
      weeklyTss: 200,
      weekStartDate: new Date(now - 1.5 * 86400000),
      primaryGoal: goal,
      activityLogs: [
        { startDate: new Date(now - 86400000) },
        { startDate: new Date(now) },
      ],
    });

    // Without day-normalization both would read the same 20 km against the
    // ~60 km target (~33%). The partial week projects to 70 km instead and
    // must land well above the completed week's raw score.
    expect(fullWeek.volumeAdherence).toBeLessThan(100);
    expect(partialWeek.volumeAdherence).toBe(100);
    expect(partialWeek.volumeAdherence).toBeGreaterThan(fullWeek.volumeAdherence);
  });

  it("keeps a healthy partial week from scoring near zero", () => {
    const now = Date.now();
    const result = computeReadinessScore({
      weeklyVolumeMeters: 15000,
      weeklyTss: 60,
      weekStartDate: new Date(now - 1.5 * 86400000),
      primaryGoal: {
        targetDate: new Date(now + 30 * 86400000),
        distanceMeters: 42195,
      },
      activityLogs: [{ startDate: new Date(now - 86400000) }],
    });
    expect(result.readinessScore).toBeGreaterThanOrEqual(50);
  });

  it("caps the projected volume at the athlete's recent weekly norm", () => {
    const now = Date.now();
    const raceThisWeek = {
      targetDate: new Date(now + 3 * 86400000),
      distanceMeters: 42195,
    };
    const base = {
      weeklyVolumeMeters: 20000, // one big Monday session
      weeklyTss: 200,
      weekStartDate: new Date(now - 1.5 * 86400000), // day 2 of the week
      primaryGoal: raceThisWeek,
      activityLogs: [{ startDate: new Date(now - 86400000) }],
    };
    const uncapped = computeReadinessScore(base);
    const capped = computeReadinessScore({
      ...base,
      // The athlete only sustains 30 km/week — a 20 km Monday must not
      // project to 70 km (100% of the ~60 km target).
      recentWeeklyVolumeMeters: 30000,
    });
    // Uncapped: 20 × 3.5 = 70 km → 100%. Capped: 30 × 1.2 = 36 km → ~60%.
    expect(uncapped.volumeAdherence).toBe(100);
    expect(capped.volumeAdherence).toBe(60);
    expect(capped.volumeAdherence).toBeLessThan(uncapped.volumeAdherence);
  });

  it("caps score at 100", () => {
    const result = computeReadinessScore({
      weeklyVolumeMeters: 200000,
      weeklyTss: 50,
      weekStartDate: new Date("2025-01-13"),
      primaryGoal: {
        targetDate: new Date("2025-02-01"),
        distanceMeters: 10000,
      },
      activityLogs: Array.from({ length: 7 }, (_, i) => ({
        startDate: new Date(`2025-01-${13 + i}`),
      })),
    });
    expect(result.readinessScore).toBeLessThanOrEqual(100);
  });

  it("clamps score at 0 for extreme fatigue", () => {
    const result = computeReadinessScore({
      weeklyVolumeMeters: 0,
      weeklyTss: 1000,
      weekStartDate: new Date("2025-01-13"),
      activityLogs: [],
    });
    expect(result.readinessScore).toBeGreaterThanOrEqual(0);
  });
});

describe("computeFatigueSignals", () => {
  it("detects high volume signal when TSS > 600", () => {
    const result = computeFatigueSignals({
      weeklyTss: 700,
      activityCount: 5,
    });
    expect(result.signals).toContain("High training volume this week");
    expect(result.severity).toBe("low");
  });

  it("detects high load with few sessions", () => {
    const result = computeFatigueSignals({
      weeklyTss: 400,
      activityCount: 2,
    });
    expect(result.signals).toContain("High load with few sessions");
  });

  it("detects resting HR drift with sufficient data", () => {
    const result = computeFatigueSignals({
      weeklyTss: 300,
      activityCount: 5,
      // Most recent metrics come first (descending date order from DB)
      bodyMetrics: [
        { restingHr: 62 },
        { restingHr: 60 },
        { restingHr: 58 }, // recent 3 avg = (62+60+58)/3 = 60
        { restingHr: 47 },
        { restingHr: 46 },
        { restingHr: 45 }, // older 3 avg = (47+46+45)/3 = 46, drift = 60-46 = 14
      ],
    });
    expect(result.signals.filter((s) => s.includes("Resting HR"))).toHaveLength(1);
  });

  it("detects low consistency", () => {
    const result = computeFatigueSignals({
      weeklyTss: 200,
      activityCount: 2,
    });
    expect(result.signals.filter((s) => s.includes("Low consistency"))).toHaveLength(1);
  });

  it("returns severity based on signal count", () => {
    const none = computeFatigueSignals({ weeklyTss: 200, activityCount: 5 });
    expect(none.severity).toBe("none");
    expect(none.signals).toHaveLength(0);
    expect(none.recommendations).toHaveLength(0);
  });

  it("returns recommendations with each signal", () => {
    const result = computeFatigueSignals({ weeklyTss: 700, activityCount: 1 });
    expect(result.recommendations.length).toBeGreaterThanOrEqual(result.signals.length);
  });
});

describe("recentWeeklyVolume", () => {
  it("returns a rolling weekly average from the last 4 weeks", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    // 20 km on Mon/Wed/Sat for three weeks = ~60 km/week.
    const logs = [];
    for (let w = 0; w < 3; w++) {
      for (const day of [0, 2, 5]) {
        logs.push({
          startDate: new Date(now.getTime() - (w * 7 + day) * 86400000),
          distanceMeters: 20000,
        });
      }
    }
    const avg = recentWeeklyVolume(logs, now);
    expect(avg).not.toBeNull();
    expect(avg!).toBeGreaterThan(50000);
    expect(avg!).toBeLessThan(70000);
  });

  it("returns null when there is too little history to estimate a norm", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const avg = recentWeeklyVolume([{ startDate: now, distanceMeters: 20000 }], now);
    expect(avg).toBeNull();
  });
});
