/**
 * Shared Redis connection configuration for BullMQ queues and workers.
 *
 * Both entrypoint.ts and activity-analysis-queue.ts import this singleton
 * so that BullMQ Queue and Worker instances share a single connection config,
 * avoiding unnecessary separate connections.
 */
import { getRedisConnection } from "./redis";
export const redisConnection = getRedisConnection();
