"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration } from "@/lib/utils";
import { Activity, ChevronRight, Route, Mountain, Clock, Heart, Target, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus, BarChart3, Database, Info, ChevronLeft, AlertCircle } from "lucide-react";
import CoachChat from "@/components/coach/coach-chat";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface PlanDayActual {
  type: string;
  name: string;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  durationSeconds: number;
  activityId: string;
  source: string;
}

interface PlanDayPlanned {
  type: string;
  description: string;
  targetDistance: number | null;
  targetElevation: number | null;
  targetDuration: number | null;
  changedAt?: string;
  changeReason?: string;
}

interface PlanDay {
  date: string;
  dayLabel: string;
  dayOfWeek: number;
  planned: PlanDayPlanned | null;
  actual: PlanDayActual | null;
  isPast: boolean;
  isToday: boolean;
}

interface PlanData {
  weekStart: string;
  weekEnd: string;
  days: PlanDay[];
  targetVolumeMeters?: number;
  targetElevationMeters?: number;
  adjustments?: string[];
  coachNotes?: string;
}

interface ReadinessData {
  score: number; label: string; detail: string; volumeAdherence: number;
}

interface GoalSummary {
  id: string; name: string; targetDate: string; distanceMeters: number;
  elevationGainMeters: number | null; priority: string;
  progress: number; daysUntil: number; goalStatement?: string | null;
}

interface StatsComparison {
  weeklyDistance: number; weeklyElevation: number; weeklyDuration: number;
  weeklyCount: number; weeklyTss: number; avgDailyTss: number; avgHr: number | null;
}

interface Stats {
  weeklyDistance: number; weeklyElevation: number; weeklyDuration: number;
  weeklyCount: number; weeklyTss: number; avgDailyTss: number;
  avgHr: number | null; activeGoals: number; latestWeight: number | null;
  latestRestingHr: number | null; estimatedMaxHr: number | null;
  lastWeek: StatsComparison | null; currentMonth: StatsComparison | null; lastMonth: StatsComparison | null;
}

interface PmcData {
  ctl: number; atl: number; tsb: number; rampRate: number | null;
  ctlTrend: "up" | "down" | "stable";
  atlTrend: "up" | "down" | "stable";
  tsbTrend: "up" | "down" | "stable";
}

interface PmcHistoryPoint { date: string; tss: number; ctl: number; atl: number; tsb: number; }

interface TrackpointInsights {
  available: boolean; message?: string; activityCount?: number;
  intensityDistribution?: { zone1Pct: number; zone2Pct: number; zone3Pct: number; zone4Pct: number; zone5Pct: number;
    distributionType: "polarized" | "pyramidal" | "threshold-heavy"; activityCount: number; totalAnalyzedHours: number; } | null;
  decoupling?: { avgDecouplingPct: number; status: "excellent" | "good" | "elevated"; activityCount: number; } | null;
  efTrend?: { weekStart: string; ef: number; activityCount: number }[];
  estimatedFtp?: number | null; estimatedFtpWkg?: number | null; weightSource?: string | null;
}

interface DailyHealthItem {
  id: string; date: string; restingHeartRate: number | null; sleepSeconds: number | null;
  sleepScore: number | null; deepSleepSeconds: number | null; bodyBatteryMin: number | null;
  bodyBatteryMax: number | null; avgStress: number | null; hrvStatus: string | null;
  overnightHrv: number | null; steps: number | null;
}

interface TrendPoint {
  weekStartDate: string; readinessScore: number | null; ctl: number | null; atl: number | null;
  tsb: number | null; weeklyVolumeMeters: number | null; weeklyElevationMeters: number | null;
  weeklyDurationSeconds: number | null; weeklyTss: number; activityCount: number;
  avgDailyTss: number; avgHr: number | null; volumeAdherence: number | null;
  consistency: number | null; fatigueSeverity: string;
}

interface AnalysisReportData {
  id: string;
  reasoning: { dataDrivers?: string[]; strengths?: string[]; concerns?: string[]; keyDecisions?: string[] } | null;
  metrics: { ctl?: number; atl?: number; tsb?: number; readinessScore?: number; sleepAvg?: number; hrvAvg?: number; restingHrAvg?: number } | null;
  createdAt: string;
}

interface RaceReadinessOutput { readinessPct: number; status: string; volumeGap: number; elevationGap: number | null; tsbStatus: string; recommendations: string[]; }

