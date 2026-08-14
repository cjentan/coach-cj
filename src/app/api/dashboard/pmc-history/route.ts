import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computePMC, fillDailyTss } from "@/lib/pmc";
import { localDateStr } from "@/lib/utils";
import { cache } from "react";

const cachedComputePMC = cache(computePMC);

/**
 * Shift a "YYYY-MM-DD" local date string by N days. Used to compute the trailing
 * 28-day window for the FTP estimate. Dates are ISO local strings, so comparing
 * them lexicographically is equivalent to chronological ordering.
 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * Fill gaps in a sparse daily metric with monotone cubic Hermite interpolation
 * so the chart draws a continuous line instead of disjointed segments. Sparse
 * metrics like EF and HR decoupling are only measured on activity days with
 * valid trackpoints, so the raw series has nulls between rides. Interpolating
 * across the gaps yields a smooth curve that passes through the real
 * measurements without overshooting between them. Days before the first / after
 * the last measurement stay null: the line starts and ends at real data.
 */
function interpolateGaps<K extends string>(series: Array<Record<K, number | null>>, key: K): void {
  const measured: number[] = [];
  for (let i = 0; i < series.length; i++) {
    if (series[i][key] != null) measured.push(i);
  }
  if (measured.length < 2) return; // nothing to connect

  const xs = measured;
  const ys = measured.map((i) => series[i][key] as number);

  // Steffen-style tangents, clamped so each Hermite segment stays monotone.
  const n = xs.length;
  const slopes = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    slopes[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  }
  const tangents = new Array<number>(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const [p, q] = [slopes[i - 1], slopes[i]];
    tangents[i] = p * q > 0 ? Math.sign(p) * Math.min(Math.abs(p), Math.abs(q)) : 0;
  }

  // Sample the cubic Hermite through each gap at every day index inside it.
  for (let k = 0; k + 1 < n; k++) {
    const a = xs[k];
    const b = xs[k + 1];
    const span = b - a;
    if (span <= 1) continue;
    const [y0, y1] = [ys[k], ys[k + 1]];
    const [t0, t1] = [tangents[k], tangents[k + 1]];
    for (let j = a + 1; j < b; j++) {
      const h = (j - a) / span;
      const h2 = h * h;
      const h3 = h2 * h;
      const v =
        (2 * h3 - 3 * h2 + 1) * y0 +
        (h3 - 2 * h2 + h) * span * t0 +
        (-2 * h3 + 3 * h2) * y1 +
        (h3 - h2) * span * t1;
      series[j][key] = Math.round(v * 100) / 100;
    }
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const tzOffset = parseInt(searchParams.get("tzOffset") || "0", 10) || 0;
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
      efficiencyFactor: true,
      decouplingPct: true,
      trackpointNormalizedPower: true,
    },
  });

  // Build daily TSS map using stored TSS (or estimate from duration), bucketed
  // by the user's LOCAL date so the chart x-axis matches their calendar.
  const tssByDate: Record<string, number> = {};
  // EF is a per-activity metric (requires power+HR trackpoints), so it only
  // exists on some days; average the day's activities to plot a daily value.
  const efSumByDate: Record<string, number> = {};
  const efCountByDate: Record<string, number> = {};
  const decSumByDate: Record<string, number> = {};
  const decCountByDate: Record<string, number> = {};
  // FTP is estimated from the best normalized power, so keep the max NP per
  // local date (not a sum) for the trailing-window computation below.
  const npMaxByDate: Record<string, number> = {};
  for (const log of logs) {
    const dateKey = localDateStr(log.startDate, tzOffset);
    const tss = log.tss || Math.round(log.durationSeconds / 3600 * 50);
    tssByDate[dateKey] = (tssByDate[dateKey] || 0) + tss;
    if (log.efficiencyFactor != null) {
      efSumByDate[dateKey] = (efSumByDate[dateKey] || 0) + log.efficiencyFactor;
      efCountByDate[dateKey] = (efCountByDate[dateKey] || 0) + 1;
    }
    if (log.decouplingPct != null) {
      decSumByDate[dateKey] = (decSumByDate[dateKey] || 0) + log.decouplingPct;
      decCountByDate[dateKey] = (decCountByDate[dateKey] || 0) + 1;
    }
    if (log.trackpointNormalizedPower != null) {
      npMaxByDate[dateKey] = Math.max(npMaxByDate[dateKey] || 0, log.trackpointNormalizedPower);
    }
  }

  const pmcInput = Object.entries(tssByDate)
    .map(([date, tss]) => ({ date, tss }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Fill in missing dates with tss: 0 so the chart's x-axis is continuous,
  // CTL/ATL/TSB decay naturally on rest days, and the series extends through
  // today even when the last activity was earlier. Extends to the user's local
  // today so the chart reflects their current date.
  const filledInput = fillDailyTss(pmcInput, localDateStr(now, tzOffset));

  const pmcResults = cachedComputePMC(filledInput);

  // Build time-series arrays for charting
  const series = pmcResults.map((r) => ({
    date: r.date,
    tss: r.tss,
    ctl: r.ctl,
    atl: r.atl,
    tsb: r.tsb,
    // null on days without the measurement; the measured* flags mark real
    // measurements so the chart can distinguish them from interpolated days.
    ef: efCountByDate[r.date]
      ? Math.round((efSumByDate[r.date] / efCountByDate[r.date]) * 100) / 100
      : null,
    measuredEf: efCountByDate[r.date] > 0,
    decoupling: decCountByDate[r.date]
      ? Math.round((decSumByDate[r.date] / decCountByDate[r.date]) * 10) / 10
      : null,
    measuredDecoupling: decCountByDate[r.date] > 0,
    // FTP = 95% of the best normalized power in the trailing 28 days, matching
    // the standalone Est. FTP card (best recent NP × 0.95). The sliding window
    // lets the estimate rise and fall with fitness; null when no power activity
    // has occurred in the window (no interpolation — a gap means "no data").
    ftp: (() => {
      let best = 0;
      for (let d = addDays(r.date, -27); d <= r.date; d = addDays(d, 1)) {
        const np = npMaxByDate[d];
        if (np != null && np > best) best = np;
      }
      return best > 0 ? Math.round(best * 0.95) : null;
    })(),
  }));

  // Fill sparse-metric gaps with smooth interpolation so lines are continuous.
  interpolateGaps(series, "ef");
  interpolateGaps(series, "decoupling");

  // Trim to the requested display window so CTL has stabilized before it
  const trimmed = displayDays < computeDays && series.length > displayDays
    ? series.slice(series.length - displayDays)
    : series;

  return NextResponse.json({ days: displayDays, series: trimmed });
}
