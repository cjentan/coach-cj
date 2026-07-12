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
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
    zone1Pct: number; zone2Pct: number; zone3Pct: number;
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

function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
          <span className={color || "text-muted-foreground"}>{icon}</span>
        </div>
        <div className={`text-2xl font-bold ${color || ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

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
  const [trackpointInsights, setTrackpointInsights] = useState<TrackpointInsights | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
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
      const [logRes, statsRes, goalsRes, fatigueRes, rdRes, planRes, pmcRes, notesRes] = await Promise.all([
        fetch("/api/dashboard/recent"),
        fetch("/api/dashboard/stats"),
        fetch("/api/dashboard/goals"),
        fetch("/api/dashboard/fatigue"),
        fetch("/api/dashboard/readiness"),
        fetch("/api/dashboard/plan"),
        fetch("/api/dashboard/pmc"),
        fetch("/api/dashboard/notes"),
      ]);
      if (!logRes.ok || !statsRes.ok) throw new Error(`${logRes.status}/${statsRes.status}`);
      setLogs(await logRes.json());
      setStats(await statsRes.json());
      if (goalsRes.ok) setGoals(await goalsRes.json());
      if (fatigueRes.ok) setFatigue(await fatigueRes.json());
      if (rdRes.ok) setReadiness(await rdRes.json());
      if (planRes.ok) { const p = await planRes.json(); setPlan(p); }
      if (notesRes.ok) {
        const n = await notesRes.json();
        if (n.coachNotes) { setCoachNotes(n.coachNotes); setCoachNotesAt(n.generatedAt); }
      }
      if (pmcRes.ok) setPmc(await pmcRes.json());
      // Trackpoint insights (fire-and-forget — loads after main data)
      fetch("/api/dashboard/trackpoint-insights")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d && setTrackpointInsights(d))
        .catch(() => {});
      // Historical trends (fire-and-forget)
      fetch("/api/dashboard/trends?weeks=52")
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          {stats.avgHr && (
            <StatCard label="Avg HR" value={`${stats.avgHr} bpm`}
              icon={<Heart className="h-4 w-4 text-red-500" />} />
          )}
          <StatCard label="Active Goals" value={stats.activeGoals}
            icon={<Target className="h-4 w-4" />} />
          {stats.latestWeight && (
            <StatCard label="Weight" value={`${stats.latestWeight} kg`}
              icon={<Activity className="h-4 w-4" />} />
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

      {/* PMC History Charts */}
      {pmcHistory.length > 0 && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> PMC Charts
              </h2>
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* TSS Chart */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">Daily TSS Load</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pmcHistory} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip labelFormatter={(v: string) => v} contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="tss" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* CTL Chart */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">CTL · Chronic Training Load (Fitness)</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pmcHistory} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip labelFormatter={(v: string) => v} contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="ctl" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* ATL Chart */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">ATL · Acute Training Load (Fatigue)</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pmcHistory} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip labelFormatter={(v: string) => v} contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="atl" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.12} strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* TSB Chart */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">TSB · Training Stress Balance (Form)</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pmcHistory} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip labelFormatter={(v: string) => v} contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="tsb" stroke="#22c55e" fill="#22c55e" fillOpacity={0.10} strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historical Trends */}
      {trends.length >= 2 && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Historical Trends
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Readiness over time */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">Readiness Score</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trends} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="weekStartDate" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={30} domain={[0, 100]} />
                      <Tooltip labelFormatter={(v: string) => `Week of ${v}`} contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="readinessScore" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Weekly Volume (distance bars + elevation line) */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">Weekly Volume</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trends} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="weekStartDate" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        labelFormatter={(v: string) => `Week of ${v}`}
                        formatter={(v: number, name: string) => [name === "weeklyVolumeMeters" ? `${(v / 1000).toFixed(1)} km` : `${v}m`, name === "weeklyVolumeMeters" ? "Distance" : "Elevation"]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="weeklyVolumeMeters" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Weekly TSS */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">Weekly Training Load (TSS)</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trends} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="weekStartDate" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip labelFormatter={(v: string) => `Week of ${v}`} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="weeklyTss" fill="#a855f7" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Activity Count */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">Activities per Week</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trends} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="weekStartDate" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={20} allowDecimals={false} />
                      <Tooltip labelFormatter={(v: string) => `Week of ${v}`} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="activityCount" fill="#22c55e" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
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
                <div className="space-y-2">
                  {(["zone1Pct", "zone2Pct", "zone3Pct"] as const).map((zone, i) => {
                    const labels = ["Zone 1 · Easy", "Zone 2 · Moderate", "Zone 3 · Hard"];
                    const colors = ["bg-blue-500", "bg-amber-500", "bg-red-500"];
                    const pct = trackpointInsights.intensityDistribution![zone];
                    const hrs = trackpointInsights.intensityDistribution!.totalAnalyzedHours * (pct / 100);
                    return (
                      <div key={zone}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">{labels[i]}</span>
                          <span className="font-medium">{pct}% ({hrs.toFixed(1)}h)</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div className={`${colors[i]} h-2 rounded-full`} style={{ width: `${pct}%` }} />
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
                        ? "80/20 split — ideal for endurance"
                        : trackpointInsights.intensityDistribution.distributionType === "pyramidal"
                        ? "Tapered — reduce mid-zone"
                        : "Too much grey zone — add easy days"}
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
