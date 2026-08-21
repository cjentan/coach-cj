import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart, localDateStr } from "@/lib/utils";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const grouping = url.searchParams.get("grouping") || "monthly";

  const now = new Date();

  // ── Weekly grouping: 12-week window (UTC-based) ──────────────────────
  if (grouping === "weekly") {
    const monday = getWeekStart(now);
    const windowEndWeek = -offset;
    const windowStartWeek = windowEndWeek - 11;

    const startDate = new Date(monday);
    startDate.setUTCDate(startDate.getUTCDate() + windowStartWeek * 7);

    const endDate = new Date(monday);
    endDate.setUTCDate(endDate.getUTCDate() + (windowEndWeek + 1) * 7);
    // exclusive-end: query uses lt

    const logs = await prisma.trainingLog.findMany({
      where: {
        userId: session.user.id,
        startDate: { gte: startDate, lt: endDate },
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
      {
        activityCount: number;
        totalDistance: number;
        totalElevation: number;
        totalDurationSeconds: number;
      }
    > = {};

    for (const log of logs) {
      const lm = getWeekStart(log.startDate);
      const key = localDateStr(lm);
      if (!byWeek[key])
        byWeek[key] = {
          activityCount: 0,
          totalDistance: 0,
          totalElevation: 0,
          totalDurationSeconds: 0,
        };
      byWeek[key].activityCount++;
      byWeek[key].totalDistance += log.distanceMeters || 0;
      byWeek[key].totalElevation += log.elevationGainMeters || 0;
      byWeek[key].totalDurationSeconds += log.durationSeconds || 0;
    }

    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(monday);
      ws.setUTCDate(ws.getUTCDate() + (windowStartWeek + (11 - i)) * 7);
      const we = new Date(ws);
      we.setUTCDate(we.getUTCDate() + 6);

      const key = localDateStr(ws);
      const stats = byWeek[key] || {
        activityCount: 0,
        totalDistance: 0,
        totalElevation: 0,
        totalDurationSeconds: 0,
      };
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

  // ── Yearly grouping: calendar year months (UTC) ──────────────────────
  if (grouping === "yearly") {
    const targetYear = now.getUTCFullYear() - offset;
    const isCurrentYear = offset === 0;
    const endMonth = isCurrentYear ? now.getUTCMonth() : 11; // 0-indexed

    const startDate = new Date(Date.UTC(targetYear, 0, 1));
    const endDate = new Date(Date.UTC(targetYear, endMonth + 1, 0, 23, 59, 59, 999));

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
      {
        activityCount: number;
        totalDistance: number;
        totalElevation: number;
        totalDurationSeconds: number;
      }
    > = {};

    for (const log of logs) {
      const key = `${log.startDate.getUTCFullYear()}-${String(log.startDate.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key])
        byMonth[key] = {
          activityCount: 0,
          totalDistance: 0,
          totalElevation: 0,
          totalDurationSeconds: 0,
        };
      byMonth[key].activityCount++;
      byMonth[key].totalDistance += log.distanceMeters || 0;
      byMonth[key].totalElevation += log.elevationGainMeters || 0;
      byMonth[key].totalDurationSeconds += log.durationSeconds || 0;
    }

    const months = [];
    for (let m = 0; m <= endMonth; m++) {
      const key = `${targetYear}-${String(m + 1).padStart(2, "0")}`;
      const d = new Date(Date.UTC(targetYear, m, 1));
      const stats = byMonth[key] || {
        activityCount: 0,
        totalDistance: 0,
        totalElevation: 0,
        totalDurationSeconds: 0,
      };
      months.push({
        key,
        label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        ...stats,
      });
    }

    const canGoBack = offset < 100;
    return NextResponse.json({ grouping, months, canGoBack });
  }

  // ── Monthly grouping: 12-month window (UTC) ──────────────────────────
  const windowEndMonth = -offset;
  const windowStartMonth = windowEndMonth - 11;

  const startDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + windowStartMonth, 1)
  );
  const endDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + windowEndMonth + 1, 0, 23, 59, 59, 999)
  );

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
    {
      activityCount: number;
      totalDistance: number;
      totalElevation: number;
      totalDurationSeconds: number;
    }
  > = {};

  for (const log of logs) {
    const key = `${log.startDate.getUTCFullYear()}-${String(log.startDate.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key])
      byMonth[key] = {
        activityCount: 0,
        totalDistance: 0,
        totalElevation: 0,
        totalDurationSeconds: 0,
      };
    byMonth[key].activityCount++;
    byMonth[key].totalDistance += log.distanceMeters || 0;
    byMonth[key].totalElevation += log.elevationGainMeters || 0;
    byMonth[key].totalDurationSeconds += log.durationSeconds || 0;
  }

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const m = windowStartMonth + (11 - i);
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const stats = byMonth[key] || {
      activityCount: 0,
      totalDistance: 0,
      totalElevation: 0,
      totalDurationSeconds: 0,
    };
    months.push({
      key,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      ...stats,
    });
  }

  const canGoBack = offset < 120;
  return NextResponse.json({ grouping, months, canGoBack });
}
