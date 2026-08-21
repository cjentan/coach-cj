import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMaxHrInfo } from "@/lib/body-metrics";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Full picture for the settings UI: the value currently in effect, why, and
  // both the user-set and data-estimated candidates.
  const info = await getMaxHrInfo(session.user.id);
  return NextResponse.json(info);
}

const maxHrSchema = z.object({
  // null clears the user-set value (falling back to estimate / default).
  maxHr: z.number().int().min(30).max(220).nullable(),
});

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = maxHrSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "maxHr must be an integer between 30 and 220" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { maxHr: parsed.data.maxHr },
  });

  return NextResponse.json(await getMaxHrInfo(session.user.id));
}
