"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration } from "@/lib/utils";
import type {
  PlanDay,
  PlanDayActual,
  PlanDayPlanned,
  PlanWeekData,
} from "@/lib/training-plan-types";
import {
  Activity,
  ChevronRight,
  Route,
  Mountain,
  Clock,
  Heart,
  Target,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Minus,
  BarChart3,
  Database,
  Info,
  ChevronLeft,
  AlertCircle,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useDashboardPrefs } from "@/hooks/use-dashboard-prefs";

interface ReadinessData {
  score: number;
  status: "on_track" | "needs_attention" | "off_track";
  volumeAdherence: number;
}

interface GoalSummary {
  id: string;
  name: string;
  targetDate: string;
  distanceMeters: number;
  elevationGainMeters: number | null;
  priority: string;
  progress: number;
  daysUntil: number;
  goalStatement?: string | null;
}

interface StatsComparison {
  weeklyDistance: number;
  weeklyElevation: number;
  weeklyDuration: number;
  weeklyCount: number;
  weeklyTss: number;
  avgDailyTss: number;
  avgHr: number | null;
}

interface Stats {
  weeklyDistance: number;
  weeklyElevation: number;
  weeklyDuration: number;
  weeklyCount: number;
  weeklyTss: number;
  avgDailyTss: number;
  avgHr: number | null;
  activeGoals: number;
  latestWeight: number | null;
  latestRestingHr: number | null;
  maxHr: number;
  maxHrSource: "estimated" | "user-set" | "default";
  lastWeek: StatsComparison | null;
  currentMonth: StatsComparison | null;
  lastMonth: StatsComparison | null;
}

interface PmcData {
  ctl: number;
  atl: number;
  tsb: number;
  rampRate: number | null;
  ctlTrend: "up" | "down" | "stable";
  atlTrend: "up" | "down" | "stable";
  tsbTrend: "up" | "down" | "stable";
}

interface PmcHistoryPoint {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
  ef: number | null;
  measuredEf: boolean;
  decoupling: number | null;
  measuredDecoupling: boolean;
  ftp: number | null;
}

interface TrackpointInsights {
  available: boolean;
  message?: string;
  activityCount?: number;
  intensityDistribution?: {
    zone1Pct: number;
    zone2Pct: number;
    zone3Pct: number;
    zone4Pct: number;
    zone5Pct: number;
    distributionType: "polarized" | "pyramidal" | "threshold-heavy";
    activityCount: number;
    totalAnalyzedHours: number;
  } | null;
  decoupling?: {
    avgDecouplingPct: number;
    status: "excellent" | "good" | "elevated";
    activityCount: number;
  } | null;
  estimatedFtp?: number | null;
  estimatedFtpWkg?: number | null;
  weightSource?: string | null;
}

interface DailyHealthItem {
  id: string;
  date: string;
  restingHeartRate: number | null;
  sleepSeconds: number | null;
  sleepScore: number | null;
  deepSleepSeconds: number | null;
  bodyBatteryMin: number | null;
  bodyBatteryMax: number | null;
  avgStress: number | null;
  hrvStatus: string | null;
  overnightHrv: number | null;
  steps: number | null;
}

interface AnalysisReportData {
  id: string;
  reasoning: {
    dataDrivers?: string[];
    strengths?: string[];
    concerns?: string[];
    keyDecisions?: string[];
  } | null;
  metrics: {
    ctl?: number;
    atl?: number;
    tsb?: number;
    readinessScore?: number;
    sleepAvg?: number;
    hrvAvg?: number;
    restingHrAvg?: number;
  } | null;
  createdAt: string;
}

interface RaceReadinessOutput {
  readinessPct: number;
  status: string;
  volumeGap: number;
  elevationGap: number | null;
  tsbStatus: string;
  recommendations: string[];
}

const TIME_RANGES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "Max", days: 730 },
];

