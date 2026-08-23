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
   * Recent sustained weekly volume (meters), e.g. a 4-week rolling average.
   * When provided and > 0, the projected partial-week volume is capped at
   * `recentWeeklyVolumeMeters * PROJECTION_CAP_FACTOR` so a single early-week
   * session can't claim more than the athlete has demonstrated — otherwise a
   * 3×/week trainer would be scored as if every day were a training day.
   */
  recentWeeklyVolumeMeters?: number | null;
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

/** Max a projected weekly volume may exceed the athlete's recent weekly norm. */
export const PROJECTION_CAP_FACTOR = 1.2;

/**
 * Recent weekly training volume as a 4-week rolling average of the supplied
 * activity logs (ascending by date), relative to `referenceDate`. Used to cap
 * the early-week volume projection so a single session can't claim more than
 * the athlete has been sustaining. Returns null when there's too little
 * history (fewer than two sessions in the window) to estimate a norm.
 */
export function recentWeeklyVolume(
  logs: ReadonlyArray<{ startDate: Date; distanceMeters: number | null }>,
  referenceDate: Date
): number | null {
  const windowMs = 28 * 86_400_000;
  const cutoff = referenceDate.getTime() - windowMs;
  const inWindow = logs.filter(
    (l) => l.startDate.getTime() >= cutoff && l.startDate.getTime() <= referenceDate.getTime()
  );
  if (inWindow.length < 2) return null;
  const total = inWindow.reduce((sum, l) => sum + (l.distanceMeters || 0), 0);
  const earliest = Math.min(...inWindow.map((l) => l.startDate.getTime()));
  const latest = Math.max(...inWindow.map((l) => l.startDate.getTime()));
  // Calendar days actually covered, capped at the window, at least 1.
  const coveredDays = Math.min(28, Math.max(1, (latest - earliest) / 86_400_000 + 1));
  return (total / coveredDays) * 7;
}

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
    recentWeeklyVolumeMeters,
    tzOffset,
  } = input;
  const now = new Date();
  const endDate = weekEndDate ?? now;

  // Days of the window that have actually elapsed (1..7). A partial window —
  // e.g. the current Mon–Sun week viewed on a Wednesday — is projected to a
  // full week before volume adherence is scored, so a healthy athlete isn't
  // penalized for the days of the week that haven't happened yet.
  const elapsedDays = Math.max(
    1,
    Math.min(
      7,
      Math.ceil((Math.min(now.getTime(), endDate.getTime()) - weekStartDate.getTime()) / 86_400_000)
    )
  );
  const weeklyProjectionFactor = 7 / elapsedDays;

  // Volume adherence — how close the athlete is to the primary goal's target
  // volume. The partial week's volume is projected to a full-week equivalent
  // (so day one isn't scored against the whole week), then capped at the
  // athlete's demonstrated recent weekly volume so a low-frequency trainer
  // isn't over-credited for a single session.
  let volumeAdherence = 50;
  if (primaryGoal) {
    const weeksUntil = Math.max(
      1,
      Math.ceil((primaryGoal.targetDate.getTime() - now.getTime()) / (7 * 86_400_000))
    );
    const targetWeekly = primaryGoal.distanceMeters / (weeksUntil * 0.7);
    let projectedVolume = weeklyVolumeMeters * weeklyProjectionFactor;
    if (recentWeeklyVolumeMeters && recentWeeklyVolumeMeters > 0) {
      projectedVolume = Math.min(projectedVolume, recentWeeklyVolumeMeters * PROJECTION_CAP_FACTOR);
    }
    volumeAdherence = Math.min(
      100,
      Math.round((projectedVolume / Math.max(1, targetWeekly)) * 100)
    );
  }

  // Consistency — proportion of days in the window with at least one activity.
  // Bucket by the user's LOCAL calendar day so it aligns with the elapsed-days
  // window above (which is derived from the caller's local week boundaries);
  // `toISOString()` would shift activities into UTC days. tzOffset defaults to
  // UTC (0) for background callers that don't know the user's timezone.
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
