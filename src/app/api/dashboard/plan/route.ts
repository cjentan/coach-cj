import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWeeklyPlan } from "@/lib/plan-generator";
import type { PlannedSession } from "@/lib/plan-generator";
import { getWeekStart, localDateStr } from "@/lib/utils";
import { SHORT_DAY_NAMES } from "@/lib/constants";

/** Day of week (0=Sun..6=Sat) of a "YYYY-MM-DD" local date string. */
function dayOfWeekFromDateStr(dateStr: string): number {
  return new Date(dateStr + "T00:00:00Z").getUTCDay();
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const weekOffset = parseInt(searchParams.get("weekOffset") || "0", 10);
  const tzOffset = parseInt(searchParams.get("tzOffset") || "0", 10) || 0;

  const now = new Date();
  // "Today" from the user's perspective — compare as YYYY-MM-DD strings so the
  // UTC server clock can't highlight the wrong day.
  const todayStr = localDateStr(now, tzOffset);

  // Compute Monday of the target week. getWeekStart returns the canonical UTC
  // Monday the weekly plan record is stored under; display dates below are
  // shifted into the user's local timezone.
  const weekStart = getWeekStart(now);
  weekStart.setUTCDate(weekStart.getUTCDate() + weekOffset * 7);

  // Sunday of the target week (UTC key)
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  // Query a widened window (±1 day) around the UTC week so activities on the
  // user's local weekdays are captured regardless of timezone offset, then
  // bucket them by the user's LOCAL date below.
  const weekEndExclusive = new Date(weekStart);
  weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 7);
  const actualLogs = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      startDate: {
        gte: new Date(weekStart.getTime() - 86400000),
        lt: new Date(weekEndExclusive.getTime() + 86400000),
      },
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

  // Group logs by the user's LOCAL date string. startDate is a UTC timestamp,
  // so shift by the browser's tzOffset before formatting — otherwise a 6am
  // UTC+8 run (10pm UTC the previous day) would land on the wrong calendar day.
  const logsByDate = new Map<string, typeof actualLogs>();
  for (const log of actualLogs) {
    const dateKey = localDateStr(log.startDate, tzOffset);
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

  // Count ALL weekly plans for this user (across all weeks)
  const totalPlanCount = await prisma.weeklyPlan.count({
    where: { userId: session.user.id },
  });

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
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = localDateStr(d, tzOffset);
    const dow = dayOfWeekFromDateStr(dateStr);
    const isPast = dateStr < todayStr;
    const isToday = dateStr === todayStr;

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
      dayLabel: SHORT_DAY_NAMES[dow],
      dayOfWeek: dow,
      planned,
      actual,
      isPast,
      isToday,
    });
  }

  return NextResponse.json({
    weekStart: localDateStr(weekStart, tzOffset),
    weekEnd: localDateStr(weekEnd, tzOffset),
    days,
    targetVolumeMeters: plan?.targetVolumeMeters ?? undefined,
    targetElevationMeters: plan?.targetElevationMeters ?? undefined,
    adjustments: plan?.adjustments || [],
    coachNotes: plan?.coachNotes ?? undefined,
    fromCache: !!plan,
    totalPlanCount,
  });
}