const TIME_RANGES = [
  { label: "7D", days: 7 }, { label: "30D", days: 30 }, { label: "90D", days: 90 }, { label: "6M", days: 180 }, { label: "1Y", days: 365 }, { label: "Max", days: 730 },
];

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("dashboard");
  const common = useTranslations("common");
  const [stats, setStats] = useState<Stats | null>(null);
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [coachNotes, setCoachNotes] = useState<string | null>(null);
  const [coachNotesAt, setCoachNotesAt] = useState<string | null>(null);
  const [pmc, setPmc] = useState<PmcData | null>(null);
  const [pmcHistory, setPmcHistory] = useState<PmcHistoryPoint[]>([]);
  const [timeframeDays, setTimeframeDays] = useState(30);
  const [pmcMetrics, setPmcMetrics] = useState<Set<string>>(new Set(["ctl", "tsb"]));
  const [trendMetrics, setTrendMetrics] = useState<Set<string>>(new Set(["readinessScore", "weeklyVolumeMeters"]));
  const [intensityDist, setIntensityDist] = useState<{
    zone1Pct: number; zone2Pct: number; zone3Pct: number; zone4Pct: number; zone5Pct: number;
    distributionType: string; activityCount: number; analyzedHours: number;
  } | null>(null);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReportData | null>(null);
  const [raceReadiness, setRaceReadiness] = useState<Map<string, RaceReadinessOutput>>(new Map());
  const [dailyHealth, setDailyHealth] = useState<DailyHealthItem[]>([]);
  const [trackpointInsights, setTrackpointInsights] = useState<TrackpointInsights | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [volumePeriod, setVolumePeriod] = useState<"week" | "month">("week");
  const [weekOffset, setWeekOffset] = useState(0);

  const PMC_METRICS = [
    { key: "tss", label: "Daily TSS Load", color: "#a855f7", unit: "", format: (v: number) => String(Math.round(v)) },
    { key: "ctl", label: "CTL · Fitness", color: "#3b82f6", unit: "", format: (v: number) => String(Math.round(v)) },
    { key: "atl", label: "ATL · Fatigue", color: "#f59e0b", unit: "", format: (v: number) => String(Math.round(v)) },
    { key: "tsb", label: "TSB · Form", color: "#22c55e", unit: "", format: (v: number) => String(Math.round(v)) },
  ] as const;

  const TREND_METRICS = [
    { key: "readinessScore", label: "Readiness", color: "#ef4444", format: (v: number) => String(Math.round(v)), yAxisId: "left", orientation: "left" as const, tickFormatter: (v: number) => String(Math.round(v)) },
    { key: "weeklyVolumeMeters", label: "Volume", color: "#3b82f6", format: (v: number) => `${(v / 1000).toFixed(1)}`, yAxisId: "right1", orientation: "right" as const, tickFormatter: (v: number) => `${(v / 1000).toFixed(0)}k` },
    { key: "weeklyTss", label: "Weekly TSS", color: "#a855f7", format: (v: number) => String(Math.round(v)), yAxisId: "right2", orientation: "right" as const, tickFormatter: (v: number) => String(Math.round(v)) },
    { key: "activityCount", label: "Activities", color: "#22c55e", format: (v: number) => String(Math.round(v)), yAxisId: "right3", orientation: "right" as const, tickFormatter: (v: number) => String(Math.round(v)) },
  ] as const;

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
      const res = await fetch("/api/dashboard/load");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setStats(data.stats || null);
      setGoals(data.goals || []);
      setReadiness(data.readiness || null);
      setPmc(data.pmc || null);
      if (data.coachNotes) { setCoachNotes(data.coachNotes); setCoachNotesAt(data.coachNotesAt); }
      if (data.analysisReport) setAnalysisReport(data.analysisReport);

      fetch("/api/dashboard/trackpoint-insights").then((r) => r.ok ? r.json() : null).then((d) => d && setTrackpointInsights(d)).catch(() => {});
      const w = Math.max(1, Math.ceil(timeframeDays / 7));
