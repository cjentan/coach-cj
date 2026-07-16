"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Upload, FileSpreadsheet, FileType, Pencil, CheckCircle2, XCircle, AlertCircle,
  Activity, Bike, Waves, Mountain, Footprints, Dumbbell, Trash2, Database, Loader2, Archive, ChevronDown, ChevronUp,
} from "lucide-react";

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  message: string;
  totalRows?: number;
  results?: { filename: string; status: string; error?: string }[];
}

interface LogEntry {
  text: string;
  level: "info" | "activity" | "error" | "success";
  detail?: string;
}

const ACTIVITY_TYPES = [
  { value: "run", label: "Run", icon: Activity },
  { value: "ride", label: "Ride", icon: Bike },
  { value: "swim", label: "Swim", icon: Waves },
  { value: "hike", label: "Hike", icon: Mountain },
  { value: "walk", label: "Walk", icon: Footprints },
  { value: "workout", label: "Workout", icon: Dumbbell },
  { value: "other", label: "Other", icon: Activity },
];

const SUB_TYPE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  run: [
    { value: "trail_running", label: "Trail Running" },
    { value: "treadmill", label: "Treadmill" },
    { value: "virtual_run", label: "Virtual Run" },
  ],
  ride: [
    { value: "mountain_biking", label: "Mountain Biking" },
    { value: "gravel_cycling", label: "Gravel Cycling" },
    { value: "road_cycling", label: "Road Cycling" },
    { value: "indoor_cycling", label: "Indoor Cycling" },
    { value: "virtual_ride", label: "Virtual Ride" },
    { value: "handcycle", label: "Handcycle" },
  ],
  swim: [
    { value: "open_water", label: "Open Water" },
    { value: "lap_swimming", label: "Lap Swimming" },
  ],
  workout: [
    { value: "strength_training", label: "Strength Training" },
    { value: "crossfit", label: "CrossFit" },
    { value: "yoga", label: "Yoga" },
    { value: "elliptical", label: "Elliptical" },
    { value: "stair_stepper", label: "Stair Stepper" },
    { value: "pilates", label: "Pilates" },
  ],
  other: [
    { value: "rock_climbing", label: "Rock Climbing" },
    { value: "surfing", label: "Surfing" },
    { value: "stand_up_paddling", label: "Stand Up Paddling" },
    { value: "kayaking", label: "Kayaking" },
    { value: "canoeing", label: "Canoeing" },
    { value: "rowing", label: "Rowing" },
    { value: "ice_skating", label: "Ice Skating" },
    { value: "inline_skating", label: "Inline Skating" },
    { value: "nordic_skiing", label: "Nordic Skiing" },
    { value: "alpine_skiing", label: "Alpine Skiing" },
    { value: "backcountry_skiing", label: "Backcountry Skiing" },
    { value: "snowboarding", label: "Snowboarding" },
    { value: "snowshoeing", label: "Snowshoeing" },
    { value: "soccer", label: "Soccer" },
    { value: "tennis", label: "Tennis" },
    { value: "golf", label: "Golf" },
    { value: "wheelchair", label: "Wheelchair" },
  ],
};

const TYPE_ICON: Record<string, string> = {
  run: "🏃", ride: "🚴", swim: "🏊", hike: "🥾", walk: "🚶", workout: "🏋️", other: "📋",
};

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

