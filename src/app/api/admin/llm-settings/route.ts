import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { getAdminLlmDefault, saveAdminLlmDefault, type AdminLlmDefault } from "@/lib/llm-defaults";
import { PROVIDER_BASE_URLS } from "@/lib/llm-providers";

const saveSchema = z.object({
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(4096).optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const d = await getAdminLlmDefault();
  // Never return the raw API key — only whether one is set.
  return NextResponse.json({
    provider: d.provider,
    model: d.model,
    baseUrl: d.baseUrl || PROVIDER_BASE_URLS[d.provider] || "",
    hasApiKey: !!d.apiKey,
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

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid body" }, { status: 400 });
  }

  // Key semantics: omitted = keep, "" = clear, non-empty = set.
  const values: Partial<AdminLlmDefault> = {};
  if (parsed.data.provider !== undefined) values.provider = parsed.data.provider;
  if (parsed.data.model !== undefined) values.model = parsed.data.model;
  if (parsed.data.baseUrl !== undefined) values.baseUrl = parsed.data.baseUrl;
  if (parsed.data.apiKey !== undefined) values.apiKey = parsed.data.apiKey;

  // A key with no provider would be ignored by getDefaultLlmConfig — reject it.
  const resolvedProvider = parsed.data.provider ?? (await getAdminLlmDefault()).provider;
  if (parsed.data.apiKey && !resolvedProvider) {
    return NextResponse.json({ error: "API key requires a provider" }, { status: 400 });
  }

  await saveAdminLlmDefault(values);
  return NextResponse.json({ success: true });
}
