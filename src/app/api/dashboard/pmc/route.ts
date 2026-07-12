import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computePMC } from "@/lib/pmc";
import { computeBestTss } from "@/lib/trackpoint-metrics";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();

  // Fetch last 90 days of logs for PMC computation (42-day CTL needs ~60+ days to stabilize)
  // Include rawJson to compute better TSS from trackpoint data when available
  const logs = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      startDate: { gte: new Date(now.getTime() - 90 * 86400000) },
    },
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

    // Use trackpoint-based TSS if rawJson has trackPoints, fall back to stored TSS
    const rawJson = log.rawJson as Record<string, unknown> | null;
    const trackPoints = rawJson?.trackPoints as any[] | undefined;
    const tss = trackPoints && trackPoints.length >= 2
      ? computeBestTss(trackPoints as any, log.averageHr, log.maxHr, log.durationSeconds)
      : (log.tss || Math.round(log.durationSeconds / 3600 * 50));

    tssByDate[dateKey] = (tssByDate[dateKey] || 0) + tss;
  }

  const pmcInput = Object.entries(tssByDate).map(([date, tss]) => ({ date, tss }));
  const pmcResults = computePMC(pmcInput);

  if (pmcResults.length === 0) {
    return NextResponse.json({ ctl: 0, atl: 0, tsb: 0, rampRate: null, ctlTrend: "stable", atlTrend: "stable", tsbTrend: "stable" });
  }

  const latest = pmcResults[pmcResults.length - 1];

  // Find entry ~7 days ago for trend comparison
  const getTrend = (current: number, previous: number): "up" | "down" | "stable" => {
    const diff = current - previous;
    if (diff > 0.5) return "up";
    if (diff < -0.5) return "down";
    return "stable";
  };

  let prevEntry: typeof latest | null = null;
  const latestDate = new Date(latest.date + "T00:00:00");
  const targetDateStr = new Date(latestDate.getTime() - 7 * 86400000).toISOString().split("T")[0];

  // Try exact match first, then ±1 day window
  for (const entry of pmcResults) {
    if (entry.date === targetDateStr) {
      prevEntry = entry;
      break;
    }
  }
  if (!prevEntry) {
    for (const entry of pmcResults) {
      const entryDate = new Date(entry.date + "T00:00:00");
      const dayDiff = Math.abs((entryDate.getTime() - new Date(targetDateStr + "T00:00:00").getTime()) / 86400000);
      if (dayDiff <= 1) {
        prevEntry = entry;
        break;
      }
    }
  }
  // Fallback: use entry ~8 positions back
  if (!prevEntry && pmcResults.length > 7) {
    prevEntry = pmcResults[pmcResults.length - 8];
  }

  return NextResponse.json({
    ctl: latest.ctl,
    atl: latest.atl,
    tsb: latest.tsb,
    rampRate: latest.rampRate,
    ctlTrend: prevEntry ? getTrend(latest.ctl, prevEntry.ctl) : "stable",
    atlTrend: prevEntry ? getTrend(latest.atl, prevEntry.atl) : "stable",
    tsbTrend: prevEntry ? getTrend(latest.tsb, prevEntry.tsb) : "stable",
  });
}
