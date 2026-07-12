import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart, getMonthStart, getMonthEnd } from "@/lib/utils";

interface PeriodStats {
  weeklyDistance: number;
  weeklyElevation: number;
  weeklyDuration: number;
  weeklyCount: number;
  weeklyTss: number;
  avgDailyTss: number;
  avgHr: number | null;
}

function aggregateLogs(
  logs: { distanceMeters: number | null; elevationGainMeters: number | null; durationSeconds: number; averageHr: number | null; tss: number | null }[],
  daysInPeriod: number,
): PeriodStats {
  const weeklyDistance = logs.reduce((sum, log) => sum + (log.distanceMeters || 0), 0);
  const weeklyElevation = logs.reduce((sum, log) => sum + (log.elevationGainMeters || 0), 0);
  const weeklyDuration = logs.reduce((sum, log) => sum + (log.durationSeconds || 0), 0);
  const weeklyCount = logs.length;
  const weeklyTss = Math.round(logs.reduce((sum, log) => sum + (log.tss || 50), 0));
  const avgDailyTss = weeklyCount > 0 ? Math.round(weeklyTss / Math.max(1, daysInPeriod)) : 0;
  const hrLogs = logs.filter((log) => log.averageHr != null);
  const avgHr = hrLogs.length > 0
    ? Math.round(hrLogs.reduce((sum, log) => sum + (log.averageHr || 0), 0) / hrLogs.length)
    : null;

  return { weeklyDistance, weeklyElevation, weeklyDuration, weeklyCount, weeklyTss, avgDailyTss, avgHr };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const weekStart = getWeekStart(now);

  // Period boundaries
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
  const lastWeekEnd = new Date(weekStart.getTime() - 1);
  const monthStart = getMonthStart(now);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = getMonthEnd(lastMonthStart);

  const [weekLogs, lastWeekLogs, monthLogs, lastMonthLogs, goalCount, bodyMetrics] = await Promise.all([
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: weekStart } },
      select: { distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: lastWeekStart, lt: weekStart } },
      select: { distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: monthStart } },
      select: { distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: lastMonthStart, lte: lastMonthEnd } },
      select: { distanceMeters: true, elevationGainMeters: true, durationSeconds: true, averageHr: true, tss: true },
    }),
    prisma.raceGoal.count({ where: { userId: session.user.id, status: "active" } }),
    prisma.bodyMetric.findFirst({
      where: { userId: session.user.id },
      orderBy: { recordedAt: "desc" },
      select: { weightKg: true },
    }),
  ]);

  const daysThisMonth = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / 86400000));
  const daysLastMonth = Math.max(1, new Date(now.getFullYear(), now.getMonth(), 0).getDate());

  const current = aggregateLogs(weekLogs, 7);
  const lastWeek = lastWeekLogs.length > 0 ? aggregateLogs(lastWeekLogs, 7) : null;
  const currentMonth = monthLogs.length > 0 ? aggregateLogs(monthLogs, daysThisMonth) : null;
  const lastMonth = lastMonthLogs.length > 0 ? aggregateLogs(lastMonthLogs, daysLastMonth) : null;

  return NextResponse.json({
    weeklyDistance: current.weeklyDistance,
    weeklyElevation: current.weeklyElevation,
    weeklyDuration: current.weeklyDuration,
    weeklyCount: current.weeklyCount,
    weeklyTss: current.weeklyTss,
    avgDailyTss: current.avgDailyTss,
    avgHr: current.avgHr,
    activeGoals: goalCount,
    latestWeight: bodyMetrics?.weightKg || null,
    lastWeek,
    currentMonth,
    lastMonth,
  });
}
