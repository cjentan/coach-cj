import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveDuplicateGroup, dismissDuplicateGroup } from "@/lib/duplicate-detector";
import { prisma } from "@/lib/prisma";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";

const resolveSchema = z.object({
  groupId: z.string().uuid(),
  keepActivityId: z.string().uuid(),
  resolution: z.string().optional(),
});

const dismissSchema = z.object({
  groupId: z.string().uuid(),
});

/**
 * POST /api/duplicates/resolve
 *
 * Resolve a duplicate group by merging one activity into another.
 *
 * Body (JSON):
 *   { groupId: "...", keepActivityId: "...", resolution?: "..." }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Check if this is a dismiss action
    if (body.action === "dismiss") {
      const parsed = dismissSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
      }
      await dismissDuplicateGroup(parsed.data.groupId, session.user.id);
      return NextResponse.json({ success: true, action: "dismissed" });
    }

    // Otherwise it's a merge
    const parsed = resolveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    await resolveDuplicateGroup({
      groupId: parsed.data.groupId,
      userId: session.user.id,
      keepActivityId: parsed.data.keepActivityId,
      resolution: parsed.data.resolution,
    });

    // Refresh weekly snapshots for the kept activity's week
    const keptActivity = await prisma.trainingLog.findUnique({
      where: { id: parsed.data.keepActivityId },
      select: { startDate: true },
    });
    if (keptActivity) {
      await snapshotWeek(session.user.id, getWeekStart(keptActivity.startDate)).catch(() => {});
    }

    return NextResponse.json({ success: true, action: "merged" });
  } catch (err) {
    console.error("Duplicate resolution error:", err);
    return NextResponse.json({
      error: `Resolution failed: ${(err as Error).message}`,
    }, { status: 500 });
  }
}
