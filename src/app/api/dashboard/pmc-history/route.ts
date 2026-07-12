import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computePMC } from "@/lib/pmc";
import { computeBestTss } from "@/lib/trackpoint-metrics";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get("days") || "90")));

  const now = new Date();
  const since = new Date(now.getTime() - days * 86400000);

  const logs = await prisma.trainingLog.findMany({
    where: { userId: session.user.id, startDate: { gte: since } },
    orderBy: { startDate: "asc" },
    select: {
      startDate: true,
      tss: true,
      durationSeconds: true,
      averageHr: true,
      maxHr: true,
      rawJson: true,
    },
  });

  // Build daily TSS map using trackpoint-derived TSS when available
  const tssByDate: Record<string, number> = {};
  for (const log of logs) {
    const dateKey = log.startDate.toISOString().split("T")[0];

    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as any[] | undefined;
    const tss = trackPoints && trackPoints.length >= 2
      ? computeBestTss(trackPoints as any, log.averageHr, log.maxHr, log.durationSeconds)
      : (log.tss || Math.round(log.durationSeconds / 3600 * 50));

    tssByDate[dateKey] = (tssByDate[dateKey] || 0) + tss;
  }

  const pmcInput = Object.entries(tssByDate)
    .map(([date, tss]) => ({ date, tss }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const pmcResults = computePMC(pmcInput);

  // Build time-series arrays for charting
  const series = pmcResults.map((r) => ({
    date: r.date,
    tss: r.tss,
    ctl: r.ctl,
    atl: r.atl,
    tsb: r.tsb,
  }));

  return NextResponse.json({ days, series });
}
