import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const goalSchema = z.object({
  name: z.string().min(1),
  raceType: z.string().min(1),
  targetDate: z.string().transform((s) => new Date(s)),
  distanceMeters: z.number().positive(),
  elevationGainMeters: z.number().nullable().optional(),
  targetTimeSeconds: z.number().int().positive().nullable().optional(),
  priority: z.enum(["A", "B", "C"]).optional(),
  notes: z.string().nullable().optional(),
  goalStatement: z.string().nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const goals = await prisma.raceGoal.findMany({
    where: { userId: session.user.id },
    orderBy: [{ status: "asc" }, { targetDate: "asc" }],
  });

  return NextResponse.json(goals);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = goalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const goal = await prisma.raceGoal.create({
    data: { ...parsed.data, userId: session.user.id },
  });

  return NextResponse.json(goal, { status: 201 });
}