function fmtDistance(m: number | null): string {
  if (m == null) return "";
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export default function IngestionPage() {
  const t = useTranslations("ingestion");
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gpxInputRef = useRef<HTMLInputElement>(null);
  const stravaExportInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Strava Export ZIP
  const [stravaExportResult, setStravaExportResult] = useState<ImportResult & { withRichData?: number; csvOnly?: number; enriched?: number } | null>(null);
  const [stravaExportLoading, setStravaExportLoading] = useState(false);
  const [stravaExportLog, setStravaExportLog] = useState<LogEntry[]>([]);
  const [stravaExportProgress, setStravaExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [stravaExportPhase, setStravaExportPhase] = useState<string>("");
  const [logExpanded, setLogExpanded] = useState(false);
  const [stravaFrom, setStravaFrom] = useState("");
  const [stravaTo, setStravaTo] = useState("");

  // CSV
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);

  // GPX
  const [gpxResult, setGpxResult] = useState<ImportResult | null>(null);
  const [gpxLoading, setGpxLoading] = useState(false);

  // Manual form
  const [manualForm, setManualForm] = useState({
    name: "", type: "run", subType: "", date: new Date().toISOString().slice(0, 16),
    durationMinutes: "", durationSeconds: "", distance: "", elevation: "",
    avgHr: "", maxHr: "", calories: "", description: "",
  });
  const [manualResult, setManualResult] = useState<string | null>(null);

  // Auto-scroll log when new entries arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [stravaExportLog]);

  // ── Cancel any running import ────────────────────────
  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStravaExportLoading(false);
    setStravaExportPhase("cancelled");
    setCsvLoading(false);
    setGpxLoading(false);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  // ─── Strava Export ZIP Upload ──────────────────────────
  async function handleStravaExportUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStravaExportLoading(true);
    setStravaExportResult(null);
    setStravaExportLog([]);
    setStravaExportProgress(null);
    setStravaExportPhase("uploading");
    setLogExpanded(false);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const form = new FormData();
    form.append("file", file);
    if (stravaFrom) form.append("fromDate", stravaFrom);
    if (stravaTo) form.append("toDate", stravaTo);
    try {
      const res = await fetch("/api/ingestion/strava-export", { method: "POST", body: form, signal: controller.signal });

      if (!res.ok) {
        const text = await res.text();
        let msg = "Upload failed";
        try { const j = JSON.parse(text); msg = j.error || msg; } catch {}
        setStravaExportResult({ imported: 0, skipped: 0, errors: [msg], message: msg });
        setStravaExportLoading(false);
        setStravaExportPhase("");
        if (stravaExportInputRef.current) stravaExportInputRef.current.value = "";
        return;
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/x-ndjson")) {
        const reader = res.body?.getReader();
        if (!reader) {
          setStravaExportResult({ imported: 0, skipped: 0, errors: ["No response body"], message: "Upload failed" });
          setStravaExportLoading(false);
          setStravaExportPhase("");
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        while (!done) {
          const chunk = await reader.read();
          done = chunk.done;
          buffer += decoder.decode(chunk.value, { stream: !done });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);

              switch (event.type) {
                case "heartbeat":
                  // silently ignore — just keeps connection alive
                  break;

                case "progress":
                  setStravaExportPhase(event.phase || "");
                  if (event.phase === "importing") {
                    setStravaExportLog((prev) => [...prev, {
                      text: event.message,
                      level: "info",
                      detail: `${event.imported ?? 0} new, ${event.enriched ?? 0} enriched, ${event.skipped ?? 0} skipped`,
                    }]);
                  } else {
                    setStravaExportLog((prev) => [...prev, { text: event.message, level: "info" }]);
                  }
                  if (event.current != null && event.total != null) {
                    setStravaExportProgress({ current: event.current, total: event.total });
                  }
                  break;

                case "activity": {
                  const statusIcon =
                    event.status === "imported" ? "✓" :
                    event.status === "enriched" ? "↑" :
                    event.status === "error" ? "✗" : "−";
                  const level =
                    event.status === "error" ? "error" :
                    event.status === "imported" || event.status === "enriched" ? "success" :
                    "activity";

                  const typeEmoji = TYPE_ICON[event.activityType] || "";
                  const dur = event.duration ? ` ${fmtDuration(event.duration)}` : "";
                  const dist = event.distance ? ` ${fmtDistance(event.distance)}` : "";
                  const rich = event.hasRichData ? " 📡" : "";
                  const label = event.name || event.externalId || "unknown";
                  const detail = event.error || `${typeEmoji}${dur}${dist}${rich}`;

                  setStravaExportLog((prev) => [...prev, {
                    text: `  ${statusIcon} ${label}`,
                    level,
                    detail,
                  }]);
                  break;
                }

                case "summary":
                  setStravaExportResult(event);
                  setStravaExportPhase("done");
                  break;

                case "error":
                  setStravaExportLog((prev) => [...prev, {
                    text: `❌ ${event.message}`,
                    level: "error",
                  }]);
                  break;

                case "done":
                  // Stream finished
                  break;
              }
            } catch {
              // skip malformed lines
            }
          }
        }
        // Stream completed — auto-expand log if there are errors or many entries
        setStravaExportLog((prev) => {
          if (prev.some((e) => e.level === "error")) setLogExpanded(true);
          return prev;
        });
      } else {
        const data = await res.json();
        setStravaExportResult(data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStravaExportResult({
          imported: 0, skipped: 0, errors: ["Import cancelled"],
          message: "Import cancelled by user",
        });
      } else {
        setStravaExportResult({ imported: 0, skipped: 0, errors: ["Upload failed — network error"], message: "Upload failed — network error" });
      }
    }
    setStravaExportLoading(false);
    abortControllerRef.current = null;
    if (stravaExportInputRef.current) stravaExportInputRef.current.value = "";
  }

  // ─── CSV Upload ────────────────────────────────────────
  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvLoading(true);
    setCsvResult(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/ingestion/csv", { method: "POST", body: form, signal: controller.signal });
      setCsvResult(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setCsvResult({ imported: 0, skipped: 0, errors: ["Import cancelled"], message: "Import cancelled by user" });
      } else {
        setCsvResult({ imported: 0, skipped: 0, errors: ["Upload failed"], message: "Upload failed" });
      }
    }
    setCsvLoading(false);
    abortControllerRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ─── GPX Upload ────────────────────────────────────────
  async function handleGpxUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setGpxLoading(true);
    setGpxResult(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const form = new FormData();
    for (const file of Array.from(files)) {
      form.append("files", file);
    }

    try {
      const res = await fetch("/api/ingestion/gpx", { method: "POST", body: form, signal: controller.signal });
      setGpxResult(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setGpxResult({ imported: 0, skipped: 0, errors: ["Import cancelled"], message: "Import cancelled by user", results: [] });
      } else {
        setGpxResult({ imported: 0, skipped: 0, errors: [], message: "Upload failed", results: [] });
      }
    }
    setGpxLoading(false);
    abortControllerRef.current = null;
    if (gpxInputRef.current) gpxInputRef.current.value = "";
  }

  // ─── Manual Entry ──────────────────────────────────────
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setManualResult(null);

    const durationSec = (parseInt(manualForm.durationMinutes || "0") * 60) + parseInt(manualForm.durationSeconds || "0");

    if (durationSec <= 0) {
      setManualResult("Enter a valid duration");
      return;
    }

    const body: Record<string, unknown> = {
      name: manualForm.name,
      type: manualForm.type,
      subType: manualForm.subType || null,
      startDate: new Date(manualForm.date).toISOString(),
      durationSeconds: durationSec,
      distanceMeters: manualForm.distance ? parseFloat(manualForm.distance) : null,
      elevationGainMeters: manualForm.elevation ? parseFloat(manualForm.elevation) : null,
      averageHr: manualForm.avgHr ? parseFloat(manualForm.avgHr) : null,
      maxHr: manualForm.maxHr ? parseFloat(manualForm.maxHr) : null,
      calories: manualForm.calories ? parseFloat(manualForm.calories) : null,
      description: manualForm.description || null,
    };

    const res = await fetch("/api/ingestion/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setManualResult("Activity created successfully!");
      setManualForm({
        name: "", type: "run", subType: "", date: new Date().toISOString().slice(0, 16),
        durationMinutes: "", durationSeconds: "", distance: "", elevation: "",
        avgHr: "", maxHr: "", calories: "", description: "",
      });
    } else {
      const data = await res.json();
      setManualResult(data.error || "Failed to create activity");
    }
  }

  if (status === "loading") return <div className="container mx-auto px-4 py-8">Loading...</div>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
      <p className="text-muted-foreground mb-8">Import training data from GPX, TCX, FIT, CSV files, or enter manually</p>

      <Tabs defaultValue="strava-export">
        <TabsList className="mb-6">
          <TabsTrigger value="strava-export"><Archive className="h-4 w-4 mr-2" /> {t("tabs.strava")}</TabsTrigger>
          <TabsTrigger value="csv"><FileSpreadsheet className="h-4 w-4 mr-2" /> CSV</TabsTrigger>
          <TabsTrigger value="gpx"><FileType className="h-4 w-4 mr-2" /> GPX / TCX / FIT</TabsTrigger>
          <TabsTrigger value="manual"><Pencil className="h-4 w-4 mr-2" /> {t("tabs.manual")}</TabsTrigger>
        </TabsList>

        {/* ── Strava Export Tab ──────────────────────── */}
        <TabsContent value="strava-export">
          <Card>
            <CardHeader>
              <CardTitle>Strava Bulk Export (ZIP)</CardTitle>
              <CardDescription>Upload your complete Strava data export ZIP — matches activities.csv with GPX/TCX/FIT files for full trackpoint data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* ── Date Range Filter ──────────────────── */}
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="strava-from">From</Label>
                  <Input
                    id="strava-from"
                    type="date"
                    value={stravaFrom}
                    onChange={(e) => setStravaFrom(e.target.value)}
                    disabled={stravaExportLoading}
                    className="w-44"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="strava-to">To</Label>
                  <Input
                    id="strava-to"
                    type="date"
                    value={stravaTo}
                    onChange={(e) => setStravaTo(e.target.value)}
                    disabled={stravaExportLoading}
                    className="w-44"
                  />
                </div>
                <p className="text-xs text-muted-foreground pb-1">
                  Leave blank to import everything
                </p>
              </div>

              <div className="border-2 border-dashed rounded-lg p-6 sm:p-8 text-center hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => stravaExportInputRef.current?.click()}>
                <Archive className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium mb-1">Click to upload your Strava export ZIP</p>
                <p className="text-sm text-muted-foreground">Download from strava.com → Settings → My Account → Download or Delete Your Account</p>
                <Input ref={stravaExportInputRef} type="file" accept=".zip" className="hidden" onChange={handleStravaExportUpload} />
              </div>

              {/* ── Processing UI ─────────────────────── */}
              {stravaExportLoading && (
                <div className="space-y-3">
                  {/* Phase label + Cancel button */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="font-medium">
                        {stravaExportPhase === "reading" ? "Reading ZIP file…" :
                         stravaExportPhase === "parsing" ? "Extracting and parsing activities…" :
                         stravaExportPhase === "importing" ? "Importing activities to database…" :
                         stravaExportPhase === "snapshotting" ? "Updating weekly snapshots…" :
                         stravaExportPhase === "cancelled" ? "Cancelled" :
                         "Processing ZIP…"}
                      </span>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleCancel}
                      disabled={!stravaExportLoading}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" /> Stop
                    </Button>
                  </div>

                  {/* Progress bar */}
                  {stravaExportProgress && stravaExportProgress.total > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{stravaExportProgress.current} / {stravaExportProgress.total} ({Math.round((stravaExportProgress.current / stravaExportProgress.total) * 100)}%)</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-primary h-full rounded-full transition-all duration-200 ease-linear"
                          style={{ width: `${Math.round((stravaExportProgress.current / stravaExportProgress.total) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Processing log */}
                  {stravaExportLog.length > 0 && (
                    <div>
                      <button
                        onClick={() => setLogExpanded(!logExpanded)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
                      >
                        {logExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        Processing log ({stravaExportLog.length} entries)
                      </button>
                      <div
                        ref={logContainerRef}
                        className={`bg-muted/50 rounded-lg border p-2 overflow-y-auto font-mono text-xs space-y-0.5 transition-all ${logExpanded ? "max-h-96" : "max-h-40"}`}
                      >
                        {stravaExportLog.map((entry, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className={
                              entry.level === "error" ? "text-red-600 dark:text-red-400" :
                              entry.level === "success" ? "text-green-600 dark:text-green-400" :
                              entry.level === "activity" ? "text-muted-foreground" :
                              "text-foreground font-medium"
                            }>
                              {entry.text}
                            </span>
                            {entry.detail && (
                              <span className="text-muted-foreground/60 truncate">{entry.detail}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Results ───────────────────────────── */}
              {stravaExportResult && (
                <div>
                  <ResultBadge result={stravaExportResult as ImportResult} detail={`${stravaExportResult.totalRows || "?"} CSV rows`} />
                  {stravaExportResult.imported > 0 && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                      <div className="p-3 rounded-lg bg-muted text-center">
                        <div className="text-2xl font-bold text-primary">{stravaExportResult.imported}</div>
                        <div className="text-xs text-muted-foreground">Total Imported</div>
                      </div>
                      {stravaExportResult.withRichData != null && (
                        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 text-center">
                          <div className="text-2xl font-bold text-green-600">{stravaExportResult.withRichData}</div>
                          <div className="text-xs text-muted-foreground">With Full GPS Track Data</div>
                        </div>
                      )}
                      {stravaExportResult.enriched != null && stravaExportResult.enriched > 0 && (
                        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 text-center">
                          <div className="text-2xl font-bold text-blue-600">{stravaExportResult.enriched}</div>
                          <div className="text-xs text-muted-foreground">Upgraded from Basic</div>
                        </div>
                      )}
                    </div>
                  )}
                  {stravaExportResult.withRichData != null && stravaExportResult.withRichData > 0 && (
                    <div className="mt-3 p-3 rounded-lg bg-muted/50 flex items-start gap-2">
                      <Database className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-muted-foreground">
                        <strong>Full trackpoint data stored:</strong> {stravaExportResult.withRichData} activities now include per-second GPS coordinates, heart rate, cadence, and power data.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="text-sm text-muted-foreground space-y-2">
                <p><strong>How it works:</strong></p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Go to strava.com → Settings → My Account → Download or Delete Your Account</li>
                  <li>Request your data export (Strava will email you a ZIP when ready)</li>
                  <li>Upload the ZIP here — activities are matched with their GPX files by activity ID</li>
                  <li>Activities with GPX files get full trackpoint data: GPS route, HR at every second, cadence, and power</li>
                </ol>
                <p className="mt-2"><strong>Safe to re-upload:</strong> If you have already imported via CSV, uploading the full ZIP will <strong>upgrade</strong> those activities with rich trackpoint data — no duplicates created.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── CSV Tab ────────────────────────────────── */}
        <TabsContent value="csv">
          <Card>
            <CardHeader>
              <CardTitle>CSV Bulk Import</CardTitle>
              <CardDescription>Upload your activities.csv from a data export</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed rounded-lg p-6 sm:p-8 text-center hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}>
                <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium mb-1">Click to upload activities.csv</p>
                <p className="text-sm text-muted-foreground">From your data export ZIP (activities.csv)</p>
                <Input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
              </div>

              {csvLoading && (
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Processing CSV...
                  </div>
                  <Button variant="destructive" size="sm" onClick={handleCancel} disabled={!csvLoading}>
                    <Trash2 className="h-4 w-4 mr-1.5" /> Stop
                  </Button>
                </div>
              )}

              {csvResult && <ResultBadge result={csvResult} detail={`${csvResult.totalRows || "?"} rows scanned`} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── GPX / TCX Tab ──────────────────────────── */}
        <TabsContent value="gpx">
          <Card>
            <CardHeader>
              <CardTitle>GPX / TCX / FIT File Import</CardTitle>
              <CardDescription>Upload .gpx, .tcx, or .fit files from your devices or other platforms</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed rounded-lg p-6 sm:p-8 text-center hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => gpxInputRef.current?.click()}>
                <FileType className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium mb-1">Click to upload GPX, TCX, or FIT files</p>
                <p className="text-sm text-muted-foreground">Supports Garmin, Wahoo, Suunto, COROS, and other device exports</p>
                <Input ref={gpxInputRef} type="file" accept=".gpx,.tcx,.fit,.xml" multiple className="hidden" onChange={handleGpxUpload} />
              </div>

              {gpxLoading && (
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Parsing files...
                  </div>
                  <Button variant="destructive" size="sm" onClick={handleCancel} disabled={!gpxLoading}>
                    <Trash2 className="h-4 w-4 mr-1.5" /> Stop
                  </Button>
                </div>
              )}

              {gpxResult && (
                <div>
                  <ResultBadge result={gpxResult} />
                  {gpxResult.results && gpxResult.results.length > 0 && (
                    <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                      {gpxResult.results.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm p-2 rounded bg-muted">
                          {r.status === "imported" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
                           r.status === "skipped" ? <AlertCircle className="h-4 w-4 text-amber-500" /> :
                           <XCircle className="h-4 w-4 text-destructive" />}
                          <span className="flex-1 truncate">{r.filename}</span>
                          <Badge variant={r.status === "imported" ? "success" : r.status === "skipped" ? "warning" : "destructive"}>
                            {r.status}
                          </Badge>
                          {r.error && <span className="text-xs text-muted-foreground">{r.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                <strong>Supported formats:</strong> GPX (GPS Exchange Format), TCX (Garmin Training Center XML), FIT (Garmin Flexible & Interoperable Data Transfer).{" "}
                FIT files are Garmin&apos;s native binary format — used by most modern Garmin watches, Edge cycling computers, and many COROS/Wahoo devices.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Manual Entry Tab ───────────────────────── */}
        <TabsContent value="manual">
          <Card>
            <CardHeader>
              <CardTitle>Manual Activity Entry</CardTitle>
              <CardDescription>Log a training session that wasn&apos;t tracked digitally</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Activity Name *</Label>
                    <Input value={manualForm.name} onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
                      placeholder="Morning Run" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Type *</Label>
                    <Select value={manualForm.type} onValueChange={(v) => { setManualForm({ ...manualForm, type: v, subType: "" }); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACTIVITY_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            <span className="flex items-center gap-2"><t.icon className="h-4 w-4" /> {t.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {SUB_TYPE_OPTIONS[manualForm.type] && SUB_TYPE_OPTIONS[manualForm.type].length > 0 && (
                    <div className="space-y-2">
                      <Label>Sub-Type</Label>
                      <Select value={manualForm.subType} onValueChange={(v) => setManualForm({ ...manualForm, subType: v })}>
                        <SelectTrigger><SelectValue placeholder="None (generic)" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None (generic)</SelectItem>
                          {SUB_TYPE_OPTIONS[manualForm.type].map((st) => (
                            <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Date & Time *</Label>
                    <Input type="datetime-local" value={manualForm.date}
                      onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Duration *</Label>
                    <div className="flex gap-2">
                      <Input type="number" placeholder="Min" value={manualForm.durationMinutes}
                        onChange={(e) => setManualForm({ ...manualForm, durationMinutes: e.target.value })} />
                      <Input type="number" placeholder="Sec" value={manualForm.durationSeconds}
                        onChange={(e) => setManualForm({ ...manualForm, durationSeconds: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Distance (meters)</Label>
                    <Input type="number" value={manualForm.distance}
                      onChange={(e) => setManualForm({ ...manualForm, distance: e.target.value })} placeholder="12000" />
                  </div>
                  <div className="space-y-2">
                    <Label>Elevation Gain (meters)</Label>
                    <Input type="number" value={manualForm.elevation}
                      onChange={(e) => setManualForm({ ...manualForm, elevation: e.target.value })} placeholder="450" />
                  </div>
                  <div className="space-y-2">
                    <Label>Avg Heart Rate (bpm)</Label>
                    <Input type="number" value={manualForm.avgHr}
                      onChange={(e) => setManualForm({ ...manualForm, avgHr: e.target.value })} placeholder="142" />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Heart Rate (bpm)</Label>
                    <Input type="number" value={manualForm.maxHr}
                      onChange={(e) => setManualForm({ ...manualForm, maxHr: e.target.value })} placeholder="172" />
                  </div>
                  <div className="space-y-2">
                    <Label>Calories</Label>
                    <Input type="number" value={manualForm.calories}
                      onChange={(e) => setManualForm({ ...manualForm, calories: e.target.value })} placeholder="450" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Notes</Label>
                    <Input value={manualForm.description}
                      onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                      placeholder="Felt strong, negative split..." />
                  </div>
                </div>

                {manualResult && (
                  <div className={`p-3 rounded-md text-sm ${manualResult.includes("success") ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-destructive/10 text-destructive"}`}>
                    {manualResult}
                  </div>
                )}

                <Button type="submit">
                  <Pencil className="h-4 w-4 mr-2" /> Log Activity
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ResultBadge({ result, detail }: { result: ImportResult; detail?: string }) {
  const isError = result.imported === 0 && result.skipped === 0;
  return (
    <div className={`p-4 rounded-lg ${isError ? "bg-destructive/10" : "bg-green-50 dark:bg-green-950"}`}>
      <div className="flex items-center gap-2 mb-2">
        {isError ? <XCircle className="h-5 w-5 text-destructive" /> : <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />}
        <span className={`font-medium ${isError ? "text-destructive" : "text-green-800 dark:text-green-200"}`}>
          {result.message}
        </span>
      </div>
      {detail && <p className="text-sm text-muted-foreground ml-7">{detail}</p>}
      {result.errors.length > 0 && (
        <div className="mt-2 ml-7">
          {result.errors.map((err, i) => (
            <p key={i} className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {err}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
