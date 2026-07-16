import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWeeklyPlan } from "@/lib/plan-generator";
import type { PlannedSession } from "@/lib/plan-generator";
import { getWeekStart } from "@/lib/utils";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const weekOffset = parseInt(searchParams.get("weekOffset") || "0", 10);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Compute Monday of the target week
  const weekStart = getWeekStart(now);
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);

  // Sunday of the target week
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

  // Build week dates
  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    weekDates.push(d);
  }

  // ALWAYS query training logs for this week (for actual activity on past days)
  const weekEndExclusive = new Date(weekEnd);
  weekEndExclusive.setDate(weekEndExclusive.getDate() + 1);
  const actualLogs = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      startDate: { gte: weekStart, lt: weekEndExclusive },
      mergedIntoId: null,
    },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      startDate: true,
      distanceMeters: true,
      elevationGainMeters: true,
      durationSeconds: true,
      source: true,
    },
  });

  // Group logs by date string
  const logsByDate = new Map<string, typeof actualLogs>();
  for (const log of actualLogs) {
    const dateKey = log.startDate.toISOString().split("T")[0];
    if (!logsByDate.has(dateKey)) logsByDate.set(dateKey, []);
    logsByDate.get(dateKey)!.push(log);
  }

  // Load plan for this week if it exists
  const plan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId: session.user.id, weekStartDate: weekStart } },
  });

  // Parse sessions and change info (if plan exists)
  let sessions: PlannedSession[] = [];
  let changedDays = new Map<number, { changedAt: string; changeReason: string }>();

  if (plan) {
    sessions = (plan.plannedSessions as unknown as PlannedSession[]) || [];

    const adjHistory = (plan.adjustmentHistory as unknown as Array<{
      timestamp: string; prompt: string; summary: string;
      dayOfWeek?: number; reason?: string;
    }>) || [];

    for (const entry of adjHistory) {
      // New format: dayChanges array
      const dayChanges = (entry as any).dayChanges as Array<{ dayOfWeek: number; reason: string }> | undefined;
      if (dayChanges && Array.isArray(dayChanges)) {
        for (const dc of dayChanges) {
          if (dc.reason && !dc.reason.startsWith("Skipped")) {
            changedDays.set(dc.dayOfWeek, {
              changedAt: entry.timestamp,
              changeReason: dc.reason,
            });
          }
        }
      }
      // Legacy format: single dayOfWeek/reason
      if ((entry as any).dayOfWeek !== undefined && (entry as any).reason) {
        changedDays.set((entry as any).dayOfWeek, {
          changedAt: entry.timestamp,
          changeReason: (entry as any).reason,
        });
      }
    }
  }

  // Build days array
  const days: Array<{
    date: string;
    dayLabel: string;
    dayOfWeek: number;
    planned: {
      type: string;
      description: string;
      targetDistance: number | null;
      targetElevation: number | null;
      targetDuration: number | null;
      changedAt?: string;
      changeReason?: string;
    } | null;
    actual: {
      type: string;
      name: string;
      distanceMeters: number | null;
      elevationGainMeters: number | null;
      durationSeconds: number;
      activityId: string;
      source: string;
    } | null;
    isPast: boolean;
    isToday: boolean;
  }> = [];

  for (let i = 0; i < 7; i++) {
    const d = weekDates[i];
    const dateStr = d.toISOString().split("T")[0];
    const dow = d.getDay();
    const isPast = d < todayStart;
    const isToday = d.getTime() === todayStart.getTime();

    // Planned session from plan (if any)
    const session = sessions.find((s) => s.dayOfWeek === dow);
    const changeInfo = changedDays.get(dow);

    const planned = session
      ? {
          type: session.type,
          description: session.description,
          targetDistance: session.targetDistance ?? null,
          targetElevation: session.targetElevation ?? null,
          targetDuration: session.targetDuration ?? null,
          ...(changeInfo ? { changedAt: changeInfo.changedAt, changeReason: changeInfo.changeReason } : {}),
        }
      : null;

    // Actual activity from training logs (for past/today days)
    let actual: typeof days[number]["actual"] = null;
    const dateLogs = logsByDate.get(dateStr);
    if (dateLogs && dateLogs.length > 0) {
      const best = dateLogs[0];
      actual = {
        type: best.type,
        name: best.name,
        distanceMeters: best.distanceMeters,
        elevationGainMeters: best.elevationGainMeters,
        durationSeconds: best.durationSeconds,
        activityId: best.id,
        source: best.source,
      };
    }

    days.push({
      date: dateStr,
      dayLabel: DAY_NAMES[dow],
      dayOfWeek: dow,
      planned,
      actual,
      isPast,
      isToday,
    });
  }

  return NextResponse.json({
    weekStart: weekStart.toISOString().split("T")[0],
    weekEnd: weekEnd.toISOString().split("T")[0],
    days,
    targetVolumeMeters: plan?.targetVolumeMeters ?? undefined,
    targetElevationMeters: plan?.targetElevationMeters ?? undefined,
    adjustments: plan?.adjustments || [],
    coachNotes: plan?.coachNotes ?? undefined,
    fromCache: !!plan,
  });
}