const g = timeframeDays > 90 ? "month" : "week";
fetch(`/api/dashboard/trends?weeks=${w}&grouping=${g}`).then((r) => r.ok ? r.json() : null).then((d) => d?.trends && setTrends(d.trends)).catch(() => {});
fetch(`/api/dashboard/intensity-distribution?days=${Math.min(timeframeDays, 365)}`).then((r) => r.ok ? r.json() : null).then((d) => d?.distribution && setIntensityDist(d.distribution)).catch(() => {});
      fetch("/api/daily-health?days=7").then((r) => r.ok ? r.json() : null).then((d) => d?.healthData && setDailyHealth(d.healthData)).catch(() => {});
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const fetchPmcHistory = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/dashboard/pmc-history?days=${days}`);
      if (res.ok) { const data = await res.json(); setPmcHistory(data.series || []); }
    } catch { /* ignore */ }
  }, []);

  const loadPlan = useCallback(async (offset: number) => {
    try {
      const res = await fetch(`/api/dashboard/plan?weekOffset=${offset}`);
      if (res.ok) {
        const data = await res.json();
        setPlan(data);
      }
    } catch { /* ignore */ }
  }, []);

  // Reload plan when weekOffset changes
  useEffect(() => { loadPlan(weekOffset); }, [weekOffset, loadPlan]);

  const handlePlanApplied = useCallback(() => {
    // AI Coach made changes (goal created, plan updated, etc.) —
    // silently refresh cards without showing the loading spinner
    fetch("/api/dashboard/load")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        setStats(data.stats || null);
        setGoals(data.goals || []);
        setReadiness(data.readiness || null);
        setPmc(data.pmc || null);
        if (data.coachNotes) { setCoachNotes(data.coachNotes); setCoachNotesAt(data.coachNotesAt); }
        if (data.analysisReport) setAnalysisReport(data.analysisReport);
      })
      .catch(() => {});
    loadPlan(weekOffset);
  }, [weekOffset, loadPlan]);

  // Compute race readiness
  useEffect(() => {
    if (!goals.length || !pmc || !stats) return;
    const now = Date.now();
    const newReadiness = new Map<string, RaceReadinessOutput>();
    for (const goal of goals) {
      const weeksUntilRace = Math.max(1, Math.ceil((new Date(goal.targetDate).getTime() - now) / (7 * 86400000)));
      const targetPeakWeekly = goal.distanceMeters * 0.7;
      const volumeProgress = weeksUntilRace <= 4 ? targetPeakWeekly : targetPeakWeekly * (1 - (weeksUntilRace - 4) * 0.02);
      const volumeGap = volumeProgress > 0 ? Math.min(100, Math.round((stats.weeklyDistance / volumeProgress) * 100)) : 0;
      let elevationGap: number | null = null;
      if (goal.elevationGainMeters && goal.elevationGainMeters > 0) {
        elevationGap = Math.min(100, Math.round((stats.weeklyElevation / (goal.elevationGainMeters * 0.5)) * 100));
      }
      const tsbStatus = pmc.tsb > 10 ? "fresh" : pmc.tsb > -10 ? "balanced" : "fatigued";
      const readinessPct = Math.max(0, Math.min(100, Math.round(
        Math.min(100, volumeGap) * 0.45 + (elevationGap != null ? Math.min(100, elevationGap) * 0.20 : 15) +
        (pmc.tsb > 10 ? 20 : pmc.tsb > -5 ? 15 : pmc.tsb > -15 ? 10 : 5) + (readiness?.volumeAdherence || 50) * 0.10
      )));
      const status = readinessPct >= 70 ? "on_track" : readinessPct >= 45 ? "needs_work" : "behind";
      const recommendations: string[] = [];
      if (volumeGap < 50 && weeksUntilRace > 4) recommendations.push("Weekly volume well below target. Consider adding sessions.");
      else if (volumeGap < 80 && weeksUntilRace > 4) recommendations.push(`Build toward ${Math.round(targetPeakWeekly / 1000)}km/week.`);
      if (pmc.tsb < -15) recommendations.push("TSB deeply negative. Consider deload.");
      if (readinessPct >= 70) recommendations.push("On track — maintain consistency.");
      else recommendations.push("Focus on consistent volume and recovery.");
      newReadiness.set(goal.id, { readinessPct, status, volumeGap, elevationGap, tsbStatus, recommendations });
    }
    setRaceReadiness(newReadiness);
  }, [goals, pmc, stats, readiness]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    } else if (status === "authenticated") {
      // Check onboarding status
      fetch("/api/settings/onboarding")
        .then((r) => r.json())
        .then((data) => {
          if (!data.onboardingCompleted) {
            router.push("/onboarding");
          } else {
            loadAll();
          }
        })
        .catch(() => loadAll());
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const pmcDays = Math.min(timeframeDays, 365);
    fetchPmcHistory(pmcDays);
    const weeks = Math.max(1, Math.ceil(timeframeDays / 7));
    const grouping = timeframeDays > 90 ? "month" : "week";
    fetch(`/api/dashboard/trends?weeks=${weeks}&grouping=${grouping}`)
      .then((r) => r.ok ? r.json() : null).then((d) => d?.trends && setTrends(d.trends)).catch(() => {});
    fetch(`/api/dashboard/intensity-distribution?days=${pmcDays}`)
      .then((r) => r.ok ? r.json() : null).then((d) => d?.distribution && setIntensityDist(d.distribution)).catch(() => {});
  }, [status, timeframeDays, fetchPmcHistory]);

  // ─── Helper components ─────────────────────────────────────────────

  function HrZoneCard({ stats }: { stats: Stats }) {
    const maxHr = stats.estimatedMaxHr;
    const restHr = stats.latestRestingHr;
    return (
      <Card><CardContent className="py-4">
        <span className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-2"><Heart className="h-3.5 w-3.5 text-red-500" /> Heart Rate</span>
        <div className="flex items-baseline gap-3 mb-3 pb-3 border-b">
          {restHr ? <><div><span className="text-2xl font-bold">{restHr}</span><span className="text-sm text-muted-foreground ml-1">bpm</span><div className="text-[10px] text-muted-foreground">Resting</div></div></>
            : <div className="text-xs text-muted-foreground italic">No resting HR</div>}
          {maxHr && <div className="border-l pl-3"><span className="text-lg font-semibold">{maxHr}</span><span className="text-xs text-muted-foreground ml-0.5">bpm</span><div className="text-[10px] text-muted-foreground">Est. max</div></div>}
          {stats.avgHr && <div className="border-l pl-3"><span className="text-lg font-semibold">{Math.round(stats.avgHr)}</span><span className="text-xs text-muted-foreground ml-0.5">bpm</span><div className="text-[10px] text-muted-foreground">Avg ex.</div></div>}
        </div>
        {(() => {
          if (!maxHr) return <div className="text-xs text-muted-foreground italic">Log activities with HR data to calculate zones.</div>;
          const thresholds = [0.68, 0.83, 0.94, 1.05];
          const labels = ["Z1 Recov", "Z2 Endur", "Z3 Tempo", "Z4 Thresh", "Z5 Anaer"];
          const colors = ["bg-blue-400", "bg-green-400", "bg-amber-400", "bg-orange-500", "bg-red-500"];
          const textColors = ["text-blue-500", "text-green-500", "text-amber-500", "text-orange-600", "text-red-500"];
          return <div className="space-y-1">{labels.map((label, i) => {
            let lower = i === 0 ? 0 : restHr ? Math.round(restHr + (maxHr - restHr) * thresholds[i - 1]) : Math.round(maxHr * thresholds[i - 1]);
            let upper = i < 5 ? restHr ? Math.round(restHr + (maxHr - restHr) * thresholds[Math.min(i, 4)]) : Math.round(maxHr * thresholds[Math.min(i, 4)]) : 999;
            return <div key={label} className="flex items-center gap-2 text-[11px]">
              <span className="w-auto min-w-[3rem] text-muted-foreground shrink-0">{label}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className={`${colors[i]} h-full rounded-full`} style={{ width: "20%", marginLeft: `${(lower / (maxHr * 1.1)) * 100}%` }} /></div>
              <span className={`w-auto min-w-[4rem] text-right font-medium tabular-nums ${textColors[i]}`}>{lower === 0 ? `<${upper}` : upper >= 999 ? `>${lower}` : `${lower}–${upper}`} bpm</span>
            </div>;
          })}</div>;
        })()}
      </CardContent></Card>
    );
  }

  function HealthMetricsCard({ data }: { data: DailyHealthItem[] }) {
    if (data.length === 0) return null;
    const latestDate = data[0]?.date;
    return (
      <Card><CardContent className="py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Activity className="h-3.5 w-3.5" /> Recovery</span>
          {latestDate && (
            <span className="text-[10px] text-muted-foreground">
              {(() => {
                const d = new Date(latestDate);
                const today = new Date();
                const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
                if (diff === 0) return "Today";
                if (diff === 1) return "Yesterday";
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              })()}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded bg-muted/30">
            <div className="text-[10px] text-muted-foreground uppercase">Sleep</div>
            <div className="font-semibold">{data[0]?.sleepSeconds ? formatDuration(data[0].sleepSeconds) : "—"}</div>
            {data[0]?.sleepScore != null && <div className="text-xs text-muted-foreground">Score: {data[0].sleepScore}</div>}
          </div>
          <div className="p-2 rounded bg-muted/30">
            <div className="text-[10px] text-muted-foreground uppercase">Body Battery</div>
            <div className="font-semibold">{data[0]?.bodyBatteryMin != null && data[0]?.bodyBatteryMax != null ? `${data[0].bodyBatteryMin}–${data[0].bodyBatteryMax}` : "—"}</div>
          </div>
          <div className="p-2 rounded bg-muted/30">
            <div className="text-[10px] text-muted-foreground uppercase">HRV</div>
            <div className="font-semibold">{data[0]?.overnightHrv ? `${data[0].overnightHrv}ms` : "—"}</div>
            {data[0]?.hrvStatus && <div className="text-xs text-muted-foreground capitalize">{data[0].hrvStatus}</div>}
          </div>
          <div className="p-2 rounded bg-muted/30">
            <div className="text-[10px] text-muted-foreground uppercase">Stress</div>
            <div className="font-semibold">{data[0]?.avgStress != null ? `${data[0].avgStress}` : "—"}</div>
          </div>
        </div>
      </CardContent></Card>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────
  if (status === "loading" || loading) {
    return <div className="max-w-5xl mx-auto px-4 py-8">{common("loading")}</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">
            {t("welcome", { name: session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : "" })}
          </h1>
          {analysisReport?.createdAt && (
            <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {t("analyzed")} {(() => {
                const diff = Date.now() - new Date(analysisReport.createdAt).getTime();
                const h = Math.floor(diff / 3600000);
                if (h < 1) return common("justNow");
                if (h < 24) return common("hoursAgo", { hours: h });
                return common("daysAgo", { days: Math.floor(h / 24) });
              })()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {analysisReport?.metrics && (
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              {analysisReport.metrics.ctl != null && `CTL ${Math.round(analysisReport.metrics.ctl)}`}
              {analysisReport.metrics.tsb != null && ` · TSB ${Math.round(analysisReport.metrics.tsb)}`}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={loadAll}>
            <Activity className="h-4 w-4 mr-1" /> {common("refresh")}
          </Button>
        </div>
      </div>

      {fetchError && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded mb-4">
          {common("error")}: {fetchError}. <button className="underline" onClick={loadAll}>{common("retry")}</button>
        </div>
      )}

      {/* ═══ 1. READINESS + PMC ═══ */}
      {readiness && pmc && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-1 flex items-center gap-3 p-3 rounded-lg bg-muted/20">
                <div className={`text-4xl font-bold ${readiness.score >= 70 ? "text-green-600" : readiness.score >= 50 ? "text-amber-600" : "text-red-600"}`}>
                  {readiness.score}
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">{t("readiness")}
                    <Dialog>
                      <DialogTrigger asChild>
                        <button className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer" aria-label={t("readinessInfo")}>
                          <Info className="h-3 w-3" />
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("readinessDialogTitle")}</DialogTitle>
                          <DialogDescription className="space-y-2 pt-2">
                            <p>{t.rich("readinessDialogP1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p>{t.rich("readinessDialogP2", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p>{t.rich("readinessDialogP3", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p>{t.rich("readinessDialogP4", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p className="text-xs text-muted-foreground pt-1">{t("readinessDialogP5")}</p>
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className={`font-semibold text-sm ${readiness.score >= 70 ? "text-green-600" : readiness.score >= 50 ? "text-amber-600" : "text-red-600"}`}>
                    {readiness.label}
                  </div>
                  <div className="w-full bg-muted rounded-full h-1 mt-1"><div className="bg-blue-500 h-1 rounded-full" style={{ width: `${readiness.volumeAdherence}%` }} /></div>
                </div>
              </div>
              <div className="sm:col-span-3 grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">CTL · Fitness
                    <Dialog>
                      <DialogTrigger asChild>
                        <button className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer" aria-label={t("ctlInfo")}>
                          <Info className="h-3 w-3" />
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("ctlDialogTitle")}</DialogTitle>
                          <DialogDescription className="space-y-2 pt-2">
                            <p>{t.rich("ctlDialogP1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p>{t("ctlDialogP2")}</p>
                            <p className="text-xs text-muted-foreground pt-1">{t("ctlDialogP3")}</p>
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-xl font-bold ${pmc.ctl >= 50 ? "text-blue-600" : "text-blue-400"}`}>{pmc.ctl}</span>
                    {pmc.ctlTrend === "up" ? <TrendingUp className="h-3 w-3 text-green-500" /> : pmc.ctlTrend === "down" ? <TrendingDown className="h-3 w-3 text-red-500" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                  </div>
                  {pmc.rampRate !== null && <div className="text-[10px] text-muted-foreground">Ramp: {pmc.rampRate >= 0 ? "+" : ""}{pmc.rampRate}/wk</div>}
                </div>
                <div className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">ATL · Fatigue
                    <Dialog>
                      <DialogTrigger asChild>
                        <button className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer" aria-label={t("atlInfo")}>
                          <Info className="h-3 w-3" />
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("atlDialogTitle")}</DialogTitle>
                          <DialogDescription className="space-y-2 pt-2">
                            <p>{t.rich("atlDialogP1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p>{t("atlDialogP2")}</p>
                            <p className="text-xs text-muted-foreground pt-1">{t("atlDialogP3")}</p>
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-xl font-bold ${pmc.atl > 80 ? "text-red-600" : pmc.atl > 50 ? "text-amber-600" : "text-green-600"}`}>{pmc.atl}</span>
                    {pmc.atlTrend === "up" ? <TrendingUp className="h-3 w-3 text-amber-500" /> : pmc.atlTrend === "down" ? <TrendingDown className="h-3 w-3 text-green-500" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">TSB · Form
                    <Dialog>
                      <DialogTrigger asChild>
                        <button className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer" aria-label={t("tsbInfo")}>
                          <Info className="h-3 w-3" />
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("tsbDialogTitle")}</DialogTitle>
                          <DialogDescription className="space-y-2 pt-2">
                            <p>{t.rich("tsbDialogP1", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p>{t.rich("tsbDialogP2", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p>{t.rich("tsbDialogP3", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                            <p className="text-xs text-muted-foreground pt-1">{t("tsbDialogP4")}</p>
                          </DialogDescription>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-xl font-bold ${pmc.tsb >= 0 ? "text-green-600" : pmc.tsb >= -10 ? "text-amber-600" : "text-red-600"}`}>{pmc.tsb}</span>
                    {pmc.tsbTrend === "up" ? <TrendingUp className="h-3 w-3 text-green-500" /> : pmc.tsbTrend === "down" ? <TrendingDown className="h-3 w-3 text-red-500" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ 2. RACE READINESS ═══ */}
      {goals.length > 0 && pmc && (
        <Card className="mb-6 border-primary/20">
          <CardContent className="py-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2"><Target className="h-4 w-4" /> Race Readiness</h2>
            <div className="space-y-3">
              {goals.slice(0, 3).map((goal) => {
                const rr = raceReadiness.get(goal.id);
                return (
                  <div key={goal.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-start justify-between mb-2 gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{goal.name}</span>
                          <Badge variant={goal.priority === "A" ? "destructive" : goal.priority === "B" ? "default" : "secondary"} className="text-[10px] h-5">{goal.priority}-Goal</Badge>
                        </div>
                        {goal.goalStatement && <p className="text-xs text-muted-foreground italic mt-0.5">&ldquo;{goal.goalStatement}&rdquo;</p>}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">{goal.daysUntil > 0 ? `${goal.daysUntil}d` : "Due!"}</div>
                    </div>
                    {rr ? <><div className="flex items-center gap-3 mb-2 flex-wrap">
                      <div className={`text-2xl font-bold ${rr.readinessPct >= 70 ? "text-green-600" : rr.readinessPct >= 45 ? "text-amber-600" : "text-red-600"}`}>{rr.readinessPct}%</div>
                      <Badge variant={rr.status === "on_track" ? "success" : rr.status === "needs_work" ? "warning" : "destructive"}>{rr.status.replace("_", " ").toUpperCase()}</Badge>
                      <span className="text-xs text-muted-foreground">Volume: {rr.volumeGap}%{rr.elevationGap != null ? ` · Elev: ${rr.elevationGap}%` : ""}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${rr.readinessPct >= 70 ? "bg-green-500" : rr.readinessPct >= 45 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${rr.readinessPct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">{rr.recommendations[0]}</p>
                    </> : <p className="text-xs text-muted-foreground">{t("computingReadiness")}</p>}
                  </div>
                );
              })}
            </div>
            {goals.length > 3 && <Link href="/settings/goals" className="text-xs text-primary hover:underline mt-2 inline-block">View all {goals.length} goals →</Link>}
          </CardContent>
        </Card>
      )}

      {/* ═══ 3. VOLUME & LOAD ═══ */}
      {stats && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2"><BarChart3 className="h-4 w-4" /> {t("volumeAndLoad")}</h2>
              <Tabs value={volumePeriod} onValueChange={(v) => setVolumePeriod(v as "week" | "month")}>
                <TabsList className="h-8"><TabsTrigger value="week" className="text-xs px-3">Week</TabsTrigger><TabsTrigger value="month" className="text-xs px-3">Month</TabsTrigger></TabsList>
              </Tabs>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Distance", current: volumePeriod === "week" ? stats.weeklyDistance : (stats.currentMonth?.weeklyDistance ?? stats.weeklyDistance), prior: volumePeriod === "week" ? stats.lastWeek?.weeklyDistance : stats.lastMonth?.weeklyDistance, formattedValue: formatDistance(volumePeriod === "week" ? stats.weeklyDistance : (stats.currentMonth?.weeklyDistance ?? stats.weeklyDistance)), icon: <Route className="h-4 w-4" /> },
                { label: "Elevation", current: volumePeriod === "week" ? stats.weeklyElevation : (stats.currentMonth?.weeklyElevation ?? stats.weeklyElevation), prior: volumePeriod === "week" ? stats.lastWeek?.weeklyElevation : stats.lastMonth?.weeklyElevation, formattedValue: `${Math.round(volumePeriod === "week" ? stats.weeklyElevation : (stats.currentMonth?.weeklyElevation ?? stats.weeklyElevation)).toLocaleString()} m`, icon: <Mountain className="h-4 w-4" /> },
                { label: "Duration", current: volumePeriod === "week" ? stats.weeklyDuration : (stats.currentMonth?.weeklyDuration ?? stats.weeklyDuration), prior: volumePeriod === "week" ? stats.lastWeek?.weeklyDuration : stats.lastMonth?.weeklyDuration, formattedValue: formatDuration(volumePeriod === "week" ? stats.weeklyDuration : (stats.currentMonth?.weeklyDuration ?? stats.weeklyDuration)), icon: <Clock className="h-4 w-4" /> },
                { label: "TSS Load", current: volumePeriod === "week" ? stats.weeklyTss : (stats.currentMonth?.weeklyTss ?? stats.weeklyTss), prior: volumePeriod === "week" ? stats.lastWeek?.weeklyTss : stats.lastMonth?.weeklyTss, formattedValue: String(volumePeriod === "week" ? stats.weeklyTss : (stats.currentMonth?.weeklyTss ?? stats.weeklyTss)), icon: <TrendingUp className="h-4 w-4" /> },
              ].map((metric) => {
                const delta = computeDelta(metric.current, metric.prior);
                return (
                  <div key={metric.label}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-muted-foreground">{metric.icon}</span>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">{metric.label}</span>
                    </div>
                    <div className="text-2xl font-bold">{metric.formattedValue}</div>
                    {delta && <div className="flex items-center gap-1 mt-0.5 text-xs font-medium">
                      {delta.direction === "up" && <ArrowUp className="h-3 w-3 text-green-500" />}
                      {delta.direction === "down" && <ArrowDown className="h-3 w-3 text-red-500" />}
                      {delta.direction === "flat" && <Minus className="h-3 w-3 text-muted-foreground" />}
                      {delta.direction === "new" ? <span className="text-blue-500">New</span> : <span className={delta.direction === "up" ? "text-green-600" : delta.direction === "down" ? "text-red-600" : "text-muted-foreground"}>
                        {delta.pct}% {delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "—"}
                      </span>}
                    </div>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ 4. AI COACH ═══ */}
      <CoachChat
        plan={plan}
        onPlanApplied={handlePlanApplied}
        initialNotes={coachNotes}
        initialNotesAt={coachNotesAt}
      />

      {/* ═══ 5. TRAINING ANALYSIS (PMC + Intensity Dist + Historical) ═══ */}
      {(pmcHistory.length > 0 || intensityDist || trends.length >= 2) && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2 mb-4"><TrendingUp className="h-4 w-4" /> Training Analysis</h2>

            {/* PMC / Fitness Trends */}
            {pmcHistory.length > 0 && (
              <div className="mb-6">
                <div className="flex gap-1 flex-wrap mb-3">
                  {PMC_METRICS.map((m) => (
                    <button key={m.key} onClick={() => setPmcMetrics((prev) => { const n = new Set(prev); if (n.has(m.key)) { if (n.size > 1) n.delete(m.key); } else n.add(m.key); return n; })}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${pmcMetrics.has(m.key) ? "text-foreground border" : "text-muted-foreground border border-dashed opacity-60 hover:opacity-100"}`}
                      style={pmcMetrics.has(m.key) ? { borderColor: m.color, backgroundColor: `${m.color}14` } : {}}>
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: m.color }} /> {m.label}
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={pmcHistory} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} width={30} />
                        <Tooltip labelFormatter={(v: string) => v} formatter={(v: number, name: string) => { const m = PMC_METRICS.find((mm) => mm.key === name); return m ? [m.format(v), m.label] : [v, name]; }} contentStyle={{ fontSize: 12 }} />
                        {PMC_METRICS.filter((m) => pmcMetrics.has(m.key)).map((m) => (
                          <Area key={m.key} type="monotone" dataKey={m.key} stroke={m.color} fill={m.color} fillOpacity={0.12} strokeWidth={2} dot={false} />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Intensity Distribution */}
            {intensityDist && (
              <div className="mb-6">
                <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3">Intensity Distribution</h3>
                <div className="space-y-1.5">
                  {([{ k: "zone1Pct" as const, l: "Z1 · Recovery", c: "bg-blue-400" }, { k: "zone2Pct" as const, l: "Z2 · Endurance", c: "bg-green-400" }, { k: "zone3Pct" as const, l: "Z3 · Tempo", c: "bg-amber-400" }, { k: "zone4Pct" as const, l: "Z4 · Threshold", c: "bg-orange-500" }, { k: "zone5Pct" as const, l: "Z5 · VO₂Max", c: "bg-red-500" }]).map((z) => {
                    const pct = intensityDist[z.k];
                    return <div key={z.k}><div className="flex justify-between text-xs mb-0.5"><span className="text-muted-foreground">{z.l}</span><span className="font-medium">{pct}%</span></div><div className="w-full bg-muted rounded-full h-2"><div className={`${z.c} h-2 rounded-full`} style={{ width: `${pct}%` }} /></div></div>;
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant={intensityDist.distributionType === "polarized" ? "success" : intensityDist.distributionType === "pyramidal" ? "warning" : "destructive"}>
                    {intensityDist.distributionType.replace("-", " ").toUpperCase()}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{intensityDist.activityCount} activities · {intensityDist.analyzedHours}h analyzed</span>
                </div>
              </div>
            )}

            {/* Historical Trends */}
            {trends.length >= 2 && (
              <div className="mb-6 last:mb-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  {TREND_METRICS.map((m) => (
                    <button key={m.key} onClick={() => setTrendMetrics((prev) => { const n = new Set(prev); if (n.has(m.key)) { if (n.size > 1) n.delete(m.key); } else n.add(m.key); return n; })}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${trendMetrics.has(m.key) ? "text-foreground border" : "text-muted-foreground border border-dashed opacity-60 hover:opacity-100"}`}
                      style={trendMetrics.has(m.key) ? { borderColor: m.color, backgroundColor: `${m.color}14` } : {}}>
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: m.color }} /> {m.label}
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      {(() => {
                        const vis = TREND_METRICS.filter((m) => trendMetrics.has(m.key));
                        const leftN = vis.filter((m) => m.orientation === "left").length;
                        const rightN = vis.filter((m) => m.orientation === "right").length;
                        const margin = { top: 4, right: rightN > 1 ? 20 + rightN * 32 : rightN > 0 ? 20 : 8, left: leftN > 1 ? 20 + leftN * 32 : leftN > 0 ? 20 : 8, bottom: 0 };
                        return (
                          <AreaChart data={trends} margin={margin} onClick={(data) => {
                            if (!data?.activeLabel) return;
                            const label = data.activeLabel;
                            const g = timeframeDays > 90 ? "month" : "week";
                            if (g === "month" && label.length === 7) router.push(`/activities?from=${label}-01&to=${label}-31`);
                            else if (label.length === 10) { const d = new Date(label); const e = new Date(d); e.setDate(e.getDate() + 6); router.push(`/activities?from=${label}&to=${e.toISOString().split("T")[0]}`); }
                          }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="weekStartDate" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.length > 7 ? v.slice(5) : v} interval="preserveStartEnd" />
                            {vis.map((m) => (
                              <YAxis key={m.yAxisId} yAxisId={m.yAxisId} orientation={m.orientation} stroke={m.color} tick={{ fontSize: 10, fill: m.color }}
                                width={m.orientation === "left" ? (leftN === 0 ? 30 : 44) : (rightN === 0 ? 30 : 44)} tickFormatter={m.tickFormatter}
                                domain={m.key === "readinessScore" ? [0, 100] : ["auto", "auto"]} />
                            ))}
                            <Tooltip labelFormatter={(v: string) => v.length > 7 ? `Week of ${v}` : v} formatter={(v: number, name: string) => { const mt = TREND_METRICS.find((mm) => mm.key === name); return mt ? [mt.format(v), mt.label] : [v, name]; }} contentStyle={{ fontSize: 12 }} />
                            {vis.map((m) => (<Area key={m.key} yAxisId={m.yAxisId} type="monotone" dataKey={m.key} stroke={m.color} fill={m.color} fillOpacity={0.12} strokeWidth={2} dot={false} />))}
                          </AreaChart>
                        );
                      })()}
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 text-center">Click a data point to view training logs for that period</div>
                </div>
              </div>
            )}

            {/* Shared timeframe buttons */}
            <div className="flex gap-1 mt-4 flex-wrap">
              {TIME_RANGES.map((r) => (
                <Button key={r.days} variant={timeframeDays === r.days ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setTimeframeDays(r.days)}>{r.label}</Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ 6. HEALTH & BODY ROW ═══ */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <HrZoneCard stats={stats} />
          <div className="space-y-3">
            {stats.latestWeight && (
              <Card><CardContent className="py-4">
                <span className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-1"><Activity className="h-3.5 w-3.5" /> Weight</span>
                <div className="flex items-baseline gap-1"><span className="text-2xl font-bold">{stats.latestWeight}</span><span className="text-sm text-muted-foreground">kg</span></div>
                <div className="mt-3 pt-3 border-t space-y-1">
                  {stats.activeGoals > 0 && <div className="flex items-center gap-2 text-[11px]"><Target className="h-3 w-3 text-muted-foreground shrink-0" /><span className="text-muted-foreground">{stats.activeGoals} active goal{stats.activeGoals !== 1 ? "s" : ""}</span></div>}
                  {stats.weeklyCount > 0 && <div className="flex items-center gap-2 text-[11px]"><Activity className="h-3 w-3 text-muted-foreground shrink-0" /><span className="text-muted-foreground">{stats.weeklyCount} activit{stats.weeklyCount !== 1 ? "ies" : "y"} this week</span></div>}
                </div>
              </CardContent></Card>
            )}
            <HealthMetricsCard data={dailyHealth} />
          </div>
        </div>
      )}

      {/* ═══ No trackpoint data notice ═══ */}
      {trackpointInsights && !trackpointInsights.available && (
        <Card className="mb-6 border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Database className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <h3 className="font-medium text-sm">{t("enableDetailedMetrics")}</h3>
                <p className="text-sm text-muted-foreground mt-1">Upload a Strava export ZIP or individual GPX/TCX/FIT files to unlock intensity distribution, HR decoupling analysis, and efficiency factor tracking.{" "}<Link href="/ingestion" className="text-primary underline">Go to Data Import →</Link></p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ 7. GOAL PROGRESS ═══ */}
      {goals.length > 0 && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3">{t("raceGoals")}</h2>
            {goals.map((goal) => {
              const pct = Math.min(100, goal.progress);
              const barColor = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
              return (
                <div key={goal.id} className="mb-3 last:mb-0">
                  <div className="flex justify-between text-sm mb-1"><span className="font-medium">{goal.name}</span><span className="text-muted-foreground">{goal.daysUntil > 0 ? common("daysLeft", { days: goal.daysUntil }) : common("pastDue")} — {pct}%</span></div>
                  <div className="w-full bg-muted rounded-full h-2.5"><div className={`${barColor} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} /></div>
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

      {/* ═══ 8. TRAINING PLAN ═══ */}
      {plan && plan.days && (
        <Card className="mb-6">
          <CardContent className="py-4">
            {/* Header with week navigation */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setWeekOffset((w) => w - 1)}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  aria-label={t("previousWeek")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                  {t("trainingPlan")}
                </h2>
                <span className="text-xs text-muted-foreground font-medium">
                  {formatWeekLabel(plan.weekStart, plan.weekEnd)}
                </span>
                <button
                  onClick={() => setWeekOffset((w) => w + 1)}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  aria-label={t("nextWeek")}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {plan.targetVolumeMeters ? `${Math.round(plan.targetVolumeMeters / 1000)}km` : ""}
                  {plan.targetElevationMeters ? ` · ${Math.round(plan.targetElevationMeters)}m` : ""}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">Use AI Coach above to modify</span>
              </div>
            </div>

            {/* Days */}
            <div className="space-y-0.5">
              {plan.days.map((day) => {
                const hasPlanned = day.planned && day.planned.description;
                const hasActual = day.actual && day.actual.name;
                const isChanged = day.planned?.changeReason;

                return (
                  <div
                    key={day.date}
                    className={`flex items-start gap-2 text-sm py-4 px-2 rounded transition-colors
                      ${day.isToday ? "bg-primary/5 ring-1 ring-primary/20" : ""}
                      ${day.isPast ? "opacity-55" : "hover:bg-muted/30"}
                      ${day.isPast && !hasActual ? "opacity-40" : ""}
                    `}
                  >
                    {/* Day label + date */}
                    <span className={`w-14 shrink-0 text-xs font-medium
                      ${day.isPast ? "text-muted-foreground" : "text-muted-foreground"}
                    `}>
                      {day.dayLabel} {new Date(day.date).getDate()}
                    </span>

                    {/* Planned content */}
                    {hasPlanned ? (
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <span className={`${day.isPast ? "text-muted-foreground line-through decoration-1" : "font-medium"}`}>
                          {day.planned!.description}
                        </span>
                        {day.planned!.targetDistance && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {Math.round(day.planned!.targetDistance / 1000)}km
                          </span>
                        )}
                        {/* Change indicator */}
                        {isChanged && (
                          <span
                            className="inline-flex items-center justify-center shrink-0 cursor-help"
                            title={day.planned!.changeReason}
                          >
                            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title={day.planned!.changeReason} />
                          </span>
                        )}
                      </div>
                    ) : day.isPast ? (
                      <span className="flex-1 text-xs text-muted-foreground italic">
                        {hasActual ? t("unplanned") : t("noPlanNoActivity")}
                      </span>
                    ) : (
                      <span className="flex-1 text-xs text-muted-foreground italic">{t("noPlanSet")}</span>
                    )}

                    {/* Actual activity (past days) */}
                    {hasActual && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="h-1 w-1 rounded-full bg-green-500 shrink-0" />
                        <span className="text-xs font-medium">{day.actual!.name}</span>
                        {day.actual!.distanceMeters && (
                          <span className="text-xs text-muted-foreground">
                            {(day.actual!.distanceMeters / 1000).toFixed(1)}km
                          </span>
                        )}
                      </div>
                    )}
                    {day.isPast && !hasActual && (
                      <span className="text-[10px] text-muted-foreground italic shrink-0">—</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Adjustments */}
            {plan.adjustments && plan.adjustments.length > 0 && (
              <div className="mt-3 pt-3 border-t">
                <div className="space-y-0.5">
                  {plan.adjustments.map((adj, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <span className="mt-0.5 shrink-0">•</span>
                      <span>{adj}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Coach notes */}
            {plan.coachNotes && (
              <div className="mt-2 pt-2 border-t">
                <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{plan.coachNotes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ 9. TRACKPOINT INSIGHTS ═══ */}
      {trackpointInsights?.available && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {trackpointInsights.decoupling && (
            <Card><CardContent className="py-4">
              <div className="flex items-start justify-between mb-3">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground"><Heart className="h-3.5 w-3.5 text-red-500 inline" /> {t("hrDecoupling")}</h2>
                <Dialog>
                  <DialogTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer" aria-label={t("hrDecouplingInfo")}>
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("hrDecouplingDialogTitle")}</DialogTitle>
                      <DialogDescription className="space-y-2 pt-2">
                        <p>{t("hrDecouplingDialogP1")}</p>
                        <p>{t.rich("hrDecouplingDialogP2", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                        <p>{t.rich("hrDecouplingDialogP3", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                        <p>{t.rich("hrDecouplingDialogP4", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                        <p className="text-xs text-muted-foreground pt-1">{t("hrDecouplingDialogP5")}</p>
                      </DialogDescription>
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="text-center py-2">
                <div className={`text-3xl font-bold ${trackpointInsights.decoupling.status === "excellent" ? "text-green-600" : trackpointInsights.decoupling.status === "good" ? "text-amber-600" : "text-red-600"}`}>{trackpointInsights.decoupling.avgDecouplingPct}%</div>
                <Badge variant={trackpointInsights.decoupling.status === "excellent" ? "success" : trackpointInsights.decoupling.status === "good" ? "warning" : "destructive"} className="mt-1">{trackpointInsights.decoupling.status.toUpperCase()}</Badge>
              </div>
            </CardContent></Card>
          )}
          {trackpointInsights.efTrend && trackpointInsights.efTrend.length >= 2 && (
            <Card><CardContent className="py-4">
              <div className="flex items-start justify-between mb-3">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{t("efficiencyFactor")}</h2>
                <Dialog>
                  <DialogTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer" aria-label={t("efInfo")}>
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("efDialogTitle")}</DialogTitle>
                      <DialogDescription className="space-y-2 pt-2">
                        <p>{t("efDialogP1")}</p>
                        <p>{t("efDialogP2")}</p>
                        <p>{t("efDialogP3")}</p>
                        <p className="text-xs text-muted-foreground pt-1">{t("efDialogP4")}</p>
                      </DialogDescription>
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="h-32"><ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trackpointInsights.efTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <YAxis tick={{ fontSize: 10 }} width={30} domain={["dataMin - 0.1", "dataMax + 0.1"]} />
                  <Tooltip labelFormatter={(v: string) => `Week of ${v}`} formatter={(v: number) => [v.toFixed(2), "EF"]} contentStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="ef" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} strokeWidth={2} dot />
                </AreaChart>
              </ResponsiveContainer></div>
              {(() => { const t = trackpointInsights.efTrend!; if (t.length < 2) return null; const ch = ((t[t.length-1].ef - t[0].ef) / t[0].ef) * 100; return <Badge variant={ch >= 0 ? "success" : "destructive"} className="mt-2">{ch >= 0 ? "+" : ""}{Math.round(ch)}%</Badge>; })()}
              {trackpointInsights.estimatedFtp && <p className="text-xs text-muted-foreground mt-2">Est. FTP: {trackpointInsights.estimatedFtp}W{trackpointInsights.estimatedFtpWkg ? ` · ${trackpointInsights.estimatedFtpWkg} w/kg` : ""}</p>}
            </CardContent></Card>
          )}
        </div>
      )}

    </div>
  );
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const start = new Date(weekStart);
  const end = new Date(weekEnd);
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString("en-US", { month: "short" })} ${start.getDate()}–${end.getDate()}`;
  }
  return `${start.toLocaleDateString("en-US", fmt)} – ${end.toLocaleDateString("en-US", fmt)}`;
}
