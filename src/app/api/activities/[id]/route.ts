import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const log = await prisma.trainingLog.findUnique({
    where: { id: params.id, userId: session.user.id },
  });
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get("neighbors") === "true" || url.searchParams.get("neighbors") === "full") {
    const wantFull = url.searchParams.get("neighbors") === "full";
    const neighborSelect = wantFull
      ? undefined // full object
      : { id: true };
    const [prev, next] = await Promise.all([
      prisma.trainingLog.findFirst({
        where: { userId: session.user.id, mergedIntoId: null, startDate: { lt: log.startDate } },
        orderBy: { startDate: "desc" },
        select: neighborSelect,
      }),
      prisma.trainingLog.findFirst({
        where: { userId: session.user.id, mergedIntoId: null, startDate: { gt: log.startDate } },
        orderBy: { startDate: "asc" },
        select: neighborSelect,
      }),
    ]);
    if (wantFull) {
      return NextResponse.json({ log, prev: prev || null, next: next || null });
    }
    return NextResponse.json({ log, prevId: prev?.id || null, nextId: next?.id || null });
  }

  return NextResponse.json(log);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = z.object({
    remarks: z.string().nullable(),
    isRace: z.boolean().optional(),
  }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const updateData: Record<string, unknown> = { remarks: parsed.data.remarks };
  if (parsed.data.isRace !== undefined) {
    updateData.isRace = parsed.data.isRace;
  }

  const log = await prisma.trainingLog.update({
    where: { id: params.id, userId: session.user.id },
    data: updateData,
  });

  return NextResponse.json(log);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const log = await prisma.trainingLog.findUnique({
    where: { id: params.id, userId: session.user.id },
  });
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.trainingLog.delete({
    where: { id: params.id, userId: session.user.id },
  });

  // Re-snapshot the affected week after deletion
  await snapshotWeek(session.user.id, getWeekStart(log.startDate)).catch(() => {});

  return NextResponse.json({ success: true });
}
