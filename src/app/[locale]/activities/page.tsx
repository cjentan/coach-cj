"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Activity, Bike, Waves, Mountain, SportShoe, Footprints, MessageSquare, ChevronDown, ChevronUp, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistance, formatDuration, localDateStr, getWeekStart, getCurrentUnits } from "@/lib/utils";
import ImportModal from "@/components/training/import-modal";
import { SOURCE_LABELS, SOURCE_COLORS, ACTIVITY_TYPE_LABELS } from "@/lib/constants";

/** Elevation with thousands separators in the active unit ("1,200m" / "3,937ft"). */
function formatElevationShort(meters: number): string {
  const units = getCurrentUnits();
  const v = units === "imperial" ? meters * 3.28084 : meters;
  return `${Math.round(v).toLocaleString()}${units === "imperial" ? "ft" : "m"}`;
}

type ActivityLog = {
  id: string; type: string; subType: string | null; name: string; startDate: string;
  distanceMeters: number | null; elevationGainMeters: number | null;
  durationSeconds: number; averageHr: number | null; tss: number | null;
  remarks?: string | null; source: string;
};

type MonthlyStat = {
  key: string; label: string; fullLabel?: string;
  activityCount: number; totalDistance: number; totalElevation: number;
  totalDurationSeconds: number;
};

// ── Constants ──────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ReactNode> = {
  run: <SportShoe className="h-4 w-4" />,
  ride: <Bike className="h-4 w-4" />,
  swim: <Waves className="h-4 w-4" />,
  hike: <Mountain className="h-4 w-4" />,
  walk: <Footprints className="h-4 w-4" />,
};

const TYPE_BADGE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  run: "default", ride: "secondary", swim: "outline", hike: "outline",
};

const SUB_TYPE_LABELS: Record<string, string> = {
  trail_running: "Trail", treadmill: "Treadmill", virtual_run: "Virtual Run",
  mountain_biking: "MTB", gravel_cycling: "Gravel", road_cycling: "Road", indoor_cycling: "Indoor", virtual_ride: "Virtual Ride", handcycle: "Handcycle",
  open_water: "Open Water", lap_swimming: "Lap Swim",
  strength_training: "Strength", crossfit: "CrossFit", yoga: "Yoga", elliptical: "Elliptical", stair_stepper: "Stair Stepper", pilates: "Pilates",
  rock_climbing: "Rock Climb", surfing: "Surfing", stand_up_paddling: "SUP", kayaking: "Kayaking", canoeing: "Canoeing", rowing: "Rowing",
  ice_skating: "Ice Skate", inline_skating: "Inline Skate", nordic_skiing: "Nordic Ski", alpine_skiing: "Alpine Ski", backcountry_skiing: "Backcountry", snowboarding: "Snowboard", snowshoeing: "Snowshoe",
  soccer: "Soccer", tennis: "Tennis", golf: "Golf", wheelchair: "Wheelchair",
};

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "outline";

function SourceBadge({ source }: { source: string }) {
  const variant = (SOURCE_COLORS as Record<string, BadgeVariant>)[source] || "outline";
  return (
    <Badge variant={variant} className="text-[10px] shrink-0">
      {(SOURCE_LABELS as Record<string, string>)[source] || source}
    </Badge>
  );
}

const TYPE_OPTIONS = ["all", "run", "ride", "swim", "hike", "workout", "walk", "other"] as const;
const TYPE_LABELS_SHORT: Record<string, string> = {
  all: "All",
  ...ACTIVITY_TYPE_LABELS,
};

const SOURCE_OPTIONS = ["all", "strava", "garmin", "watch_push", "manual"] as const;
const SOURCE_LABELS_SHORT: Record<string, string> = {
  all: "All",
  ...SOURCE_LABELS,
};

// ── Month helpers ──────────────────────────────────────────────────────

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Monday of the week containing `date`, in the viewer's local timezone.
 * Distinct from the UTC-based `getWeekStart` util — this one drives the
 * date range sent to the API, which is expressed in local dates.
 */
