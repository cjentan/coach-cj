/**
 * Activity analysis queue — schedules per-activity Coach Analysis jobs
 * based on a batch-size heuristic.
 *
 * Small batches (regular sync, ≤ 5 activities) → enqueue immediately.
 * Large batches (first-time import, > 5) → skip; user triggers on-demand.
 */
import { Queue } from "bullmq";
import { getRedisConnection } from "./redis";

const BATCH_THRESHOLD = 5;
const QUEUE_NAME = "activity-analysis";

const connection = getRedisConnection();

export const analysisQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Decide whether to enqueue analysis for a batch of newly imported activities.
 *
 * @param activityIds — IDs of newly created activities to potentially analyze
 * @param userId — owner
 * @param totalBatchSize — total number of new activities in this import session
 */
export async function scheduleBatchAnalysis(
  activityIds: string[],
  userId: string,
  totalBatchSize: number
): Promise<void> {
  if (totalBatchSize > BATCH_THRESHOLD) {
    console.log(
      `[analysis-queue] Large batch (${totalBatchSize}), skipping auto-analysis for ${activityIds.length} activities`
    );
    return;
  }

  if (activityIds.length === 0) return;

  console.log(
    `[analysis-queue] Enqueuing analysis for ${activityIds.length} activities (batch size ${totalBatchSize})`
  );

  // Set status to pending so the frontend can show a queued state
  const { prisma } = await import("./prisma");
  await prisma.trainingLog.updateMany({
    where: { id: { in: activityIds } },
    data: { analysisStatus: "pending" },
  });

  // Enqueue one job per activity
  for (const activityId of activityIds) {
    await analysisQueue.add("analyze", { activityId, userId });
  }
}

/**
 * Enqueue a single activity for analysis (used for manual triggers).
 */
export async function scheduleActivityAnalysis(
  activityId: string,
  userId: string
): Promise<void> {
  const { prisma } = await import("./prisma");
  await prisma.trainingLog.update({
    where: { id: activityId },
    data: { analysisStatus: "pending" },
  });

  await analysisQueue.add("analyze", { activityId, userId });
}
