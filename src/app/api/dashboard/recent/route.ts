import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const weekStart = getWeekStart(new Date());

  const logs = await prisma.trainingLog.findMany({
    where: { userId: session.user.id, startDate: { gte: weekStart } },
    orderBy: { startDate: "desc" },
    select: {
      id: true, name: true, type: true, startDate: true,
      distanceMeters: true, durationSeconds: true,
      elevationGainMeters: true, averageHr: true,
      tss: true, remarks: true,
    },
  });

  return NextResponse.json(logs);
}
