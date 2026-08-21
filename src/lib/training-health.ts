/**
 * Shared training health computation — readiness score and fatigue signals.
 *
 * Deduplicated from metrics-snapshot.ts and training-context.ts.
 * These functions are pure computations; callers supply the pre-fetched data.
 */

import { localDateStr } from "./utils";

// ── Types ──────────────────────────────────────────────────────────

export interface ReadinessInput {
  /** Total volume for the period in meters */
  weeklyVolumeMeters: number;
  /** Total TSS for the period */
  weeklyTss: number;
  /** Start of the evaluation period */
  weekStartDate: Date;
  /** End of the evaluation period (defaults to now) */
  weekEndDate?: Date;
  /** Primary goal for volume adherence (optional) */
  primaryGoal?: {
    targetDate: Date;
    distanceMeters: number;
  } | null;
  /** Activity logs in the period — used for consistency calculation */
  activityLogs: ReadonlyArray<{ startDate: Date }>;
  /**
   * Client's UTC offset in minutes as reported by `Date.getTimezoneOffset()`
   * (negative for UTC+). Activity dates are bucketed to this local calendar
   * day so consistency matches the caller's week boundaries. Defaults to UTC
   * for callers without a timezone context (e.g. background snapshot jobs).
   */
  tzOffset?: number;
}

export interface ReadinessResult {
  readinessScore: number;
  volumeAdherence: number;
  consistencyScore: number;
}

/** A body metric entry usable for fatigue detection */
export interface FatigueBodyMetric {
  restingHr?: number | null;
}

export interface FatigueInput {
  weeklyTss: number;
  activityCount: number;
  bodyMetrics?: ReadonlyArray<FatigueBodyMetric>;
}

export interface FatigueResult {
  severity: string;
  signals: string[];
  recommendations: string[];
}

// ── Readiness Score ───────────────────────────────────────────────

/**
 * Computes a 0-100 readiness score based on:
 *  - Volume adherence to the primary goal (40 %)
 *  - Consistency (days active / elapsed days) (25 %)
 *  - Rest balance (inverse of TSS load)            (20 %)
 *  - Trend score (neutral fallback)                (15 %)
 *  - Fatigue penalty (TSS-based deduction)
 */
export function computeReadinessScore(input: ReadinessInput): ReadinessResult {
  const {
    weeklyVolumeMeters,
    weeklyTss,
    weekStartDate,
    weekEndDate,
    primaryGoal,
    activityLogs,
    tzOffset,
  } = input;
  const now = new Date();
  const endDate = weekEndDate ?? now;

  // Volume adherence — how close the athlete is to the primary goal's target volume
  let volumeAdherence = 50;
  if (primaryGoal) {
    const weeksUntil = Math.max(
      1,
      Math.ceil((primaryGoal.targetDate.getTime() - now.getTime()) / (7 * 86_400_000))
    );
    const targetWeekly = primaryGoal.distanceMeters / (weeksUntil * 0.7);
    volumeAdherence = Math.min(
      100,
      Math.round((weeklyVolumeMeters / Math.max(1, targetWeekly)) * 100)
    );
  }

  // Consistency — proportion of days in the window with at least one activity.
  // Bucket by the user's LOCAL calendar day so it aligns with the elapsed-days
  // window above (which is derived from the caller's local week boundaries);
  // `toISOString()` would shift activities into UTC days. tzOffset defaults to
  // UTC (0) for background callers that don't know the user's timezone.
  const elapsedDays = Math.max(
    1,
    Math.min(
      7,
      Math.ceil((Math.min(now.getTime(), endDate.getTime()) - weekStartDate.getTime()) / 86_400_000)
    )
  );
  const activeDays = new Set(activityLogs.map((l) => localDateStr(l.startDate, tzOffset ?? 0)))
    .size;
  const consistencyScore = Math.min(100, Math.round((activeDays / elapsedDays) * 100));

  // Rest balance — how much training load leaves room for recovery
  const restBalance = Math.max(0, 100 - Math.min(100, Math.round((weeklyTss / 700) * 100)));

  // Trend score — simplified to neutral because multi-week trend data
  // is often unavailable in snapshot / context-gathering contexts
  const trendScore = 75;

  // Fatigue penalty — TSS thresholds that reduce the final score
  let fatiguePenalty = 0;
  if (weeklyTss > 700) fatiguePenalty = 20;
  else if (weeklyTss > 500) fatiguePenalty = 10;
  else if (weeklyTss > 350) fatiguePenalty = 5;

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        volumeAdherence * 0.4 +
          consistencyScore * 0.25 +
          restBalance * 0.2 +
          trendScore * 0.15 -
          fatiguePenalty
      )
    )
  );

  return { readinessScore: score, volumeAdherence, consistencyScore };
}

// ── Fatigue Signals ──────────────────────────────────────────────

/**
 * Detects fatigue signals from training load, resting HR trend,
 * and session consistency.
 *
 * Merged logic from:
 *  - metrics-snapshot.ts  computeFatigue()   (consistency check)
 *  - training-context.ts  inline fatigue     (high-load-with-few-sessions check)
 */
export function computeFatigueSignals(input: FatigueInput): FatigueResult {
  const { weeklyTss, activityCount, bodyMetrics = [] } = input;
  const signals: string[] = [];
  const recommendations: string[] = [];

  // ── High volume ──────────────────────────────────────────
  if (weeklyTss > 600) {
    signals.push("High training volume this week");
    recommendations.push("Your TSS load is high. Prioritize sleep and nutrition this week.");
  }

  // ── High load with few sessions ──────────────────────────
  if (weeklyTss > 350 && activityCount < 3) {
    signals.push("High load with few sessions");
    recommendations.push("Consider distributing volume across more sessions.");
  }

  // ── Resting HR trend ─────────────────────────────────────
  const restingHrValues = bodyMetrics.filter((m) => m.restingHr != null);
  if (restingHrValues.length >= 3) {
    const recent = restingHrValues.slice(0, 3).reduce((sum, m) => sum + (m.restingHr ?? 0), 0) / 3;
    const older =
      restingHrValues.length >= 6
        ? restingHrValues.slice(3, 6).reduce((sum, m) => sum + (m.restingHr ?? 0), 0) / 3
        : recent;

    if (older > 0 && recent - older > 5) {
      signals.push(`Resting HR +${Math.round(recent - older)} bpm above baseline`);
      recommendations.push(
        "Your resting heart rate is trending up — a key sign of autonomic stress. Consider a lighter training week."
      );
    }
  }

  // ── Consistency ──────────────────────────────────────────
  const EXPECTED_SESSIONS = 5;
  const consistencyPct = Math.round((activityCount / EXPECTED_SESSIONS) * 100);
  if (consistencyPct < 50) {
    signals.push(`Low consistency (${consistencyPct}% of planned sessions)`);
    recommendations.push("Consistency is the foundation of endurance training.");
  }

  // ── Severity ─────────────────────────────────────────────
  let severity: string;
  if (signals.length >= 3) severity = "high";
  else if (signals.length === 2) severity = "medium";
  else if (signals.length === 1) severity = "low";
  else severity = "none";

  return { severity, signals, recommendations };
}
