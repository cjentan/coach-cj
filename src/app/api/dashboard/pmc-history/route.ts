import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computePMC, fillDailyTss } from "@/lib/pmc";
import { cache } from "react";

const cachedComputePMC = cache(computePMC);

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const displayDays = Math.min(365, Math.max(7, parseInt(searchParams.get("days") || "90")));
  // CTL is a 42-day EWMA — compute from at least 90 days so it stabilizes
  // before the displayed window, then trim to the requested range
  const computeDays = Math.min(365, Math.max(displayDays, 90));

  const now = new Date();
  const since = new Date(now.getTime() - computeDays * 86400000);

  const logs = await prisma.trainingLog.findMany({
    where: { userId: session.user.id, startDate: { gte: since }, mergedIntoId: null },
    orderBy: { startDate: "asc" },
    select: {
      startDate: true,
      tss: true,
      durationSeconds: true,
    },
  });

  // Build daily TSS map using stored TSS (or estimate from duration)
  const tssByDate: Record<string, number> = {};
  for (const log of logs) {
    const dateKey = log.startDate.toISOString().split("T")[0];
    const tss = log.tss || Math.round(log.durationSeconds / 3600 * 50);
    tssByDate[dateKey] = (tssByDate[dateKey] || 0) + tss;
  }

  const pmcInput = Object.entries(tssByDate)
    .map(([date, tss]) => ({ date, tss }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Fill in missing dates with tss: 0 so the chart's x-axis is continuous,
  // CTL/ATL/TSB decay naturally on rest days, and the series extends through
  // today even when the last activity was earlier.
  const filledInput = fillDailyTss(pmcInput);

  const pmcResults = cachedComputePMC(filledInput);

  // Build time-series arrays for charting
  const series = pmcResults.map((r) => ({
    date: r.date,
    tss: r.tss,
    ctl: r.ctl,
    atl: r.atl,
    tsb: r.tsb,
  }));

  // Trim to the requested display window so CTL has stabilized before it
  const trimmed = displayDays < computeDays && series.length > displayDays
    ? series.slice(series.length - displayDays)
    : series;

  return NextResponse.json({ days: displayDays, series: trimmed });
}
