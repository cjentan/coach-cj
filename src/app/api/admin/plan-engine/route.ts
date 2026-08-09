import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { PLAN_GENERATION_ENGINE_KEY, type PlanGenerationEngine } from "@/lib/plan-generation-engine";

const EngineSchema = z.object({
  engine: z.enum(["v1", "v2"]),
});

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await prisma.appSetting.findUnique({ where: { key: PLAN_GENERATION_ENGINE_KEY } });
  const engine: PlanGenerationEngine = row?.value === "v2" ? "v2" : "v1";

  return NextResponse.json({ engine });
}

export async function PUT(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = EngineSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "engine must be 'v1' or 'v2'" }, { status: 400 });
  }

  const { engine } = parsed.data;
  await prisma.appSetting.upsert({
    where: { key: PLAN_GENERATION_ENGINE_KEY },
    create: { key: PLAN_GENERATION_ENGINE_KEY, value: engine },
    update: { value: engine },
  });

  return NextResponse.json({ success: true, engine });
}
