import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";

/** POST — snapshot the current week (or backfill all weeks) */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const backfill = url.searchParams.get("backfill") === "true";

  if (backfill) {
    // Find the earliest training log for this user
    const firstLog = await prisma.trainingLog.findFirst({
      where: { userId: session.user.id },
      orderBy: { startDate: "asc" },
      select: { startDate: true },
    });

    if (!firstLog) {
      return NextResponse.json({ weeksSnapshotted: 0, message: "No training logs found" });
    }

    // Iterate every week from first log to now
    const firstWeek = getWeekStart(firstLog.startDate);
    const thisWeek = getWeekStart(new Date());
    let weeksSnapshotted = 0;

    const cursor = new Date(firstWeek);
    while (cursor <= thisWeek) {
      await snapshotWeek(session.user.id, new Date(cursor));
      weeksSnapshotted++;
      cursor.setDate(cursor.getDate() + 7);
    }

    return NextResponse.json({ weeksSnapshotted });
  }

  // Single week snapshot (current week)
  const weekStart = getWeekStart(new Date());
  await snapshotWeek(session.user.id, weekStart);

  // Return the newly created snapshot
  const snapshot = await prisma.weeklyAssessment.findUnique({
    where: {
      userId_weekStartDate: {
        userId: session.user.id,
        weekStartDate: weekStart,
      },
    },
  });

  return NextResponse.json({ weekStart: weekStart.toISOString(), snapshot });
}
