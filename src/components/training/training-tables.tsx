"use client";

import { Split, formatSplitPace, formatTime } from "@/lib/trackpoint-charts";
import { LapSummary } from "@/lib/trackpoint-charts";
import { RoutePoint } from "@/lib/trackpoint-charts";

// ─── Splits Table ────────────────────────────────────────────

export function SplitsTable({ splits, paceUnit }: { splits: Split[]; paceUnit?: string }) {
  if (splits.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-12">#</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Split</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Cum. Time</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Pace</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">HR</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Gain</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {splits.map((s) => (
            <tr key={s.km} className="hover:bg-muted/30 tabular-nums">
              <td className="px-3 py-1.5 text-muted-foreground">{s.km}</td>
              <td className="px-3 py-1.5 font-medium">{formatTime(s.splitSec)}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{formatTime(s.timeSec)}</td>
              <td className="px-3 py-1.5">{formatSplitPace(s.pace)}</td>
              <td className="px-3 py-1.5">{s.avgHr ? `${s.avgHr} bpm` : "—"}</td>
              <td className="px-3 py-1.5">{s.gainM > 0 ? `${s.gainM}m` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Lap Table (TCX-style laps) ──────────────────────────────

export function LapTable({ laps }: { laps: LapSummary[] }) {
  if (!laps || laps.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-12">Lap</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Time</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Distance</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Pace</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Avg HR</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Max HR</th>
            {laps.some((l) => l.avgPower) && (
              <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Power</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {laps.map((lap) => (
            <tr key={lap.index} className="hover:bg-muted/30 tabular-nums">
              <td className="px-3 py-1.5 text-muted-foreground">{lap.index}</td>
              <td className="px-3 py-1.5 font-medium">{formatTime(lap.durationSec)}</td>
              <td className="px-3 py-1.5">{(lap.distanceM / 1000).toFixed(2)} km</td>
              <td className="px-3 py-1.5">{formatSplitPace(lap.pace)}</td>
              <td className="px-3 py-1.5">{lap.avgHr ? `${lap.avgHr} bpm` : "—"}</td>
              <td className="px-3 py-1.5">{lap.maxHr ? `${lap.maxHr} bpm` : "—"}</td>
              {laps.some((l) => l.avgPower) && (
                <td className="px-3 py-1.5">{lap.avgPower ? `${lap.avgPower}W` : "—"}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Route Map (SVG polyline) ────────────────────────────────

export function RouteMap({ points }: { points: RoutePoint[] }) {
  if (points.length < 3) return null;
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Route</h3>
      <svg
        viewBox="0 0 100 100"
        className="w-full h-48 rounded"
        style={{ background: "var(--muted)" }}
      >
        {/* Grid lines */}
        {[25, 50, 75].map((pct) => (
          <g key={pct}>
            <line x1={pct} y1={0} x2={pct} y2={100} stroke="var(--border)" strokeWidth={0.3} />
            <line x1={0} y1={pct} x2={100} y2={pct} stroke="var(--border)" strokeWidth={0.3} />
          </g>
        ))}
        {/* Route polyline */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
        {/* Start marker */}
        {points.length > 0 && (
          <circle cx={points[0].x} cy={points[0].y} r={1.8} fill="#22c55e" stroke="white" strokeWidth={0.5} />
        )}
        {/* End marker */}
        {points.length > 1 && (
          <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={1.8} fill="#ef4444" stroke="white" strokeWidth={0.5} />
        )}
      </svg>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" /> Start</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" /> End</span>
      </div>
    </div>
  );
}
