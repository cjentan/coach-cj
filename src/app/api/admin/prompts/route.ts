import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ANALYZE_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  PROMPT_KEYS,
  clearPromptCache,
} from "@/lib/coach-prompts";

async function checkAdmin(session: { user?: { id?: string } } | null) {
  if (!session?.user?.id) return false;
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  return user?.role === "admin";
}

export async function GET() {
  const session = await auth();
  if (!(await checkAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load any overrides from DB
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: Object.values(PROMPT_KEYS) } },
  });
  const overrides = new Map(settings.map((s) => [s.key, s.value]));

  return NextResponse.json({
    prompts: [
      {
        key: PROMPT_KEYS.ANALYZE,
        label: "Analysis Prompt",
        description: "Used when the athlete clicks Analyze. Returns JSON with analysis + suggestions.",
        default: ANALYZE_SYSTEM_PROMPT,
        current: overrides.get(PROMPT_KEYS.ANALYZE) ?? ANALYZE_SYSTEM_PROMPT,
      },
      {
        key: PROMPT_KEYS.CHAT,
        label: "Chat Prompt",
        description: "System prompt for conversational follow-ups. Describes available tools.",
        default: CHAT_SYSTEM_PROMPT,
        current: overrides.get(PROMPT_KEYS.CHAT) ?? CHAT_SYSTEM_PROMPT,
      },
      {
        key: PROMPT_KEYS.SUMMARIZE,
        label: "Summarize Prompt",
        description: "Used to condense a conversation into a coach's note.",
        default: SUMMARIZE_SYSTEM_PROMPT,
        current: overrides.get(PROMPT_KEYS.SUMMARIZE) ?? SUMMARIZE_SYSTEM_PROMPT,
      },
    ],
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!(await checkAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { key, value } = body;

  if (!key || typeof value !== "string") {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }

  if (!Object.values(PROMPT_KEYS).includes(key)) {
    return NextResponse.json({ error: `Unknown prompt key: ${key}` }, { status: 400 });
  }

  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });

  // Clear the in-memory cache so the next LLM call picks up the new prompt
  clearPromptCache(key);

  return NextResponse.json({ success: true, key });
}