/**
 * Parse a "YYYY-MM-DD" date string as a LOCAL date (midnight in the browser's
 * timezone). The dashboard API returns local date strings, so constructing via
 * local components keeps day-of-month / weekday rendering correct regardless of
 * the browser's offset — `new Date("YYYY-MM-DD")` would parse as UTC midnight
 * and shift a day for negative-offset users.
 */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("dashboard");
  const common = useTranslations("common");
  const labelsT = useTranslations("labels");
  const locale = useLocale();
  const { prefs, setPrefs } = useDashboardPrefs();
  // Browser's UTC offset in minutes (negative for UTC+); all dashboard dates
  // are bucketed/labeled in the user's local timezone.
  const tzOffset = new Date().getTimezoneOffset();
  const timeframeDays = prefs.timeframeDays;
  const volumePeriod = prefs.volumePeriod;
  const pmcMetrics = new Set(prefs.pmcMetrics);

  const [stats, setStats] = useState<Stats | null>(null);
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [plan, setPlan] = useState<PlanWeekData | null>(null);
  const [pmc, setPmc] = useState<PmcData | null>(null);
  const [pmcHistory, setPmcHistory] = useState<PmcHistoryPoint[]>([]);
  const [intensityDist, setIntensityDist] = useState<{
    zone1Pct: number;
    zone2Pct: number;
    zone3Pct: number;
    zone4Pct: number;
    zone5Pct: number;
    distributionType: string;
    activityCount: number;
    analyzedHours: number;
  } | null>(null);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReportData | null>(null);
  const [raceReadiness, setRaceReadiness] = useState<Map<string, RaceReadinessOutput>>(new Map());
  const [dailyHealth, setDailyHealth] = useState<DailyHealthItem[]>([]);
  const [trackpointInsights, setTrackpointInsights] = useState<TrackpointInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  // Metric explainer: null = dialog closed, otherwise the key of the metric shown.
  const [explainerMetric, setExplainerMetric] = useState<string | null>(null);

  type ExplainerParagraph = { k: string; strong?: boolean; note?: boolean };

  interface PmcMetric {
    key: string;
    label: string;
    color: string;
    format: (v: number) => string;
    yAxisId: string;
    measuredField?: string;
    /** Render as a stroke-only line (no area fill) — e.g. FTP, a level not a load curve. */
    lineOnly?: boolean;
    paragraphs: readonly ExplainerParagraph[];
  }

  const PMC_METRICS: readonly PmcMetric[] = [
    {
      key: "tss",
      label: t("metricTssLoad"),
      color: "#a855f7",
      format: (v: number) => String(Math.round(v)),
      yAxisId: "main",
      paragraphs: [
        { k: "metricTssP1" },
        { k: "metricTssP2", strong: true },
        { k: "metricTssP3", strong: true },
        { k: "metricTssP4", strong: true },
        { k: "metricTssNote", note: true },
      ],
    },
    {
      key: "ctl",
      label: t("ctlFitness"),
      color: "#3b82f6",
      format: (v: number) => String(Math.round(v)),
      yAxisId: "main",
      paragraphs: [
        { k: "ctlDialogP1", strong: true },
        { k: "ctlDialogP2" },
        { k: "ctlDialogP3", note: true },
      ],
    },
    {
      key: "atl",
      label: t("atlFatigue"),
      color: "#f59e0b",
      format: (v: number) => String(Math.round(v)),
      yAxisId: "main",
      paragraphs: [
        { k: "atlDialogP1", strong: true },
        { k: "atlDialogP2" },
        { k: "atlDialogP3", note: true },
      ],
    },
    {
      key: "tsb",
      label: t("tsbForm"),
      color: "#22c55e",
      format: (v: number) => String(Math.round(v)),
      yAxisId: "main",
      paragraphs: [
        { k: "tsbDialogP1", strong: true },
        { k: "tsbDialogP2", strong: true },
        { k: "tsbDialogP3", strong: true },
        { k: "tsbDialogP4", note: true },
      ],
    },
    // EF, HR decoupling and FTP are on completely different scales (EF ≈0.5–3,
    // drift 0–15%, FTP 100–400W) than the PMC curves, so they get their own
    // right-side axes instead of sharing the left one. EF and decoupling are
    // sparse — only measured on some days — so measuredField marks the real
    // measurements for the dot rendering. FTP is a stroke-only level (lineOnly),
    // not an area load curve.
    {
      key: "ef",
      label: t("efEfficiency"),
      color: "#06b6d4",
      format: (v: number) => (v == null ? "—" : v.toFixed(2)),
      yAxisId: "ef",
      measuredField: "measuredEf",
      paragraphs: [
        { k: "metricEfP1" },
        { k: "metricEfP2", strong: true },
        { k: "metricEfP3", strong: true },
        { k: "metricEfP4" },
        { k: "metricEfNote", note: true },
      ],
    },
    {
      key: "decoupling",
      label: t("decoupling"),
      color: "#ec4899",
      format: (v: number) => (v == null ? "—" : `${v.toFixed(1)}%`),
      yAxisId: "decoupling",
      measuredField: "measuredDecoupling",
      paragraphs: [
        { k: "hrDecouplingDialogP1" },
        { k: "hrDecouplingDialogP2", strong: true },
        { k: "hrDecouplingDialogP3", strong: true },
        { k: "hrDecouplingDialogP4", strong: true },
        { k: "hrDecouplingDialogP5", note: true },
      ],
    },
    {
      key: "ftp",
      label: t("ftpThreshold"),
      color: "#ef4444",
      format: (v: number) => (v == null ? "—" : `${v.toFixed(0)}W`),
      yAxisId: "ftp",
      lineOnly: true,
      paragraphs: [
        { k: "metricFtpP1" },
        { k: "metricFtpP2", strong: true },
        { k: "metricFtpP3", strong: true },
        { k: "metricFtpP4" },
        { k: "metricFtpNote", note: true },
      ],
    },
  ];

  // One shared explainer for every metric — each info button on the dashboard
  // opens it with its metric preselected. Chart metrics inherit label/color/
  // paragraphs from PMC_METRICS; readiness is the first, non-chart entry.
  const METRIC_EXPLAINERS: readonly {
    key: string;
    label: string;
    color: string;
    paragraphs: readonly ExplainerParagraph[];
  }[] = [
    {
      key: "readiness",
      label: t("readiness"),
      color: "#6366f1",
      paragraphs: [
        { k: "readinessDialogP1", strong: true },
        { k: "readinessDialogP2", strong: true },
        { k: "readinessDialogP3", strong: true },
        { k: "readinessDialogP4", strong: true },
        { k: "readinessDialogP5", note: true },
      ],
    },
    ...PMC_METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      color: m.color,
      paragraphs: m.paragraphs,
    })),
  ];

  function computeDelta(
    current: number,
    prior: number | null | undefined
  ): { direction: "up" | "down" | "flat" | "new"; pct: number } | null {
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

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await fetch(`/api/dashboard/load?tzOffset=${tzOffset}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setStats(data.stats || null);
      setGoals(data.goals || []);
      setReadiness(data.readiness || null);
      setPmc(data.pmc || null);
      if (data.analysisReport) setAnalysisReport(data.analysisReport);

      fetch(`/api/dashboard/trackpoint-insights?tzOffset=${tzOffset}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setTrackpointInsights(d))
        .catch(() => {});
      fetch(
        `/api/dashboard/intensity-distribution?days=${Math.min(timeframeDays, 365)}&tzOffset=${tzOffset}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.distribution && setIntensityDist(d.distribution))
        .catch(() => {});
      fetch(`/api/daily-health?days=7&tzOffset=${tzOffset}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.healthData && setDailyHealth(d.healthData))
        .catch(() => {});
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : common("error"));
    } finally {
      setLoading(false);
    }
  }, [tzOffset, timeframeDays, common]);

  const fetchPmcHistory = useCallback(
    async (days: number) => {
      try {
        const res = await fetch(`/api/dashboard/pmc-history?days=${days}&tzOffset=${tzOffset}`);
        if (res.ok) {
          const data = await res.json();
          setPmcHistory(data.series || []);
        }
      } catch {
        /* ignore */
      }
    },
    [tzOffset]
  );

  const loadPlan = useCallback(
    async (offset: number) => {
      try {
        const res = await fetch(`/api/dashboard/plan?weekOffset=${offset}&tzOffset=${tzOffset}`);
        if (res.ok) {
          const data = await res.json();
          setPlan(data);
        }
      } catch {
        /* ignore */
      }
    },
    [tzOffset]
  );

  // Reload plan when weekOffset changes
  useEffect(() => {
    loadPlan(weekOffset);
  }, [weekOffset, loadPlan]);

  // Compute race readiness
  useEffect(() => {
    if (!goals.length || !pmc || !stats) return;
    const now = Date.now();
    const newReadiness = new Map<string, RaceReadinessOutput>();
    for (const goal of goals) {
      const weeksUntilRace = Math.max(
        1,
        Math.ceil((new Date(goal.targetDate).getTime() - now) / (7 * 86400000))
      );
      const targetPeakWeekly = goal.distanceMeters * 0.7;
      const volumeProgress =
        weeksUntilRace <= 4
          ? targetPeakWeekly
          : targetPeakWeekly * (1 - (weeksUntilRace - 4) * 0.02);
      const volumeGap =
        volumeProgress > 0
          ? Math.min(100, Math.round((stats.weeklyDistance / volumeProgress) * 100))
          : 0;
      let elevationGap: number | null = null;
      if (goal.elevationGainMeters && goal.elevationGainMeters > 0) {
        elevationGap = Math.min(
          100,
          Math.round((stats.weeklyElevation / (goal.elevationGainMeters * 0.5)) * 100)
        );
      }
      const tsbStatus = pmc.tsb > 10 ? "fresh" : pmc.tsb > -10 ? "balanced" : "fatigued";
      const readinessPct = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            Math.min(100, volumeGap) * 0.45 +
              (elevationGap != null ? Math.min(100, elevationGap) * 0.2 : 15) +
              (pmc.tsb > 10 ? 20 : pmc.tsb > -5 ? 15 : pmc.tsb > -15 ? 10 : 5) +
              (readiness?.volumeAdherence || 50) * 0.1
          )
        )
      );
      const status = readinessPct >= 70 ? "on_track" : readinessPct >= 45 ? "needs_work" : "behind";
      const recommendations: string[] = [];
      if (volumeGap < 50 && weeksUntilRace > 4) recommendations.push(t("recVolumeLow"));
      else if (volumeGap < 80 && weeksUntilRace > 4)
        recommendations.push(t("recBuildVolume", { target: Math.round(targetPeakWeekly / 1000) }));
      if (pmc.tsb < -15) recommendations.push(t("recTsbNegative"));
      if (readinessPct >= 70) recommendations.push(t("recOnTrack"));
      else recommendations.push(t("recConsistency"));
      newReadiness.set(goal.id, {
        readinessPct,
        status,
        volumeGap,
        elevationGap,
        tsbStatus,
        recommendations,
      });
    }
    setRaceReadiness(newReadiness);
  }, [goals, pmc, stats, readiness, t]);

  useEffect(() => {
    let cancelled = false;
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    } else if (status === "authenticated") {
      // Check onboarding status
      fetch("/api/settings/onboarding")
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (!data.onboardingCompleted) {
            router.push("/onboarding");
          } else {
            loadAll();
          }
        })
        .catch(() => {
          if (!cancelled) loadAll();
        });
    }
    return () => {
      cancelled = true;
    };
  }, [status, router, loadAll]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    const pmcDays = Math.min(timeframeDays, 365);
    fetchPmcHistory(pmcDays);
    fetch(`/api/dashboard/intensity-distribution?days=${pmcDays}&tzOffset=${tzOffset}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.distribution) setIntensityDist(d.distribution);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, timeframeDays, fetchPmcHistory, tzOffset]);

  // ─── Helper components ─────────────────────────────────────────────

  function HrZoneCard({ stats }: { stats: Stats }) {
    const maxHr = stats.maxHr;
    const restHr = stats.latestRestingHr;
    // Label which value is in effect: data-derived estimate, the user's
    // manually set value, or the generic default.
    const maxHrLabel =
      stats.maxHrSource === "estimated"
        ? t("maxHrSourceEstimated")
        : stats.maxHrSource === "user-set"
          ? t("maxHrSourceUserSet")
          : t("maxHrSourceDefault");
    return (
      <div className="rounded-lg border bg-muted/20 p-4">
        <span className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-2">
          <Heart className="h-3.5 w-3.5 text-red-500" /> {t("hr")}
        </span>
        <div className="flex flex-wrap items-stretch gap-2">
          {/* Rest / Max / Avg grouped as one unit */}
          <div className="flex items-center divide-x divide-border rounded-md border shrink-0 w-full sm:w-auto">
            <div className="px-3 py-1.5 text-center flex-1 sm:flex-none">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("restingHr")}
              </div>
              <div className="text-[11px] font-medium tabular-nums mt-0.5">
                {restHr ? `${restHr} bpm` : "—"}
              </div>
            </div>
            <div className="px-3 py-1.5 text-center flex-1 sm:flex-none">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {maxHrLabel}
              </div>
              <div className="text-[11px] font-medium tabular-nums mt-0.5">{maxHr} bpm</div>
            </div>
            <div className="px-3 py-1.5 text-center flex-1 sm:flex-none">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("avgExerciseHr")}
              </div>
              <div className="text-[11px] font-medium tabular-nums mt-0.5">
                {stats.avgHr ? `${Math.round(stats.avgHr)} bpm` : "—"}
              </div>
            </div>
          </div>
          {(() => {
            const thresholds = [0.6, 0.7, 0.8, 0.9];
            const labels = t.raw("hrZones") as unknown as string[];
            const textColors = [
              "text-blue-500",
              "text-green-500",
              "text-amber-500",
              "text-orange-600",
              "text-red-500",
            ];
            // Karvonen (heart-rate reserve) when a resting HR is recorded, else the
            // same bands as % of max HR — matching computeIntensityDistribution.
            // The last zone (Z5) is bounded by max HR itself, so an out-of-range
            // index (which previously produced NaN) is impossible.
            const zoneToBpm = (pct: number) =>
              restHr && restHr > 0 && restHr < maxHr
                ? Math.round(restHr + (maxHr - restHr) * pct)
                : Math.round(maxHr * pct);
            return (
              // On mobile the zones stack vertically — one full-width row per
              // zone — so each HR range fits without truncation; at sm+ they
              // sit in a single horizontal row beside the rest/max/avg group
              // (sm:flex-1), sharing the width.
              <div className="flex flex-col gap-2 min-w-0 w-full sm:flex-row sm:w-auto sm:flex-1">
                {labels.map((label, i) => {
                  const lower = i === 0 ? 0 : zoneToBpm(thresholds[i - 1]);
                  const upper = i < thresholds.length ? zoneToBpm(thresholds[i]) : maxHr;
                  return (
                    <div
                      key={label}
                      className="sm:flex-1 min-w-0 rounded-md border p-2 sm:p-1 text-center"
                    >
                      <div
                        className={`text-[11px] sm:text-[10px] font-semibold uppercase tracking-wide truncate ${textColors[i]}`}
                      >
                        {label}
                      </div>
                      <div className="text-sm sm:text-[11px] font-medium tabular-nums mt-0.5 truncate">
                        {lower === 0 ? `<${upper}` : `${lower}–${upper}`} bpm
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  function HealthMetricsCard({ data }: { data: DailyHealthItem[] }) {
    // No health sync at all (e.g. Coros-only users) → the recovery tiles are
    // hidden entirely; the caller renders the HR zone card full-width instead.
    if (data.length === 0) return null;
    const latestDate = data[0]?.date;
    // Each metric falls back to the most recent day that has a value, so a
    // single sleep-less (or unsynced) night doesn't blank the tile.
    const latestValue = <T,>(pick: (d: DailyHealthItem) => T | null | undefined): T | null => {
      for (const d of data) {
        const v = pick(d);
        if (v != null) return v;
      }
      return null;
    };
    const sleepSeconds = latestValue((d) => (d.sleepSeconds ? d.sleepSeconds : null));
    const sleepScore = latestValue((d) => d.sleepScore);
    const overnightHrv = latestValue((d) => (d.overnightHrv ? d.overnightHrv : null));
    const hrvStatus = latestValue((d) => d.hrvStatus);

    // Relative date shared by both tiles — labels which night the data is from
    // (sleep/HRV are per-night, unlike the rolling PMC numbers).
    const relativeDate = latestDate
      ? (() => {
          const d = parseLocalDate(latestDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
          if (diff === 0) return common("today");
          if (diff === 1) return common("yesterday");
          return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
        })()
      : null;

    const tiles = [
      {
        key: "sleep",
        label: t("sleep"),
        date: relativeDate,
        value: sleepSeconds ? formatDuration(sleepSeconds) : "—",
        sub: sleepScore != null ? `${t("score")}: ${sleepScore}` : null,
      },
      {
        key: "hrv",
        label: t("hrv"),
        date: relativeDate,
        value: overnightHrv ? `${overnightHrv}ms` : "—",
        sub: hrvStatus ? <span className="capitalize">{hrvStatus}</span> : null,
      },
    ];

    // Rendered inside the top readiness card — same tile styling as the
    // CTL/ATL/TSB/decoupling tiles so the health metrics read as part of it.
    // Grid placement: full-width row below the readiness row below sm, but
    // packs onto the same row as readiness+PMC at xl.
    return (
      <div className="sm:col-span-4 xl:col-span-2 grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <div key={tile.key} className="rounded-lg border bg-muted/20 p-2.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {tile.label}
              </span>
              {tile.date && <span className="text-[10px] text-muted-foreground">{tile.date}</span>}
            </div>
            <div className="text-xl font-bold tabular-nums">{tile.value}</div>
            {tile.sub && <div className="text-[10px] text-muted-foreground">{tile.sub}</div>}
          </div>
        ))}
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────
  if (status === "loading" || loading) {
    return <div className="max-w-5xl mx-auto px-4 py-8">{common("loading")}</div>;
  }

  // Single-tick left axis: round the peak of the currently-selected main PMC
  // curves (TSS/CTL/ATL/TSB) up to a nice number and label only that top tick, so
  // the chart rescales when the user toggles metrics. The lower bound stays at 0
  // unless the selected values dip below it (e.g. negative TSB).
  const mainValues = pmcHistory.flatMap((p) => {
    const vals: number[] = [];
    if (pmcMetrics.has("tss")) vals.push(p.tss);
    if (pmcMetrics.has("ctl")) vals.push(p.ctl);
    if (pmcMetrics.has("atl")) vals.push(p.atl);
    if (pmcMetrics.has("tsb")) vals.push(p.tsb);
    return vals;
  });
  const mainLow = mainValues.length ? Math.min(0, ...mainValues) : 0;
  const mainHigh = mainValues.length ? Math.max(...mainValues) : 0;
  const mainTick = Math.max(10, Math.ceil(mainHigh / 10) * 10);
  const mainDomain: [number, number] = [mainLow, mainTick];

  // HR decoupling stat in the readiness row: the 28-day average from the
  // trackpoint insights, colored by its status on the same green/amber/red
  // scale as the old standalone card. "—" when no trackpoint data exists.
  const decouplingData = trackpointInsights?.decoupling ?? null;
  const decouplingColor = !decouplingData
    ? "text-muted-foreground"
    : decouplingData.status === "excellent"
      ? "text-green-600"
      : decouplingData.status === "good"
        ? "text-amber-600"
        : "text-red-600";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">
            {t("welcome", {
              name: session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : "",
            })}
          </h1>
          {analysisReport?.createdAt && (
            <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {t("analyzed")}{" "}
              {(() => {
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
              {analysisReport.metrics.ctl != null &&
                `CTL ${Math.round(analysisReport.metrics.ctl)}`}
              {analysisReport.metrics.tsb != null &&
                ` · TSB ${Math.round(analysisReport.metrics.tsb)}`}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={loadAll}>
            <Activity className="h-4 w-4 mr-1" /> {common("refresh")}
          </Button>
        </div>
      </div>

      {fetchError && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded mb-4">
          {common("error")}: {fetchError}.{" "}
          <button className="underline" onClick={loadAll}>
            {common("retry")}
          </button>
        </div>
      )}

      {/* ═══ 1. READINESS + PMC ═══ */}
      {readiness && pmc && (
        <Card className="mb-6">
          <CardContent className="py-4">
            {/* All seven metrics pack into one row at xl; without health data
                the grid stays at 5 columns so no empty cells appear. */}
            <div
              className={
                dailyHealth.length > 0
                  ? "grid grid-cols-1 sm:grid-cols-4 xl:grid-cols-7 gap-4"
                  : "grid grid-cols-1 sm:grid-cols-4 gap-4"
              }
            >
              <div className="sm:col-span-1 xl:col-span-1 flex items-center gap-3 xl:flex-col p-3 rounded-lg bg-muted/20">
                <div
                  className={`text-4xl font-bold ${readiness.score >= 70 ? "text-green-600" : readiness.score >= 50 ? "text-amber-600" : "text-red-600"}`}
                >
                  {readiness.score}
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    {t("readiness")}
                    <button
                      className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                      aria-label={t("readinessInfo")}
                      onClick={() => setExplainerMetric("readiness")}
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                  <div
                    className={`font-semibold text-sm ${readiness.score >= 70 ? "text-green-600" : readiness.score >= 50 ? "text-amber-600" : "text-red-600"}`}
                  >
                    {readiness.status === "on_track"
                      ? t("readinessOnTrack")
                      : readiness.status === "needs_attention"
                        ? t("readinessNeedsAttention")
                        : t("readinessOffTrack")}
                  </div>
                  <div className="w-full bg-muted rounded-full h-1 mt-1">
                    <div
                      className="bg-blue-500 h-1 rounded-full"
                      style={{ width: `${readiness.volumeAdherence}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="sm:col-span-3 xl:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    {t("ctlFitness")}
                    <button
                      className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                      aria-label={t("ctlInfo")}
                      onClick={() => setExplainerMetric("ctl")}
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-xl font-bold ${pmc.ctl >= 50 ? "text-blue-600" : "text-blue-400"}`}
                    >
                      {pmc.ctl}
                    </span>
                    {pmc.ctlTrend === "up" ? (
                      <TrendingUp className="h-3 w-3 text-green-500" />
                    ) : pmc.ctlTrend === "down" ? (
                      <TrendingDown className="h-3 w-3 text-red-500" />
                    ) : (
                      <Minus className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  {pmc.rampRate !== null && (
                    <div className="text-[10px] text-muted-foreground">
                      {t("ramp", { value: `${pmc.rampRate >= 0 ? "+" : ""}${pmc.rampRate}` })}/wk
                    </div>
                  )}
                </div>
                <div className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    {t("atlFatigue")}
                    <button
                      className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                      aria-label={t("atlInfo")}
                      onClick={() => setExplainerMetric("atl")}
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-xl font-bold ${pmc.atl > 80 ? "text-red-600" : pmc.atl > 50 ? "text-amber-600" : "text-green-600"}`}
                    >
                      {pmc.atl}
                    </span>
                    {pmc.atlTrend === "up" ? (
                      <TrendingUp className="h-3 w-3 text-amber-500" />
                    ) : pmc.atlTrend === "down" ? (
                      <TrendingDown className="h-3 w-3 text-green-500" />
                    ) : (
                      <Minus className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    {t("tsbForm")}
                    <button
                      className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                      aria-label={t("tsbInfo")}
                      onClick={() => setExplainerMetric("tsb")}
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-xl font-bold ${pmc.tsb >= 0 ? "text-green-600" : pmc.tsb >= -10 ? "text-amber-600" : "text-red-600"}`}
                    >
                      {pmc.tsb}
                    </span>
                    {pmc.tsbTrend === "up" ? (
                      <TrendingUp className="h-3 w-3 text-green-500" />
                    ) : pmc.tsbTrend === "down" ? (
                      <TrendingDown className="h-3 w-3 text-red-500" />
                    ) : (
                      <Minus className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    {t("decoupling")}
                    <button
                      className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                      aria-label={t("decouplingInfo")}
                      onClick={() => setExplainerMetric("decoupling")}
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-xl font-bold ${decouplingColor}`}>
                      {decouplingData ? `${decouplingData.avgDecouplingPct}%` : "—"}
                    </span>
                  </div>
                  {decouplingData && (
                    <div className="text-[10px] text-muted-foreground">
                      {t("decouplingActivityCount", { count: decouplingData.activityCount })}
                    </div>
                  )}
                </div>
              </div>

              {/* Sleep + HRV tile inside the same top grid — packs onto the
                  readiness row at xl, full-width row below it otherwise.
                  Hidden for users without health data. */}
              {dailyHealth.length > 0 && <HealthMetricsCard data={dailyHealth} />}
            </div>

            {/* HR zone card — full-width row below the readiness section. */}
            <div className="mt-4 space-y-3">{stats && <HrZoneCard stats={stats} />}</div>
          </CardContent>
        </Card>
      )}

      {/* ═══ 2. RACE READINESS ═══ */}
      {goals.length > 0 && pmc && (
        <Card className="mb-6 border-primary/20">
          <CardContent className="py-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
              <Target className="h-4 w-4" /> {t("raceReadiness")}
            </h2>
            <div className="space-y-3">
              {goals.slice(0, 3).map((goal) => {
                const rr = raceReadiness.get(goal.id);
                return (
                  <div key={goal.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-start justify-between mb-2 gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{goal.name}</span>
                          <Badge
                            variant={
                              goal.priority === "A"
                                ? "destructive"
                                : goal.priority === "B"
                                  ? "default"
                                  : "secondary"
                            }
                            className="text-[10px] h-5"
                          >
                            {goal.priority === "A"
                              ? t("goalA")
                              : goal.priority === "B"
                                ? t("goalB")
                                : t("goalC")}
                          </Badge>
                        </div>
                        {goal.goalStatement && (
                          <p className="text-xs text-muted-foreground italic mt-0.5">
                            &ldquo;{goal.goalStatement}&rdquo;
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {goal.daysUntil > 0 ? `${goal.daysUntil}d` : t("due")}
                      </div>
                    </div>
                    {rr ? (
                      <>
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <div
                            className={`text-2xl font-bold ${rr.readinessPct >= 70 ? "text-green-600" : rr.readinessPct >= 45 ? "text-amber-600" : "text-red-600"}`}
                          >
                            {rr.readinessPct}%
                          </div>
                          <Badge
                            variant={
                              rr.status === "on_track"
                                ? "success"
                                : rr.status === "needs_work"
                                  ? "warning"
                                  : "destructive"
                            }
                          >
                            {rr.status === "on_track"
                              ? t("statusOnTrack")
                              : rr.status === "needs_work"
                                ? t("statusNeedsWork")
                                : t("statusBehind")}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {t("volume")}: {rr.volumeGap}%
                            {rr.elevationGap != null
                              ? ` · ${t("elevation")}: ${rr.elevationGap}%`
                              : ""}
                          </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${rr.readinessPct >= 70 ? "bg-green-500" : rr.readinessPct >= 45 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${rr.readinessPct}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {rr.recommendations[0]}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("computingReadiness")}</p>
                    )}
                  </div>
                );
              })}
            </div>
            {goals.length > 3 && (
              <Link
                href="/settings/goals"
                className="text-xs text-primary hover:underline mt-2 inline-block"
              >
                {t("viewAllGoals", { count: goals.length })}
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ 3. VOLUME & LOAD ═══ */}
      {stats && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> {t("volumeAndLoad")}
                </h2>
                <span className="text-[10px] text-muted-foreground normal-case font-normal">
                  {volumePeriod === "week" ? t("vsLastWeek") : t("vsLastMonth")}
                </span>
              </div>
              <Tabs
                value={volumePeriod}
                onValueChange={(v) => setPrefs({ volumePeriod: v as "week" | "month" })}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="week" className="text-xs px-3">
                    {t("week")}
                  </TabsTrigger>
                  <TabsTrigger value="month" className="text-xs px-3">
                    {t("month")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: t("distance"),
                  current:
                    volumePeriod === "week"
                      ? stats.weeklyDistance
                      : (stats.currentMonth?.weeklyDistance ?? stats.weeklyDistance),
                  prior:
                    volumePeriod === "week"
                      ? stats.lastWeek?.weeklyDistance
                      : stats.lastMonth?.weeklyDistance,
                  formattedValue: formatDistance(
                    volumePeriod === "week"
                      ? stats.weeklyDistance
                      : (stats.currentMonth?.weeklyDistance ?? stats.weeklyDistance)
                  ),
                  icon: <Route className="h-4 w-4" />,
                },
                {
                  label: t("elevation"),
                  current:
                    volumePeriod === "week"
                      ? stats.weeklyElevation
                      : (stats.currentMonth?.weeklyElevation ?? stats.weeklyElevation),
                  prior:
                    volumePeriod === "week"
                      ? stats.lastWeek?.weeklyElevation
                      : stats.lastMonth?.weeklyElevation,
                  formattedValue: `${Math.round(volumePeriod === "week" ? stats.weeklyElevation : (stats.currentMonth?.weeklyElevation ?? stats.weeklyElevation)).toLocaleString()} m`,
                  icon: <Mountain className="h-4 w-4" />,
                },
                {
                  label: t("duration"),
                  current:
                    volumePeriod === "week"
                      ? stats.weeklyDuration
                      : (stats.currentMonth?.weeklyDuration ?? stats.weeklyDuration),
                  prior:
                    volumePeriod === "week"
                      ? stats.lastWeek?.weeklyDuration
                      : stats.lastMonth?.weeklyDuration,
                  formattedValue: formatDuration(
                    volumePeriod === "week"
                      ? stats.weeklyDuration
                      : (stats.currentMonth?.weeklyDuration ?? stats.weeklyDuration)
                  ),
                  icon: <Clock className="h-4 w-4" />,
                },
                {
                  label: t("tssLoad"),
                  current:
                    volumePeriod === "week"
                      ? stats.weeklyTss
                      : (stats.currentMonth?.weeklyTss ?? stats.weeklyTss),
                  prior:
                    volumePeriod === "week"
                      ? stats.lastWeek?.weeklyTss
                      : stats.lastMonth?.weeklyTss,
                  formattedValue: String(
                    volumePeriod === "week"
                      ? stats.weeklyTss
                      : (stats.currentMonth?.weeklyTss ?? stats.weeklyTss)
                  ),
                  icon: <TrendingUp className="h-4 w-4" />,
                },
              ].map((metric) => {
                const delta = computeDelta(metric.current, metric.prior);
                return (
                  <div key={metric.label}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-muted-foreground">{metric.icon}</span>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        {metric.label}
                      </span>
                    </div>
                    <div className="text-2xl font-bold">{metric.formattedValue}</div>
                    {delta && (
                      <div className="flex items-center gap-1 mt-0.5 text-xs font-medium">
                        {delta.direction === "up" && <ArrowUp className="h-3 w-3 text-green-500" />}
                        {delta.direction === "down" && (
                          <ArrowDown className="h-3 w-3 text-red-500" />
                        )}
                        {delta.direction === "flat" && (
                          <Minus className="h-3 w-3 text-muted-foreground" />
                        )}
                        {delta.direction === "new" ? (
                          <span className="text-blue-500">{t("newActivity")}</span>
                        ) : (
                          <span
                            className={
                              delta.direction === "up"
                                ? "text-green-600"
                                : delta.direction === "down"
                                  ? "text-red-600"
                                  : "text-muted-foreground"
                            }
                          >
                            {delta.pct}%{" "}
                            {delta.direction === "up"
                              ? "↑"
                              : delta.direction === "down"
                                ? "↓"
                                : "—"}
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

      {/* ═══ 4. TRAINING ANALYSIS (PMC + Intensity Dist) ═══ */}
      {(pmcHistory.length > 0 || intensityDist) && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4" /> {t("trainingAnalysis")}
            </h2>

            {/* Shared timeframe buttons + metric explainer */}
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <div className="flex gap-1 flex-wrap">
                {TIME_RANGES.map((r) => (
                  <Button
                    key={r.days}
                    variant={timeframeDays === r.days ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setPrefs({ timeframeDays: r.days })}
                  >
                    {r.label === "Max" ? t("timeMax") : r.label}
                  </Button>
                ))}
              </div>
              <button
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-xs"
                aria-label={t("metricHelp")}
                onClick={() => setExplainerMetric("tss")}
              >
                <Info className="h-3.5 w-3.5" /> <span>{t("metricHelp")}</span>
              </button>
            </div>

            {/* PMC / Fitness Trends */}
            {pmcHistory.length > 0 && (
              <div className="mb-6">
                <div className="flex gap-1 flex-wrap mb-3">
                  {PMC_METRICS.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => {
                        const current = new Set(prefs.pmcMetrics);
                        if (current.has(m.key)) {
                          if (current.size > 1) current.delete(m.key);
                        } else current.add(m.key);
                        setPrefs({ pmcMetrics: Array.from(current) });
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${pmcMetrics.has(m.key) ? "text-foreground border" : "text-muted-foreground border border-dashed opacity-60 hover:opacity-100"}`}
                      style={
                        pmcMetrics.has(m.key)
                          ? { borderColor: m.color, backgroundColor: `${m.color}14` }
                          : {}
                      }
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ background: m.color }}
                      />{" "}
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={pmcHistory}
                        margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v: string) => v.slice(5)}
                          interval="preserveStartEnd"
                        />
                        {/* Left axis shows a single line + one tick at the rounded peak
                            (mainTick). The right-side axes are hidden — they must stay
                            mounted (with their domains) because the EF/decoupling/FTP
                            Areas bind to them by yAxisId. hide skips both rendering and
                            the reserved width. */}
                        <YAxis
                          yAxisId="main"
                          tick={{ fontSize: 10 }}
                          width={30}
                          domain={mainDomain}
                          ticks={[mainTick]}
                        />
                        {pmcMetrics.has("ef") && (
                          <YAxis yAxisId="ef" orientation="right" domain={["auto", "auto"]} hide />
                        )}
                        {pmcMetrics.has("decoupling") && (
                          <YAxis
                            yAxisId="decoupling"
                            orientation="right"
                            domain={["auto", "auto"]}
                            hide
                          />
                        )}
                        {pmcMetrics.has("ftp") && (
                          <YAxis yAxisId="ftp" orientation="right" domain={["auto", "auto"]} hide />
                        )}
                        <Tooltip
                          content={({ active, payload, label }: any) => {
                            if (!active || !payload || payload.length === 0) return null;
                            // label is the X-axis value (the local date string); fall back to
                            // the hovered point's date field if recharts omits it.
                            const date = label ?? payload[0]?.payload?.date;
                            return (
                              <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                                {date && (
                                  <div className="font-medium mb-1.5">
                                    {parseLocalDate(date).toLocaleDateString(locale, {
                                      weekday: "short",
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </div>
                                )}
                                <div className="space-y-1">
                                  {payload.map((entry: any) => {
                                    const m = PMC_METRICS.find((mm) => mm.key === entry.name);
                                    return (
                                      <div key={entry.name} className="flex items-center gap-2">
                                        <span
                                          className="inline-block w-2 h-2 rounded-full shrink-0"
                                          style={{ background: m?.color ?? entry.color }}
                                        />
                                        <span className="text-muted-foreground">
                                          {m?.label ?? entry.name}
                                        </span>
                                        <span className="ml-auto font-medium tabular-nums">
                                          {m ? m.format(entry.value) : String(entry.value)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }}
                        />
                        {PMC_METRICS.filter((m) => pmcMetrics.has(m.key)).map((m) => {
                          // Only sparse metrics (EF, decoupling) carry a measured* flag;
                          // it's optional on the typed config, so it's undefined elsewhere.
                          const measuredField = m.measuredField;
                          const strokeOnly = measuredField || m.lineOnly;
                          return (
                            <Area
                              key={m.key}
                              yAxisId={m.yAxisId}
                              type="monotone"
                              dataKey={m.key}
                              stroke={m.color}
                              fill={strokeOnly ? "none" : m.color}
                              fillOpacity={strokeOnly ? 0 : 0.12}
                              strokeWidth={2}
                              dot={
                                measuredField
                                  ? (props: any) =>
                                      props.payload?.[measuredField] ? (
                                        <circle
                                          key={props.key}
                                          cx={props.cx}
                                          cy={props.cy}
                                          r={2.5}
                                          fill={m.color}
                                          stroke="none"
                                        />
                                      ) : (
                                        <circle key={props.key} cx={props.cx} cy={props.cy} r={0} />
                                      )
                                  : false
                              }
                            />
                          );
                        })}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Intensity Distribution */}
            {intensityDist && (
              <div className="mb-6">
                <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3">
                  {t("intensityDistribution")}
                </h3>
                <div className="space-y-1.5">
                  {[
                    { k: "zone1Pct" as const, c: "bg-blue-400" },
                    { k: "zone2Pct" as const, c: "bg-green-400" },
                    { k: "zone3Pct" as const, c: "bg-amber-400" },
                    { k: "zone4Pct" as const, c: "bg-orange-500" },
                    { k: "zone5Pct" as const, c: "bg-red-500" },
                  ].map((z, zi) => {
                    const pct = intensityDist[z.k];
                    return (
                      <div key={z.k}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">
                            {(t.raw("intensityZones") as unknown as string[])[zi]}
                          </span>
                          <span className="font-medium">{pct}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div className={`${z.c} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge
                    variant={
                      intensityDist.distributionType === "polarized"
                        ? "success"
                        : intensityDist.distributionType === "pyramidal"
                          ? "warning"
                          : "destructive"
                    }
                  >
                    {intensityDist.distributionType === "polarized"
                      ? t("distPolarized")
                      : intensityDist.distributionType === "pyramidal"
                        ? t("distPyramidal")
                        : t("distThresholdHeavy")}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {t("activitiesAnalyzed", {
                      count: intensityDist.activityCount,
                      hours: intensityDist.analyzedHours,
                    })}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ No trackpoint data notice ═══ */}
      {trackpointInsights && !trackpointInsights.available && (
        <Card className="mb-6 border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Database className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <h3 className="font-medium text-sm">{t("enableDetailedMetrics")}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("trackpointNotice")}{" "}
                  <Link href="/ingestion" className="text-primary underline">
                    {t("goToImport")}
                  </Link>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ 6. TRAINING PLAN ═══ */}
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
                  {plan.targetElevationMeters
                    ? ` · ${Math.round(plan.targetElevationMeters)}m`
                    : ""}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  {t("aiCoachModifyHint")}
                </span>
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
                    <span
                      className={`w-14 shrink-0 text-xs font-medium
                      ${day.isPast ? "text-muted-foreground" : "text-muted-foreground"}
                    `}
                    >
                      {labelsT("days.short." + day.dayLabel)} {parseLocalDate(day.date).getDate()}
                    </span>

                    {/* Main column: planned workout + actual activity stacked */}
                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Planned content */}
                      {hasPlanned ? (
                        <div className="space-y-0.5">
                          <span
                            className={`${day.isPast ? "text-muted-foreground line-through decoration-1" : "font-medium"}`}
                          >
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
                              <span
                                className="inline-block w-2 h-2 rounded-full bg-amber-400"
                                title={day.planned!.changeReason}
                              />
                            </span>
                          )}
                        </div>
                      ) : day.isPast ? (
                        <span className="block text-xs text-muted-foreground italic">
                          {hasActual ? t("unplanned") : t("noPlanNoActivity")}
                        </span>
                      ) : (
                        <span className="block text-xs text-muted-foreground italic">
                          {t("noPlanSet")}
                        </span>
                      )}

                      {/* Actual activity (past days) — new line under the planned workout */}
                      {hasActual && (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1 w-1 rounded-full bg-green-500 shrink-0" />
                          <span className="text-xs font-medium">{day.actual!.name}</span>
                          {day.actual!.distanceMeters && (
                            <span className="text-xs text-muted-foreground">
                              {(day.actual!.distanceMeters / 1000).toFixed(1)}km
                            </span>
                          )}
                        </div>
                      )}
                      {day.isPast && !hasActual && hasPlanned && (
                        <span className="text-[10px] text-muted-foreground italic">—</span>
                      )}
                    </div>
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
                <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                  {plan.coachNotes}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Unified metric explainer — every info button on the dashboard opens this
          with its metric preselected; chips switch metrics while it's open. */}
      <Dialog
        open={explainerMetric !== null}
        onOpenChange={(open) => {
          if (!open) setExplainerMetric(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("metricHelpTitle")}</DialogTitle>
            <DialogDescription asChild>
              <div className="pt-2">
                <div className="flex flex-wrap gap-1 mb-3" aria-label={t("metricHelp")}>
                  {METRIC_EXPLAINERS.map((m) => {
                    const active = m.key === explainerMetric;
                    return (
                      <button
                        key={m.key}
                        onClick={() => setExplainerMetric(m.key)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${active ? "text-foreground border" : "text-muted-foreground border border-dashed opacity-60 hover:opacity-100"}`}
                        style={
                          active ? { borderColor: m.color, backgroundColor: `${m.color}14` } : {}
                        }
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: m.color }}
                        />{" "}
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const active =
                    METRIC_EXPLAINERS.find((m) => m.key === explainerMetric) ??
                    METRIC_EXPLAINERS[0];
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: active.color }}
                        />{" "}
                        {active.label}
                      </div>
                      {active.paragraphs.map((p) => (
                        <p key={p.k} className={p.note ? "text-xs text-muted-foreground pt-1" : ""}>
                          {p.strong
                            ? t.rich(p.k, { strong: (chunks) => <strong>{chunks}</strong> })
                            : t(p.k)}
                        </p>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const start = parseLocalDate(weekStart);
  const end = parseLocalDate(weekEnd);
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString("en-US", { month: "short" })} ${start.getDate()}–${end.getDate()}`;
  }
  return `${start.toLocaleDateString("en-US", fmt)} – ${end.toLocaleDateString("en-US", fmt)}`;
}
