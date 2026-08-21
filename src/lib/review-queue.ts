import { Queue } from "bullmq";
import { redisConnection } from "./redis-connection";
import { getWeekStart } from "./utils";

/**
 * Shared BullMQ queue + helpers for the weekly-review ("sunday-review") flow.
 *
 * Both the in-worker scheduler (src/workers/entrypoint.ts) and the admin
 * manual-trigger route (src/app/api/admin/run-analysis/route.ts) produce
 * review jobs through this module.
 *
 * NOTE: dedup is NOT done at enqueue time via BullMQ jobId. It is done in the
 * sunday worker: a user's target-week plan only gets a non-empty `coachNotes`
 * after their review's LLM analysis *succeeds* (see entrypoint.ts), so that
 * marker is the dedup that registers only after the review passes — letting a
 * failed review be retried.
 */

export const REVIEW_QUEUE = "sunday-review";

// Singleton Queue, matching the activity-analysis-queue.ts pattern, so the API
// route and the worker share one connection config without opening a new
// Redis connection per producer.
export const sundayQueue = new Queue(REVIEW_QUEUE, { connection: redisConnection });

/**
 * The Monday that an upcoming review targets (i.e. the week being planned).
 * Mirrors the computations in the sunday worker and scheduler.
 */
export function nextReviewWeekStart(now = new Date()): Date {
  const weekStart = getWeekStart(now);
  weekStart.setDate(weekStart.getDate() + 7);
  return weekStart;
}
