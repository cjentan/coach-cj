import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET — return historical weekly snapshots for trend charts */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const weeks = Math.min(
    200,
    Math.max(4, parseInt(url.searchParams.get("weeks") || "52")),
  );

  const assessments = await prisma.weeklyAssessment.findMany({
    where: { userId: session.user.id },
    orderBy: { weekStartDate: "asc" },
    take: weeks,
    select: {
      weekStartDate: true,
      readinessScore: true,
      chronicTrainingLoad: true,
      acuteTrainingLoad: true,
      tsb: true,
      weeklyVolumeMeters: true,
      weeklyElevationMeters: true,
      weeklyDurationSeconds: true,
      fatigueScore: true,
      formScore: true,
      fitnessScore: true,
      goalProgressPct: true,
      recommendations: true,
      rawData: true,
    },
  });

  const trends = assessments.map((a) => {
    const raw = a.rawData as Record<string, any> | null;
    return {
      weekStartDate: a.weekStartDate.toISOString().split("T")[0],
      readinessScore: a.readinessScore,
      ctl: a.chronicTrainingLoad,
      atl: a.acuteTrainingLoad,
      tsb: a.tsb,
      weeklyVolumeMeters: a.weeklyVolumeMeters,
      weeklyElevationMeters: a.weeklyElevationMeters,
      weeklyDurationSeconds: a.weeklyDurationSeconds,
      weeklyTss: raw?.weeklyTss ?? a.fatigueScore ?? 0,
      activityCount: raw?.weeklyCount ?? 0,
      avgDailyTss: raw?.avgDailyTss ?? 0,
      avgHr: raw?.avgHr ?? null,
      volumeAdherence: raw?.volumeAdherence ?? null,
      consistency: raw?.consistency ?? null,
      activeGoals: raw?.activeGoals ?? 0,
      latestWeight: raw?.latestWeight ?? null,
      fatigueSeverity: raw?.fatigueSeverity ?? "clear",
      fatigueSignals: raw?.fatigueSignals ?? [],
      rampRate: raw?.rampRate ?? null,
      goalProgressPct: a.goalProgressPct,
    };
  });

  return NextResponse.json({ trends, count: trends.length });
}
