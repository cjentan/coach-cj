"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration } from "@/lib/utils";
import { Activity, ChevronRight, Route, Mountain, Clock, Heart, Target, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus, BarChart3, Database } from "lucide-react";
import PlanAdjustDialog from "@/components/plan/plan-adjust-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface LogEntry {
  id: string; name: string; type: string; startDate: string;
  distanceMeters: number | null; durationSeconds: number;
  elevationGainMeters: number | null; averageHr: number | null;
  tss: number | null; remarks: string | null;
}

interface PlanData {
  weekStart: string; targetVolumeMeters: number; targetElevationMeters: number;
  plannedSessions: { dayOfWeek: number; type: string; description: string;
    targetDistance: number | null; targetElevation: number | null; targetDuration: number; facility: string | null }[];
  adjustments: string[]; trajectoryAssessment?: string; coachNotes?: string; fromCache?: boolean;
}

interface ReadinessData {
  score: number; label: string; detail: string;
  volumeAdherence: number;
}

interface FatigueData {
  severity: string; summary: string; signals: string[]; recommendations: string[];
  consistency: number; weeklyTss: number;
}

interface GoalSummary {
  id: string; name: string; targetDate: string; distanceMeters: number;
  elevationGainMeters: number | null; priority: string;
  progress: number; daysUntil: number;
}

interface StatsComparison {
  weeklyDistance: number; weeklyElevation: number; weeklyDuration: number;
  weeklyCount: number; weeklyTss: number; avgDailyTss: number;
  avgHr: number | null;
}

interface Stats {
  weeklyDistance: number; weeklyElevation: number; weeklyDuration: number;
  weeklyCount: number; weeklyTss: number; avgDailyTss: number;
  avgHr: number | null; activeGoals: number; latestWeight: number | null;
  latestRestingHr: number | null; estimatedMaxHr: number | null;
  lastWeek: StatsComparison | null;
  currentMonth: StatsComparison | null;
  lastMonth: StatsComparison | null;
}

interface PmcData {
  ctl: number; atl: number; tsb: number; rampRate: number | null;
  ctlTrend: "up" | "down" | "stable";
  atlTrend: "up" | "down" | "stable";
  tsbTrend: "up" | "down" | "stable";
}

interface PmcHistoryPoint {
  date: string; tss: number; ctl: number; atl: number; tsb: number;
}

interface TrackpointInsights {
  available: boolean;
  message?: string;
  activityCount?: number;
  intensityDistribution?: {
    zone1Pct: number; zone2Pct: number; zone3Pct: number; zone4Pct: number; zone5Pct: number;
    distributionType: "polarized" | "pyramidal" | "threshold-heavy";
    activityCount: number; totalAnalyzedHours: number;
  } | null;
  decoupling?: {
    avgDecouplingPct: number; status: "excellent" | "good" | "elevated";
    activityCount: number;
  } | null;
  efTrend?: { weekStart: string; ef: number; activityCount: number }[];
  estimatedFtp?: number | null;
  estimatedFtpWkg?: number | null;
  weightSource?: string | null;
}

interface TrendPoint {
  weekStartDate: string;
  readinessScore: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  weeklyVolumeMeters: number | null;
  weeklyElevationMeters: number | null;
  weeklyDurationSeconds: number | null;
  weeklyTss: number;
  activityCount: number;
  avgDailyTss: number;
  avgHr: number | null;
  volumeAdherence: number | null;
  consistency: number | null;
  fatigueSeverity: string;
}

