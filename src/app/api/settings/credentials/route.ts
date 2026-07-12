import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const KEYS = ["public_url"] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.appSetting.findMany({
    where: { key: { in: [...KEYS] } },
  });

  const result: Record<string, string> = {};
  for (const k of KEYS) {
    result[k] = settings.find((s) => s.key === k)?.value || "";
  }

  return NextResponse.json(result);
}

const saveSchema = z.object({
  public_url: z.string().optional(),
});

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
  }

  return NextResponse.json({ success: true });
}
