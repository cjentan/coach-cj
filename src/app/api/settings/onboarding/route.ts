import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { onboardingCompleted: true },
  });

  return NextResponse.json({
    onboardingCompleted: user?.onboardingCompleted ?? false,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const createDefaultFacility = body?.createDefaultFacility === true;

  // Update the user
  await prisma.user.update({
    where: { id: session.user.id },
    data: { onboardingCompleted: true },
  });

  // Optionally create a default Road Running facility
  if (createDefaultFacility) {
    const existing = await prisma.trainingFacility.findFirst({
      where: { userId: session.user.id, name: "Road Running" },
    });

    if (!existing) {
      await prisma.trainingFacility.create({
        data: {
          userId: session.user.id,
          name: "Road Running",
          type: "road",
        },
      });
    }
  }

  return NextResponse.json({ success: true });
}
