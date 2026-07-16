"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Download,
  Upload,
  Clock,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";

type BackupStatus = {
  available: boolean;
  running: boolean;
  error?: string | null;
  timestamp?: string | null;
  size?: number | null;
};

type RestoreCounts = Record<string, number>;
type PageState = "idle" | "requesting" | "running" | "ready" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BackupRestorePage() {
  const t = useTranslations("settings.backupRestore");
  const common = useTranslations("common");
  const [pageState, setPageState] = useState<PageState>("idle");
  const [backupInfo, setBackupInfo] = useState<BackupStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [details, setDetails] = useState<RestoreCounts | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Check backup status on mount
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/backup");
      if (res.ok) {
        const data: BackupStatus = await res.json();
        setBackupInfo(data);

        if (data.running) {
          setPageState("running");
        } else if (data.available) {
          setPageState("ready");
        } else if (data.error) {
          setPageState("error");
          setErrorMsg(data.error);
        } else {
          setPageState("idle");
        }

        return data;
      }
    } catch {
      // Ignore polling errors — server may be busy
    }
    return null;
  }, []);

  useEffect(() => {
    checkStatus();
    return () => {
      mountedRef.current = false;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [checkStatus]);

  // Start polling when a backup is running
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const data = await checkStatus();
      if (data && !data.running) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    }, 3000);
  }, [checkStatus]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleRequestBackup = async () => {
    setPageState("requesting");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/settings/backup", { method: "POST" });

      if (res.status === 409) {
        // Already running — just start polling
        setPageState("running");
        startPolling();
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("backupCard.requestFailed") }));
        throw new Error(err.error ?? t("backupCard.requestFailed"));
      }

      setPageState("running");
      startPolling();
    } catch (err) {
      setPageState("error");
      setErrorMsg(err instanceof Error ? err.message : t("backupCard.startFailed"));
    }
  };

  const handleRestore = async (file: File) => {
    setRestoring(true);
    setMessage(null);
    setDetails(null);

    try {
      const raw = await file.arrayBuffer();

      const res = await fetch("/api/settings/restore", {
        method: "POST",
        body: raw,
      });

      const result = await res.json();

      if (res.ok && result.success) {
        setDetails(result.counts ?? null);
        if (result.counts) {
          const total = Object.values(result.counts).reduce((s: number, c: any) => s + c, 0);
          setMessage({
            type: "success",
            text: t("restoreCard.restoreCompleteWithCount", { total, dataTypes: Object.keys(result.counts).length }),
          });
        } else {
          setMessage({ type: "success", text: t("restoreCard.restoreComplete") });
        }
      } else {
        throw new Error(result.error ?? t("restoreCard.restoreFailed"));
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t("restoreCard.restoreFailed") });
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleRestore(file);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("description")}
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-md mb-6 text-sm flex items-start gap-3 ${
            message.type === "success"
              ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
          )}
          <div className="flex-1">{message.text}</div>
        </div>
      )}

      {/* Restore details expander */}
      {details && (
        <Card className="mb-6 border-muted">
          <CardContent className="pt-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetails ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              {t("restoreDetails", { count: Object.keys(details).length })}
            </button>
            {showDetails && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(details).map(([key, count]) => (
                  <div
                    key={key}
                    className="flex justify-between items-center px-3 py-1.5 rounded-md bg-muted/50 text-sm"
                  >
                    <span className="text-muted-foreground">{key}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Backup Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {pageState === "running" || pageState === "requesting" ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            ) : (
              <Download className="h-5 w-5 text-primary" />
            )}
            {t("backupCard.title")}
          </CardTitle>
          <CardDescription>
            {t("backupCard.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Loading / progress states */}
          {(pageState === "running" || pageState === "requesting") && (
            <div className="flex items-center gap-3 mb-4 p-4 rounded-lg bg-muted/30">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div className="text-sm">
                <p className="font-medium">{t("backupCard.preparing")}</p>
                <p className="text-muted-foreground">
                  {t("backupCard.preparingHint")}
                </p>
              </div>
            </div>
          )}

          {/* Error state */}
          {pageState === "error" && !backupInfo?.available && (
            <div className="flex items-start gap-3 mb-4 p-4 rounded-lg bg-destructive/5">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">{t("backupCard.failed")}</p>
                <p className="text-muted-foreground">{errorMsg || t("backupCard.unknownError")}</p>
              </div>
            </div>
          )}

          {/* Ready state — link to download */}
          {pageState === "ready" && backupInfo?.available && (
            <div className="mb-4 p-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-green-800 dark:text-green-200">{t("backupCard.ready")}</p>
                  {backupInfo.timestamp && (
                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {t("backupCard.created", { timestamp: formatTimestamp(backupInfo.timestamp) })}
                      {backupInfo.size != null && ` · ${formatBytes(backupInfo.size)}`}
                    </p>
                  )}
                </div>
                <Button size="sm" className="shrink-0 gap-1.5" asChild>
                  <a href="/api/settings/backup/download">
                    <Download className="h-4 w-4" />
                    {t("backupCard.download")}
                  </a>
                </Button>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground mb-4">
            {t("backupCard.includedData")}
          </p>

          <Button
            onClick={handleRequestBackup}
            disabled={pageState === "requesting" || pageState === "running"}
            className="gap-2"
          >
            {pageState === "requesting" || pageState === "running" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : pageState === "ready" ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {pageState === "requesting"
              ? t("backupCard.requesting")
              : pageState === "running"
                ? t("backupCard.preparingState")
                : pageState === "ready"
                  ? t("backupCard.requestNew")
                  : t("backupCard.requestBackup")}
          </Button>
        </CardContent>
      </Card>

      {/* Restore Card */}
      <Card className="mb-6 border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-destructive" />
            {t("restoreCard.title")}
          </CardTitle>
          <CardDescription>
            {t("restoreCard.description")}
            <strong className="block mt-1 text-destructive">
              {t("restoreCard.warning")}
            </strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            {t("restoreCard.helpText")}
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Button
              variant="destructive"
              onClick={() => fileInputRef.current?.click()}
              disabled={restoring}
              className="gap-2"
            >
              {restoring ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {restoring ? t("restoreCard.restoring") : t("restoreCard.uploadRestore")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".tar.gz,.tar,.gz"
              onChange={handleFileChange}
              className="hidden"
            />
            <span className="text-xs text-muted-foreground">
              {t("restoreCard.selectFile")}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