function getWeekStartLocal(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sunday of the week containing `date`, in the viewer's local timezone. */
function getWeekEndLocal(date: Date): Date {
  const end = getWeekStartLocal(date);
  end.setDate(end.getDate() + 6);
  return end;
}

/**
 * Month range, extended to the full training weeks that straddle the month
 * boundaries. A week that starts in one month and ends in the next (e.g.
 * Mon Jul 27 – Sun Aug 2) therefore shows up complete in BOTH monthly views:
 * July's range is extended forward, August's backward.
 */
function getMonthRange(key: string): { from: string; to: string } {
  const [year, month] = key.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1); // local midnight, first day
  const monthEnd = new Date(year, month, 0); // local midnight, last day
  return {
    from: localDateStr(getWeekStartLocal(monthStart)),
    to: localDateStr(getWeekEndLocal(monthEnd)),
  };
}

/**
 * True when the training week starting on `weekKey` overlaps `monthKey`.
 * The extended fetch range can pull in weeks from the neighbouring months;
 * this drops any that don't actually touch the selected month.
 */
function weekOverlapsMonth(weekKey: string, monthKey: string): boolean {
  const [year, month] = monthKey.split("-").map(Number);
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastOfMonth = localDateStr(new Date(year, month, 0));
  const sunday = new Date(weekKey + "T00:00:00");
  sunday.setDate(sunday.getDate() + 6);
  return weekKey <= lastOfMonth && localDateStr(sunday) >= firstOfMonth;
}

function getWeekRange(key: string): { from: string; to: string } {
  const monday = new Date(key + "T00:00:00");
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { from: key, to: localDateStr(sunday) };
}

/**
 * Label for a week keyed by its local Monday ("YYYY-MM-DD"). Computed
 * directly from the local date — NOT via the UTC-based `getWeekStart` —
 * so a Monday like "2026-07-27" labels as "Jul 27 – Aug 2" even for
 * positive UTC offsets, where the UTC week helper would shift back a week.
 */
