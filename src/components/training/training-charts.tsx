"use client";

import { useState, useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ComposedChart,
} from "recharts";
import { formatTime as fmtTime } from "@/lib/trackpoint-charts";
import type { CombinedDataPoint } from "@/lib/trackpoint-charts";

// ─── Shared tooltip style ────────────────────────────────────

const tooltipStyle = { fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" };

// ─── Elevation Profile ───────────────────────────────────────

export function ElevationChart({ data }: { data: { distance: number; ele: number }[] }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Elevation Profile</h3>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="eleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="distance" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}km`} />
            <YAxis tick={{ fontSize: 10 }} width={36} tickFormatter={(v: number) => `${v}m`} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v: number) => `${(v / 1000).toFixed(2)} km`}
              formatter={(v: number) => [`${v} m`, "Elevation"]}
            />
            <Area type="monotone" dataKey="ele" stroke="#8b5cf6" fill="url(#eleGrad)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Heart Rate Chart with Zone Bands ────────────────────────

export function HrChart({ data, maxHr, restingHr }: {
  data: { distance: number; hr: number }[];
  maxHr: number;
  restingHr?: number;
}) {
  const base = restingHr || 0;
  const reserve = maxHr - base;
  const z1 = Math.round(base + reserve * 0.68);
  const z2 = Math.round(base + reserve * 0.83);
  const z3 = Math.round(base + reserve * 0.94);
  const z4 = Math.round(base + reserve * 1.05);

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Heart Rate</h3>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="distance" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}km`} />
            <YAxis tick={{ fontSize: 10 }} width={32} domain={["dataMin - 5", "dataMax + 5"]} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v: number) => `${(v / 1000).toFixed(2)} km`}
              formatter={(v: number) => [`${v} bpm`, "HR"]}
            />
            {/* Zone bands */}
            <ReferenceArea y1={base} y2={z1} fill="#6b7280" fillOpacity={0.06} />
            <ReferenceArea y1={z1} y2={z2} fill="#3b82f6" fillOpacity={0.06} />
            <ReferenceArea y1={z2} y2={z3} fill="#f59e0b" fillOpacity={0.06} />
            <ReferenceArea y1={z3} y2={z4} fill="#ef4444" fillOpacity={0.06} />
            <ReferenceArea y1={z4} y2={maxHr + 10} fill="#a855f7" fillOpacity={0.06} />
            <Area type="monotone" dataKey="hr" stroke="#ef4444" fill="#ef4444" fillOpacity={0.12} strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Zone legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
        {[
          { label: "Z1", color: "#6b7280", range: `${Math.round(base)}–${z1}` },
          { label: "Z2", color: "#3b82f6", range: `${z1}–${z2}` },
          { label: "Z3", color: "#f59e0b", range: `${z2}–${z3}` },
          { label: "Z4", color: "#ef4444", range: `${z3}–${z4}` },
          { label: "Z5", color: "#a855f7", range: `${z4}+` },
        ].map((z) => (
          <span key={z.label} className="text-[10px] text-muted-foreground flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: z.color }} />
            {z.label} {z.range}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── HR Zone Breakdown Bar ───────────────────────────────────

export function HrZoneBar({ zones }: {
  zones: { zone: number; label: string; pct: number; timeMin: number; lowerBpm: number; upperBpm: number }[];
}) {
  const zoneColors = ["#6b7280", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7"];
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-3">HR Zone Distribution</h3>
      <div className="space-y-2">
        {zones.map((z, i) => (
          <div key={z.zone}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-muted-foreground">{z.label}</span>
              <span className="font-medium tabular-nums">{z.pct}% · {fmtTime(z.timeMin * 60)}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className="h-3 rounded-full transition-all"
                style={{ width: `${Math.max(2, z.pct)}%`, background: zoneColors[i] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pace Chart ──────────────────────────────────────────────

export function PaceChart({ data }: { data: { distance: number; pace: number }[] }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Pace</h3>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="distance" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}km`} />
            <YAxis tick={{ fontSize: 10 }} width={40} reversed domain={["dataMin - 0.5", "dataMax + 0.5"]}
              tickFormatter={(v: number) => {
                const min = Math.floor(v);
                const sec = Math.round((v - min) * 60);
                return `${min}:${sec.toString().padStart(2, "0")}`;
              }}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v: number) => `${(v / 1000).toFixed(2)} km`}
              formatter={(v: number) => {
                const min = Math.floor(v);
                const sec = Math.round((v - min) * 60);
                return [`${min}:${sec.toString().padStart(2, "0")} /km`, "Pace"];
              }}
            />
            <Line type="monotone" dataKey="pace" stroke="#0ea5e9" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Power Chart ─────────────────────────────────────────────

