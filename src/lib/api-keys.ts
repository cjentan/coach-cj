/**
 * API key generation, hashing, and verification.
 *
 * Keys follow the format: coach_<32 random hex chars>
 * Only the SHA-256 hash is stored in the database.
 * The raw key is returned once at creation time.
 */
import crypto from "crypto";
import { prisma } from "./prisma";

const KEY_PREFIX = "coach_";
const RANDOM_BYTES = 16; // → 32 hex chars

export interface GeneratedKey {
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
}

/** Generate a new API key. The raw key is only returned here. */
export function generateApiKey(): GeneratedKey {
  const randomPart = crypto.randomBytes(RANDOM_BYTES).toString("hex");
  const rawKey = `${KEY_PREFIX}${randomPart}`;
  const keyHash = hashApiKey(rawKey);
  // First 8 chars after the prefix for display in the UI
  const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + 8);
  return { rawKey, keyHash, keyPrefix };
}

/** Hash a raw API key with SHA-256. */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Verify a raw API key against the database.
 * Returns the owning userId if valid, null if invalid or revoked.
 * Updates lastUsedAt on successful verification.
 */
export async function verifyApiKey(rawKey: string): Promise<string | null> {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashApiKey(rawKey);

  try {
    const key = await prisma.apiKey.findFirst({
      where: { keyHash },
      select: { id: true, userId: true },
    });

    if (!key) return null;

    // Update lastUsedAt asynchronously — don't block the response
    prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return key.userId;
  } catch {
    return null;
  }
}
