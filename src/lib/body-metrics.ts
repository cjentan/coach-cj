/**
 * Body metrics utilities — weight/height lookup with interpolation for training metrics.
 *
 * Body weight changes over time but users log it sporadically (not daily).
 * To use weight in training metrics (w/kg, calorie estimates, etc.), we need
 * the best available weight for any given date. This module provides that lookup.
 */
import { prisma } from "./prisma";

export interface WeightResult {
  weightKg: number;
  source: "exact" | "nearest" | "interpolated" | "carry";
  /** Days between the activity date and the body metric date */
  gapDays: number;
}

/**
 * Return the best-estimate body weight for a given date.
 *
 * Resolution order:
 * 1. Exact match — body metric on the same day
 * 2. Nearest neighbor within ±14 days (prefers before over after when equidistant)
 * 3. Linear interpolation — points before and after exist, interpolate by day
 * 4. Edge carry — only one side has data, use it (up to 30 days)
 * 5. No data → returns null
 */
export async function getWeightAtDate(
  userId: string,
  date: Date,
): Promise<WeightResult | null> {
  const dateStr = date.toISOString().split("T")[0];

  // Fetch body metrics in a wide window around the target date
  const windowStart = new Date(date.getTime() - 40 * 86400000);
  const windowEnd = new Date(date.getTime() + 40 * 86400000);

  const metrics = await prisma.bodyMetric.findMany({
    where: {
      userId,
      recordedAt: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, weightKg: true },
  });

  if (metrics.length === 0) return null;

  // 1. Exact match
  const exact = metrics.find(
    (m) => m.recordedAt.toISOString().split("T")[0] === dateStr,
  );
  if (exact) {
    return { weightKg: exact.weightKg, source: "exact", gapDays: 0 };
  }

  const targetTime = date.getTime();

  // 2. Nearest neighbor within ±14 days
  let bestNearest: (typeof metrics)[0] | null = null;
  let bestGap = Infinity;

  for (const m of metrics) {
    const gap = Math.abs(m.recordedAt.getTime() - targetTime) / 86400000;
    if (gap > 14) continue;

    // Prefer earlier date when equidistant
    const isBetter =
      gap < bestGap ||
      (gap === bestGap &&
        m.recordedAt.getTime() < targetTime &&
        bestNearest &&
        bestNearest.recordedAt.getTime() > targetTime);

    if (isBetter || gap < bestGap) {
      bestGap = gap;
      bestNearest = m;
    }
  }

  if (bestNearest) {
    return {
      weightKg: bestNearest.weightKg,
      source: "nearest",
      gapDays: Math.round(bestGap),
    };
  }

  // 3. Linear interpolation — find points before and after
  const before = metrics
    .filter((m) => m.recordedAt.getTime() < targetTime)
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0];

  const after = metrics
    .filter((m) => m.recordedAt.getTime() > targetTime)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())[0];

  if (before && after) {
    const beforeTime = before.recordedAt.getTime();
    const afterTime = after.recordedAt.getTime();
    const totalSpan = (afterTime - beforeTime) / 86400000;
    const fraction = (targetTime - beforeTime) / 86400000 / totalSpan;
    const interpolated =
      before.weightKg + (after.weightKg - before.weightKg) * fraction;

    return {
      weightKg: Math.round(interpolated * 10) / 10,
      source: "interpolated",
      gapDays: Math.round(
        Math.min(
          Math.abs(beforeTime - targetTime),
          Math.abs(afterTime - targetTime),
        ) / 86400000,
      ),
    };
  }

  // 4. Edge carry (up to 30 days)
  const closest = metrics.reduce((best, m) => {
    const gap = Math.abs(m.recordedAt.getTime() - targetTime) / 86400000;
    return gap < best.gap ? { metric: m, gap } : best;
  }, { metric: metrics[0], gap: Infinity });

  if (closest.gap <= 30) {
    return {
      weightKg: closest.metric.weightKg,
      source: "carry",
      gapDays: Math.round(closest.gap),
    };
  }

  return null;
}

