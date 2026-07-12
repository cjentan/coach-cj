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
  const grouping = url.searchParams.get("grouping") || "week";

  const assessments = await prisma.weeklyAssessment.findMany({
    where: { userId: session.user.id },
    orderBy: { weekStartDate: "desc" },
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

  // Reverse to ascending chronological order for display
  trends.reverse();

  // Monthly aggregation
  if (grouping === "month") {
    const monthly: Record<string, any> = {};
    for (const w of trends) {
      const monthKey = w.weekStartDate.slice(0, 7); // "YYYY-MM"
      if (!monthly[monthKey]) {
        monthly[monthKey] = {
          monthLabel: monthKey,
          readinessScore: 0,
          ctl: 0,
          atl: 0,
          tsb: 0,
          weeklyVolumeMeters: 0,
          weeklyElevationMeters: 0,
          weeklyDurationSeconds: 0,
          weeklyTss: 0,
          activityCount: 0,
          avgDailyTss: 0,
          avgHr: 0,
          volumeAdherence: 0,
          consistency: 0,
          count: 0,
          hrCount: 0,
        };
      }
      const m = monthly[monthKey];
      m.readinessScore += w.readinessScore ?? 0;
      m.ctl += w.ctl ?? 0;
      m.atl += w.atl ?? 0;
      m.tsb += w.tsb ?? 0;
      m.weeklyVolumeMeters += w.weeklyVolumeMeters ?? 0;
      m.weeklyElevationMeters += w.weeklyElevationMeters ?? 0;
      m.weeklyDurationSeconds += w.weeklyDurationSeconds ?? 0;
      m.weeklyTss += w.weeklyTss ?? 0;
      m.activityCount += w.activityCount ?? 0;
      m.avgDailyTss += w.avgDailyTss ?? 0;
      m.volumeAdherence += w.volumeAdherence ?? 0;
      m.consistency += w.consistency ?? 0;
      if (w.avgHr != null) { m.avgHr += w.avgHr; m.hrCount++; }
      m.count++;
    }

    const monthlyTrends = Object.values(monthly).map((m: any) => ({
      weekStartDate: m.monthLabel, // reuse field name for chart compatibility
      readinessScore: Math.round((m.readinessScore / m.count) * 10) / 10,
      ctl: Math.round((m.ctl / m.count) * 10) / 10,
      atl: Math.round((m.atl / m.count) * 10) / 10,
      tsb: Math.round((m.tsb / m.count) * 10) / 10,
      weeklyVolumeMeters: Math.round(m.weeklyVolumeMeters),
      weeklyElevationMeters: Math.round(m.weeklyElevationMeters),
      weeklyDurationSeconds: Math.round(m.weeklyDurationSeconds),
      weeklyTss: Math.round(m.weeklyTss),
      activityCount: Math.round(m.activityCount),
      avgDailyTss: Math.round((m.avgDailyTss / m.count) * 10) / 10,
      avgHr: m.hrCount > 0 ? Math.round((m.avgHr / m.hrCount) * 10) / 10 : null,
      volumeAdherence: Math.round((m.volumeAdherence / m.count) * 10) / 10,
      consistency: Math.round((m.consistency / m.count) * 10) / 10,
    }));

    return NextResponse.json({ trends: monthlyTrends, count: monthlyTrends.length });
  }

  return NextResponse.json({ trends, count: trends.length });
}
