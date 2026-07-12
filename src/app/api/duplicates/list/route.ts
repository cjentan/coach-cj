import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/duplicates/list
 *
 * List all pending duplicate groups for the current user.
 *
 * Query params:
 *   status=pending|resolved_merged|resolved_keep_both (default: pending)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "pending";

  try {
    const groups = await prisma.duplicateGroup.findMany({
      where: {
        userId: session.user.id,
        status: status as "pending" | "resolved_merged" | "resolved_keep_both",
        // Only include groups that actually have training logs
        trainingLogs: { some: {} },
      },
      orderBy: { createdAt: "desc" },
      include: {
        trainingLogs: {
          select: {
            id: true,
            source: true,
            type: true,
            name: true,
            startDate: true,
            durationSeconds: true,
            distanceMeters: true,
            elevationGainMeters: true,
            averageHr: true,
            maxHr: true,
            tss: true,
            remarks: true,
            mergedIntoId: true,
            duplicateStatus: true,
          },
          orderBy: { startDate: "desc" },
        },
      },
    });

    return NextResponse.json({ groups });
  } catch (err) {
    console.error("Error listing duplicate groups:", err);
    return NextResponse.json({
      error: `Failed to list duplicates: ${(err as Error).message}`,
    }, { status: 500 });
  }
}
