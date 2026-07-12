import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const weekStart = getWeekStart(now);
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);

  const [weekLogs, recentLogs, goals, availabilitySlots] = await Promise.all([
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: weekStart }, mergedIntoId: null },
      select: { startDate: true, distanceMeters: true, elevationGainMeters: true, durationSeconds: true, tss: true },
    }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: fourWeeksAgo }, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: { startDate: true, distanceMeters: true },
    }),
    prisma.raceGoal.findFirst({
      where: { userId: session.user.id, status: "active" },
      orderBy: { priority: "asc" },
      select: { distanceMeters: true, targetDate: true },
    }),
    prisma.trainingAvailability.count({ where: { userId: session.user.id } }),
  ]);

  // Weekly totals
  const weeklyVolume = weekLogs.reduce((sum, l) => sum + (l.distanceMeters || 0), 0);
  const weeklyElevation = weekLogs.reduce((sum, l) => sum + (l.elevationGainMeters || 0), 0);
  const weeklyDuration = weekLogs.reduce((sum, l) => sum + (l.durationSeconds || 0), 0);
  const weeklyTss = weekLogs.reduce((sum, l) => sum + (l.tss || 50), 0);

  // ── Volume adherence ──────────────────────────────────────────────
  let volumeAdherence = 50; // neutral default

  if (goals) {
    // Compare to goal-based weekly target
    const weeksUntil = Math.max(1, Math.ceil((goals.targetDate.getTime() - now.getTime()) / (7 * 86400000)));
    const targetWeekly = goals.distanceMeters / (weeksUntil * 0.7);
    volumeAdherence = Math.min(100, Math.round((weeklyVolume / Math.max(1, targetWeekly)) * 100));
  } else {
    // No goals — compare to 4-week average (100% = maintaining your average)
    const avgWeeklyVolume = recentLogs.length > 0
      ? recentLogs.reduce((sum, l) => sum + (l.distanceMeters || 0), 0) / 4
      : 0;
    if (avgWeeklyVolume > 0) {
      // Scale: 0% = zero volume, 100% = at average, 150% = 1.5x average (capped at 100)
      volumeAdherence = Math.min(100, Math.round((weeklyVolume / Math.max(1, avgWeeklyVolume)) * 100));
    } else if (weeklyVolume > 0) {
      volumeAdherence = 75; // first week with data — acknowledge it
    }
  }

  // ── Consistency ───────────────────────────────────────────────────
  // Count distinct days with activities this week, divided by days elapsed so far
  const elapsedDays = Math.max(1, Math.min(7,
    Math.ceil((now.getTime() - weekStart.getTime()) / 86400000)
  ));
  const activeDays = new Set(
    weekLogs.map((l) => l.startDate.toISOString().split("T")[0])
  ).size;
  const consistency = Math.min(100, Math.round((activeDays / elapsedDays) * 100));

  // ── Trend ─────────────────────────────────────────────────────────
  // Compute weekly volumes for the last 4 weeks, fit a linear trend
  const weeklyVolumes: number[] = [];
  for (let w = 3; w >= 0; w--) {
    const start = new Date(now.getTime() - (w + 1) * 7 * 86400000);
    const end = new Date(now.getTime() - w * 7 * 86400000);
    const wLogs = recentLogs.filter((l) => l.startDate >= start && l.startDate < end);
    weeklyVolumes.push(wLogs.reduce((s, l) => s + (l.distanceMeters || 0), 0));
  }

  // Simple linear regression on 4 data points
  const n = weeklyVolumes.length;
  const xMean = (n - 1) / 2; // 1.5 for 4 points
  const yMean = weeklyVolumes.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (weeklyVolumes[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  const slope = den > 0 ? num / den : 0;
  const trendPct = yMean > 0 ? Math.round((slope / yMean) * 100) : 0;

  // ── Rest balance ──────────────────────────────────────────────────
  const restBalance = Math.max(0, 100 - Math.min(100, Math.round((weeklyTss / 700) * 100)));

  // ── Trend score (continuous) ──────────────────────────────────────
  // Stable (-5 to +5%) = best, moderate ramp (+5 to +15%) = ok, steep or declining = lower
  let trendScore: number;
  const absTrend = Math.abs(trendPct);
  if (absTrend <= 5) trendScore = 100;
  else if (absTrend <= 15) trendScore = 100 - (absTrend - 5) * 2;   // 100 → 80
  else if (absTrend <= 30) trendScore = 80 - (absTrend - 15) * 1;    // 80 → 65
  else trendScore = Math.max(30, 65 - (absTrend - 30) * 0.5);
  trendScore = Math.round(trendScore);

  // ── Fatigue penalty ───────────────────────────────────────────────
  let fatiguePenalty = 0;
  if (weeklyTss > 700) fatiguePenalty = 20;
  else if (weeklyTss > 500) fatiguePenalty = 10;
  else if (weeklyTss > 350) fatiguePenalty = 5;

  // ── Readiness score ───────────────────────────────────────────────
  // Weighted composite: volume 40%, consistency 25%, rest 20%, trend 15%
  let score = Math.round(
    volumeAdherence * 0.40 +
    consistency * 0.25 +
    restBalance * 0.20 +
    trendScore * 0.15 -
    fatiguePenalty
  );
  score = Math.max(0, Math.min(100, score));

  // ── Labels ────────────────────────────────────────────────────────
  let label: string;
  let detail: string;
  if (score >= 70) {
    label = "On Track";
    detail = "Your training trajectory is aligned with your goals.";
  } else if (score >= 50) {
    label = "Needs Attention";
    detail = "Adjust volume or consistency to get back on track.";
  } else {
    label = "Off Track";
    detail = "Significant adjustments needed to reach your race goals.";
  }

  return NextResponse.json({
    score,
    label,
    detail,
    volumeAdherence,
    consistency,
    weeklyTss,
    trendPct,
    weeklyVolume,
    weeklyElevation,
    weeklyDuration,
  });
}
