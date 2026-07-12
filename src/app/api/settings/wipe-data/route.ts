import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // Delete all user data in dependency-safe order.
  // Prisma enforces referential integrity, so child tables first.
  await prisma.$transaction([
    prisma.trainingLog.deleteMany({ where: { userId } }),
    prisma.raceGoal.deleteMany({ where: { userId } }),
    prisma.trainingFacility.deleteMany({ where: { userId } }),
    prisma.bodyMetric.deleteMany({ where: { userId } }),
    prisma.trainingAvailability.deleteMany({ where: { userId } }),
    prisma.weeklyAssessment.deleteMany({ where: { userId } }),
    prisma.weeklyPlan.deleteMany({ where: { userId } }),
    prisma.fatigueAlert.deleteMany({ where: { userId } }),
  ]);

  return NextResponse.json({ success: true });
}