const TIME_RANGES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [fatigue, setFatigue] = useState<FatigueData | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [coachNotes, setCoachNotes] = useState<string | null>(null);
  const [coachNotesAt, setCoachNotesAt] = useState<string | null>(null);
  const [pmc, setPmc] = useState<PmcData | null>(null);
  const [pmcHistory, setPmcHistory] = useState<PmcHistoryPoint[]>([]);
  const [pmcDays, setPmcDays] = useState(90);
  const [pmcMetrics, setPmcMetrics] = useState<Set<string>>(new Set(["tss", "ctl"]));
  const [trendMetrics, setTrendMetrics] = useState<Set<string>>(new Set(["readinessScore", "weeklyVolumeMeters"]));

  const PMC_METRICS = [
    { key: "tss", label: "Daily TSS Load", color: "#a855f7", unit: "", format: (v: number) => String(Math.round(v)) },
    { key: "ctl", label: "CTL · Fitness", color: "#3b82f6", unit: "", format: (v: number) => String(Math.round(v)) },
    { key: "atl", label: "ATL · Fatigue", color: "#f59e0b", unit: "", format: (v: number) => String(Math.round(v)) },
    { key: "tsb", label: "TSB · Form", color: "#22c55e", unit: "", format: (v: number) => String(Math.round(v)) },
  ] as const;

  const TREND_METRICS = [
    { key: "readinessScore", label: "Readiness Score", color: "#3b82f6", unit: "", format: (v: number) => String(Math.round(v)), yAxisId: "left", orientation: "left" as const,
      tickFormatter: (v: number) => String(Math.round(v)) },
    { key: "weeklyVolumeMeters", label: "Weekly Volume", color: "#3b82f6", unit: "km", format: (v: number) => `${(v / 1000).toFixed(1)}`, yAxisId: "right1", orientation: "right" as const,
      tickFormatter: (v: number) => `${(v / 1000).toFixed(0)}k` },
    { key: "weeklyTss", label: "Weekly TSS", color: "#a855f7", unit: "", format: (v: number) => String(Math.round(v)), yAxisId: "right2", orientation: "right" as const,
      tickFormatter: (v: number) => String(Math.round(v)) },
    { key: "activityCount", label: "Activities", color: "#22c55e", unit: "", format: (v: number) => String(Math.round(v)), yAxisId: "right3", orientation: "right" as const,
      tickFormatter: (v: number) => String(Math.round(v)) },
  ] as const;
  const [trackpointInsights, setTrackpointInsights] = useState<TrackpointInsights | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [trendWeeks, setTrendWeeks] = useState(52);
  const [trendGrouping, setTrendGrouping] = useState<"week" | "month">("week");
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [volumePeriod, setVolumePeriod] = useState<"week" | "month">("week");

  function computeDelta(current: number, prior: number | null | undefined): { direction: "up" | "down" | "flat" | "new"; pct: number } | null {
    if (prior === null || prior === undefined || prior === 0) {
      if (current === 0) return null;
      return { direction: "new", pct: 100 };
    }
    if (current === 0) return { direction: "down", pct: 100 };
    const pct = Math.round(((current - prior) / prior) * 100);
    if (pct > 0) return { direction: "up", pct };
    if (pct < 0) return { direction: "down", pct: Math.abs(pct) };
    return { direction: "flat", pct: 0 };
  }

  async function loadAll() {
    setLoading(true);
    setFetchError("");
    try {
      // Consolidated endpoint — single HTTP round-trip for all main dashboard data
      const res = await fetch("/api/dashboard/load");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setLogs(data.logs || []);
      setStats(data.stats || null);
      setGoals(data.goals || []);
      setFatigue(data.fatigue || null);
      setReadiness(data.readiness || null);
      setPmc(data.pmc || null);
      if (data.coachNotes) { setCoachNotes(data.coachNotes); setCoachNotesAt(data.coachNotesAt); }

      // Plan loads separately (may trigger plan generation)
      fetch("/api/dashboard/plan")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d && setPlan(d))
        .catch(() => {});
      // Trackpoint insights (fire-and-forget)
      fetch("/api/dashboard/trackpoint-insights")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d && setTrackpointInsights(d))
        .catch(() => {});
      // Historical trends (fire-and-forget)
      fetch(`/api/dashboard/trends?weeks=${trendWeeks}&grouping=${trendGrouping}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d?.trends && setTrends(d.trends))
        .catch(() => {});
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const fetchPmcHistory = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/dashboard/pmc-history?days=${days}`);
      if (res.ok) {
        const data = await res.json();
        setPmcHistory(data.series || []);
      }
    } catch { /* ignore */ }
  }, []);

  async function generateNotes() {
    setGenerating(true);
    try {
      const res = await fetch("/api/dashboard/notes", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setCoachNotes(data.coachNotes);
        if (data.generatedAt) setCoachNotesAt(data.generatedAt);
      }
    } catch { /* ignore */ }
    setGenerating(false);
  }

  const handlePlanApplied = useCallback((updatedPlan: PlanData) => {
    setPlan(updatedPlan);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
    else if (status === "authenticated") loadAll();
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") fetchPmcHistory(pmcDays);
  }, [status, pmcDays, fetchPmcHistory]);

  // Refetch trends when range or grouping changes
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch(`/api/dashboard/trends?weeks=${trendWeeks}&grouping=${trendGrouping}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d?.trends && setTrends(d.trends))
      .catch(() => {});
  }, [status, trendWeeks, trendGrouping]);

  if (status === "loading" || loading) {
    return <div className="max-w-5xl mx-auto px-4 py-8">Loading...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          Welcome{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}
        </h1>
        <Button variant="outline" size="sm" onClick={loadAll}>
          <Activity className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {fetchError && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded mb-4">
          Error: {fetchError}. <button className="underline" onClick={loadAll}>Retry</button>
        </div>
      )}

      {/* Readiness Score */}
      {readiness && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <Card className="sm:col-span-2 lg:col-span-1">
            <CardContent className="py-4 sm:py-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                <div className={`text-4xl sm:text-5xl font-bold ${
                  readiness.score >= 70 ? "text-green-600" :
                  readiness.score >= 50 ? "text-amber-600" : "text-red-600"
                }`}>
                  {readiness.score}
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Readiness Score / 100</div>
                  <div className={`font-semibold text-base sm:text-lg truncate ${
                    readiness.score >= 70 ? "text-green-600" :
                    readiness.score >= 50 ? "text-amber-600" : "text-red-600"
                  }`}>
                    {readiness.label}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{readiness.detail}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 sm:py-5">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Volume</div>
              <div className="text-2xl font-bold">{readiness.volumeAdherence}%</div>
              <div className="text-xs text-muted-foreground">of weekly target</div>
              <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${readiness.volumeAdherence}%` }} />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Volume & Load Card */}
      {stats && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Volume & Load
              </h2>
              <Tabs value={volumePeriod} onValueChange={(v) => setVolumePeriod(v as "week" | "month")}>
                <TabsList className="h-8">
                  <TabsTrigger value="week" className="text-xs px-3">Week</TabsTrigger>
                  <TabsTrigger value="month" className="text-xs px-3">Month</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: "Distance",
                  current: stats.weeklyDistance,
                  prior: volumePeriod === "week" ? stats.lastWeek?.weeklyDistance : stats.lastMonth?.weeklyDistance,
                  formattedValue: formatDistance(stats.weeklyDistance),
                  icon: <Route className="h-4 w-4" />,
                },
                {
                  label: "Elevation",
                  current: stats.weeklyElevation,
                  prior: volumePeriod === "week" ? stats.lastWeek?.weeklyElevation : stats.lastMonth?.weeklyElevation,
                  formattedValue: `${Math.round(stats.weeklyElevation).toLocaleString()} m`,
                  icon: <Mountain className="h-4 w-4" />,
                },
                {
                  label: "Duration",
                  current: stats.weeklyDuration,
                  prior: volumePeriod === "week" ? stats.lastWeek?.weeklyDuration : stats.lastMonth?.weeklyDuration,
                  formattedValue: formatDuration(stats.weeklyDuration),
                  icon: <Clock className="h-4 w-4" />,
                },
                {
                  label: "TSS Load",
                  current: stats.weeklyTss,
                  prior: volumePeriod === "week" ? stats.lastWeek?.weeklyTss : stats.lastMonth?.weeklyTss,
                  formattedValue: String(stats.weeklyTss),
                  icon: <TrendingUp className="h-4 w-4" />,
                },
              ].map((metric) => {
                const delta = computeDelta(metric.current, metric.prior);
                return (
                  <div key={metric.label}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-muted-foreground">{metric.icon}</span>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">{metric.label}</span>
                    </div>
                    <div className="text-2xl font-bold">{metric.formattedValue}</div>
                    {delta && (
                      <div className="flex items-center gap-1 mt-0.5">
                        {delta.direction === "up" && <ArrowUp className="h-3 w-3 text-green-500" />}
                        {delta.direction === "down" && <ArrowDown className="h-3 w-3 text-red-500" />}
                        {delta.direction === "flat" && <Minus className="h-3 w-3 text-muted-foreground" />}
                        {delta.direction === "new" ? (
                          <span className="text-xs text-blue-500 font-medium">New</span>
                        ) : (
                          <span className={`text-xs font-medium ${
                            delta.direction === "up" ? "text-green-600" :
                            delta.direction === "down" ? "text-red-600" :
                            "text-muted-foreground"
                          }`}>
                            {delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "—"} {delta.pct}% vs last {volumePeriod}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Secondary Stats Row */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {/* Heart Rate Card — resting HR + HR zone boundaries */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Heart className="h-3.5 w-3.5 text-red-500" /> Heart Rate Zones
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-3 pb-3 border-b">
                {stats.latestRestingHr ? (
                  <div>
                    <span className="text-2xl font-bold">{stats.latestRestingHr}</span>
                    <span className="text-sm text-muted-foreground ml-1">bpm</span>
                    <div className="text-[10px] text-muted-foreground">Resting HR</div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">No resting HR data</div>
                )}
                {stats.estimatedMaxHr && (
                  <div className="border-l pl-3">
                    <span className="text-lg font-semibold">{stats.estimatedMaxHr}</span>
                    <span className="text-xs text-muted-foreground ml-0.5">bpm</span>
                    <div className="text-[10px] text-muted-foreground">Est. max HR</div>
                  </div>
                )}
                {stats.avgHr && (
                  <div className="border-l pl-3">
                    <span className="text-lg font-semibold">{Math.round(stats.avgHr)}</span>
                    <span className="text-xs text-muted-foreground ml-0.5">bpm</span>
                    <div className="text-[10px] text-muted-foreground">Avg exercise</div>
                  </div>
                )}
              </div>
              {/* HR Zone boundaries computed from maxHR + restingHR */}
              {(() => {
                const maxHr = stats.estimatedMaxHr;
                const restHr = stats.latestRestingHr;
                if (!maxHr) return <div className="text-xs text-muted-foreground italic">Log activities with heart rate data to calculate zones.</div>;

                // Coggan 5-zone thresholds as % of maxHR (or HR reserve if resting available)
                const thresholds = [0.68, 0.83, 0.94, 1.05];
                const zoneLabels = ["Z1 Recov", "Z2 Endur", "Z3 Tempo", "Z4 Thresh", "Z5 Anaer"];
                const zoneColors = ["bg-blue-400", "bg-green-400", "bg-amber-400", "bg-orange-500", "bg-red-500"];
                const zoneTextColors = ["text-blue-500", "text-green-500", "text-amber-500", "text-orange-600", "text-red-500"];

                const zones = zoneLabels.map((_, i) => {
                  let lower: number;
                  let upper: number;
                  if (restHr) {
                    const reserve = maxHr - restHr;
                    lower = i === 0 ? 0 : Math.round(restHr + reserve * thresholds[i - 1]);
                    upper = i < 5 ? Math.round(restHr + reserve * thresholds[Math.min(i, thresholds.length - 1)]) : 999;
                  } else {
                    lower = i === 0 ? 0 : Math.round(maxHr * thresholds[i - 1]);
                    upper = i < 5 ? Math.round(maxHr * thresholds[Math.min(i, thresholds.length - 1)]) : 999;
                  }
                  return { lower, upper, label: zoneLabels[i], color: zoneColors[i], textColor: zoneTextColors[i] };
                });

                return (
                  <div className="space-y-1.5">
                    {zones.map((z) => (
                      <div key={z.label} className="flex items-center gap-2 text-[11px]">
                        <span className="w-16 text-muted-foreground shrink-0">{z.label}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`${z.color} h-full rounded-full`} style={{ width: `${100 / 5}%`, marginLeft: `${(z.lower / (maxHr * 1.1)) * 100}%` }} />
                        </div>
                        <span className={`w-20 text-right font-medium tabular-nums ${z.textColor}`}>
                          {z.lower === 0 ? `<${z.upper}` : z.upper >= 999 ? `>${z.lower}` : `${z.lower}–${z.upper}`} bpm
                        </span>
                      </div>
                    ))}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {restHr ? "Karvonen formula" : "% of maxHR"} · Coggan 5-zone model
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
          {stats.latestWeight && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Activity className="h-3.5 w-3.5" /> Weight
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold">{stats.latestWeight}</span>
                  <span className="text-sm text-muted-foreground">kg</span>
                </div>
                <div className="mt-3 pt-3 border-t space-y-1">
                  {stats.activeGoals > 0 && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <Target className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">{stats.activeGoals} active goal{stats.activeGoals !== 1 ? "s" : ""}</span>
                    </div>
                  )}
                  {stats.weeklyCount > 0 && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <Activity className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">{stats.weeklyCount} activit{stats.weeklyCount !== 1 ? "ies" : "y"} this week</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* PMC Summary */}
      {pmc && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> PMC Summary
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* CTL */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">CTL · Fitness</div>
                <div className={`text-3xl font-bold mt-1 ${pmc.ctl >= 50 ? "text-blue-600" : "text-blue-400"}`}>
                  {pmc.ctl}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {pmc.ctlTrend === "up" ? <TrendingUp className="h-3 w-3 text-green-500" /> :
                   pmc.ctlTrend === "down" ? <TrendingDown className="h-3 w-3 text-red-500" /> :
                   <Minus className="h-3 w-3 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground">
                    {pmc.ctlTrend === "up" ? "↑ Rising — fitness building" :
                     pmc.ctlTrend === "down" ? "↓ Falling — detraining" :
                     "— Stable"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1.5">
                  42-day rolling average of your daily training load.
                </div>
                {pmc.rampRate !== null && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Ramp rate: {pmc.rampRate >= 0 ? "+" : ""}{pmc.rampRate}/wk
                  </div>
                )}
              </div>

              {/* ATL */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">ATL · Fatigue</div>
                <div className={`text-3xl font-bold mt-1 ${
                  pmc.atl > 80 ? "text-red-600" : pmc.atl > 50 ? "text-amber-600" : "text-green-600"
                }`}>
                  {pmc.atl}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {pmc.atlTrend === "up" ? <TrendingUp className="h-3 w-3 text-amber-500" /> :
                   pmc.atlTrend === "down" ? <TrendingDown className="h-3 w-3 text-green-500" /> :
                   <Minus className="h-3 w-3 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground">
                    {pmc.atlTrend === "up" ? "↑ Rising — loading phase" :
                     pmc.atlTrend === "down" ? "↓ Falling — recovering" :
                     "— Stable"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1.5">
                  7-day rolling average — your short-term fatigue.
                </div>
              </div>

              {/* TSB */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">TSB · Form</div>
                <div className={`text-3xl font-bold mt-1 ${
                  pmc.tsb >= 0 ? "text-green-600" : pmc.tsb >= -10 ? "text-amber-600" : "text-red-600"
                }`}>
                  {pmc.tsb}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {pmc.tsbTrend === "up" ? <TrendingUp className="h-3 w-3 text-green-500" /> :
                   pmc.tsbTrend === "down" ? <TrendingDown className="h-3 w-3 text-red-500" /> :
                   <Minus className="h-3 w-3 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground">
                    {pmc.tsbTrend === "up" ? "↑ Improving — fresher" :
                     pmc.tsbTrend === "down" ? "↓ Declining — building fatigue" :
                     "— Stable"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1.5">
                  CTL − ATL.{" "}
                  {pmc.tsb > 10 ? "Fresh — good day to push." :
                   pmc.tsb < -10 ? "Deep load — prioritize recovery." :
                   pmc.tsb < -5 ? "Building — watch recovery." :
                   "Balanced — maintain."}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PMC History Charts — multi-metric toggleable chart */}
      {pmcHistory.length > 0 && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> PMC Charts
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex gap-1 flex-wrap">
                  {PMC_METRICS.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => {
                        setPmcMetrics((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.key)) {
                            if (next.size > 1) next.delete(m.key);
                          } else {
                            next.add(m.key);
                          }
                          return next;
                        });
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                        pmcMetrics.has(m.key)
                          ? "text-foreground border"
                          : "text-muted-foreground border border-dashed opacity-60 hover:opacity-100"
                      }`}
                      style={pmcMetrics.has(m.key) ? { borderColor: m.color, backgroundColor: `${m.color}14` } : {}}
                    >
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: m.color }} />
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {TIME_RANGES.map((r) => (
                    <Button
                      key={r.days}
                      variant={pmcDays === r.days ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setPmcDays(r.days)}
                    >
                      {r.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pmcHistory} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={30} />
                    <Tooltip
                      labelFormatter={(v: string) => v}
                      formatter={(v: number, name: string) => {
                        const m = PMC_METRICS.find((mm) => mm.key === name);
                        return m ? [m.format(v), m.label] : [v, name];
                      }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    {PMC_METRICS.filter((m) => pmcMetrics.has(m.key)).map((m) => (
                      <Area key={m.key} type="monotone" dataKey={m.key} stroke={m.color} fill={m.color} fillOpacity={0.12} strokeWidth={2} dot={false} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historical Trends */}
      {trends.length >= 2 && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Historical Trends
              </h2>
              <div className="flex items-center gap-2">
                <Tabs value={trendGrouping} onValueChange={(v) => setTrendGrouping(v as "week" | "month")}>
                  <TabsList className="h-7">
                    <TabsTrigger value="week" className="text-xs px-2.5">Weekly</TabsTrigger>
                    <TabsTrigger value="month" className="text-xs px-2.5">Monthly</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex gap-1">
                  {[
                    { label: "1M", weeks: 4 },
                    { label: "3M", weeks: 12 },
                    { label: "6M", weeks: 24 },
                    { label: "1Y", weeks: 52 },
                    { label: "Max", weeks: 200 },
                  ].map((r) => (
                    <Button
                      key={r.weeks}
                      variant={trendWeeks === r.weeks ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setTrendWeeks(r.weeks)}
                    >
                      {r.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              {TREND_METRICS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => {
                    setTrendMetrics((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.key)) {
                        if (next.size > 1) next.delete(m.key);
                      } else {
                        next.add(m.key);
                      }
                      return next;
                    });
                  }}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                    trendMetrics.has(m.key)
                      ? "text-foreground border"
                      : "text-muted-foreground border border-dashed opacity-60 hover:opacity-100"
                  }`}
                  style={trendMetrics.has(m.key) ? { borderColor: m.color, backgroundColor: `${m.color}14` } : {}}
                >
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: m.color }} />
                  {m.label}
                </button>
              ))}
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  {(() => {
                    const visibleMetrics = TREND_METRICS.filter((m) => trendMetrics.has(m.key));
                    const leftCount = visibleMetrics.filter((m) => m.orientation === "left").length;
                    const rightCount = visibleMetrics.filter((m) => m.orientation === "right").length;
                    const chartMargin = {
                      top: 4,
                      right: rightCount > 1 ? 20 + rightCount * 32 : rightCount > 0 ? 20 : 8,
                      left: leftCount > 1 ? 20 + leftCount * 32 : leftCount > 0 ? 20 : 8,
                      bottom: 0,
                    };

                    // Assign positions: first left axis gets offset 0, second gets offset 1, etc.
                    const leftAxisPositions: Record<string, number> = {};
                    let leftIdx = 0;
                    const rightAxisPositions: Record<string, number> = {};
                    let rightIdx = 0;
                    for (const m of TREND_METRICS) {
                      if (!trendMetrics.has(m.key)) continue;
                      if (m.orientation === "left") {
                        leftAxisPositions[m.yAxisId] = leftIdx++;
                      } else {
                        rightAxisPositions[m.yAxisId] = rightIdx++;
                      }
                    }

                    return (
                      <AreaChart
                        data={trends}
                        margin={chartMargin}
                        onClick={(data) => {
                          if (!data?.activeLabel) return;
                          const label = data.activeLabel;
                          if (trendGrouping === "month" && label.length === 7) {
                            router.push(`/training-logs?from=${label}-01&to=${label}-31`);
                          } else if (label.length === 10) {
                            const d = new Date(label);
                            const weekEnd = new Date(d);
                            weekEnd.setDate(weekEnd.getDate() + 6);
                            const toStr = weekEnd.toISOString().split("T")[0];
                            router.push(`/training-logs?from=${label}&to=${toStr}`);
                          }
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="weekStartDate" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.length > 7 ? v.slice(5) : v} interval="preserveStartEnd" />
                        {visibleMetrics.map((m) => (
                          <YAxis
                            key={m.yAxisId}
                            yAxisId={m.yAxisId}
                            orientation={m.orientation}
                            stroke={m.color}
                            tick={{ fontSize: 10, fill: m.color }}
                            width={m.orientation === "left"
                              ? (leftAxisPositions[m.yAxisId] === 0 ? 30 : 44)
                              : (rightAxisPositions[m.yAxisId] === 0 ? 30 : 44)
                            }
                            tickFormatter={m.tickFormatter}
                            domain={m.key === "readinessScore" ? [0, 100] : ["auto", "auto"]}
                          />
                        ))}
                        <Tooltip
                          labelFormatter={(v: string) => v.length > 7 ? `Week of ${v}` : v}
                          formatter={(v: number, name: string) => {
                            const mt = TREND_METRICS.find((mm) => mm.key === name);
                            return mt ? [mt.format(v), mt.label] : [v, name];
                          }}
                          contentStyle={{ fontSize: 12 }}
                        />
                        {visibleMetrics.map((m) => (
                          <Area key={m.key} yAxisId={m.yAxisId} type="monotone" dataKey={m.key} stroke={m.color} fill={m.color} fillOpacity={0.12} strokeWidth={2} dot={false} />
                        ))}
                      </AreaChart>
                    );
                  })()}
                </ResponsiveContainer>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 text-center">
                Click on a data point to view training logs for that period
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trackpoint Insights — Intensity, Decoupling, Efficiency */}
      {trackpointInsights?.available && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Intensity Distribution */}
          {trackpointInsights.intensityDistribution && (
            <Card>
              <CardContent className="py-4">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Intensity Distribution
                </h2>
                <div className="space-y-1.5">
                  {([
                    { key: "zone1Pct" as const, label: "Z1 · Recovery", color: "bg-blue-400" },
                    { key: "zone2Pct" as const, label: "Z2 · Endurance", color: "bg-green-400" },
                    { key: "zone3Pct" as const, label: "Z3 · Tempo", color: "bg-amber-400" },
                    { key: "zone4Pct" as const, label: "Z4 · Threshold", color: "bg-orange-500" },
                    { key: "zone5Pct" as const, label: "Z5 · VO₂Max", color: "bg-red-500" },
                  ]).map((zone) => {
                    const pct = trackpointInsights.intensityDistribution![zone.key];
                    const hrs = trackpointInsights.intensityDistribution!.totalAnalyzedHours * (pct / 100);
                    return (
                      <div key={zone.key}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">{zone.label}</span>
                          <span className="font-medium">{pct}% ({hrs.toFixed(1)}h)</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div className={`${zone.color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 pt-3 border-t">
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      trackpointInsights.intensityDistribution.distributionType === "polarized" ? "success" :
                      trackpointInsights.intensityDistribution.distributionType === "pyramidal" ? "warning" :
                      "destructive"
                    }>
                      {trackpointInsights.intensityDistribution.distributionType.replace("-", " ").toUpperCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {trackpointInsights.intensityDistribution.distributionType === "polarized"
                        ? "80/20 split (Z1+Z2 vs Z4+Z5) — ideal for endurance"
                        : trackpointInsights.intensityDistribution.distributionType === "pyramidal"
                        ? "Tapered distribution — healthy training balance"
                        : "Too much Z3 (tempo) — consider more easy days"}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {trackpointInsights.intensityDistribution.activityCount} activities · {trackpointInsights.intensityDistribution.totalAnalyzedHours}h analyzed
                </p>
              </CardContent>
            </Card>
          )}

          {/* Aerobic Decoupling */}
          {trackpointInsights.decoupling && (
            <Card>
              <CardContent className="py-4">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                  <Heart className="h-4 w-4 text-red-500" /> HR Decoupling
                </h2>
                <div className="text-center py-2">
                  <div className={`text-3xl font-bold ${
                    trackpointInsights.decoupling.status === "excellent" ? "text-green-600" :
                    trackpointInsights.decoupling.status === "good" ? "text-amber-600" :
                    "text-red-600"
                  }`}>
                    {trackpointInsights.decoupling.avgDecouplingPct}%
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Avg HR:output drift
                  </div>
                  <Badge variant={
                    trackpointInsights.decoupling.status === "excellent" ? "success" :
                    trackpointInsights.decoupling.status === "good" ? "warning" :
                    "destructive"
                  } className="mt-2">
                    {trackpointInsights.decoupling.status.toUpperCase()}
                  </Badge>
                </div>
                <div className="mt-3 pt-3 border-t text-xs text-muted-foreground space-y-1">
                  <p><strong>&lt; 5%</strong> = excellent aerobic endurance</p>
                  <p><strong>5-10%</strong> = normal for long efforts</p>
                  <p><strong>&gt; 10%</strong> = dehydration, fatigue, or undertrained</p>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Across {trackpointInsights.decoupling.activityCount} activities
                </p>
              </CardContent>
            </Card>
          )}

          {/* Efficiency Factor Trend */}
          {trackpointInsights.efTrend && trackpointInsights.efTrend.length >= 2 && (
            <Card>
              <CardContent className="py-4">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-500" /> Efficiency Factor
                </h2>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trackpointInsights.efTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <YAxis tick={{ fontSize: 10 }} width={30} domain={["dataMin - 0.1", "dataMax + 0.1"]} />
                      <Tooltip
                        labelFormatter={(v: string) => `Week of ${v}`}
                        formatter={(v: number) => [v.toFixed(2), "EF"]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Area type="monotone" dataKey="ef" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} strokeWidth={2} dot />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {(() => {
                    const trend = trackpointInsights.efTrend;
                    if (trend.length < 2) return null;
                    const first = trend[0].ef;
                    const last = trend[trend.length - 1].ef;
                    const change = ((last - first) / first) * 100;
                    return (
                      <>
                        <Badge variant={change >= 0 ? "success" : "destructive"}>
                          {change >= 0 ? "+" : ""}{Math.round(change)}%
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {change >= 2 ? "Improving — aerobic base building" :
                           change >= -2 ? "Stable — maintaining fitness" :
                           "Declining — consider more base training"}
                        </span>
                      </>
                    );
                  })()}
                </div>
                {trackpointInsights.estimatedFtp && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Est. FTP: {trackpointInsights.estimatedFtp}W
                    {trackpointInsights.estimatedFtpWkg && (
                      <> · {trackpointInsights.estimatedFtpWkg} w/kg</>
                    )}
                    {trackpointInsights.weightSource && trackpointInsights.weightSource !== "exact" && (
                      <> <span className="text-muted-foreground/60">(wt: ±{trackpointInsights.weightSource})</span></>
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Trackpoint data notice — shown when no trackpoint data available */}
      {trackpointInsights && !trackpointInsights.available && (
        <Card className="mb-6 border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Database className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <h3 className="font-medium text-sm">Enable Detailed Metrics</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload a Strava export ZIP or individual GPX/TCX/FIT files to unlock intensity distribution, HR decoupling analysis, and efficiency factor tracking.{" "}
                  <Link href="/ingestion" className="text-primary underline">Go to Data Import →</Link>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Goal Progress */}
      {goals.length > 0 && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3">
              Race Goals
            </h2>
            {goals.map((goal) => {
              const pct = Math.min(100, goal.progress);
              const barColor = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
              return (
                <div key={goal.id} className="mb-3 last:mb-0">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{goal.name}</span>
                    <span className="text-muted-foreground">
                      {goal.daysUntil > 0 ? `${goal.daysUntil}d left` : "Past due"} — {pct}%
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2.5">
                    <div className={`${barColor} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{goal.distanceMeters >= 1000 ? `${(goal.distanceMeters / 1000).toFixed(0)}km` : `${goal.distanceMeters}m`}</span>
                    <span>{goal.priority === "A" ? "A-Goal" : goal.priority === "B" ? "B-Goal" : "C-Goal"}</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Weekly Plan */}
      {plan && plan.plannedSessions && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Next Week&apos;s Plan</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {plan.targetVolumeMeters ? `${Math.round(plan.targetVolumeMeters / 1000)}km` : ""}
                  {plan.targetElevationMeters ? ` · ${Math.round(plan.targetElevationMeters)}m D+` : ""}
                </span>
                <PlanAdjustDialog plan={plan} onApplied={handlePlanApplied} />
              </div>
            </div>
            <div className="space-y-1.5">
              {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map((dayName, dayIdx) => {
                const session = (plan.plannedSessions as PlanData["plannedSessions"]).find((s) => s.dayOfWeek === dayIdx);
                if (!session || session.type === "rest") {
                  return (
                    <div key={dayIdx} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded hover:bg-muted/30">
                      <span className="w-8 text-xs text-muted-foreground font-medium">{dayName}</span>
                      <span className="text-muted-foreground italic">Rest</span>
                    </div>
                  );
                }
                return (
                  <div key={dayIdx} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded hover:bg-muted/30">
                    <span className="w-8 text-xs text-muted-foreground font-medium">{dayName}</span>
                    <span className="font-medium">{session.description}</span>
                    {session.targetDistance && <span className="text-xs text-muted-foreground">{Math.round(session.targetDistance / 1000)}km</span>}
                    {session.targetElevation && session.targetElevation > 0 && <span className="text-xs text-muted-foreground">{session.targetElevation}m</span>}
                    {session.facility && <span className="text-xs text-muted-foreground ml-auto truncate max-w-[120px]">{session.facility}</span>}
                  </div>
                );
              })}
            </div>
            {plan.adjustments && plan.adjustments.length > 0 && (
              <div className="mt-3 pt-3 border-t">
                <span className="text-xs text-muted-foreground">Adjustments from last week:</span>
                <ul className="mt-1 space-y-0.5">
                  {plan.adjustments.map((adj, idx) => (
                    <li key={idx} className="text-xs text-muted-foreground">{adj}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Fatigue & Recommendations */}
      {fatigue && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="py-4">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-2">Fatigue Status</h2>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={
                  fatigue.severity === "high" ? "destructive" :
                  fatigue.severity === "medium" ? "warning" :
                  "success"
                }>{fatigue.severity.toUpperCase()}</Badge>
                <span className="text-xs text-muted-foreground">{fatigue.weeklyTss} TSS this week</span>
              </div>
              <p className="text-sm mb-2">{fatigue.summary}</p>
              {fatigue.signals.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-1">
                  {fatigue.signals.map((signal, idx) => <li key={idx} className="flex gap-1"><span className="text-amber-500">•</span> {signal}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-2">Recommendations</h2>
              {fatigue.recommendations.length > 0 ? (
                <ul className="space-y-1.5">
                  {fatigue.recommendations.map((rec, idx) => (
                    <li key={idx} className="text-sm flex gap-2"><span className="text-primary">•</span> {rec}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">You&apos;re on track.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Coach's Notes */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Coach&apos;s Notes</h2>
            {coachNotesAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Generated {new Date(coachNotesAt).toLocaleString("en-US", {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                })}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={generateNotes} disabled={generating}>
            {generating ? "Generating..." : coachNotes ? "Regenerate" : "Generate"}
          </Button>
        </div>
        {coachNotes ? (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="py-4">
              <p className="text-sm whitespace-pre-line leading-relaxed">{coachNotes}</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-6 text-center">
              <p className="text-sm text-muted-foreground">Click &quot;Generate&quot; to get AI-powered coaching analysis of your training.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Training */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">This Week</h2>
            <Link href="/training-logs" className="text-xs text-primary hover:underline flex items-center gap-1">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No training logged this week.</p>
          ) : (
            <div className="divide-y -mx-4">
              {logs.map((log) => (
                <Link key={log.id} href={`/training-logs/${log.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Activity className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{log.name}</span>
                      <Badge variant="outline" className="text-xs">{log.type}</Badge>
                      {log.remarks && <span className="text-muted-foreground text-xs">💬</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.startDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <div className="text-right text-sm shrink-0">
                    {log.distanceMeters && <div className="font-medium">{formatDistance(log.distanceMeters)}</div>}
                    {log.averageHr && <div className="text-xs text-muted-foreground">{Math.round(log.averageHr)} bpm</div>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
