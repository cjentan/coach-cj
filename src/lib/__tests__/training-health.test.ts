import { describe, it, expect } from "vitest";
import { computeReadinessScore, computeFatigueSignals } from "../training-health";

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
