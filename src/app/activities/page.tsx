"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Plus, Activity, Bike, Waves, Mountain, SportShoe, Footprints, Clock, Heart, Route, MessageSquare, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistance, formatDuration } from "@/lib/utils";
import ImportModal from "@/components/training/import-modal";

type ActivityLog = {
  id: string; type: string; subType: string | null; name: string; startDate: string;
  distanceMeters: number | null; elevationGainMeters: number | null;
  durationSeconds: number; averageHr: number | null; tss: number | null;
  remarks?: string | null; source: string;
};

type MonthlyStat = {
  key: string; label: string;
  activityCount: number; totalDistance: number; totalElevation: number;
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

const SOURCE_LABELS: Record<string, string> = {
  strava: "Strava", garmin: "Garmin", watch_push: "Watch", manual: "Manual",
};

const SOURCE_COLORS: Record<string, "default" | "secondary" | "outline" | "success" | "warning"> = {
  strava: "default", garmin: "success", watch_push: "warning", manual: "secondary",
};

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant={SOURCE_COLORS[source] || "outline"} className="text-[10px] shrink-0">
      {SOURCE_LABELS[source] || source}
    </Badge>
  );
}

const TYPE_OPTIONS = ["all", "run", "ride", "swim", "hike", "workout", "walk", "other"] as const;
const TYPE_LABELS_SHORT: Record<string, string> = {
  all: "All", run: "Run", ride: "Ride", swim: "Swim", hike: "Hike",
  workout: "Workout", walk: "Walk", other: "Other",
};

const SOURCE_OPTIONS = ["all", "strava", "garmin", "watch_push", "manual"] as const;
const SOURCE_LABELS_SHORT: Record<string, string> = {
  all: "All", strava: "Strava", garmin: "Garmin", watch_push: "Watch", manual: "Manual",
};

