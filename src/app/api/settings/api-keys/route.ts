/**
 * API key management — CRUD for personal API keys.
 * All endpoints require session auth (NextAuth JWT).
 *
 * GET    /api/settings/api-keys           — list keys (never exposes raw key)
 * POST   /api/settings/api-keys           — create a new key (raw key returned ONCE)
 * DELETE /api/settings/api-keys?id=<id>   — revoke a key
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/api-keys";

// ── List keys ──────────────────────────────────────────────
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ keys });
}

// ── Create key ─────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let name: string;
  try {
    const body = await req.json();
    name = (body.name || "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!name) {
    return NextResponse.json({ error: "Provide a name for the key (e.g. 'Watch Push', 'Zapier')" }, { status: 400 });
  }

  if (name.length > 100) {
    return NextResponse.json({ error: "Name must be 100 characters or fewer" }, { status: 400 });
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey();

  const key = await prisma.apiKey.create({
    data: {
      userId: session.user.id,
      name,
      keyHash,
      keyPrefix,
    },
  });

  return NextResponse.json({
    key: {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      createdAt: key.createdAt,
    },
    rawKey, // ← Only returned here — the user must copy it now
    message: "Copy this key now — it won't be shown again.",
  }, { status: 201 });
}

// ── Revoke key ─────────────────────────────────────────────
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Provide ?id=<key-id> to revoke" }, { status: 400 });
  }

  // Ensure the key belongs to this user
  const key = await prisma.apiKey.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!key) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  await prisma.apiKey.delete({ where: { id } });

  return NextResponse.json({ success: true, message: `Key "${key.name}" revoked` });
}
