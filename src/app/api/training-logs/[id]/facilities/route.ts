import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const setFacilitiesSchema = z.object({
  facilityIds: z.array(z.string().uuid()),
});

/**
 * GET /api/training-logs/:id/facilities
 *
 * List facilities tagged on this activity.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const log = await prisma.trainingLog.findUnique({
    where: { id: params.id, userId: session.user.id },
  });
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const facilities = await prisma.trainingLogFacility.findMany({
    where: { trainingLogId: params.id },
    include: { facility: true },
    orderBy: { assignedAt: "desc" },
  });

  return NextResponse.json(facilities.map((f) => f.facility));
}

/**
 * PUT /api/training-logs/:id/facilities
 *
 * Replace all facility tags on this activity.
 * Body: { facilityIds: ["uuid1", "uuid2", ...] }
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const log = await prisma.trainingLog.findUnique({
    where: { id: params.id, userId: session.user.id },
  });
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const parsed = setFacilitiesSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  // Verify all facility IDs belong to the user
  const facilities = await prisma.trainingFacility.findMany({
    where: { id: { in: parsed.data.facilityIds }, userId: session.user.id },
    select: { id: true },
  });
  const validIds = new Set(facilities.map((f) => f.id));

  // Filter out invalid facility IDs
  const validFacilityIds = parsed.data.facilityIds.filter((id) => validIds.has(id));

  // Replace all tags in a transaction
  await prisma.$transaction([
    prisma.trainingLogFacility.deleteMany({ where: { trainingLogId: params.id } }),
    ...validFacilityIds.map((facilityId) =>
      prisma.trainingLogFacility.create({
        data: { trainingLogId: params.id, facilityId },
      }),
    ),
  ]);

  // Return updated facilities
  const updated = await prisma.trainingLogFacility.findMany({
    where: { trainingLogId: params.id },
    include: { facility: true },
    orderBy: { assignedAt: "desc" },
  });

  return NextResponse.json(updated.map((f) => f.facility));
}