/**
 * Return the most recent height for a user.
 * Height rarely changes, so we just take the latest entry.
 */
export async function getLatestHeight(userId: string): Promise<number | null> {
  const metric = await prisma.bodyMetric.findFirst({
    where: { userId, heightCm: { not: null } },
    orderBy: { recordedAt: "desc" },
    select: { heightCm: true },
  });
  return metric?.heightCm ?? null;
}

/**
 * Fallback max HR when no estimate exists and the user hasn't set one.
 * 190 bpm is the common generic adult default (no age/sex data is collected
 * to apply a formula like 208 − 0.7·age).
 */
export const DEFAULT_MAX_HR = 190;

/**
 * Return the user's most recent resting HR, or null if none is available.
 *
 * Priority order:
 * 1. Garmin-sourced resting HR (DailyHealth.restingHeartRate) — measured
 *    overnight by the watch and synced via Garmin health sync. This is the
 *    freshest, most accurate value, so it wins over anything manual.
 * 2. Manually logged resting HR (BodyMetric.restingHr).
 *
 * DailyHealth is only ever written by the Garmin health sync (plus backup
 * restore), so the DailyHealth-first check is equivalent to "Garmin users use
 * the API value". COROS and manual-only users have no DailyHealth rows and
 * fall through to the manual value.
 *
 * Resting HR is the lower anchor of the Karvonen (heart-rate reserve) zone
 * calculation, so every zone-consuming site fetches it from the same place.
 */
export async function getLatestRestingHr(userId: string): Promise<number | null> {
  // 1. Garmin API value first — most recent measured resting HR.
  const fromHealth = await prisma.dailyHealth.findFirst({
    where: { userId, restingHeartRate: { not: null } },
    orderBy: { date: "desc" },
    select: { restingHeartRate: true },
  });
  if (fromHealth?.restingHeartRate != null) return fromHealth.restingHeartRate;

  // 2. Manual body-metric entry as fallback.
  const metric = await prisma.bodyMetric.findFirst({
    where: { userId, restingHr: { not: null } },
    orderBy: { recordedAt: "desc" },
    select: { restingHr: true },
  });
  return metric?.restingHr ?? null;
}

/**
 * Estimated max HR: the highest max HR observed in a workout over the last 2
 * years, or null if none. This is the "as more data is gathered" estimate —
 * once a user has enough workouts to show their ceiling, it takes precedence
 * over any manually set value.
 */
export async function getEstimatedMaxHr(userId: string): Promise<number | null> {
  const log = await prisma.trainingLog.findFirst({
    where: {
      userId,
      maxHr: { not: null },
      startDate: { gte: new Date(Date.now() - 2 * 365 * 86400000) },
      mergedIntoId: null,
    },
    orderBy: { maxHr: "desc" },
    select: { maxHr: true },
  });
  return log?.maxHr ?? null;
}

/** Which source currently provides the user's max HR. */
export type MaxHrSource = "estimated" | "user-set" | "default";

export interface MaxHrInfo {
  /** The max HR every zone calculation should use. */
  effective: number;
  /** Why this value is in effect. */
  source: MaxHrSource;
  /** The user's manually configured max HR (Settings), or null. */
  userSet: number | null;
  /** The data-derived estimate (highest workout max, 2y), or null. */
  estimated: number | null;
}

/**
 * Resolve the user-level max HR used for all Karvonen zone math.
 *
 * Precedence:
 * 1. Estimated max HR (highest workout max over the last 2 years) — data wins
 *    once it exists.
 * 2. User-set max HR (Settings) — the baseline before there's enough data.
 * 3. DEFAULT_MAX_HR (190) — when neither exists.
 *
 * Always returns a number so callers never degrade zone math on a missing max.
 */
export async function getEffectiveMaxHr(userId: string): Promise<number> {
  return (await getMaxHrInfo(userId)).effective;
}

