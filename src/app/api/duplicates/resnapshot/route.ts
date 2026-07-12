import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";

/**
 * POST /api/duplicates/resnapshot
 *
 * Re-snapshot only the weeks affected by resolved duplicate groups.
 * This is more efficient than a full backfill since it only processes
 * the weeks that actually had duplicate resolutions.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find all resolved duplicate groups for this user
    const resolvedGroups = await prisma.duplicateGroup.findMany({
      where: {
        userId: session.user.id,
        status: { in: ["resolved_merged", "resolved_keep_both"] },
      },
      select: {
        id: true,
        status: true,
        trainingLogs: {
          select: { startDate: true },
        },
      },
    });

    if (resolvedGroups.length === 0) {
      return NextResponse.json({
        weeksSnapshotted: 0,
        message: "No resolved duplicate groups found. Nothing to re-snapshot.",
      });
    }

    // Collect unique week starts from all activities in resolved groups
    const weekStarts = new Set<string>();
    for (const group of resolvedGroups) {
      for (const log of group.trainingLogs) {
        weekStarts.add(getWeekStart(log.startDate).toISOString());
      }
    }

    // Snapshot each affected week
    const weekStartDates = Array.from(weekStarts)
      .map((iso) => new Date(iso))
      .sort((a, b) => a.getTime() - b.getTime());

    let weeksSnapshotted = 0;
    for (const weekStart of weekStartDates) {
      await snapshotWeek(session.user.id, weekStart);
      weeksSnapshotted++;
    }

    return NextResponse.json({
      weeksSnapshotted,
      groupsFound: resolvedGroups.length,
      message: `Re-snapshotted ${weeksSnapshotted} week(s) across ${resolvedGroups.length} resolved duplicate group(s).`,
    });
  } catch (err) {
    console.error("Re-snapshot error:", err);
    return NextResponse.json({
      error: `Re-snapshot failed: ${(err as Error).message}`,
    }, { status: 500 });
  }
}