function getWeekLabel(weekKey: string): string {
  const start = new Date(weekKey + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function groupLogsByWeek(logs: ActivityLog[]): { weekKey: string; label: string; logs: ActivityLog[] }[] {
  const groups: Record<string, ActivityLog[]> = {};
  for (const log of logs) {
    const weekStart = getWeekStart(new Date(log.startDate));
    const key = localDateStr(weekStart);
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  }
  return Object.entries(groups)
    .map(([weekKey, weekLogs]) => ({
      weekKey,
      label: getWeekLabel(weekKey),
      logs: weekLogs.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    }))
    .sort((a, b) => new Date(b.weekKey + "T00:00:00").getTime() - new Date(a.weekKey + "T00:00:00").getTime());
}

const now = new Date();
const defaultMonthKey = getMonthKey(now);
const defaultRange = getMonthRange(defaultMonthKey);

export default function ActivitiesPage() {
  const t = useTranslations("activities");
  const [allLogs, setAllLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [avgTypeFilter, setAvgTypeFilter] = useState("all");
  const [avgSourceFilter, setAvgSourceFilter] = useState("all");
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);

  // View mode — persisted to localStorage
  const [viewMode, setViewMode] = useState<"monthly" | "weekly" | "yearly">(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const vm = params.get("vm") as "monthly" | "weekly" | "yearly" | null;
      if (vm && ["monthly", "weekly", "yearly"].includes(vm)) return vm;
      return (localStorage.getItem("activities-view-mode") as "monthly" | "weekly" | "yearly") || "monthly";
    }
    return "monthly";
  });

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem("activities-view-mode", viewMode);
  }, [viewMode]);

  // Monthly/weekly stats & selection
  const [barStats, setBarStats] = useState<MonthlyStat[]>([]);
  const [selectedBar, setSelectedBar] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const bar = params.get("bar");
      if (bar) return bar;
    }
    return defaultMonthKey;
  });
  const [dateFrom, setDateFrom] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const bar = params.get("bar");
      if (bar) {
        const range = viewMode === "weekly" ? getWeekRange(bar) : getMonthRange(bar);
        return range.from;
      }
    }
    return defaultRange.from;
  });
  const [dateTo, setDateTo] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const bar = params.get("bar");
      if (bar) {
        const range = viewMode === "weekly" ? getWeekRange(bar) : getMonthRange(bar);
        return range.to;
      }
    }
    return defaultRange.to;
  });
  const [monthOffset, setMonthOffset] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const off = params.get("off");
      return off ? parseInt(off) || 0 : 0;
    }
    return 0;
  });
  const [canGoBack, setCanGoBack] = useState(true);

  // ── Filter options from API ──────────────────────────
  const [filterOptions, setFilterOptions] = useState<{
    types: string[]; sources: string[]; subTypes: string[];
  }>({ types: [], sources: [], subTypes: [] });

  // ── Sync from connected integrations (Garmin / COROS) ──
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Check which integrations are connected on mount
  useEffect(() => {
    Promise.allSettled([
      fetch("/api/integrations/garmin/status").then((r) => r.json()),
      fetch("/api/integrations/coros/status").then((r) => r.json()),
    ]).then(([garmin, coros]) => {
      const providers: string[] = [];
      if (garmin.status === "fulfilled" && garmin.value?.connected) providers.push("garmin");
      if (coros.status === "fulfilled" && coros.value?.connected) providers.push("coros");
      setConnectedProviders(providers);
    });
  }, []);

  const doSync = useCallback(async () => {
    if (syncing || connectedProviders.length === 0) return;
    setSyncing(true);
    setSyncResult(null);

    let totalImported = 0;
    let hasError = false;

    for (const provider of connectedProviders) {
      try {
        const res = await fetch(`/api/integrations/${provider}/sync`, { method: "POST" });
        const data = await res.json();
        if (res.ok) {
          totalImported += data.activitiesImported || 0;
        } else {
          hasError = true;
        }
      } catch {
        hasError = true;
      }
    }

    setSyncing(false);

    if (hasError && totalImported === 0) {
      setSyncResult({ type: "error", text: "Sync failed. Check your integrations in Settings." });
    } else {
      setSyncResult({
        type: "success",
        text: `Synced ${totalImported} activit${totalImported !== 1 ? "ies" : "y"}.`,
      });
      // Refresh activity data
      loadAll();
    }

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => setSyncResult(null), 5000);
  }, [syncing, connectedProviders]);

  // Cleanup sync timer
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  // ── Pull-to-refresh (mobile) ────────────────────────────
  const pullStateRef = useRef({ startY: 0, distance: 0, active: false });
  const [pullDistance, setPullDistance] = useState(0);

  useEffect(() => {
    if (connectedProviders.length === 0) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 8 || syncing) return;
      const ps = pullStateRef.current;
      ps.startY = e.touches[0].clientY;
      ps.distance = 0;
      ps.active = true;
      setPullDistance(0);
    };

    const onTouchMove = (e: TouchEvent) => {
      const ps = pullStateRef.current;
      if (!ps.active) return;
      const delta = e.touches[0].clientY - ps.startY;
      if (delta <= 0) {
        ps.active = false;
        setPullDistance(0);
        return;
      }
      // Resistive feel: cap distance and apply damping
      ps.distance = Math.min(delta * 0.35, 110);
      setPullDistance(ps.distance);
      if (delta > 10) e.preventDefault();
    };

    const onTouchEnd = () => {
      const ps = pullStateRef.current;
      if (!ps.active) return;
      ps.active = false;
      const dist = ps.distance;
      setPullDistance(0);
      if (dist > 55) doSync();
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [connectedProviders.length, syncing, doSync]);

  const [total, setTotal] = useState(0);

  function loadAll(cancelledRef?: { current: boolean }) {
    setLoading(true);
    Promise.all([
      fetch(`/api/activities?limit=500&from=${dateFrom}&to=${dateTo}&type=${avgTypeFilter}&source=${avgSourceFilter}&tzOffset=${new Date().getTimezoneOffset()}`).then(r => r.json()),
      fetch(`/api/activities/monthly-stats?offset=${monthOffset}&grouping=${viewMode}`).then(r => r.json()),
      fetch("/api/activities/filter-options").then(r => r.json()),
    ]).then(([logsData, stats, opts]) => {
      if (cancelledRef?.current) return;
      if (logsData.logs) { setAllLogs(logsData.logs); setTotal(logsData.total); }
      const bars = stats.months || stats.weeks;
      if (bars) { setBarStats(bars); setCanGoBack(stats.canGoBack ?? true); }
      if (opts.types) setFilterOptions(opts);
    }).catch(() => {}).finally(() => {
      if (!cancelledRef?.current) setLoading(false);
    });
  }

  // Load on mount
  useEffect(() => {
    const cancelledRef = { current: false };
    loadAll(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, []);

  // Reload when filters, month, or view mode change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/activities?limit=500&from=${dateFrom}&to=${dateTo}&type=${avgTypeFilter}&source=${avgSourceFilter}&tzOffset=${new Date().getTimezoneOffset()}`).then(r => r.json()),
      fetch(`/api/activities/monthly-stats?offset=${monthOffset}&grouping=${viewMode}`).then(r => r.json()),
    ]).then(([logsData, stats]) => {
      if (cancelled) return;
      if (logsData.logs) { setAllLogs(logsData.logs); setTotal(logsData.total); }
      const bars = stats.months || stats.weeks;
      if (bars) { setBarStats(bars); setCanGoBack(stats.canGoBack ?? true); }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [avgTypeFilter, avgSourceFilter, dateFrom, dateTo, monthOffset, viewMode]);

  // ── Sync position state to URL ─────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (viewMode !== "monthly") params.set("vm", viewMode);
    if (monthOffset > 0) params.set("off", String(monthOffset));
    if (selectedBar) params.set("bar", selectedBar);
    const qs = params.toString();
    const newUrl = `/activities${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", newUrl);
  }, [viewMode, monthOffset, selectedBar]);

  function handleImportComplete() {
    loadAll();
  }

  function handleViewModeChange(mode: "monthly" | "weekly" | "yearly") {
    if (mode === viewMode) return;
    setViewMode(mode);
    setMonthOffset(0);
    setBarStats([]);
    if (mode === "weekly") {
      const latestKey = localDateStr(getWeekStart(now));
      const range = getWeekRange(latestKey);
      setSelectedBar(latestKey);
      setDateFrom(range.from);
      setDateTo(range.to);
    } else {
      const range = getMonthRange(defaultMonthKey);
      setSelectedBar(defaultMonthKey);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
    setExpandedWeeks(new Set());
  }

  function handleMonthClick(key: string) {
    setSelectedBar(key);
    const range = viewMode === "weekly" ? getWeekRange(key) : getMonthRange(key);
    setDateFrom(range.from);
    setDateTo(range.to);
    setExpandedWeeks(new Set());
  }

  function goBackMonths() {
    const step = viewMode === "yearly" ? 1 : 12;
    const newOffset = monthOffset + step;
    setMonthOffset(newOffset);
    // Auto-select the most recent bar in the new window
    if (viewMode === "weekly") {
      const d = new Date();
      d.setDate(d.getDate() - newOffset * 7);
      const latestKey = localDateStr(getWeekStart(d));
      const range = getWeekRange(latestKey);
      setSelectedBar(latestKey);
      setDateFrom(range.from);
      setDateTo(range.to);
    } else if (viewMode === "yearly") {
      const targetYear = now.getFullYear() - newOffset;
      const lastMonth = newOffset === 0 ? now.getMonth() : 11;
      const latestKey = `${targetYear}-${String(lastMonth + 1).padStart(2, "0")}`;
      const range = getMonthRange(latestKey);
      setSelectedBar(latestKey);
      setDateFrom(range.from);
      setDateTo(range.to);
    } else {
      const latestKey = getMonthKey(new Date(now.getFullYear(), now.getMonth() - newOffset, 1));
      const range = getMonthRange(latestKey);
      setSelectedBar(latestKey);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
    setExpandedWeeks(new Set());
  }

  function goForwardMonths() {
    const step = viewMode === "yearly" ? 1 : 12;
    const newOffset = Math.max(0, monthOffset - step);
    setMonthOffset(newOffset);
    if (viewMode === "weekly") {
      const d = new Date();
      d.setDate(d.getDate() - Math.max(newOffset, 1) * 7);
      const latestKey = localDateStr(getWeekStart(newOffset === 0 ? now : d));
      const range = getWeekRange(latestKey);
      setSelectedBar(latestKey);
      setDateFrom(range.from);
      setDateTo(range.to);
    } else if (viewMode === "yearly") {
      const targetYear = now.getFullYear() - newOffset;
      const lastMonth = newOffset === 0 ? now.getMonth() : 11;
      const latestKey = `${targetYear}-${String(lastMonth + 1).padStart(2, "0")}`;
      const range = getMonthRange(latestKey);
      setSelectedBar(latestKey);
      setDateFrom(range.from);
      setDateTo(range.to);
    } else {
      if (newOffset === 0) {
        const range = getMonthRange(defaultMonthKey);
        setSelectedBar(defaultMonthKey);
        setDateFrom(range.from);
        setDateTo(range.to);
      } else {
        const latestKey = getMonthKey(new Date(now.getFullYear(), now.getMonth() - newOffset, 1));
        const range = getMonthRange(latestKey);
        setSelectedBar(latestKey);
        setDateFrom(range.from);
        setDateTo(range.to);
      }
    }
    setExpandedWeeks(new Set());
  }

  function toggleWeek(key: string) {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Group logs by week ───────────────────────────────
  const weekGroups = useMemo(() => groupLogsByWeek(allLogs), [allLogs]);

  // In monthly view the fetch range is extended to include straddling weeks,
  // so drop any week group that doesn't actually overlap the selected month.
  const visibleWeekGroups = useMemo(
    () => (viewMode === "monthly" ? weekGroups.filter((w) => weekOverlapsMonth(w.weekKey, selectedBar)) : weekGroups),
    [weekGroups, viewMode, selectedBar]
  );

  // Expand all weeks by default when month changes
  useEffect(() => {
    if (visibleWeekGroups.length > 0 && expandedWeeks.size === 0) {
      setExpandedWeeks(new Set(visibleWeekGroups.map(w => w.weekKey)));
    }
  }, [visibleWeekGroups.length]);

  // ── Active bar stats ─────────────────────────────────
  const activeBar = barStats.find((m) => m.key === selectedBar);

  // Build activity detail href with current position state
  function detailHref(activityId: string) {
    const p = new URLSearchParams();
    if (viewMode !== "monthly") p.set("vm", viewMode);
    if (monthOffset > 0) p.set("off", String(monthOffset));
    if (selectedBar) p.set("bar", selectedBar);
    const qs = p.toString();
    return `/activities/${activityId}${qs ? `?${qs}` : ""}`;
  }

  // ── Render ───────────────────────────────────────────

  if (loading && allLogs.length === 0) return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
      <div className="animate-pulse space-y-3 mt-8">
        {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-muted rounded-lg" />)}
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* ═══ PULL-TO-REFRESH INDICATOR (mobile) ═══ */}
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-100 md:hidden"
        style={{ height: pullDistance > 0 ? `${pullDistance}px` : "0px" }}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw
            className={`h-5 w-5 transition-all duration-200 ${
              pullDistance > 55 ? "text-primary" : ""
            }`}
            style={{ transform: `rotate(${pullDistance * 3.6}deg)` }}
          />
          <span>{pullDistance > 55 ? "Release to sync" : "Pull to sync"}</span>
        </div>
      </div>

      {/* ═══ SYNC RESULT BANNER ═══ */}
      {syncResult && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            syncResult.type === "success"
              ? "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200"
              : "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200"
          }`}
        >
          {syncResult.text}
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            {t("title")}
          </h1>
          {activeBar && (
            <p className="text-muted-foreground mt-1">
              {activeBar.activityCount} activit{activeBar.activityCount !== 1 ? "ies" : ""}
              {activeBar.activityCount > 0 && (
                <> — {formatDistance(activeBar.totalDistance)} · {formatElevationShort(activeBar.totalElevation)} ↑</>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          {connectedProviders.length > 0 && (
            <Button onClick={doSync} disabled={syncing} variant="outline" className="shrink-0">
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {syncing ? "Syncing…" : "Sync"}
            </Button>
          )}
          <Button onClick={() => setShowImportModal(true)} className="shrink-0">
            <Plus className="h-4 w-4 mr-2" /> Import
          </Button>
        </div>
      </div>

      {/* ═══ VOLUME BAR CHART ═══ */}
      {barStats.length > 0 && (
        <div className="mb-6">
          {/* Chart header with toggle */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {viewMode === "yearly"
                  ? now.getFullYear() - monthOffset
                  : `${viewMode === "monthly" ? "Monthly" : "Weekly"} Volume`}
              </h2>
              {/* View mode toggle */}
              <div className="flex rounded-lg border border-border p-0.5 bg-muted/30">
                <button
                  onClick={() => handleViewModeChange("monthly")}
                  className={`px-2.5 py-0.5 text-[11px] rounded-md transition-all ${
                    viewMode === "monthly"
                      ? "bg-background text-foreground shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => handleViewModeChange("weekly")}
                  className={`px-2.5 py-0.5 text-[11px] rounded-md transition-all ${
                    viewMode === "weekly"
                      ? "bg-background text-foreground shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Weekly
                </button>
                <button
                  onClick={() => handleViewModeChange("yearly")}
                  className={`px-2.5 py-0.5 text-[11px] rounded-md transition-all ${
                    viewMode === "yearly"
                      ? "bg-background text-foreground shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Yearly
                </button>
              </div>
            </div>
            {(() => {
              const totalOfDisplayed = barStats.reduce((s, m) => s + m.totalDistance, 0);
              return totalOfDisplayed > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {formatDistance(totalOfDisplayed)} total
                </span>
              ) : null;
            })()}
          </div>

          {/* Bars */}
          <div className="flex items-end gap-[3px] h-28">
            {barStats.map((bar) => {
              const maxVal = Math.max(...barStats.map((m) => m.totalDistance));
              const heightPct = maxVal > 0 ? (bar.totalDistance / maxVal) * 100 : 0;
              const isActive = selectedBar === bar.key;
              return (
                <button
                  key={bar.key}
                  onClick={() => handleMonthClick(bar.key)}
                  className="flex-1 flex flex-col items-center gap-0.5 group cursor-pointer min-w-0 h-full"
                >
                  {/* Bar area */}
                  <div className="flex-1 w-full flex items-end justify-center">
                    <div
                      className={`w-full max-w-[32px] rounded-t-sm transition-all duration-200 ${
                        isActive
                          ? "bg-primary shadow-sm"
                          : "bg-primary/40 group-hover:bg-primary/60"
                      }`}
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    />
                  </div>
                  {/* Label */}
                  <span
                    className={`text-[10px] leading-tight whitespace-nowrap ${
                      isActive
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground"
                    }`}
                  >
                    {viewMode === "monthly" ? bar.label.split(" ")[0] : bar.label}
                  </span>
                  <span className="text-[8px] leading-tight text-muted-foreground/60">
                    {bar.key.slice(0, 4)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected bar detail */}
          {activeBar && activeBar.totalDistance > 0 && (
            <div className="text-xs text-muted-foreground mt-2 text-center">
              <span className="font-medium text-foreground">
                {viewMode === "weekly" && activeBar.fullLabel ? activeBar.fullLabel : activeBar.label}
              </span>
              {" — "}
              {formatDistance(activeBar.totalDistance)}
              {" · "}
              {activeBar.activityCount} activit
              {activeBar.activityCount !== 1 ? "ies" : "y"}
              {activeBar.totalDurationSeconds > 0 && (
                <> · {formatDuration(activeBar.totalDurationSeconds)}</>
              )}
              {activeBar.totalElevation > 0 && (
                <> · {formatElevationShort(activeBar.totalElevation)} ↑</>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
            <button
              onClick={goBackMonths}
              disabled={!canGoBack}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              {viewMode === "yearly" ? "← Previous year" : `← 12 ${viewMode === "monthly" ? "months" : "weeks"} earlier`}
            </button>
            {monthOffset > 0 && (
              <button
                onClick={() => {
                  setMonthOffset(0);
                  if (viewMode === "weekly") {
                    const latestKey = localDateStr(getWeekStart(now));
                    const range = getWeekRange(latestKey);
                    setSelectedBar(latestKey);
                    setDateFrom(range.from);
                    setDateTo(range.to);
                  } else {
                    const range = getMonthRange(defaultMonthKey);
                    setSelectedBar(defaultMonthKey);
                    setDateFrom(range.from);
                    setDateTo(range.to);
                  }
                  setExpandedWeeks(new Set());
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {viewMode === "yearly" ? "This year" : `Latest ${viewMode === "monthly" ? "months" : "weeks"}`}
              </button>
            )}
            <button
              onClick={goForwardMonths}
              disabled={monthOffset === 0}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              {viewMode === "yearly" ? "Next year →" : `12 ${viewMode === "monthly" ? "months" : "weeks"} later →`}
            </button>
          </div>
        </div>
      )}

      {/* ═══ FILTER CHIPS ═══ */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide mr-1">{t("type")}</span>
        {TYPE_OPTIONS.filter(t => t === "all" || filterOptions.types.includes(t) || filterOptions.types.length === 0).map((t) => (
          <button
            key={t}
            onClick={() => setAvgTypeFilter(t)}
            className={`text-xs rounded-full px-3 py-1 border transition-all ${
              avgTypeFilter === t
                ? "bg-foreground text-background border-foreground font-medium"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30"
            }`}
          >
            {TYPE_LABELS_SHORT[t]}
          </button>
        ))}
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide mr-1 ml-2">{t("source")}</span>
        {SOURCE_OPTIONS.filter(s => s === "all" || filterOptions.sources.includes(s) || filterOptions.sources.length === 0).map((s) => (
          <button
            key={s}
            onClick={() => setAvgSourceFilter(s)}
            className={`text-xs rounded-full px-3 py-1 border transition-all ${
              avgSourceFilter === s
                ? "bg-foreground text-background border-foreground font-medium"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30"
            }`}
          >
            {SOURCE_LABELS_SHORT[s]}
          </button>
        ))}
        {(avgTypeFilter !== "all" || avgSourceFilter !== "all") && (
          <button
            onClick={() => { setAvgTypeFilter("all"); setAvgSourceFilter("all"); }}
            className="text-xs text-muted-foreground underline hover:text-foreground ml-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* ═══ WEEK-GROUPED ACTIVITIES ═══ */}
      {visibleWeekGroups.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">{t("noActivities")}</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {visibleWeekGroups.map((week) => {
            const isExpanded = expandedWeeks.has(week.weekKey);
            const weekDist = week.logs.reduce((s, l) => s + (l.distanceMeters || 0), 0);
            const weekElev = week.logs.reduce((s, l) => s + (l.elevationGainMeters || 0), 0);
            const weekDur = week.logs.reduce((s, l) => s + (l.durationSeconds || 0), 0);
            const weekTss = week.logs.reduce((s, l) => s + (l.tss || 0), 0);

            return (
              <Card key={week.weekKey} className="rounded-xl border">
                {/* Week header — clickable to expand/collapse */}
                <button
                  onClick={() => toggleWeek(week.weekKey)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors bg-muted/40 hover:bg-muted/70 border-l-[3px] border-l-primary/40 rounded-r-xl"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm tracking-tight">{week.label}</span>
                      <Badge variant="secondary" className="text-[10px] font-semibold">{week.logs.length} activit{week.logs.length !== 1 ? "ies" : "y"}</Badge>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                      {weekDist > 0 && <span className="font-medium">{formatDistance(weekDist)}</span>}
                      {weekElev > 0 && <span className="font-medium">{formatElevationShort(weekElev)} ↑</span>}
                      <span className="font-medium">{formatDuration(weekDur)}</span>
                      {weekTss > 0 && <span className="font-medium">TSS {Math.round(weekTss)}</span>}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground/60 shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground/60 shrink-0" />}
                </button>

                {/* Activity rows */}
                {isExpanded && (
                  <div className="divide-y border-t">
                    {week.logs.map((log) => {
                      const dist = log.distanceMeters || 0;
                      const elev = log.elevationGainMeters || 0;

                      return (
                        <div key={log.id}>
                          {/* Mobile layout */}
                          <Link href={detailHref(log.id)} className="md:hidden block px-4 py-3 hover:bg-muted/30 transition-colors">
                            <div className="flex items-start">
                              <div className="flex-1 min-w-0 pr-2">
                                <div className="text-sm font-medium leading-snug line-clamp-2">{log.name}</div>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(log.startDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                  </span>
                                  <span className="ml-auto flex items-center gap-1">
                                    <span className="text-muted-foreground/60">{TYPE_ICONS[log.type] || <Activity className="h-3.5 w-3.5" />}</span>
                                    <SourceBadge source={log.source} />
                                  </span>
                                </div>
                              </div>
                              <div className="text-right shrink-0" style={{ width: "25%" }}>
                                {dist > 0 && <div className="text-sm font-medium tabular-nums">{formatDistance(dist)}</div>}
                                {elev > 0 && <div className="text-xs text-muted-foreground tabular-nums">{Math.round(elev)}m</div>}
                                {log.tss != null && <div className="text-xs tabular-nums">TSS {Math.round(log.tss)}</div>}
                              </div>
                            </div>
                          </Link>
                          {/* Desktop layout (md+) */}
                          <Link href={detailHref(log.id)} className="hidden md:block px-4 py-2.5 hover:bg-muted/30 transition-colors">
                            <div className="flex items-center gap-3">
                            <span className="text-muted-foreground shrink-0">{TYPE_ICONS[log.type] || <Activity className="h-4 w-4" />}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{log.name}</span>
                                <Badge variant={TYPE_BADGE_VARIANTS[log.type] || "outline"} className="text-[10px] shrink-0 capitalize">{log.type}</Badge>
                                {log.subType && SUB_TYPE_LABELS[log.subType] && (
                                  <Badge variant="secondary" className="shrink-0 text-[10px] hidden sm:inline">{SUB_TYPE_LABELS[log.subType]}</Badge>
                                )}
                                <SourceBadge source={log.source} />
                                {log.tss != null && (
                                  <Badge variant="secondary" className="text-[10px]">TSS {Math.round(log.tss)}</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {new Date(log.startDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 text-xs shrink-0">
                              {dist > 0 && <span className="font-medium tabular-nums">{formatDistance(dist)}</span>}
                              <span className="text-muted-foreground tabular-nums">{formatDuration(log.durationSeconds)}</span>
                              {elev > 0 && (
                                <span className="text-muted-foreground tabular-nums hidden lg:inline">{Math.round(elev)}m</span>
                              )}
                              {log.averageHr != null && (
                                <span className="text-muted-foreground tabular-nums hidden lg:inline">❤️{Math.round(log.averageHr)}</span>
                              )}
                              {log.remarks && <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />}
                            </div>
                          </div>
                        </Link>
                      </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ═══ IMPORT MODAL ═══ */}
      <ImportModal
        open={showImportModal}
        onOpenChange={setShowImportModal}
        onImport={handleImportComplete}
      />
    </div>
  );
}
