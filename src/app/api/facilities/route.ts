import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const facilitySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["road", "trail", "track", "trainer", "pool", "gym"]),
  distanceMeters: z.number().nullable().optional(),
  elevationGainMeters: z.number().nullable().optional(),
  surface: z.enum(["tarmac", "gravel", "trail", "track", "treadmill", "trainer"]).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const facilities = await prisma.trainingFacility.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(facilities);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = facilitySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const facility = await prisma.trainingFacility.create({
    data: { ...parsed.data, userId: session.user.id },
  });
  return NextResponse.json(facility, { status: 201 });
}
