"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration, formatPace } from "@/lib/utils";
import { format } from "date-fns";
import {
  Activity, Clock, Mountain, Route, Heart, Zap, ArrowLeft, ArrowRight,
  ChevronLeft, ChevronRight, MessageSquare, Trash2, TrendingUp, BarChart3, Flame,
  Copy, AlertTriangle, Target, Check, Brain, Loader2, AlertCircle,
} from "lucide-react";
import { TrackPoint } from "@/lib/gpx-parser";
import {
  computeSplits, computeHrZoneBreakdown, computeVam,
  computeCombinedDistanceData, computeCombinedTimeData,
  extractRoutePoints, extractLaps, formatSplitPace, formatTime,
} from "@/lib/trackpoint-charts";
import {
  HrZoneBar, VamCard,
  CombinedMetricsChart,
} from "@/components/training/training-charts";
import { SplitsTable, LapTable, RouteMap } from "@/components/training/training-tables";

interface RouteMatch {
  id: string; name: string; startDate: string;
  durationSeconds: number; distanceMeters: number | null;
  elevationGainMeters: number | null; averageHr: number | null;
  maxHr: number | null; tss: number | null;
  similarity: number;
}

interface TrainingLog {
  id: string; type: string; subType: string | null; name: string; description: string | null; remarks: string | null;
  coachAnalysis: string | null;
  startDate: string; durationSeconds: number; distanceMeters: number | null;
  elevationGainMeters: number | null; averageHr: number | null; maxHr: number | null;
  averagePower: number | null; normalizedPower: number | null; calories: number | null; tss: number | null;
  rawJson: Record<string, unknown> | null;
  source: string;
  duplicateGroupId: string | null;
  duplicateStatus: string | null;
  mergedIntoId: string | null;
}

interface DuplicateGroupInfo {
  id: string; status: string;
  trainingLogs: { id: string; name: string; source: string; startDate: string; mergedIntoId: string | null }[];
}

function deltaStr(current: number, previous: number | null | undefined, unit: string, invert: boolean = false): string {
  if (previous == null || previous === 0) return "—";
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  const sign = diff > 0 ? "+" : "";
  const better = invert ? diff < 0 : diff > 0;
  const worse = invert ? diff > 0 : diff < 0;
  const arrow = better ? "↓" : worse ? "↑" : "—";
  const color = better ? "text-green-600" : worse ? "text-red-600" : "text-muted-foreground";
  return `${sign}${pct}% ${arrow}`;
}

const SOURCE_LABELS: Record<string, string> = {
  strava: "Strava",
  garmin: "Garmin",
  watch_push: "Watch Push",
  manual: "Manual",
};

const SOURCE_COLORS: Record<string, "default" | "secondary" | "outline" | "success" | "warning"> = {
  strava: "default",
  garmin: "success",
  watch_push: "warning",
  manual: "secondary",
};

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant={SOURCE_COLORS[source] || "outline"}>
      {SOURCE_LABELS[source] || source}
    </Badge>
  );
}

function Stat({ icon: Icon, label, value }: {icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
      <Icon className="h-4 w-4 text-primary shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
        <div className="text-sm font-semibold truncate">{value}</div>
      </div>
    </div>
  );
}

