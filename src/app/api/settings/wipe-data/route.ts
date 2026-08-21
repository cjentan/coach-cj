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
  "dailyHealth",
  "analysisReports",
  "apiKeys",
  "duplicateGroups",
  "integrations",
  "coachData",
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
    return NextResponse.json(
      { error: `Invalid data types: ${invalidTypes.join(", ")}` },
      { status: 400 }
    );
  }

  // Build operations array from the requested types.
  // A type can map to more than one table (e.g. integrations), so each
  // operation is paired with the type it belongs to for accurate counting.
  // Order matters for referential integrity (child tables first).
  const operations: { type: string; promise: Prisma.PrismaPromise<any> }[] = [];
  const add = (type: string, promise: Prisma.PrismaPromise<any>) =>
    operations.push({ type, promise });

  if (types.includes("trainingLogs"))
    add("trainingLogs", prisma.trainingLog.deleteMany({ where: { userId } }));
  if (types.includes("duplicateGroups"))
    add("duplicateGroups", prisma.duplicateGroup.deleteMany({ where: { userId } }));
  if (types.includes("raceGoals"))
    add("raceGoals", prisma.raceGoal.deleteMany({ where: { userId } }));
  if (types.includes("bodyMetrics"))
    add("bodyMetrics", prisma.bodyMetric.deleteMany({ where: { userId } }));
  if (types.includes("dailyHealth"))
    add("dailyHealth", prisma.dailyHealth.deleteMany({ where: { userId } }));
  if (types.includes("weeklyAssessments"))
    add("weeklyAssessments", prisma.weeklyAssessment.deleteMany({ where: { userId } }));
  if (types.includes("weeklyPlans"))
    add("weeklyPlans", prisma.weeklyPlan.deleteMany({ where: { userId } }));
  if (types.includes("fatigueAlerts"))
    add("fatigueAlerts", prisma.fatigueAlert.deleteMany({ where: { userId } }));
  if (types.includes("analysisReports"))
    add("analysisReports", prisma.analysisReport.deleteMany({ where: { userId } }));
  if (types.includes("apiKeys")) add("apiKeys", prisma.apiKey.deleteMany({ where: { userId } }));
  if (types.includes("coachData"))
    add("coachData", prisma.coachConversation.deleteMany({ where: { userId } }));
  if (types.includes("integrations")) {
    add("integrations", prisma.garminSession.deleteMany({ where: { userId } }));
    add("integrations", prisma.corosSession.deleteMany({ where: { userId } }));
  }

  const results = await prisma.$transaction(operations.map((o) => o.promise));

  // Build a per-type count summary (a type's ops are summed across tables).
  const counts: Record<string, number> = {};
  operations.forEach((o, i) => {
    counts[o.type] = (counts[o.type] ?? 0) + (results[i]?.count ?? 0);
  });

  return NextResponse.json({ success: true, counts });
}
