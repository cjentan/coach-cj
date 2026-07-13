"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Activity, Bike, Waves, Mountain, Clock, Heart, Route, Filter, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistance, formatDuration } from "@/lib/utils";

type ActivityLog = {
  id: string; type: string; subType: string | null; name: string; startDate: string;
  distanceMeters: number | null; elevationGainMeters: number | null;
  durationSeconds: number; averageHr: number | null; tss: number | null;
  remarks?: string | null; source: string;
};

type ActivityType = "all" | "run" | "ride" | "swim" | "hike";

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: "all", label: "All Activities" },
  { value: "run", label: "Run" },
  { value: "ride", label: "Ride" },
  { value: "swim", label: "Swim" },
  { value: "hike", label: "Hike" },
];

type ActivitySource = "all" | "strava" | "garmin" | "watch_push" | "manual";

const ACTIVITY_SOURCES: { value: ActivitySource; label: string }[] = [
  { value: "all", label: "All Sources" },
  { value: "strava", label: "Strava" },
  { value: "garmin", label: "Garmin" },
  { value: "watch_push", label: "Watch Push" },
  { value: "manual", label: "Manual" },
];

const TYPE_ICONS: Record<string, React.ReactNode> = {
  run: <Activity className="h-4 w-4" />,
  ride: <Bike className="h-4 w-4" />,
  swim: <Waves className="h-4 w-4" />,
  hike: <Mountain className="h-4 w-4" />,
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

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const PAGE_SIZE = 100;

export default function TrainingLogsPage() {
  const [allLogs, setAllLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [activityFilter, setActivityFilter] = useState<ActivityType>("all");
  const [subTypeFilter, setSubTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<ActivitySource>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string, name: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${name}"?\n\nThis cannot be undone.`)) return;
    setDeleting(id);
    try {
      await fetch(`/api/training-logs/${id}`, { method: "DELETE" });
      setAllLogs((prev) => prev.filter((l) => l.id !== id));
      setTotal((prev) => prev - 1);
    } catch {
      alert("Failed to delete. Please try again.");
    }
    setDeleting(null);
  }

  function buildFilterParams(offsetVal: number) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offsetVal) });
    if (activityFilter !== "all") params.set("type", activityFilter);
    if (subTypeFilter !== "all") params.set("subType", subTypeFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    return params;
  }

  async function loadLogs() {
    setLoading(true);
    try {
      const r = await fetch(`/api/training-logs?${buildFilterParams(0)}`);
      const data = await r.json();
      if (data.logs) {
        setAllLogs(data.logs);
        setTotal(data.total);
        setOffset(data.logs.length);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/training-logs?${buildFilterParams(offset)}`);
      const data = await r.json();
      if (data.logs) {
        setAllLogs((prev) => [...prev, ...data.logs]);
        setOffset((prev) => prev + data.logs.length);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => { loadLogs(); }, [activityFilter, subTypeFilter, sourceFilter, dateFrom, dateTo]);

  const weeklyStats = useMemo(() => {
    const weekStart = getWeekStart(new Date());
    const weekLogs = allLogs.filter((log) => new Date(log.startDate) >= weekStart);
    return {
      totalDistance: weekLogs.reduce((s, l) => s + (l.distanceMeters || 0), 0),
      totalDuration: weekLogs.reduce((s, l) => s + (l.durationSeconds || 0), 0),
      totalElevation: weekLogs.reduce((s, l) => s + (l.elevationGainMeters || 0), 0),
      count: weekLogs.length,
    };
  }, [allLogs]);

  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Training Logs</h1>
      <div className="animate-pulse space-y-3 mt-8">
        {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-muted rounded-lg" />)}
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="h-7 w-7 text-primary" />
          Training Logs
        </h1>
        <p className="text-muted-foreground mt-1">{total} activities — showing {allLogs.length}</p>
      </div>

      {/* Weekly summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="py-4 text-center"><div className="text-lg font-bold">{formatDistance(weeklyStats.totalDistance)}</div><div className="text-xs text-muted-foreground">This Week</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center"><div className="text-lg font-bold">{formatDuration(weeklyStats.totalDuration)}</div><div className="text-xs text-muted-foreground">Duration</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center"><div className="text-lg font-bold">{formatDistance(weeklyStats.totalElevation)}</div><div className="text-xs text-muted-foreground">Elevation</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center"><div className="text-lg font-bold">{weeklyStats.count}</div><div className="text-xs text-muted-foreground">Activities</div></CardContent></Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2"><Filter className="h-4 w-4" /> Filters</CardTitle>
            {(activityFilter !== "all" || subTypeFilter !== "all" || sourceFilter !== "all" || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setActivityFilter("all"); setSubTypeFilter("all"); setSourceFilter("all"); setDateFrom(""); setDateTo(""); }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
            <div className="grid sm:grid-cols-5 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Activity Type</Label>
              <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as ActivityType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ACTIVITY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sub-Type</Label>
              <Select value={subTypeFilter} onValueChange={setSubTypeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sub-Types</SelectItem>
                  {Object.entries(SUB_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data Source</Label>
              <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as ActivitySource)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ACTIVITY_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      {/* Activity list */}
      {allLogs.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">{loadingMore ? "Loading more activities..." : "No activities match your filters."}</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {allLogs.map((log) => {
            const dist = log.distanceMeters || 0;
            return (
              <Link key={log.id} href={`/training-logs/${log.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-muted-foreground">{TYPE_ICONS[log.type] || <Activity className="h-4 w-4" />}</span>
                          <span className="font-semibold truncate">{log.name}</span>
                          <Badge variant={TYPE_BADGE_VARIANTS[log.type] || "outline"} className="shrink-0 capitalize">{log.type}</Badge>
                          {log.subType && SUB_TYPE_LABELS[log.subType] && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">{SUB_TYPE_LABELS[log.subType]}</Badge>
                          )}
                          <SourceBadge source={log.source} />
                        </div>
                        <p className="text-sm text-muted-foreground">{new Date(log.startDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
                      </div>
                      <div className="grid grid-cols-2 sm:flex sm:items-center gap-3 sm:gap-4 text-sm shrink-0">
                        {dist > 0 && <div className="flex items-center gap-1.5"><Route className="h-3.5 w-3.5 text-muted-foreground" /><span>{formatDistance(dist)}</span></div>}
                        <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-muted-foreground" /><span>{formatDuration(log.durationSeconds)}</span></div>
                        {log.elevationGainMeters != null && <div className="flex items-center gap-1.5"><Mountain className="h-3.5 w-3.5 text-muted-foreground" /><span>{log.elevationGainMeters}m</span></div>}
                        {log.averageHr != null && <div className="flex items-center gap-1.5"><Heart className="h-3.5 w-3.5 text-muted-foreground" /><span>{Math.round(log.averageHr)} bpm</span></div>}
                        {log.tss != null && <Badge variant="secondary" className="text-xs">TSS {Math.round(log.tss)}</Badge>}
                        {log.remarks && <Badge variant="outline" className="text-xs gap-1"><MessageSquare className="h-3 w-3" /></Badge>}
                        <button
                          className="ml-2 p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          onClick={(e) => handleDelete(log.id, log.name, e)}
                          disabled={deleting === log.id}
                          title="Delete activity"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          {/* Load More */}
          {allLogs.length < total && (
            <div className="text-center pt-4">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : `Load More (${total - allLogs.length} remaining)`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
