import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const grouping = url.searchParams.get("grouping") || "monthly";

  const now = new Date();

  // ── Weekly grouping: 12-week window ──────────────────────────────────
  if (grouping === "weekly") {
    const monday = getMonday(now);
    const windowEndWeek = -offset;
    const windowStartWeek = windowEndWeek - 11;

    const startDate = new Date(monday);
    startDate.setDate(startDate.getDate() + windowStartWeek * 7);

    const endDate = new Date(monday);
    endDate.setDate(endDate.getDate() + (windowEndWeek + 1) * 7 - 1);
    endDate.setHours(23, 59, 59, 999);

    const logs = await prisma.trainingLog.findMany({
      where: {
        userId: session.user.id,
        startDate: { gte: startDate, lte: endDate },
        mergedIntoId: null,
      },
      select: {
        startDate: true,
        distanceMeters: true,
        elevationGainMeters: true,
        durationSeconds: true,
      },
    });

    const byWeek: Record<
      string,
      { activityCount: number; totalDistance: number; totalElevation: number; totalDurationSeconds: number }
    > = {};

    for (const log of logs) {
      const lm = getMonday(log.startDate);
      const key = fmtDate(lm);
      if (!byWeek[key]) byWeek[key] = { activityCount: 0, totalDistance: 0, totalElevation: 0, totalDurationSeconds: 0 };
      byWeek[key].activityCount++;
      byWeek[key].totalDistance += log.distanceMeters || 0;
      byWeek[key].totalElevation += log.elevationGainMeters || 0;
      byWeek[key].totalDurationSeconds += log.durationSeconds || 0;
    }

    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(monday);
      ws.setDate(ws.getDate() + (windowStartWeek + (11 - i)) * 7);
      const we = new Date(ws);
      we.setDate(we.getDate() + 6);

      const key = fmtDate(ws);
      const stats = byWeek[key] || { activityCount: 0, totalDistance: 0, totalElevation: 0, totalDurationSeconds: 0 };
      weeks.push({
        key,
        label: ws.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        fullLabel: `${ws.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${we.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        ...stats,
      });
    }

    const canGoBack = offset < 520; // ~10 years in weeks
    return NextResponse.json({ grouping, weeks, canGoBack });
  }

  // ── Yearly grouping: calendar year months ──────────────────────────────
  if (grouping === "yearly") {
    const targetYear = now.getFullYear() - offset;
    const isCurrentYear = offset === 0;
    const endMonth = isCurrentYear ? now.getMonth() : 11; // 0-indexed

    const startDate = new Date(targetYear, 0, 1);
    const endDate = new Date(targetYear, endMonth + 1, 0, 23, 59, 59, 999);

    const logs = await prisma.trainingLog.findMany({
      where: {
        userId: session.user.id,
        startDate: { gte: startDate, lte: endDate },
        mergedIntoId: null,
      },
      select: {
        startDate: true,
        distanceMeters: true,
        elevationGainMeters: true,
        durationSeconds: true,
      },
    });

    const byMonth: Record<
      string,
      { activityCount: number; totalDistance: number; totalElevation: number; totalDurationSeconds: number }
    > = {};

    for (const log of logs) {
      const key = `${log.startDate.getFullYear()}-${String(log.startDate.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = { activityCount: 0, totalDistance: 0, totalElevation: 0, totalDurationSeconds: 0 };
      byMonth[key].activityCount++;
      byMonth[key].totalDistance += log.distanceMeters || 0;
      byMonth[key].totalElevation += log.elevationGainMeters || 0;
      byMonth[key].totalDurationSeconds += log.durationSeconds || 0;
    }

    const months = [];
    for (let m = 0; m <= endMonth; m++) {
      const key = `${targetYear}-${String(m + 1).padStart(2, "0")}`;
      const d = new Date(targetYear, m, 1);
      const stats = byMonth[key] || { activityCount: 0, totalDistance: 0, totalElevation: 0, totalDurationSeconds: 0 };
      months.push({
        key,
        label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        ...stats,
      });
    }

    const canGoBack = offset < 100;
    return NextResponse.json({ grouping, months, canGoBack });
  }

  // ── Monthly grouping: 12-month window ────────────────────────────────
  const windowEndMonth = -offset;
  const windowStartMonth = windowEndMonth - 11;

  const startDate = new Date(now.getFullYear(), now.getMonth() + windowStartMonth, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + windowEndMonth + 1, 0, 23, 59, 59, 999);

  const logs = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      startDate: { gte: startDate, lte: endDate },
      mergedIntoId: null,
    },
    select: {
      startDate: true,
      distanceMeters: true,
      elevationGainMeters: true,
      durationSeconds: true,
    },
  });

  const byMonth: Record<
    string,
    { activityCount: number; totalDistance: number; totalElevation: number; totalDurationSeconds: number }
  > = {};

  for (const log of logs) {
    const key = `${log.startDate.getFullYear()}-${String(log.startDate.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { activityCount: 0, totalDistance: 0, totalElevation: 0, totalDurationSeconds: 0 };
    byMonth[key].activityCount++;
    byMonth[key].totalDistance += log.distanceMeters || 0;
    byMonth[key].totalElevation += log.elevationGainMeters || 0;
    byMonth[key].totalDurationSeconds += log.durationSeconds || 0;
  }

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const m = windowStartMonth + (11 - i);
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const stats = byMonth[key] || { activityCount: 0, totalDistance: 0, totalElevation: 0, totalDurationSeconds: 0 };
    months.push({
      key,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      ...stats,
    });
  }

  const canGoBack = offset < 120;
  return NextResponse.json({ grouping, months, canGoBack });
}
