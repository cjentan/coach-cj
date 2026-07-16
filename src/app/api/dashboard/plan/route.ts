import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWeeklyPlan } from "@/lib/plan-generator";
import { getWeekStart } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const nextMonday = getWeekStart(now);
  nextMonday.setDate(nextMonday.getDate() + 7);

  // Check if a plan already exists for next week
  const existing = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId: session.user.id, weekStartDate: nextMonday } },
  });

  if (existing) {
    return NextResponse.json({
      weekStart: nextMonday,
      targetVolumeMeters: existing.targetVolumeMeters,
      targetElevationMeters: existing.targetElevationMeters,
      targetDurationSeconds: existing.targetDurationSeconds,
      plannedSessions: existing.plannedSessions,
      adjustments: existing.adjustments,
      trajectoryAssessment: existing.trajectoryAssessment,
      coachNotes: existing.coachNotes,
      fromCache: true,
    });
  }

  // Generate new plan
  const [goals, trainingLogs, fatigueAlert] = await Promise.all([
    prisma.raceGoal.findMany({ where: { userId: session.user.id, status: "active" } }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: new Date(now.getTime() - 28 * 86400000) }, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: { startDate: true, distanceMeters: true, elevationGainMeters: true, durationSeconds: true },
    }),
    prisma.fatigueAlert.findFirst({
      where: { userId: session.user.id, acknowledged: false },
      orderBy: { detectedAt: "desc" },
    }),
  ]);

  // Weekly volumes for last 4 weeks
  const weeklyVolumes: number[] = [];
  const weeklyElevations: number[] = [];
  const weeklyDurations: number[] = [];

  for (let week = 3; week >= 0; week--) {
    const start = new Date(now.getTime() - (week + 1) * 7 * 86400000);
    const end = new Date(now.getTime() - week * 7 * 86400000);
    const wLogs = trainingLogs.filter((log) => log.startDate >= start && log.startDate < end);
    weeklyVolumes.push(wLogs.reduce((sum, log) => sum + (log.distanceMeters || 0), 0));
    weeklyElevations.push(wLogs.reduce((sum, log) => sum + (log.elevationGainMeters || 0), 0));
    weeklyDurations.push(wLogs.reduce((sum, log) => sum + log.durationSeconds, 0));
  }

  const plan = generateWeeklyPlan({
    goals: goals.map((goal) => ({
      id: goal.id, name: goal.name, targetDate: goal.targetDate,
      distanceMeters: goal.distanceMeters, elevationGainMeters: goal.elevationGainMeters,
      priority: goal.priority,
    })),
    recentVolumeByWeek: weeklyVolumes,
    recentElevationByWeek: weeklyElevations,
    recentDurationByWeek: weeklyDurations,
    consistencyScore: 0.7,
    fatigueSeverity: fatigueAlert?.severity || null,
  });

  // Save for next time
  await prisma.weeklyPlan.upsert({
    where: { userId_weekStartDate: { userId: session.user.id, weekStartDate: nextMonday } },
    create: {
      userId: session.user.id, weekStartDate: nextMonday,
      targetVolumeMeters: plan.targetVolumeMeters,
      targetElevationMeters: plan.targetElevationMeters,
      targetDurationSeconds: plan.targetDurationSeconds,
      plannedSessions: JSON.parse(JSON.stringify(plan.plannedSessions)),
      adjustments: plan.adjustments,
      trajectoryAssessment: plan.trajectoryAssessment,
    },
    update: {
      targetVolumeMeters: plan.targetVolumeMeters,
      targetElevationMeters: plan.targetElevationMeters,
      targetDurationSeconds: plan.targetDurationSeconds,
      plannedSessions: JSON.parse(JSON.stringify(plan.plannedSessions)),
      adjustments: plan.adjustments,
      trajectoryAssessment: plan.trajectoryAssessment,
      generatedAt: new Date(),
    },
  });

  return NextResponse.json({
    weekStart: nextMonday,
    targetVolumeMeters: plan.targetVolumeMeters,
    targetElevationMeters: plan.targetElevationMeters,
    targetDurationSeconds: plan.targetDurationSeconds,
    plannedSessions: JSON.parse(JSON.stringify(plan.plannedSessions)),
    adjustments: plan.adjustments,
    trajectoryAssessment: plan.trajectoryAssessment,
    fromCache: false,
  });
}