export async function getMaxHrInfo(userId: string): Promise<MaxHrInfo> {
  const estimated = await getEstimatedMaxHr(userId);
  if (estimated != null) {
    return { effective: estimated, source: "estimated", userSet: await getUserSetMaxHr(userId), estimated };
  }

  const userSet = await getUserSetMaxHr(userId);
  if (userSet != null) {
    return { effective: userSet, source: "user-set", userSet, estimated: null };
  }

  return { effective: DEFAULT_MAX_HR, source: "default", userSet: null, estimated: null };
}

/** The user's manually configured max HR from Settings, or null. */
async function getUserSetMaxHr(userId: string): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { maxHr: true },
  });
  return user?.maxHr ?? null;
}

/**
 * Batch-lookup weights for multiple dates. More efficient than calling
 * getWeightAtDate repeatedly since it fetches the full window once.
 */
export async function getWeightsForDates(
  userId: string,
  dates: Date[],
): Promise<Map<string, WeightResult | null>> {
  if (dates.length === 0) return new Map();

  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];

  const windowStart = new Date(minDate.getTime() - 40 * 86400000);
  const windowEnd = new Date(maxDate.getTime() + 40 * 86400000);

  const metrics = await prisma.bodyMetric.findMany({
    where: {
      userId,
      recordedAt: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, weightKg: true },
  });

  const result = new Map<string, WeightResult | null>();

  for (const date of dates) {
    result.set(date.toISOString().split("T")[0], lookupWeight(metrics, date));
  }

  return result;
}

/** Pure-function weight lookup (no DB call) — used by batch variant */
function lookupWeight(
  metrics: { recordedAt: Date; weightKg: number }[],
  date: Date,
): WeightResult | null {
  if (metrics.length === 0) return null;

  const dateStr = date.toISOString().split("T")[0];
  const targetTime = date.getTime();

  // Exact match
  const exact = metrics.find(
    (m) => m.recordedAt.toISOString().split("T")[0] === dateStr,
  );
  if (exact) {
    return { weightKg: exact.weightKg, source: "exact", gapDays: 0 };
  }

  // Nearest ±14 days
  let bestNearest: (typeof metrics)[0] | null = null;
  let bestGap = Infinity;
  for (const m of metrics) {
    const gap = Math.abs(m.recordedAt.getTime() - targetTime) / 86400000;
    if (gap > 14) continue;
    const isBetter =
      gap < bestGap ||
      (gap === bestGap &&
        m.recordedAt.getTime() < targetTime &&
        bestNearest &&
        bestNearest.recordedAt.getTime() > targetTime);
    if (isBetter || gap < bestGap) {
      bestGap = gap;
      bestNearest = m;
    }
  }
  if (bestNearest) {
    return {
      weightKg: bestNearest.weightKg,
      source: "nearest",
      gapDays: Math.round(bestGap),
    };
  }

  // Interpolation
  const before = metrics
    .filter((m) => m.recordedAt.getTime() < targetTime)
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0];
  const after = metrics
    .filter((m) => m.recordedAt.getTime() > targetTime)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())[0];

  if (before && after) {
    const totalSpan =
      (after.recordedAt.getTime() - before.recordedAt.getTime()) / 86400000;
    const fraction =
      (targetTime - before.recordedAt.getTime()) / 86400000 / totalSpan;
    const interpolated =
      before.weightKg + (after.weightKg - before.weightKg) * fraction;
    return {
      weightKg: Math.round(interpolated * 10) / 10,
      source: "interpolated",
      gapDays: Math.round(
        Math.min(
          Math.abs(before.recordedAt.getTime() - targetTime),
          Math.abs(after.recordedAt.getTime() - targetTime),
        ) / 86400000,
      ),
    };
  }

  // Edge carry ≤30 days
  const closest = metrics.reduce(
    (best, m) => {
      const gap = Math.abs(m.recordedAt.getTime() - targetTime) / 86400000;
      return gap < best.gap ? { metric: m, gap } : best;
    },
    { metric: metrics[0], gap: Infinity },
  );

  if (closest.gap <= 30) {
    return {
      weightKg: closest.metric.weightKg,
      source: "carry",
      gapDays: Math.round(closest.gap),
    };
  }

  return null;
}
