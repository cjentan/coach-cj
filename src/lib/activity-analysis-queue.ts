/**
 * Activity analysis queue — schedules per-activity Coach Analysis jobs
 * based on a batch-size heuristic.
 *
 * Small batches (regular sync, ≤ 5 activities) → enqueue immediately.
 * Large batches (first-time import, > 5) → skip; user triggers on-demand.
 */
import { Queue } from "bullmq";
import { redisConnection as connection } from "./redis-connection";

const BATCH_THRESHOLD = 5;
const QUEUE_NAME = "activity-analysis";

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
    // Reset status to null so the frontend shows "No coach analysis yet"
    // rather than a misleading stuck "pending" state
    const { prisma } = await import("./prisma");
    await prisma.trainingLog.updateMany({
      where: { id: { in: activityIds } },
      data: { analysisStatus: null },
    });
    return;
  }

  if (activityIds.length === 0) return;

  const { prisma } = await import("./prisma");

  // Filter out already-completed activities
  const existingActivities = await prisma.trainingLog.findMany({
    where: { id: { in: activityIds } },
    select: { id: true, analysisStatus: true },
  });
  const pendingIds = existingActivities
    .filter((a) => a.analysisStatus !== "completed")
    .map((a) => a.id);

  if (pendingIds.length === 0) return;

  console.log(
    `[analysis-queue] Enqueuing analysis for ${pendingIds.length} activities (batch size ${totalBatchSize})`
  );

  // Set status to pending so the frontend can show a queued state
  await prisma.trainingLog.updateMany({
    where: { id: { in: pendingIds } },
    data: { analysisStatus: "pending" },
  });

  // Enqueue one job per activity
  for (const activityId of pendingIds) {
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

  const existing = await prisma.trainingLog.findUnique({
    where: { id: activityId },
    select: { analysisStatus: true },
  });
  if (!existing || existing.analysisStatus === "completed") return;

  await prisma.trainingLog.update({
    where: { id: activityId },
    data: { analysisStatus: "pending" },
  });

  await analysisQueue.add("analyze", { activityId, userId });
}
