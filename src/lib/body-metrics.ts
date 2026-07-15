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
