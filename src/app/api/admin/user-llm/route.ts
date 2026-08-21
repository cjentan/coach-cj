import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { PROVIDER_BASE_URLS } from "@/lib/llm-providers";

const updateSchema = z.object({
  userId: z.string().min(1),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(4096).optional(),
});

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const skip = Math.max(0, parseInt(searchParams.get("skip") || "0"));
  const take = Math.min(100, Math.max(1, parseInt(searchParams.get("take") || "50")));
  const q = (searchParams.get("q") || "").trim();

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        email: true,
        name: true,
        llmProvider: true,
        llmModel: true,
        llmBaseUrl: true,
        llmApiKey: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  // Never return the raw API key — only whether one is set.
  return NextResponse.json({
    total,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      provider: u.llmProvider || "",
      model: u.llmModel || "",
      baseUrl: u.llmBaseUrl || "",
      hasKey: !!u.llmApiKey,
    })),
  });
}

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid body" },
      { status: 400 }
    );
  }

  const exists = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const data: Record<string, string> = {};

  // Provider change auto-fills the base URL from the provider map (unless an
  // explicit baseUrl was given) — mirrors src/app/api/settings/llm/route.ts.
  if (parsed.data.provider !== undefined) {
    data.llmProvider = parsed.data.provider;
    data.llmBaseUrl =
      parsed.data.baseUrl !== undefined
        ? parsed.data.baseUrl
        : PROVIDER_BASE_URLS[parsed.data.provider] || "";
  } else if (parsed.data.baseUrl !== undefined) {
    data.llmBaseUrl = parsed.data.baseUrl;
  }

  if (parsed.data.model !== undefined) data.llmModel = parsed.data.model;
  // Key semantics: omitted = keep, "" = clear, non-empty = set.
  if (parsed.data.apiKey !== undefined) data.llmApiKey = parsed.data.apiKey;

  await prisma.user.update({
    where: { id: parsed.data.userId },
    data,
  });

  return NextResponse.json({ success: true });
}
