/**
 * Duplicate detection for training activities.
 *
 * Detects potential duplicate activities across different sources
 * (e.g. the same run synced from Strava AND pushed from a watch).
 *
 * Strategy:
 *   1. Find activities from the same user that start within a
 *      configurable time window (default: 4 hours).
 *   2. Score pairs by proximity of start time, duration, and distance.
 *   3. Group strongly matching pairs into duplicate groups.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// ─── Helpers for the lightweight fetch ────────────────────────

interface ActivityRow {
  id: string;
  source: string;
  type: string;
  name: string;
  start_date: Date;
  duration_seconds: number;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  remarks: string | null;
  has_rich_data: boolean;
}

/**
 * Fetch activities for duplicate detection WITHOUT loading the massive
 * raw_json blobs.  Instead we ask Postgres to tell us whether the JSONB
 * contains a top-level "trackPoints" key — a tiny boolean per row.
 *
 * This prevents OOM kills caused by loading megabytes of GPS data
 * per activity (some raw_json entries are >10 MB).
 */
async function fetchActivitiesForDetection(
  userId: string,
  limit: number,
): Promise<
  Array<{
    id: string;
    source: string;
    type: string;
    name: string;
    startDate: Date;
    durationSeconds: number;
    distanceMeters: number | null;
    elevationGainMeters: number | null;
    remarks: string | null;
    hasRichData: boolean;
  }>
