"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration, formatPace } from "@/lib/utils";
import { format } from "date-fns";
import {
  Activity, Clock, Mountain, Route, Heart, Zap, ArrowLeft, ArrowRight,
  ChevronLeft, ChevronRight, MessageSquare, Trash2, TrendingUp, BarChart3, Flame,
  Copy, AlertTriangle, Target, Check, Brain, Loader2, AlertCircle, Download,
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
import { SplitsTable, LapTable } from "@/components/training/training-tables";
import { SOURCE_LABELS, SOURCE_COLORS } from "@/lib/constants";

// Leaflet touches `window` at module load, so it must never enter the SSR bundle.
// Isolated in its own module and loaded on demand.
const RouteMap = dynamic(
  () => import("@/components/training/route-map").then((m) => m.RouteMap),
  { ssr: false },
);

// ── Types ──────────────────────────────────────────────────────────────────

export interface RouteMatch {
  id: string; name: string; startDate: string;
  durationSeconds: number; distanceMeters: number | null;
  elevationGainMeters: number | null; averageHr: number | null;
  maxHr: number | null; tss: number | null;
  similarity: number;
}

export interface TrainingLog {
  id: string; type: string; subType: string | null; name: string; description: string | null; remarks: string | null;
  coachAnalysis: string | null; isRace: boolean;
  startDate: string; durationSeconds: number; distanceMeters: number | null;
  elevationGainMeters: number | null; averageHr: number | null; maxHr: number | null;
  averagePower: number | null; normalizedPower: number | null; calories: number | null; tss: number | null;
  rawJson: Record<string, unknown> | null;
  source: string;
  duplicateGroupId: string | null;
  duplicateStatus: string | null;
  mergedIntoId: string | null;
}

export interface DuplicateGroupInfo {
  id: string; status: string;
  trainingLogs: { id: string; name: string; source: string; startDate: string; mergedIntoId: string | null }[];
}

export interface ActivityCardProps {
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
  analysisStatus: string | null;
  onAnalyze: () => void;
  onClearAnalysis?: () => void;
  isRace: boolean;
  isRaceDirty: boolean;
  onIsRaceChange: (value: boolean) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "outline";

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

function SourceBadge({ source }: { source: string }) {
  const labelsT = useTranslations("labels");
  const variant = (SOURCE_COLORS as Record<string, BadgeVariant>)[source] || "outline";
  const sourceKey = (SOURCE_LABELS as Record<string, string>)[source];
  return (
    <Badge variant={variant}>
      {sourceKey ? labelsT("sources." + sourceKey) : source}
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

// ── ActivityCard (extracted from activities/[id]/page.tsx) ─────────────────

export function ActivityCard({
  log, remarksText, remarksDirty, saved, deleting, similarRoutes, duplicateGroup,
  onRemarksChange, onDelete, coachAnalysisText, analyzing, analyzeError, analysisStatus,
  onAnalyze, onClearAnalysis, isRace, isRaceDirty, onIsRaceChange,
}: ActivityCardProps) {
  const router = useRouter();
  const t = useTranslations("activities");
  const labelsT = useTranslations("labels");
  const pace = log.distanceMeters && log.distanceMeters > 0
    ? log.distanceMeters / log.durationSeconds
    : 0;
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<{ success: boolean; goalId?: string; goalName?: string } | null>(null);

  async function handlePromote() {
    if (promoteResult?.success) return;
    const distanceText = log.distanceMeters ? `${Math.round(log.distanceMeters / 1000)}km` : "—";
    const elevText = log.elevationGainMeters ? `${Math.round(log.elevationGainMeters)}m` : "—";
    if (!log || !window.confirm(t("card.setRaceGoal", { name: log.name, distance: distanceText, elevation: elevText }))) return;

    setPromoting(true);
    try {
      const res = await fetch(`/api/activities/${log.id}/promote-to-goal`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setPromoteResult({ success: true, goalId: data.goal.id, goalName: data.goal.name });
      } else {
        alert(t("card.goalCreateFailed"));
      }
    } catch {
      alert(t("card.networkError"));
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
          {log.subType && <Badge variant="secondary">{labelsT.has("subTypes." + log.subType) ? labelsT("subTypes." + log.subType) : log.subType.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</Badge>}
          <SourceBadge source={log.source} />
          {log.tss && <Badge variant="outline">{t("card.tss")} {Math.round(log.tss)}</Badge>}
          {log.remarks && <Badge variant="secondary" className="gap-1"><MessageSquare className="h-3 w-3" /> {t("card.remarks")}</Badge>}
          <button
            onClick={(e) => { e.preventDefault(); handlePromote(); }}
            disabled={promoting || !!promoteResult}
            className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
            title={promoteResult?.success ? t("card.raceGoalCreated") : t("card.setAsRaceGoal")}
          >
            {promoteResult?.success ? <Check className="h-4 w-4 text-green-500" /> : <Target className="h-4 w-4" />}
          </button>
          <a
            href={`/api/activities/${log.id}/gpx`}
            download
            className={`p-1 rounded-md transition-colors ${
              hasTrackpoints
                ? "hover:bg-primary/10 text-muted-foreground hover:text-primary"
                : "text-muted-foreground/30 pointer-events-none"
            }`}
            title={hasTrackpoints ? t("card.downloadGpx") : t("card.noTrackData")}
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            onClick={(e) => { e.preventDefault(); onDelete(); }}
            disabled={deleting}
            className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title={t("card.deleteActivity")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Promote result message */}
        {promoteResult?.success && (
          <div className="flex items-center gap-2 p-2 mb-2 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-200">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t("card.goalCreated", { name: promoteResult.goalName })}{" "}
              <a href="/settings/goals" className="underline font-medium">{t("card.viewInSettings")}</a>
            </span>
          </div>
        )}

        {/* Duplicate warning banner */}
        {duplicateGroup && duplicateGroup.status === "pending" && (
          <div className="flex items-center gap-2 p-2 mb-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {t("card.duplicateWarning", {
                names: duplicateGroup.trainingLogs
                  .filter((a) => a.id !== log.id && !a.mergedIntoId)
                  .map((a) => a.name)
                  .join(", ") || t("card.anotherActivity"),
              })}{" "}
              <a href="/duplicates" className="underline font-medium">{t("card.reviewDuplicates")}</a>
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
          <Stat icon={Clock} label={t("card.duration")} value={formatDuration(log.durationSeconds)} />
          {log.distanceMeters && <Stat icon={Route} label={t("card.distance")} value={formatDistance(log.distanceMeters)} />}
          {log.elevationGainMeters && <Stat icon={Mountain} label={t("card.elevation")} value={formatDistance(log.elevationGainMeters)} />}
          <Stat icon={Activity} label={t("card.avgPace")} value={formatPace(pace)} />
          {log.averageHr && (
            <Stat icon={Heart} label={t("card.heartRate")} value={`${Math.round(log.averageHr)}${log.maxHr ? `/${Math.round(log.maxHr)}` : ""} bpm`} />
          )}
          {log.averagePower && (
            <Stat icon={Zap} label={t("card.power")} value={`${Math.round(log.averagePower)}${log.normalizedPower ? ` NP ${Math.round(log.normalizedPower)}` : ""}W`} />
          )}
          {log.calories && <Stat icon={Flame} label={t("card.calories")} value={`${Math.round(log.calories)} kcal`} />}
          {vam && <Stat icon={TrendingUp} label={t("card.vam")} value={`${vam.vamTotal.toLocaleString()} m/h`} />}
          {log.tss && <Stat icon={BarChart3} label={t("card.tss")} value={String(Math.round(log.tss))} />}
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
              <BarChart3 className="h-3.5 w-3.5" /> {t("detail.splits")}
            </h3>
            <SplitsTable splits={splits} type={log.type} />
          </div>
        )}

        {/* Tier 3: Lap Table (TCX laps) */}
        {laps && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5" /> {t("card.lapsFromFile")}
            </h3>
            <LapTable laps={laps} type={log.type} />
          </div>
        )}

        {/* Same Route Comparison */}
        {similarRoutes.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
              <Route className="h-3.5 w-3.5" /> {t("card.sameRoute", { count: similarRoutes.length })}
            </h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("card.colDate")}</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("card.colTime")}</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("card.colPace")}</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("card.colHr")}</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("card.colTss")}</th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("card.colMatch")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {/* Current activity row */}
                  <tr className="bg-primary/5 font-medium tabular-nums">
                    <td className="px-3 py-1.5 text-xs">
                      {format(new Date(log.startDate), "MMM d, yyyy")}
                      <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">{t("card.now")}</Badge>
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
              <MessageSquare className="h-4 w-4 text-primary" /> {t("card.trainingRemarks")}
              <span className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => onIsRaceChange(!isRace)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
                    isRace
                      ? "bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                      : "bg-muted border-transparent text-muted-foreground hover:bg-muted/80"
                  }`}
                  disabled={isRaceDirty}
                >
                  <Target className="h-3 w-3" />
                  {isRace ? t("card.race") : t("card.notRace")}
                </button>
                {isRaceDirty && <span className="text-xs text-muted-foreground">...</span>}
                {saved && <span className="text-xs text-green-600 font-normal">{t("card.saved")}</span>}
                {remarksDirty && <span className="text-xs text-muted-foreground font-normal">{t("card.saving")}</span>}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
              placeholder={t("card.remarksPlaceholder")}
              value={remarksText}
              onChange={(e) => onRemarksChange(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Coach Analysis — read-only, populated by AI Coach */}
        <Card className="mt-6 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> {t("card.coachAnalysis")}
              {coachAnalysisText && onClearAnalysis && (
                <button
                  onClick={(e) => { e.preventDefault(); onClearAnalysis(); }}
                  className="ml-auto p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title={t("card.clearAnalysis")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyzing || analysisStatus === "processing" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("card.analyzing")}
              </div>
            ) : analysisStatus === "pending" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("card.analysisQueued")}
              </div>
            ) : analyzeError ? (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{analyzeError}</span>
              </div>
            ) : analysisStatus === "failed" ? (
              <div className="text-center py-6">
                <AlertCircle className="h-6 w-6 mx-auto mb-2 text-destructive opacity-60" />
                <p className="text-sm text-destructive mb-3">{t("card.analysisFailed")}</p>
                <Button size="sm" onClick={onAnalyze}>
                  <Brain className="h-4 w-4 mr-1" /> {t("card.retryAnalysis")}
                </Button>
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
                <p className="text-sm text-muted-foreground mb-3">{t("card.noAnalysis")}</p>
                <Button size="sm" onClick={onAnalyze}>
                  <Brain className="h-4 w-4 mr-1" /> {t("card.analyzeWithCoach")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {log.description && log.description !== log.remarks && (
          <div className="mt-6">
            <h3 className="font-semibold mb-2">{t("card.originalDescription")}</h3>
            <p className="text-sm text-muted-foreground">{log.description}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
