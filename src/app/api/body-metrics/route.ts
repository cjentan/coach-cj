import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const metricSchema = z.object({
  recordedAt: z.string().transform((s) => new Date(s)),
  weightKg: z.number().positive(),
  heightCm: z.number().positive().nullable().optional(),
  restingHr: z.number().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const metrics = await prisma.bodyMetric.findMany({
    where: { userId: session.user.id },
    orderBy: { recordedAt: "desc" },
    take: 90,
  });
  return NextResponse.json(metrics);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = metricSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const metric = await prisma.bodyMetric.create({
    data: { ...parsed.data, userId: session.user.id },
  });
  return NextResponse.json(metric, { status: 201 });
}
