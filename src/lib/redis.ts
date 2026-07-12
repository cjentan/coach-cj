import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Parse Redis URL into connection options for BullMQ compatibility
export function getRedisConnection() {
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname || "localhost",
    port: parseInt(url.port || "6379"),
    password: url.password || undefined,
  };
}

// Singleton Redis client for direct use (not BullMQ)
const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis(REDIS_URL, { maxRetriesPerRequest: null });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