// ── Month helpers ──────────────────────────────────────────────────────

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(key: string): { from: string; to: string } {
  const [year, month] = key.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  return {
    from: monthStart.toISOString().split("T")[0],
    to: monthEnd.toISOString().split("T")[0],
  };
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Days to subtract to get to Monday: Sunday=6, Monday=0, Tuesday=1, ..., Saturday=5
  const daysToSubtract = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - daysToSubtract);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekLabel(date: Date): string {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function groupLogsByWeek(logs: ActivityLog[]): { weekKey: string; label: string; logs: ActivityLog[] }[] {
  const groups: Record<string, ActivityLog[]> = {};
  for (const log of logs) {
    const weekStart = getWeekStart(new Date(log.startDate));
    const key = toLocalDateStr(weekStart);
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  }
  return Object.entries(groups)
    .map(([weekKey, weekLogs]) => ({
      weekKey,
      label: getWeekLabel(new Date(weekKey + "T00:00:00")),
      logs: weekLogs.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    }))
    .sort((a, b) => new Date(b.weekKey + "T00:00:00").getTime() - new Date(a.weekKey + "T00:00:00").getTime());
}

const now = new Date();
const defaultMonthKey = getMonthKey(now);
const defaultRange = getMonthRange(defaultMonthKey);

export default function TrainingLogsPage() {
  const [allLogs, setAllLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [avgTypeFilter, setAvgTypeFilter] = useState("all");
  const [avgSourceFilter, setAvgSourceFilter] = useState("all");
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);

  // Monthly stats & selection
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStat[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonthKey);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [monthOffset, setMonthOffset] = useState(0);
  const [canGoBack, setCanGoBack] = useState(true);
  const [jumpMonths, setJumpMonths] = useState(6);

  // Detect mobile to adjust how many months we jump per arrow click
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setJumpMonths(mq.matches ? 3 : 6);
    const handler = (e: MediaQueryListEvent) => setJumpMonths(e.matches ? 3 : 6);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Filter options from API ──────────────────────────
  const [filterOptions, setFilterOptions] = useState<{
    types: string[]; sources: string[]; subTypes: string[];
  }>({ types: [], sources: [], subTypes: [] });

  function loadAll() {
    setLoading(true);
    Promise.all([
      fetch(`/api/training-logs?limit=500&from=${dateFrom}&to=${dateTo}&type=${avgTypeFilter}&source=${avgSourceFilter}`).then(r => r.json()),
      fetch(`/api/training-logs/monthly-stats?offset=${monthOffset}`).then(r => r.json()),
      fetch("/api/training-logs/filter-options").then(r => r.json()),
    ]).then(([logsData, stats, opts]) => {
      if (logsData.logs) { setAllLogs(logsData.logs); setTotal(logsData.total); }
      if (stats.months) { setMonthlyStats(stats.months); setCanGoBack(stats.canGoBack ?? true); }
      if (opts.types) setFilterOptions(opts);
    }).catch(() => {}).finally(() => setLoading(false));
  }

  const [total, setTotal] = useState(0);

  // Load on mount
  useEffect(() => { loadAll(); }, []);

  // Reload when filters or month change
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/training-logs?limit=500&from=${dateFrom}&to=${dateTo}&type=${avgTypeFilter}&source=${avgSourceFilter}`).then(r => r.json()),
      fetch(`/api/training-logs/monthly-stats?offset=${monthOffset}`).then(r => r.json()),
    ]).then(([logsData, stats]) => {
      if (logsData.logs) { setAllLogs(logsData.logs); setTotal(logsData.total); }
      if (stats.months) { setMonthlyStats(stats.months); setCanGoBack(stats.canGoBack ?? true); }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [avgTypeFilter, avgSourceFilter, dateFrom, dateTo, monthOffset]);

  function handleImportComplete() {
    loadAll();
  }

  function handleMonthClick(key: string) {
    setSelectedMonth(key);
    const range = getMonthRange(key);
    setDateFrom(range.from);
    setDateTo(range.to);
    setExpandedWeeks(new Set());
  }

  function goBackMonths() {
    const newOffset = monthOffset + jumpMonths;
    setMonthOffset(newOffset);
    // Auto-select the most recent month in the new window after data loads
    const latestKey = getMonthKey(new Date(now.getFullYear(), now.getMonth() - newOffset, 1));
    const range = getMonthRange(latestKey);
    setSelectedMonth(latestKey);
    setDateFrom(range.from);
    setDateTo(range.to);
    setExpandedWeeks(new Set());
  }

  function goForwardMonths() {
    const newOffset = Math.max(0, monthOffset - jumpMonths);
    setMonthOffset(newOffset);
    if (newOffset === 0) {
      const range = getMonthRange(defaultMonthKey);
      setSelectedMonth(defaultMonthKey);
      setDateFrom(range.from);
      setDateTo(range.to);
    } else {
      const latestKey = getMonthKey(new Date(now.getFullYear(), now.getMonth() - newOffset, 1));
      const range = getMonthRange(latestKey);
      setSelectedMonth(latestKey);
      setDateFrom(range.from);
      setDateTo(range.to);
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

  // Expand all weeks by default when month changes
  useEffect(() => {
    if (weekGroups.length > 0 && expandedWeeks.size === 0) {
      setExpandedWeeks(new Set(weekGroups.map(w => w.weekKey)));
    }
  }, [weekGroups.length]);

  // ── Active month stats ───────────────────────────────
  const activeMonth = monthlyStats.find((m) => m.key === selectedMonth);

  // ── Render ───────────────────────────────────────────

  if (loading && allLogs.length === 0) return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Training Logs</h1>
      <div className="animate-pulse space-y-3 mt-8">
        {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-muted rounded-lg" />)}
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            Training Logs
          </h1>
          {activeMonth && (
            <p className="text-muted-foreground mt-1">
              {activeMonth.activityCount} activit{activeMonth.activityCount !== 1 ? "ies" : ""}
              {activeMonth.activityCount > 0 && (
                <> — {formatDistance(activeMonth.totalDistance)} · {Math.round(activeMonth.totalElevation).toLocaleString()}m ↑</>
              )}
            </p>
          )}
        </div>
        <Button onClick={() => setShowImportModal(true)} className="shrink-0 mt-1">
          <Plus className="h-4 w-4 mr-2" /> Import
        </Button>
      </div>

      {/* ═══ MONTH SELECTOR ═══ */}
      {monthlyStats.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-1">
            <button
              onClick={goBackMonths}
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors"
              title="Older months"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 flex-1">
            {monthlyStats.map((month, i) => {
              // On mobile only show the 3 most recent months (last 3 in the array)
              const showOnMobile = i >= 3;
              const isActive = selectedMonth === month.key;
              return (
                <button
                  key={month.key}
                  ref={(el) => {
                    if (el && isActive) {
                      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
                    }
                  }}
                  onClick={() => handleMonthClick(month.key)}
                  className={`flex flex-col items-center rounded-xl border px-3.5 py-2 text-xs shrink-0 min-w-[105px] transition-all ${showOnMobile ? "" : "hidden md:flex"} ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-card hover:bg-muted/70 border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={`font-semibold text-sm ${isActive ? "text-primary-foreground" : "text-foreground"}`}>
                    {month.label}
                  </span>
                  <span className="leading-tight">{month.activityCount} act.</span>
                  <span className="leading-tight">{formatDistance(month.totalDistance)}</span>
                </button>
              );
            })}
            </div>
            <button
              onClick={goForwardMonths}
              disabled={monthOffset === 0}
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
              title="Newer months"
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* ═══ FILTER CHIPS ═══ */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide mr-1">Type</span>
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
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide mr-1 ml-2">Source</span>
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
      {allLogs.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No activities in this period.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {weekGroups.map((week) => {
            const isExpanded = expandedWeeks.has(week.weekKey);
            const weekDist = week.logs.reduce((s, l) => s + (l.distanceMeters || 0), 0);
            const weekElev = week.logs.reduce((s, l) => s + (l.elevationGainMeters || 0), 0);
            const weekDur = week.logs.reduce((s, l) => s + (l.durationSeconds || 0), 0);

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
                      {weekElev > 0 && <span className="font-medium">{Math.round(weekElev)}m ↑</span>}
                      <span className="font-medium">{formatDuration(weekDur)}</span>
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
                          <Link href={`/training-logs/${log.id}`} className="md:hidden block px-4 py-3 hover:bg-muted/30 transition-colors">
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
                              </div>
                            </div>
                          </Link>
                          {/* Desktop layout (md+) */}
                          <Link href={`/training-logs/${log.id}`} className="hidden md:block px-4 py-2.5 hover:bg-muted/30 transition-colors">
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
