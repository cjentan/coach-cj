import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const ALL_TYPES = [
  "trainingLogs",
  "raceGoals",
  "bodyMetrics",
  "weeklyAssessments",
  "weeklyPlans",
  "fatigueAlerts",
] as const;

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  let types: string[];
  try {
    const body = await request.json();
    types = body.types;
  } catch {
    types = [...ALL_TYPES]; // default to all types when no body
  }

  if (!Array.isArray(types) || types.length === 0) {
    return NextResponse.json({ error: "No data types specified" }, { status: 400 });
  }

  const invalidTypes = types.filter((t) => !(ALL_TYPES as readonly string[]).includes(t));
  if (invalidTypes.length > 0) {
    return NextResponse.json({ error: `Invalid data types: ${invalidTypes.join(", ")}` }, { status: 400 });
  }

  // Build operations array from the requested types.
  // Order matters for referential integrity (child tables first).
  const operations: Prisma.PrismaPromise<any>[] = [];

  if (types.includes("trainingLogs")) operations.push(prisma.trainingLog.deleteMany({ where: { userId } }));
  if (types.includes("raceGoals")) operations.push(prisma.raceGoal.deleteMany({ where: { userId } }));
  if (types.includes("bodyMetrics")) operations.push(prisma.bodyMetric.deleteMany({ where: { userId } }));
  if (types.includes("weeklyAssessments")) operations.push(prisma.weeklyAssessment.deleteMany({ where: { userId } }));
  if (types.includes("weeklyPlans")) operations.push(prisma.weeklyPlan.deleteMany({ where: { userId } }));
  if (types.includes("fatigueAlerts")) operations.push(prisma.fatigueAlert.deleteMany({ where: { userId } }));

  const results = await prisma.$transaction(operations);

  // Build a per-type count summary
  const counts: Record<string, number> = {};
  types.forEach((t, i) => {
    counts[t] = results[i]?.count ?? 0;
  });

  return NextResponse.json({ success: true, counts });
}