> {
  const rows: ActivityRow[] = await prisma.$queryRaw`
    SELECT
      id,
      source::text,
      type::text,
      name,
      start_date,
      duration_seconds,
      distance_meters,
      elevation_gain_meters,
      remarks,
      raw_json IS NOT NULL AND raw_json ? 'trackPoints' AS has_rich_data
    FROM training_logs
    WHERE user_id = ${userId}
      AND merged_into_id IS NULL
      AND (duplicate_group_id IS NULL OR duplicate_status IS DISTINCT FROM CAST('pending' AS "DuplicateStatus"))
    ORDER BY start_date DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    type: r.type,
    name: r.name,
    startDate: r.start_date,
    durationSeconds: r.duration_seconds,
    distanceMeters: r.distance_meters,
    elevationGainMeters: r.elevation_gain_meters,
    remarks: r.remarks,
    hasRichData: r.has_rich_data,
  }));
}

// ─── Types ────────────────────────────────────────────────────

export interface DuplicateCandidate {
  /** Shared duplicate group ID (UUID) for all members */
  groupId: string;
  /** The activities in this group, sorted by source priority */
  activities: DuplicateActivity[];
  /** Detection score 0–100. Higher = more likely duplicate */
  score: number;
  /** Human-readable reason */
  reason: string;
}

export interface DuplicateActivity {
  id: string;
  source: string;
  type: string;
  name: string;
  startDate: Date;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  hasRichData: boolean;
  hasRemarks: boolean;
  /** Priority for keeping (lower = better) */
  priority: number;
}

export interface DuplicateDetectionConfig {
  /** Max time difference in ms (default: 4 hours) */
  timeWindowMs: number;
  /** Max duration ratio difference (default: 0.3 = ±30%) */
  maxDurationRatioDiff: number;
  /** Max distance ratio difference (default: 0.3 = ±30%) */
  maxDistanceRatioDiff: number;
  /** Minimum score to auto-group (default: 70) */
  autoGroupThreshold: number;
  /** Minimum score to suggest (default: 40) */
  suggestThreshold: number;
  /** Max activities to scan (default: 1000) */
  scanLimit: number;
}

const DEFAULT_CONFIG: DuplicateDetectionConfig = {
  timeWindowMs: 4 * 60 * 60 * 1000, // 4 hours
  maxDurationRatioDiff: 0.3,
  maxDistanceRatioDiff: 0.3,
  autoGroupThreshold: 70,
  suggestThreshold: 40,
  scanLimit: 1000,
};

// ─── Source priorities (lower = "better" / preferred) ─────────
// When merging, the activity with the lowest priority wins.

const SOURCE_PRIORITY: Record<string, number> = {
  garmin: 0,    // Most detailed raw data from device
  watch_push: 1, // FIT/GPX from watch push
  strava: 2,    // Has Strava enrichment
  manual: 3,    // User-entered, possibly less accurate
};

// ─── Main detection logic ─────────────────────────────────────

export interface DetectionResult {
  groups: DuplicateCandidate[];
  stats: {
    scanned: number;
    candidates: number;
    groups: number;
  };
}

/**
 * Scan a user's activities for potential duplicates.
 */
export async function detectDuplicates(
  userId: string,
  config: Partial<DuplicateDetectionConfig> = {},
): Promise<DetectionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Fetch activities WITHOUT loading raw_json blobs (avoids OOM)
  const activities = await fetchActivitiesForDetection(userId, cfg.scanLimit);

  const stats = { scanned: activities.length, candidates: 0, groups: 0 };
  if (activities.length < 2) {
    return { groups: [], stats };
  }

  // Build pairs and score them
  const scoredPairs: Array<{
    aIdx: number;
    bIdx: number;
    score: number;
    reason: string;
  }> = [];

  for (let i = 0; i < activities.length; i++) {
    for (let j = i + 1; j < activities.length; j++) {
      const a = activities[i];
      const b = activities[j];

      const result = scorePair(a, b, cfg);
      if (result && result.score >= cfg.suggestThreshold) {
        scoredPairs.push({ aIdx: i, bIdx: j, ...result });
      }
    }
  }

  stats.candidates = scoredPairs.length;

  // Group overlapping pairs into clusters (union-find)
  const parent = Array.from({ length: activities.length }, (_, k) => k);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(x: number, y: number) {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[ry] = rx;
  }

  for (const pair of scoredPairs) {
    if (pair.score >= cfg.autoGroupThreshold) {
      union(pair.aIdx, pair.bIdx);
    }
  }

  // Build clusters from union-find roots
  const clusters = new Map<number, { indices: Set<number>; maxScore: number }>();
  for (const pair of scoredPairs) {
    const root = find(pair.aIdx);
    if (!clusters.has(root)) {
      clusters.set(root, { indices: new Set(), maxScore: 0 });
    }
    const cluster = clusters.get(root)!;
    cluster.indices.add(pair.aIdx);
    cluster.indices.add(pair.bIdx);
    cluster.maxScore = Math.max(cluster.maxScore, pair.score);
  }

  // Also add singletons that scored above threshold but weren't auto-grouped
  // (they become suggestion-only groups)
  for (const pair of scoredPairs) {
    if (pair.score < cfg.autoGroupThreshold) {
      const rootA = find(pair.aIdx);
      const rootB = find(pair.bIdx);

      // Only create a new cluster if these aren't already in an auto-grouped cluster
      const inExistingCluster = (idx: number) => {
        return Array.from(clusters.values()).some((cluster) => cluster.indices.has(idx));
      };

      if (!inExistingCluster(pair.aIdx) && !inExistingCluster(pair.bIdx)) {
        const newRoot = pair.aIdx;
        if (!clusters.has(newRoot)) {
          clusters.set(newRoot, { indices: new Set([pair.aIdx, pair.bIdx]), maxScore: pair.score });
        }
      }
    }
  }

  // Convert clusters to DuplicateCandidate[]
  const groups: DuplicateCandidate[] = [];
  Array.from(clusters.entries()).forEach(([, cluster]) => {
    if (cluster.indices.size < 2) return;

    const members = Array.from(cluster.indices).map((idx) => {
      const act = activities[idx];
      return {
        id: act.id,
        source: act.source,
        type: act.type,
        name: act.name,
        startDate: act.startDate,
        durationSeconds: act.durationSeconds,
        distanceMeters: act.distanceMeters,
        elevationGainMeters: act.elevationGainMeters,
        hasRichData: act.hasRichData,
        hasRemarks: act.remarks !== null && act.remarks !== "",
        priority: SOURCE_PRIORITY[act.source] ?? 99,
      };
    });

    // Sort by priority (best first), then by date (newest first), then by rich data
    members.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.startDate.getTime() - a.startDate.getTime();
    });

    // Determine reason
    const sources = Array.from(new Set(members.map((m) => m.source))).join(" + ");
    const reason = getReasonText(members, cluster.maxScore);

    groups.push({
      groupId: "", // assigned when persisted
      activities: members,
      score: cluster.maxScore,
      reason,
    });
  });

  // Sort groups by score descending
  groups.sort((a, b) => b.score - a.score);
  stats.groups = groups.length;

  return { groups, stats };
}

// ─── Pair scoring ─────────────────────────────────────────────

interface ScoredResult {
  score: number;
  reason: string;
}

function scorePair(
  a: { startDate: Date; durationSeconds: number; distanceMeters: number | null; type: string; source: string },
  b: { startDate: Date; durationSeconds: number; distanceMeters: number | null; type: string; source: string },
  cfg: DuplicateDetectionConfig,
): ScoredResult | null {
  // Must be same activity type
  if (a.type !== b.type) return null;

  // Time window check
  const timeDiff = Math.abs(a.startDate.getTime() - b.startDate.getTime());
  if (timeDiff > cfg.timeWindowMs) return null;

  let totalScore = 0;
  const reasons: string[] = [];

  // 1. Time proximity (up to 40 points)
  const timeRatio = 1 - timeDiff / cfg.timeWindowMs;
  totalScore += timeRatio * 40;
  if (timeRatio > 0.9) {
    const mins = Math.round(timeDiff / 60000);
    reasons.push(`started ${mins === 0 ? "same minute" : `${mins}min apart`}`);
  }

  // 2. Duration similarity (up to 30 points)
  const durRatio = a.durationSeconds / Math.max(b.durationSeconds, 1);
  const durDiff = Math.abs(1 - durRatio);
  if (durDiff <= cfg.maxDurationRatioDiff) {
    const durScore = (1 - durDiff / cfg.maxDurationRatioDiff) * 30;
    totalScore += durScore;
    if (durScore > 20) {
      reasons.push(`duration ${Math.round(durDiff * 100)}% off`);
    }
  }

  // 3. Distance similarity (up to 30 points)
  if (a.distanceMeters != null && b.distanceMeters != null && a.distanceMeters > 0 && b.distanceMeters > 0) {
    const distRatio = a.distanceMeters / b.distanceMeters;
    const distDiff = Math.abs(1 - distRatio);
    if (distDiff <= cfg.maxDistanceRatioDiff) {
      const distScore = (1 - distDiff / cfg.maxDistanceRatioDiff) * 30;
      totalScore += distScore;
      if (distScore > 20) {
        reasons.push(`distance ${Math.round(distDiff * 100)}% off`);
      }
    }
  } else {
    // When distance is missing, distribute duration's weight to time
    totalScore += 15; // partial credit for same type + close time
  }

  // 4. Bonus: different sources (stronger duplicate signal, up to 10 bonus)
  if (a.source !== b.source) {
    totalScore += 10;
    reasons.push(`different sources (${a.source} + ${b.source})`);
  }

  return {
    score: Math.round(Math.min(totalScore, 100)),
    reason: reasons.join(", "),
  };
}

function getReasonText(activities: DuplicateActivity[], score: number): string {
  const sources = Array.from(new Set(activities.map((a) => a.source)));
  if (sources.length > 1) {
    return `Same activity from ${sources.join(" and ")}`;
  }
  if (activities.some((a) => a.hasRichData) && activities.some((a) => !a.hasRichData)) {
    return "One has GPS data, the other doesn't";
  }
  return `Very similar activities (score: ${score}/100)`;
}

// ─── Persisting duplicates ────────────────────────────────────

/**
 * Persist detected duplicate groups to the database.
 * Creates DuplicateGroup records and links TrainingLog entries.
 */
export async function persistDuplicateGroups(
  userId: string,
  groups: DuplicateCandidate[],
): Promise<number> {
  let created = 0;

  // Collect all activity IDs across all new groups
  const allActivityIds = groups.flatMap((g) => g.activities.map((a) => a.id));

  // Before creating new groups, delete any old pending groups whose activities
  // are being re-assigned, to prevent orphaned groups with 0 training logs.
  if (allActivityIds.length > 0) {
    const oldGroups = await prisma.duplicateGroup.findMany({
      where: {
        userId,
        status: "pending",
        trainingLogs: { some: { id: { in: allActivityIds } } },
      },
      select: { id: true },
    });

    if (oldGroups.length > 0) {
      const oldGroupIds = oldGroups.map((g) => g.id);
      // Clear the link on those activities first
      await prisma.trainingLog.updateMany({
        where: { duplicateGroupId: { in: oldGroupIds }, userId },
        data: { duplicateGroupId: null, duplicateStatus: null },
      });
      // Then delete the orphaned groups
      await prisma.duplicateGroup.deleteMany({
        where: { id: { in: oldGroupIds } },
      });
    }
  }

  for (const group of groups) {
    if (group.activities.length < 2) continue;

    const dbGroup = await prisma.duplicateGroup.create({
      data: {
        userId,
        status: "pending",
        keptActivityId: group.activities[0].id,
      },
    });

    // Update all activities in the group
    await prisma.trainingLog.updateMany({
      where: {
        id: { in: group.activities.map((a) => a.id) },
        userId,
      },
      data: {
        duplicateGroupId: dbGroup.id,
        duplicateStatus: "pending",
      },
    });

    created++;
  }

  return created;
}

// ─── Resolution ───────────────────────────────────────────────

export interface ResolveOptions {
  groupId: string;
  userId: string;
  /** ID of the activity to keep */
  keepActivityId: string;
  /** Optional resolution notes */
  resolution?: string;
}

/**
 * Resolve a duplicate group by keeping one activity and merging
 * metadata from the others, or marking them as duplicates.
 */
export async function resolveDuplicateGroup(
  options: ResolveOptions,
): Promise<void> {
  const { groupId, userId, keepActivityId, resolution } = options;

  // Get all activities in the group
  const members = await prisma.trainingLog.findMany({
    where: { duplicateGroupId: groupId, userId },
  });

  if (members.length === 0) {
    throw new Error("Duplicate group not found");
  }

  const keepActivity = members.find((m) => m.id === keepActivityId);
  if (!keepActivity) {
    throw new Error("Keep activity not found in this group");
  }

  const others = members.filter((m) => m.id !== keepActivityId);

  // Merge metadata from others into the kept activity
  // (remarks, description enrichment)
  let mergedRemarks = keepActivity.remarks;
  let mergedDescription = keepActivity.description as string | undefined | null;

  for (const other of others) {
    if (other.remarks && !mergedRemarks) {
      mergedRemarks = `${other.remarks}${mergedRemarks ? `\n---\n${mergedRemarks}` : ""}`;
    }
    if (other.description && !mergedDescription) {
      mergedDescription = other.description;
    }
    // Merge HR/Power data if the kept activity lacks it
    // (already handled at the activity level)
    if (!keepActivity.averageHr && other.averageHr) {
      await prisma.trainingLog.update({
        where: { id: keepActivity.id },
        data: {
          averageHr: other.averageHr,
          maxHr: !keepActivity.maxHr ? other.maxHr : undefined,
          averagePower: !keepActivity.averagePower ? other.averagePower : undefined,
          normalizedPower: !keepActivity.normalizedPower ? other.normalizedPower : undefined,
          calories: !keepActivity.calories ? other.calories : undefined,
        },
      });
    }
    // Merge rawJson (GPS data) if kept activity lacks trackpoints
    if (!keepActivity.rawJson && other.rawJson) {
      await prisma.trainingLog.update({
        where: { id: keepActivity.id },
        data: { rawJson: other.rawJson as Prisma.InputJsonValue },
      });
    }

    // Mark the other as merged into the kept one
    await prisma.trainingLog.update({
      where: { id: other.id },
      data: {
        mergedIntoId: keepActivity.id,
        duplicateStatus: "resolved_merged",
      },
    });
  }

  // Update remarks/description on kept activity
  const updateData: Record<string, unknown> = {};
  if (mergedRemarks !== keepActivity.remarks) updateData.remarks = mergedRemarks;
  if (mergedDescription !== keepActivity.description) updateData.description = mergedDescription;
  if (Object.keys(updateData).length > 0) {
    await prisma.trainingLog.update({
      where: { id: keepActivity.id },
      data: updateData as Prisma.TrainingLogUpdateInput,
    });
  }

  // Update the duplicate group
  await prisma.duplicateGroup.update({
    where: { id: groupId },
    data: {
      status: "resolved_merged",
      keptActivityId: keepActivity.id,
      mergedAt: new Date(),
      resolution: resolution || null,
    },
  });
}

/**
 * Mark a duplicate group as "keep both" (false positive).
 */
export async function dismissDuplicateGroup(
  groupId: string,
  userId: string,
): Promise<void> {
  await prisma.duplicateGroup.update({
    where: { id: groupId, userId },
    data: {
      status: "resolved_keep_both",
    },
  });

  await prisma.trainingLog.updateMany({
    where: { duplicateGroupId: groupId, userId },
    data: {
      duplicateStatus: "resolved_keep_both",
    },
  });
}
