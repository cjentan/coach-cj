"use client";

import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ComposedChart, Legend,
} from "recharts";
import { formatTime as fmtTime } from "@/lib/trackpoint-charts";

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