export function PowerChart({ data }: { data: { timeSec: number; power: number; smoothedPower: number }[] }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Power</h3>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="timeSec" tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtTime(v)} />
            <YAxis tick={{ fontSize: 10 }} width={36} tickFormatter={(v: number) => `${v}W`} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v: number) => fmtTime(v)}
              formatter={(v: number) => [`${v} W`, "Power"]}
            />
            <Area type="monotone" dataKey="power" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} strokeWidth={0.5} dot={false} />
            <Line type="monotone" dataKey="smoothedPower" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        Thin line = raw · Bold = 30s smoothed
      </p>
    </div>
  );
}

// ─── Grade-Adjusted Pace Chart ───────────────────────────────

export function GapChart({ data }: { data: { distance: number; pace: number; gap: number }[] }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Grade-Adjusted Pace</h3>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="distance" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}km`} />
            <YAxis tick={{ fontSize: 10 }} width={40} reversed domain={["dataMin - 0.5", "dataMax + 0.5"]}
              tickFormatter={(v: number) => {
                const min = Math.floor(v);
                const sec = Math.round((v - min) * 60);
                return `${min}:${sec.toString().padStart(2, "0")}`;
              }}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v: number) => `${(v / 1000).toFixed(2)} km`}
              formatter={(v: number, name: string) => {
                const min = Math.floor(v);
                const sec = Math.round((v - min) * 60);
                return [`${min}:${sec.toString().padStart(2, "0")} /km`, name === "gap" ? "GAP" : "Actual Pace"];
              }}
            />
            <Line type="monotone" dataKey="pace" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" dot={false} />
            <Line type="monotone" dataKey="gap" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        Dashed = actual pace · Solid = grade-adjusted (flattened)
      </p>
    </div>
  );
}

// ─── VAM Card ────────────────────────────────────────────────

export function VamCard({ totalGain, vamTotal, peakVam30min }: {
  totalGain: number; vamTotal: number; peakVam30min: number;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Climbing (VAM)</h3>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold">{totalGain.toLocaleString()}m</div>
          <div className="text-[10px] text-muted-foreground">Total Gain</div>
        </div>
        <div>
          <div className="text-lg font-bold">{vamTotal.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">VAM (m/h)</div>
        </div>
        <div>
          <div className="text-lg font-bold">{peakVam30min.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">Peak 30min VAM</div>
        </div>
      </div>
    </div>
  );
}

// ─── Combined Metrics Chart ──────────────────────────────────

type MetricKey = "ele" | "hr" | "pace" | "gap" | "power";
type XAxisMode = "distance" | "time";

interface MetricDef {
  key: MetricKey;
  label: string;
  color: string;
  unit: string;
  yAxisId: string;
  orientation: "left" | "right";
  reversed?: boolean;
  formatValue?: (v: number) => string;
}

const METRICS: MetricDef[] = [
  { key: "ele",  label: "Elevation", color: "#8b5cf6", unit: "m",       yAxisId: "ele",   orientation: "left" },
  { key: "hr",   label: "Heart Rate",color: "#ef4444", unit: "bpm",     yAxisId: "hr",    orientation: "left" },
  { key: "pace", label: "Pace",      color: "#0ea5e9", unit: "/km",    yAxisId: "pace",  orientation: "right", reversed: true,
    formatValue: (v) => { const m = Math.floor(v); return `${m}:${Math.round((v - m) * 60).toString().padStart(2, "0")}`; } },
  { key: "gap",  label: "GAP",       color: "#10b981", unit: "/km",    yAxisId: "gap",   orientation: "right", reversed: true,
    formatValue: (v) => { const m = Math.floor(v); return `${m}:${Math.round((v - m) * 60).toString().padStart(2, "0")}`; } },
  { key: "power",label: "Power",     color: "#f59e0b", unit: "W",       yAxisId: "power", orientation: "right" },
];

function formatPaceVal(v: number): string {
  const min = Math.floor(v);
  const sec = Math.round((v - min) * 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** Format the x-axis label depending on mode. */
function formatXAxis(value: number, mode: XAxisMode): string {
  if (mode === "distance") return `${(value / 1000).toFixed(1)}km`;
  return fmtTime(value);
}

export function CombinedMetricsChart({ distanceData, timeData, maxHr }: {
  distanceData: CombinedDataPoint[];
  timeData: CombinedDataPoint[];
  maxHr?: number;
}) {
  const [visible, setVisible] = useState<Record<MetricKey, boolean>>({
    ele: true, hr: true, pace: true, gap: true, power: true,
  });
  const [xAxisMode, setXAxisMode] = useState<XAxisMode>("distance");
  const data = xAxisMode === "distance" ? distanceData : timeData;

  const toggleMetric = (key: MetricKey) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Determine which side's axes to show
  const leftMetrics = METRICS.filter((m) => m.orientation === "left" && visible[m.key]);
  const rightMetrics = METRICS.filter((m) => m.orientation === "right" && visible[m.key]);

  // Compute Y-axis domains
  function domain(key: MetricKey): [number, number] {
    const vals = data.map((d) => d[key]).filter((v): v is number => v != null);
    if (vals.length === 0) return [0, 100];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = key === "pace" || key === "gap" ? 0.5 : key === "hr" ? 5 : max * 0.05;
    return [min - pad, max + pad];
  }

  const chartMargin = {
    top: 4,
    right: rightMetrics.length > 1 ? 64 : 8,
    bottom: 0,
    left: leftMetrics.length > 1 ? 64 : 8,
  };

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      {/* Controls bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => toggleMetric(m.key)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                visible[m.key]
                  ? "text-foreground border"
                  : "text-muted-foreground border border-dashed opacity-50"
              }`}
              style={visible[m.key] ? { borderColor: m.color, backgroundColor: `${m.color}14` } : {}}
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: m.color }} />
              {m.label}
            </button>
          ))}
        </div>
        {/* X-axis toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border p-0.5 bg-background">
          <button
            onClick={() => setXAxisMode("distance")}
            className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors ${
              xAxisMode === "distance" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Distance
          </button>
          <button
            onClick={() => setXAxisMode("time")}
            className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors ${
              xAxisMode === "time" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Time
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey={xAxisMode === "distance" ? "distance" : "timeSec"}
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => formatXAxis(v, xAxisMode)}
            />

            {/* Left Y-axes: Elevation + HR */}
            {visible.ele && (
              <YAxis
                yAxisId="ele"
                orientation="left"
                stroke="#8b5cf6"
                tick={{ fontSize: 10, fill: "#8b5cf6" }}
                width={36}
                domain={domain("ele")}
                tickFormatter={(v: number) => `${Math.round(v)}m`}
              />
            )}
            {visible.hr && (
              <YAxis
                yAxisId="hr"
                orientation="left"
                stroke="#ef4444"
                tick={{ fontSize: 10, fill: "#ef4444" }}
                width={36}
                domain={domain("hr")}
                tickFormatter={(v: number) => `${Math.round(v)}`}
              />
            )}

            {/* Right Y-axes: Pace + GAP + Power */}
            {visible.pace && (
              <YAxis
                yAxisId="pace"
                orientation="right"
                stroke="#0ea5e9"
                tick={{ fontSize: 10, fill: "#0ea5e9" }}
                width={40}
                reversed
                domain={domain("pace")}
                tickFormatter={(v: number) => formatPaceVal(v)}
              />
            )}
            {visible.gap && (
              <YAxis
                yAxisId="gap"
                orientation="right"
                stroke="#10b981"
                tick={{ fontSize: 10, fill: "#10b981" }}
                width={40}
                reversed
                domain={domain("gap")}
                tickFormatter={(v: number) => formatPaceVal(v)}
              />
            )}
            {visible.power && (
              <YAxis
                yAxisId="power"
                orientation="right"
                stroke="#f59e0b"
                tick={{ fontSize: 10, fill: "#f59e0b" }}
                width={36}
                domain={domain("power")}
                tickFormatter={(v: number) => `${Math.round(v)}W`}
              />
            )}

            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v: number) => formatXAxis(v, xAxisMode)}
              formatter={(v: number, name: string) => {
                switch (name) {
                  case "ele":   return [`${Math.round(v)} m`, "Elevation"];
                  case "hr":    return [`${Math.round(v)} bpm`, "HR"];
                  case "pace":  return [`${formatPaceVal(v)} /km`, "Pace"];
                  case "gap":   return [`${formatPaceVal(v)} /km`, "GAP"];
                  case "power": return [`${Math.round(v)} W`, "Power"];
                  case "smoothedPower": return [`${Math.round(v)} W`, "Power (smoothed)"];
                  default:      return [v, name];
                }
              }}
            />

            {/* Elevation area */}
            {visible.ele && (
              <>
                <defs>
                  <linearGradient id="combEleGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area yAxisId="ele" type="monotone" dataKey="ele" stroke="#8b5cf6" fill="url(#combEleGrad)" strokeWidth={1.5} dot={false} />
              </>
            )}

            {/* HR area */}
            {visible.hr && (
              <Area yAxisId="hr" type="monotone" dataKey="hr" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={1.5} dot={false} />
            )}

            {/* Pace line */}
            {visible.pace && (
              <Line yAxisId="pace" type="monotone" dataKey="pace" stroke="#0ea5e9" strokeWidth={1.5} dot={false} />
            )}

            {/* GAP line */}
            {visible.gap && (
              <Line yAxisId="gap" type="monotone" dataKey="gap" stroke="#10b981" strokeWidth={1.5} dot={false} />
            )}

            {/* Power: thin raw + thick smoothed */}
            {visible.power && (
              <>
                <Area yAxisId="power" type="monotone" dataKey="power" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.06} strokeWidth={0.5} dot={false} />
                <Line yAxisId="power" type="monotone" dataKey="smoothedPower" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend hint */}
      {visible.pace && visible.gap && (
        <p className="text-[10px] text-muted-foreground mt-1">
          Pace (solid blue) · GAP (solid green) · Raw power (thin amber) · Smoothed power (bold amber)
        </p>
      )}
    </div>
  );
}
