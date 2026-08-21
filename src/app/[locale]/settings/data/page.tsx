"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Download, Upload, Clock, Shield, AlertTriangle, Trash2,
  CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";

// ─── Backup Types ──────────────────────────────────────────────────────────
type BackupStatus = { available: boolean; running: boolean; error?: string | null; timestamp?: string | null; size?: number | null; };
type RestoreCounts = Record<string, number>;
type PageState = "idle" | "requesting" | "running" | "ready" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Section: Backup & Restore ─────────────────────────────────────────────
function BackupRestoreSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const [pageState, setPageState] = useState<PageState>("idle");
  const [backupInfo, setBackupInfo] = useState<BackupStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [details, setDetails] = useState<RestoreCounts | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/backup");
      if (res.ok) {
        const data: BackupStatus = await res.json();
        setBackupInfo(data);
        if (data.running) setPageState("running");
        else if (data.available) setPageState("ready");
        else if (data.error) { setPageState("error"); setErrorMsg(data.error); }
        else setPageState("idle");
        return data;
      }
    } catch {}
    return null;
  }, []);

  useEffect(() => {
    checkStatus();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [checkStatus]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const data = await checkStatus();
      if (data && !data.running && pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    }, 3000);
  }, [checkStatus]);

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  const handleRequestBackup = async () => {
    setPageState("requesting"); setErrorMsg(null);
    try {
      const res = await fetch("/api/settings/backup", { method: "POST" });
      if (res.status === 409) { setPageState("running"); startPolling(); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: t("backupCard.requestFailed") }))).error ?? t("backupCard.requestFailed"));
      setPageState("running"); startPolling();
    } catch (err) { setPageState("error"); setErrorMsg(err instanceof Error ? err.message : t("backupCard.startFailed")); }
  };

  const handleRestore = async (file: File) => {
    setRestoring(true); setMessage(null); setDetails(null);
    try {
      const res = await fetch("/api/settings/restore", { method: "POST", body: await file.arrayBuffer() });
      const result = await res.json();
      if (res.ok && result.success) {
        setDetails(result.counts ?? null);
        const total = result.counts ? Object.values(result.counts as Record<string, number>).reduce((s: number, c) => s + c, 0) : 0;
        setMessage({ type: "success", text: t("restoreCard.restoreCompleteWithCount", { total, dataTypes: Object.keys(result.counts ?? {}).length }) });
      } else throw new Error(result.error ?? t("restoreCard.restoreFailed"));
    } catch (err) { setMessage({ type: "error", text: err instanceof Error ? err.message : t("restoreCard.restoreFailed") }); }
    finally { setRestoring(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleRestore(file);
  };

  return (
    <>
      {message && (
        <div className={`p-4 rounded-md mb-6 text-sm flex items-start gap-3 ${message.type === "success" ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-destructive/10 text-destructive"}`}>
          {message.type === "success" ? <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" /> : <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />}
          <div className="flex-1">{message.text}</div>
        </div>
      )}

      {details && (
        <Card className="mb-6 border-muted">
          <CardContent className="pt-4">
            <button onClick={() => setShowDetails(!showDetails)} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {t("restoreDetails", { count: Object.keys(details).length })}
            </button>
            {showDetails && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(details).map(([key, count]) => (
                  <div key={key} className="flex justify-between items-center px-3 py-1.5 rounded-md bg-muted/50 text-sm">
                    <span className="text-muted-foreground">{key}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {(pageState === "running" || pageState === "requesting") ? <Loader2 className="h-5 w-5 text-primary animate-spin" /> : <Download className="h-5 w-5 text-primary" />}
            {t("backupCard.title")}
          </CardTitle>
          <CardDescription>{t("backupCard.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {(pageState === "running" || pageState === "requesting") && (
            <div className="flex items-center gap-3 mb-4 p-4 rounded-lg bg-muted/30">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div className="text-sm"><p className="font-medium">{t("backupCard.preparing")}</p><p className="text-muted-foreground">{t("backupCard.preparingHint")}</p></div>
            </div>
          )}
          {pageState === "error" && !backupInfo?.available && (
            <div className="flex items-start gap-3 mb-4 p-4 rounded-lg bg-destructive/5">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm"><p className="font-medium text-destructive">{t("backupCard.failed")}</p><p className="text-muted-foreground">{errorMsg || t("backupCard.unknownError")}</p></div>
            </div>
          )}
          {pageState === "ready" && backupInfo?.available && (
            <div className="mb-4 p-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-green-800 dark:text-green-200">{t("backupCard.ready")}</p>
                  {backupInfo.timestamp && <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 mt-0.5"><Clock className="h-3 w-3" />{t("backupCard.created", { timestamp: formatTimestamp(backupInfo.timestamp) })}{backupInfo.size != null && ` · ${formatBytes(backupInfo.size)}`}</p>}
                </div>
                <Button size="sm" className="shrink-0 gap-1.5" asChild><a href="/api/settings/backup/download"><Download className="h-4 w-4" />{t("backupCard.download")}</a></Button>
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground mb-4">{t("backupCard.includedData")}</p>
          <Button onClick={handleRequestBackup} disabled={pageState === "requesting" || pageState === "running"} className="gap-2">
            {(pageState === "requesting" || pageState === "running") ? <Loader2 className="h-4 w-4 animate-spin" /> : pageState === "ready" ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {pageState === "requesting" ? t("backupCard.requesting") : pageState === "running" ? t("backupCard.preparingState") : pageState === "ready" ? t("backupCard.requestNew") : t("backupCard.requestBackup")}
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-6 border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-destructive" />{t("restoreCard.title")}</CardTitle>
          <CardDescription>{t("restoreCard.description")}<strong className="block mt-1 text-destructive">{t("restoreCard.warning")}</strong></CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{t("restoreCard.helpText")}</p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Button variant="destructive" onClick={() => fileInputRef.current?.click()} disabled={restoring} className="gap-2">
              {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {restoring ? t("restoreCard.restoring") : t("restoreCard.uploadRestore")}
            </Button>
            <input ref={fileInputRef} type="file" accept=".tar.gz,.tar,.gz" onChange={handleFileChange} className="hidden" />
            <span className="text-xs text-muted-foreground">{t("restoreCard.selectFile")}</span>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Section: Danger Zone ──────────────────────────────────────────────────
function DangerZoneSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const settingsT = useTranslations("settings");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [wipeConfirm, setWipeConfirm] = useState(false);
  const [wiping, setWiping] = useState(false);

  const DATA_TYPES = [
    { key: "trainingLogs" },
    { key: "duplicateGroups" },
    { key: "raceGoals" },
    { key: "bodyMetrics" },
    { key: "dailyHealth" },
    { key: "weeklyAssessments" },
    { key: "weeklyPlans" },
    { key: "fatigueAlerts" },
    { key: "analysisReports" },
    { key: "coachData" },
    { key: "apiKeys" },
    { key: "integrations" },
  ] as const;

  const toggleType = (key: string) => {
    setSelectedTypes((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const handleWipe = async () => {
    const types = Array.from(selectedTypes);
    setWiping(true);
    const res = await fetch("/api/settings/wipe-data", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ types }) });
    if (res.ok) {
      const data = await res.json();
      const summary = types.map((tk) => { const label = settingsT("dangerZone.dataTypes." + tk + ".label"); return `${label}: ${data.counts?.[tk] ?? 0} ${settingsT("dangerZone.deleted")}`; }).join(", ");
      setMessage({ type: "success", text: t("deletedSuccess", { summary }) });
    } else setMessage({ type: "error", text: t("wipeError") });
    setWiping(false); setWipeConfirm(false);
  };

  return (
    <>
      {message && <div className={`p-4 rounded-md mb-6 text-sm ${message.type === "success" ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-destructive/10 text-destructive"}`}>{message.text}</div>}

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" /> {t("wipeData")}</CardTitle>
          <CardDescription>{t("wipeDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!wipeConfirm ? (
            <>
              <div className="space-y-1 mb-4">
                {DATA_TYPES.map((dt) => (
                  <label key={dt.key} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 cursor-pointer transition-colors">
                    <input type="checkbox" className="h-4 w-4 rounded border-destructive/40 text-destructive focus:ring-destructive/30 accent-destructive"
                      checked={selectedTypes.has(dt.key)} onChange={() => toggleType(dt.key)} />
                    <div><p className="text-sm font-medium">{settingsT("dangerZone.dataTypes." + dt.key + ".label")}</p><p className="text-xs text-muted-foreground">{settingsT("dangerZone.dataTypes." + dt.key + ".desc")}</p></div>
                  </label>
                ))}
              </div>
              <div className="flex gap-2 mb-4">
                <Button variant="outline" size="sm" onClick={() => setSelectedTypes(new Set(DATA_TYPES.map((dt) => dt.key)))}>{t("selectAll")}</Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedTypes(new Set())}>{t("deselectAll")}</Button>
              </div>
              <Button variant="destructive" disabled={selectedTypes.size === 0} onClick={() => setWipeConfirm(true)}><Trash2 className="h-4 w-4 mr-2" />{t("wipeSelected", { count: selectedTypes.size })}</Button>
            </>
          ) : (
            <div className="space-y-4 p-4 rounded-md bg-destructive/10 border border-destructive/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div><p className="text-sm font-medium text-destructive">{t("confirmTitle")}</p><p className="text-xs text-muted-foreground mt-1">{t("confirmDescription")}</p></div>
              </div>
              <ul className="text-sm space-y-1 ml-8 list-disc text-muted-foreground">
                {Array.from(selectedTypes).map((key) => { const dt = DATA_TYPES.find((dt) => dt.key === key); return <li key={key}>{dt ? settingsT("dangerZone.dataTypes." + key + ".label") : key}</li>; })}
              </ul>
              <div className="flex items-center gap-3 pt-2">
                <Button variant="destructive" size="sm" disabled={wiping} onClick={handleWipe}>{wiping ? t("deleting") : t("confirmDelete", { count: selectedTypes.size })}</Button>
                <Button variant="outline" size="sm" disabled={wiping} onClick={() => setWipeConfirm(false)}>{common("cancel")}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function SettingsDataPage() {
  const brT = useTranslations("settings.backupRestore");
  const dzT = useTranslations("settings.dangerZone");
  const settingsT = useTranslations("settings");
  const common = useTranslations("common");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{settingsT("dataTab")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {settingsT("dataDesc")}
        </p>
      </div>

      <BackupRestoreSection t={brT} common={common} />
      <DangerZoneSection t={dzT} common={common} />
    </div>
  );
}