function LogCard({ log, remarksText, remarksDirty, saved, deleting, similarRoutes, duplicateGroup, onRemarksChange, onDelete, coachAnalysisText, analyzing, analyzeError, onAnalyze }: {
  log: TrainingLog;
  remarksText: string;
  remarksDirty: boolean;
  saved: boolean;
  deleting: boolean;
  similarRoutes: RouteMatch[];
  duplicateGroup: DuplicateGroupInfo | null;
  onRemarksChange: (text: string) => void;
  onDelete: () => void;
  coachAnalysisText: string;
  analyzing: boolean;
  analyzeError: string | null;
  onAnalyze: () => void;
}) {
  const router = useRouter();
  const pace = log.distanceMeters && log.distanceMeters > 0
    ? log.distanceMeters / log.durationSeconds
    : 0;
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<{ success: boolean; goalId?: string; goalName?: string } | null>(null);

  async function handlePromote() {
    if (promoteResult?.success) return;
    if (!log || !window.confirm(`Set "${log.name}" as a race goal?\n\nDistance: ${log.distanceMeters ? `${Math.round(log.distanceMeters / 1000)}km` : "—"}\nElevation: ${log.elevationGainMeters ? `${Math.round(log.elevationGainMeters)}m` : "—"}\n\nYou can refine the goal details in Settings → Goals.`)) return;

    setPromoting(true);
    try {
      const res = await fetch(`/api/activities/${log.id}/promote-to-goal`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setPromoteResult({ success: true, goalId: data.goal.id, goalName: data.goal.name });
      } else {
        alert("Failed to create goal.");
      }
    } catch {
      alert("Network error. Please try again.");
    }
    setPromoting(false);
  }

  // Extract trackpoint data
  const rawJson = log.rawJson;
  const trackPoints = (rawJson?.trackPoints as TrackPoint[]) || null;
  const laps = extractLaps(rawJson);
  const hasTrackpoints = trackPoints && trackPoints.length >= 10;

  // Compute all chart data
  const splitMeters = log.type === "swim" ? 100 : log.type === "ride" ? 5000 : 1000;
  const splits = hasTrackpoints ? computeSplits(trackPoints!, splitMeters) : [];
  const hrZones = hasTrackpoints && log.maxHr ? computeHrZoneBreakdown(trackPoints!, log.maxHr) : null;
  const vam = hasTrackpoints ? computeVam(trackPoints!) : null;
  const routePoints = hasTrackpoints ? extractRoutePoints(trackPoints!) : [];
  const combinedDistData = hasTrackpoints ? computeCombinedDistanceData(trackPoints!) : [];
  const combinedTimeData = hasTrackpoints ? computeCombinedTimeData(trackPoints!) : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge>{log.type}</Badge>
          {log.subType && <Badge variant="secondary">{log.subType.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</Badge>}
          <SourceBadge source={log.source} />
          {log.tss && <Badge variant="outline">TSS {Math.round(log.tss)}</Badge>}
          {log.remarks && <Badge variant="secondary" className="gap-1"><MessageSquare className="h-3 w-3" /> Remarks</Badge>}
          <button
            onClick={(e) => { e.preventDefault(); handlePromote(); }}
            disabled={promoting || !!promoteResult}
            className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
            title={promoteResult?.success ? "Race goal created!" : "Set as race goal"}
          >
            {promoteResult?.success ? <Check className="h-4 w-4 text-green-500" /> : <Target className="h-4 w-4" />}
          </button>
          <button
            onClick={(e) => { e.preventDefault(); onDelete(); }}
            disabled={deleting}
            className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Delete activity"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Promote result message */}
        {promoteResult?.success && (
          <div className="flex items-center gap-2 p-2 mb-2 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-200">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>
              Race goal created — <strong>{promoteResult.goalName}</strong>.{" "}
              <a href="/settings/goals" className="underline font-medium">View in Settings →</a>
            </span>
          </div>
        )}

        {/* Duplicate warning banner */}
        {duplicateGroup && duplicateGroup.status === "pending" && (
          <div className="flex items-center gap-2 p-2 mb-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              This activity may be a duplicate of{" "}
              {duplicateGroup.trainingLogs
                .filter((a) => a.id !== log.id && !a.mergedIntoId)
                .map((a) => a.name)
                .join(", ") || "another activity"}
              .{" "}
              <a href="/duplicates" className="underline font-medium">Review duplicates</a>
            </span>
          </div>
        )}

        <CardTitle className="text-2xl">{log.name}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {format(new Date(log.startDate), "EEEE, MMMM d, yyyy 'at' h:mm a")}
        </p>
      </CardHeader>
      <CardContent>
        {/* Compact summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-6">
          <Stat icon={Clock} label="Duration" value={formatDuration(log.durationSeconds)} />
          {log.distanceMeters && <Stat icon={Route} label="Distance" value={formatDistance(log.distanceMeters)} />}
          {log.elevationGainMeters && <Stat icon={Mountain} label="Elevation" value={formatDistance(log.elevationGainMeters)} />}
          <Stat icon={Activity} label="Avg Pace" value={formatPace(pace)} />
          {log.averageHr && (
            <Stat icon={Heart} label="Heart Rate" value={`${Math.round(log.averageHr)}${log.maxHr ? `/${Math.round(log.maxHr)}` : ""} bpm`} />
          )}
          {log.averagePower && (
            <Stat icon={Zap} label="Power" value={`${Math.round(log.averagePower)}${log.normalizedPower ? ` NP ${Math.round(log.normalizedPower)}` : ""}W`} />
          )}
          {log.calories && <Stat icon={Flame} label="Calories" value={`${Math.round(log.calories)} kcal`} />}
          {vam && <Stat icon={TrendingUp} label="VAM" value={`${vam.vamTotal.toLocaleString()} m/h`} />}
          {log.tss && <Stat icon={BarChart3} label="TSS" value={String(Math.round(log.tss))} />}
        </div>

        {/* Combined Metrics Chart — replaces Elevation, HR, Pace, GAP, Power */}
        {hasTrackpoints && combinedDistData.length >= 3 && (
          <div className="space-y-4 mb-4">
            {routePoints.length >= 3 && <RouteMap points={routePoints} />}
            <CombinedMetricsChart distanceData={combinedDistData} timeData={combinedTimeData} maxHr={log.maxHr ?? undefined} />
          </div>
        )}

        {/* HR Zone Distribution (complementary to combined chart) */}
        {hrZones && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <HrZoneBar zones={hrZones.zones} />
          </div>
        )}

        {/* VAM card */}
        {vam && (
          <div className="mb-4">
            <VamCard totalGain={vam.totalGain} vamTotal={vam.vamTotal} peakVam30min={vam.peakVam30min} />
          </div>
        )}

        {/* Tier 3: Splits Table */}
        {splits.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5" /> Splits
            </h3>
            <SplitsTable splits={splits} type={log.type} />
          </div>
        )}

        {/* Tier 3: Lap Table (TCX laps) */}
        {laps && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5" /> Laps (from file)
            </h3>
            <LapTable laps={laps} type={log.type} />
          </div>
        )}

        {/* Same Route Comparison */}
        {similarRoutes.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
              <Route className="h-3.5 w-3.5" /> Same Route ({similarRoutes.length} previous attempt{similarRoutes.length !== 1 ? "s" : ""})
            </h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Date</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Time</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Pace</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">HR</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">TSS</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {/* Current activity row */}
                  <tr className="bg-primary/5 font-medium tabular-nums">
                    <td className="px-3 py-1.5 text-xs">
                      {format(new Date(log.startDate), "MMM d, yyyy")}
                      <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">now</Badge>
                    </td>
                    <td className="px-3 py-1.5">{formatTime(log.durationSeconds)}</td>
                    <td className="px-3 py-1.5">{formatPace(pace)}</td>
                    <td className="px-3 py-1.5">{log.averageHr ? `${Math.round(log.averageHr)} bpm` : "—"}</td>
                    <td className="px-3 py-1.5">{log.tss ? Math.round(log.tss) : "—"}</td>
                    <td className="px-3 py-1.5">—</td>
                  </tr>
                  {/* Previous attempts */}
                  {similarRoutes.map((m) => {
                    const mPace = m.distanceMeters && m.distanceMeters > 0
                      ? m.distanceMeters / m.durationSeconds
                      : 0;
                    return (
                      <tr key={m.id} className="hover:bg-muted/30 tabular-nums cursor-pointer"
                        onClick={() => router.push(`/activities/${m.id}`)}
                      >
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          {format(new Date(m.startDate), "MMM d, yyyy")}
                        </td>
                        <td className="px-3 py-1.5">
                          {formatTime(m.durationSeconds)}
                          <span className={`ml-1 text-[10px] ${deltaStr(log.durationSeconds, m.durationSeconds, "", true)}`}>
                            {/* faster = better (duration lower) */}
                            {(() => {
                              if (!m.durationSeconds) return null;
                              const diff = log.durationSeconds - m.durationSeconds;
                              const pct = Math.round(Math.abs(diff / m.durationSeconds) * 100);
                              if (diff === 0) return <span className="text-muted-foreground">—</span>;
                              const faster = diff < 0;
                              return <span className={faster ? "text-green-600" : "text-red-600"}>
                                {faster ? "↓" : "↑"}{pct}%
                              </span>;
                            })()}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          {mPace > 0 ? formatPace(mPace) : "—"}
                          {mPace > 0 && (
                            <span className={`ml-1 text-[10px] ${deltaStr(pace, mPace, "", true)}`}>
                              {/* faster pace = better (pace lower) */}
                              {pace > 0 && mPace > 0 ? (
                                (() => {
                                  const diff = pace - mPace;
                                  const pct = Math.round(Math.abs(diff / mPace) * 100);
                                  if (Math.abs(diff) < 0.01) return <span className="text-muted-foreground">—</span>;
                                  const faster = diff < 0;
                                  return <span className={faster ? "text-green-600" : "text-red-600"}>
                                    {faster ? "↓" : "↑"}{pct}%
                                  </span>;
                                })()
                              ) : null}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {m.averageHr ? `${Math.round(m.averageHr)} bpm` : "—"}
                          {m.averageHr && log.averageHr && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              {Math.round(log.averageHr) - Math.round(m.averageHr) > 0 ? "+" : ""}
                              {Math.round(log.averageHr) - Math.round(m.averageHr)} bpm
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {m.tss ? Math.round(m.tss) : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge variant={m.similarity >= 85 ? "success" : m.similarity >= 70 ? "default" : "secondary"} className="text-[10px]">
                            {m.similarity}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Remarks — always editable, auto-saves */}
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" /> Training Remarks
              {saved && <span className="text-xs text-green-600 font-normal">Saved</span>}
              {remarksDirty && <span className="text-xs text-muted-foreground font-normal">Saving...</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
              placeholder="How did this session feel? E.g. Tired today, didn't sleep well. Felt strong on the first 10k, then the last climb was tough..."
              value={remarksText}
              onChange={(e) => onRemarksChange(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Coach Analysis — read-only, populated by AI Coach */}
        <Card className="mt-6 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> Coach Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyzing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing activity...
              </div>
            ) : analyzeError ? (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{analyzeError}</span>
              </div>
            ) : coachAnalysisText ? (
              <div className="text-sm whitespace-pre-line leading-relaxed">
                {coachAnalysisText.split("\n").map((line, i) => {
                  if (i === 0 && line.startsWith("**")) {
                    return <p key={i} className="font-semibold mb-2">{line.replace(/\*\*/g, "")}</p>;
                  }
                  if (line.startsWith("**Flags:**")) {
                    return <p key={i} className="font-semibold mt-3 mb-1">{line.replace(/\*\*/g, "")}</p>;
                  }
                  if (line.startsWith("- ")) {
                    return <p key={i} className="text-muted-foreground ml-3">{line}</p>;
                  }
                  return <p key={i}>{line}</p>;
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <Brain className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm text-muted-foreground mb-3">No coach analysis yet. Analyze this activity against your training plan to get insights on training type, performance, and goal alignment.</p>
                <Button size="sm" onClick={onAnalyze}>
                  <Brain className="h-4 w-4 mr-1" /> Analyze with Coach
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {log.description && log.description !== log.remarks && (
          <div className="mt-6">
            <h3 className="font-semibold mb-2">Original Description</h3>
            <p className="text-sm text-muted-foreground">{log.description}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [log, setLog] = useState<TrainingLog | null>(null);
  const [neighbors, setNeighbors] = useState<{ prev: TrainingLog | null; next: TrainingLog | null }>({ prev: null, next: null });
  const [loading, setLoading] = useState(true);
  const [sliding, setSliding] = useState<"left" | "right" | null>(null);
  const [remarksText, setRemarksText] = useState("");
  const [remarksDirty, setRemarksDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const [coachAnalysisText, setCoachAnalysisText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [similarRoutes, setSimilarRoutes] = useState<RouteMatch[]>([]);
  const [duplicateGroup, setDuplicateGroup] = useState<DuplicateGroupInfo | null>(null);
  const touchRef = useRef<{ startX: number; startY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function handleDelete() {
    if (!log) return;
    if (!confirm(`Delete "${log.name}"?\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/activities/${id}`, { method: "DELETE" });
      router.push("/activities");
    } catch {
      alert("Failed to delete. Please try again.");
      setDeleting(false);
    }
  }

  const fetchLog = useCallback(() => {
    setLoading(true);
    fetch(`/api/activities/${id}?neighbors=full`)
      .then((r) => r.json())
      .then((data) => {
        const l = data.log || data;
        setLog(l);
        setRemarksText(l.remarks || "");
        setCoachAnalysisText(l.coachAnalysis || "");
        setAnalyzeError(null);
        setRemarksDirty(false);
        setSaved(false);
        setNeighbors({ prev: data.prev ?? null, next: data.next ?? null });
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  // Fetch similar routes when log changes
  useEffect(() => {
    if (!id) return;
    fetch(`/api/activities/${id}/similar`)
      .then((r) => r.json())
      .then((data) => setSimilarRoutes(data.matches || []))
      .catch(() => setSimilarRoutes([]));
  }, [id]);


  // Fetch duplicate info
  useEffect(() => {
    if (!log?.duplicateGroupId) { setDuplicateGroup(null); return; }
    fetch(`/api/duplicates/list?status=pending`)
      .then((r) => r.ok ? r.json() : { groups: [] })
      .then((data) => {
        const g = data.groups?.find((g: DuplicateGroupInfo) => g.id === log.duplicateGroupId);
        setDuplicateGroup(g || null);
      })
      .catch(() => setDuplicateGroup(null));
  }, [log?.duplicateGroupId]);

  // Auto-save remarks with debounce
  const saveRemarks = useCallback(async (text: string) => {
    await fetch(`/api/activities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remarks: text || null }),
    });
  }, [id]);

  function handleRemarksChange(text: string) {
    setRemarksText(text);
    setRemarksDirty(true);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await saveRemarks(text);
      setRemarksDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 800);
  }

  // Analyze with AI Coach
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/dashboard/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze-activity", activityId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setCoachAnalysisText(data.analysis);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
    }
    setAnalyzing(false);
  }, [id]);

  // Carousel navigation — use preloaded data when available, fetch if not
  const navigateTo = useCallback((newId: string, preloadedLog?: TrainingLog | null) => {
    if (!newId) return;
    if (preloadedLog) {
      // Instant — data is already loaded
      setLog(preloadedLog);
      setRemarksText(preloadedLog.remarks || "");
      setRemarksDirty(false);
      setSaved(false);
      // Fetch new neighbors in the background
      fetch(`/api/activities/${newId}?neighbors=full`)
        .then((r) => r.json())
        .then((data) => {
          if (data.log) setLog(data.log);
          setNeighbors({ prev: data.prev ?? null, next: data.next ?? null });
        });
      router.replace(`/activities/${newId}`, { scroll: false });
      return;
    }
    // Fallback: fetch from server
    fetch(`/api/activities/${newId}?neighbors=full`)
      .then((r) => r.json())
      .then((data) => {
        const l = data.log || data;
        setLog(l);
        setRemarksText(l.remarks || "");
        setRemarksDirty(false);
        setSaved(false);
        setNeighbors({ prev: data.prev ?? null, next: data.next ?? null });
        router.replace(`/activities/${newId}`, { scroll: false });
      });
  }, [router]);

  // Touch swipe with smooth carousel animation
  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      const t = e.touches[0];
      touchRef.current = { startX: t.clientX, startY: t.clientY };
    }

    function onTouchMove(e: TouchEvent) {
      if (!touchRef.current) return;
      // Prevent browser back/forward swipe gesture
      const t = e.touches[0];
      const dx = t.clientX - touchRef.current.startX;
      const dy = t.clientY - touchRef.current.startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        e.preventDefault();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!touchRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchRef.current.startX;
      const dy = t.clientY - touchRef.current.startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
        if (dx < 0 && neighbors.next?.id) {
          navigateTo(neighbors.next.id, neighbors.next);
        }
        if (dx > 0 && neighbors.prev?.id) {
          navigateTo(neighbors.prev.id, neighbors.prev);
        }
      }
      touchRef.current = null;
    }

    // Keyboard navigation
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" && neighbors.prev?.id) navigateTo(neighbors.prev.id, neighbors.prev);
      if (e.key === "ArrowRight" && neighbors.next?.id) navigateTo(neighbors.next.id, neighbors.next);
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [neighbors, navigateTo]);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;
  if (!log) return <div className="container mx-auto px-4 py-8 text-center">Activity not found.</div>;

  const prevId = neighbors.prev?.id;
  const nextId = neighbors.next?.id;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Navigation bar */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" onClick={() => router.push("/activities")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            disabled={!prevId}
            onClick={() => prevId && navigateTo(prevId, neighbors.prev)}
            title="Previous (←)"
          >
            <ChevronLeft className="h-5 w-5" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground px-1 hidden sm:inline">swipe or ← →</span>
          <Button
            variant="ghost" size="sm"
            disabled={!nextId}
            onClick={() => nextId && navigateTo(nextId, neighbors.next)}
            title="Next (→)"
          >
            Next <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Swipeable card area */}
      <div ref={containerRef} className="relative overflow-hidden touch-pan-y">
        <div className="transition-transform duration-200 ease-out">
          <LogCard
            log={log}
            remarksText={remarksText}
            remarksDirty={remarksDirty}
            saved={saved}
            deleting={deleting}
            similarRoutes={similarRoutes}
            duplicateGroup={duplicateGroup}
            onRemarksChange={handleRemarksChange}
            onDelete={handleDelete}
            coachAnalysisText={coachAnalysisText}
            analyzing={analyzing}
            analyzeError={analyzeError}
            onAnalyze={handleAnalyze}
          />
        </div>

        {/* Swipe hints on mobile */}
        <div className="flex sm:hidden items-center justify-between mt-3 px-1">
          <Button
            variant="ghost" size="sm"
            disabled={!prevId}
            onClick={() => prevId && navigateTo(prevId, neighbors.prev)}
          >
            <ChevronLeft className="h-5 w-5" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Swipe to navigate
          </span>
          <Button
            variant="ghost" size="sm"
            disabled={!nextId}
            onClick={() => nextId && navigateTo(nextId, neighbors.next)}
          >
            Next <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Bottom nav — desktop only */}
      <div className="hidden sm:flex items-center justify-between mt-4">
        <Button
          variant="outline" size="sm"
          disabled={!prevId}
          onClick={() => prevId && navigateTo(prevId, neighbors.prev)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Previous
        </Button>
        <span className="text-xs text-muted-foreground">Use ← → arrow keys or swipe to navigate</span>
        <Button
          variant="outline" size="sm"
          disabled={!nextId}
          onClick={() => nextId && navigateTo(nextId, neighbors.next)}
        >
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
