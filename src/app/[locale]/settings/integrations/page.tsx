"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plug,
  Unplug,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
  Watch,
} from "lucide-react";

interface GarminStatus {
  connected: boolean;
  displayName: string | null;
  lastSyncAt: string | null;
  lastHealthSyncAt: string | null;
  connectedAt: string | null;
  garminActivityCount: number;
}

interface CorosStatus {
  connected: boolean;
  displayName: string | null;
  corosUserId: string | null;
  lastSyncAt: string | null;
  connectedAt: string | null;
  corosActivityCount: number;
}

export default function IntegrationsPage() {
  const t = useTranslations("settings.integrations");
  const common = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const [garminStatus, setGarminStatus] = useState<GarminStatus | null>(null);
  const [corosStatus, setCorosStatus] = useState<CorosStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{type: "success" | "error"; text: string} | null>(null);
  const [syncFrom, setSyncFrom] = useState("");
  const [syncTo, setSyncTo] = useState("");

  // COROS state
  const [corosEmail, setCorosEmail] = useState("");
  const [corosPassword, setCorosPassword] = useState("");
  const [corosConnecting, setCorosConnecting] = useState(false);
  const [corosConnectError, setCorosConnectError] = useState<string | null>(null);
  const [corosSyncing, setCorosSyncing] = useState(false);
  const [corosSyncResult, setCorosSyncResult] = useState<{type: "success" | "error"; text: string} | null>(null);
  const [corosSyncFrom, setCorosSyncFrom] = useState("");
  const [corosSyncTo, setCorosSyncTo] = useState("");

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/integrations/garmin/status");
      if (res.ok) {
        const data = await res.json();
        setGarminStatus(data);
      }
    } catch {
      // Silently fail — will retry on mount
    }
  };

  const fetchCorosStatus = async () => {
    try {
      const res = await fetch("/api/integrations/coros/status");
      if (res.ok) {
        const data = await res.json();
        setCorosStatus(data);
      }
    } catch {
      // Silently fail
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    } else if (status === "authenticated") {
      Promise.all([fetchStatus(), fetchCorosStatus()]).then(() =>
        setLoading(false)
      );
    }
  }, [status, router]);

  const handleConnect = async () => {
    if (!email || !password) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const body: Record<string, string> = { email, password };
      if (mfaCode) body.mfaCode = mfaCode;

      const res = await fetch("/api/integrations/garmin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setEmail("");
        setPassword("");
        setMfaCode("");
        setMfaRequired(false);
        await fetchStatus();
      } else if (data.mfaRequired) {
        setMfaRequired(true);
        setConnectError(t("garmin.mfaMessage"));
      } else {
        setConnectError(data.error || t("garmin.connectFailed"));
      }
    } catch {
      setConnectError(t("garmin.networkError"));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(t("garmin.disconnectConfirm")))
      return;
    try {
      await fetch("/api/integrations/garmin/disconnect", { method: "DELETE" });
      setGarminStatus(null);
      setSyncResult(null);
    } catch {
      // Ignore
    }
  };

  // ── COROS Handlers ──────────────────────────────────

  const handleCorosConnect = async () => {
    if (!corosEmail || !corosPassword) return;
    setCorosConnecting(true);
    setCorosConnectError(null);
    try {
      const res = await fetch("/api/integrations/coros/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: corosEmail, password: corosPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setCorosEmail("");
        setCorosPassword("");
        await fetchCorosStatus();
      } else {
        setCorosConnectError(data.error || t("coros.connectFailed"));
      }
    } catch {
      setCorosConnectError(t("coros.networkError"));
    } finally {
      setCorosConnecting(false);
    }
  };

  const handleCorosDisconnect = async () => {
    if (!confirm(t("coros.disconnectConfirm")))
      return;
    try {
      await fetch("/api/integrations/coros/disconnect", { method: "DELETE" });
      setCorosStatus(null);
      setCorosSyncResult(null);
    } catch {
      // Ignore
    }
  };

  const handleCorosSync = async () => {
    setCorosSyncing(true);
    setCorosSyncResult(null);
    try {
      const body: Record<string, string> = {};
      if (corosSyncFrom) body.fromDate = corosSyncFrom;
      if (corosSyncTo) body.toDate = corosSyncTo;
      const res = await fetch("/api/integrations/coros/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setCorosSyncResult({ type: "success", text: t("coros.syncComplete", { count: data.activitiesImported }) });
        await fetchCorosStatus();
      } else {
        setCorosSyncResult({ type: "error", text: t("coros.syncError", { error: data.error }) });
      }
    } catch {
      setCorosSyncResult({ type: "error", text: t("coros.syncNetworkError") });
    } finally {
      setCorosSyncing(false);
    }
  };

  const handleCorosResetSync = async () => {
    if (!confirm(t("coros.resetSyncConfirm")))
      return;
    try {
      const res = await fetch("/api/integrations/coros/reset-sync", {
        method: "POST",
      });
      if (res.ok) {
        setCorosSyncResult({ type: "success", text: t("coros.resetSyncComplete") });
        await fetchCorosStatus();
      }
    } catch {
      // Ignore
    }
  };

  const handleResetSync = async () => {
    if (!confirm(t("garmin.resetSyncConfirm")))
      return;
    try {
      const res = await fetch("/api/integrations/garmin/reset-sync", {
        method: "POST",
      });
      if (res.ok) {
        setSyncResult({ type: "success", text: t("garmin.resetSyncComplete") });
        await fetchStatus();
      }
    } catch {
      // Ignore
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const body: Record<string, string> = {};
      if (syncFrom) body.fromDate = syncFrom;
      if (syncTo) body.toDate = syncTo;
      const res = await fetch("/api/integrations/garmin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult({ type: "success", text: t("garmin.syncComplete", { count: data.activitiesImported, healthDays: data.healthDaysSynced }) });
        await fetchStatus();
      } else {
        setSyncResult({ type: "error", text: t("garmin.syncError", { error: data.error }) });
      }
    } catch {
      setSyncResult({ type: "error", text: t("garmin.syncNetworkError") });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{t("title")}</h1>
      <p className="text-sm text-muted-foreground mb-8">
        {t("description")}
      </p>

      {/* COROS Card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Watch className="h-5 w-5" /> {t("coros.title")}
          </CardTitle>
          <CardDescription>
            {t("coros.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {corosStatus?.connected ? (
            /* ── Connected State ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">{t("coros.connected")}</span>
                {corosStatus.displayName && (
                  <Badge variant="outline">
                    {corosStatus.displayName}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm break-words">
                <div>
                  <span className="text-muted-foreground">{t("coros.activitiesSynced")}</span>
                  <span className="ml-2 font-medium">{corosStatus.corosActivityCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("coros.connectedSince")}</span>
                  <span className="ml-2 font-medium">
                    {corosStatus.connectedAt
                      ? new Date(corosStatus.connectedAt).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("coros.lastSync")}</span>
                  <span className="ml-2 font-medium">
                    {corosStatus.lastSyncAt
                      ? new Date(corosStatus.lastSyncAt).toLocaleString()
                      : t("coros.never")}
                  </span>
                </div>
              </div>

              {/* ── Date Range Filter ── */}
              <div className="flex flex-wrap items-end gap-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="coros-sync-from">{t("coros.syncFrom")}</Label>
                  <Input
                    id="coros-sync-from"
                    type="date"
                    value={corosSyncFrom}
                    onChange={(e) => setCorosSyncFrom(e.target.value)}
                    disabled={corosSyncing}
                    className="w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="coros-sync-to">{t("coros.syncTo")}</Label>
                  <Input
                    id="coros-sync-to"
                    type="date"
                    value={corosSyncTo}
                    onChange={(e) => setCorosSyncTo(e.target.value)}
                    disabled={corosSyncing}
                    className="w-40"
                  />
                </div>
                <p className="text-xs text-muted-foreground pb-1">
                  {t("coros.leaveBlank")}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
                <Button
                  onClick={handleCorosSync}
                  disabled={corosSyncing}
                  variant="default"
                  className="w-full sm:w-auto"
                >
                  {corosSyncing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                      {t("coros.syncing")}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" /> {t("coros.syncNow")}
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleCorosDisconnect}
                  variant="destructive"
                  size="sm"
                  className="w-full sm:w-auto"
                >
                  <Unplug className="h-4 w-4 mr-2" /> {t("coros.disconnect")}
                </Button>
                <Button
                  onClick={handleCorosResetSync}
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                >
                  {t("coros.resetSync")}
                </Button>
              </div>

              {corosSyncResult && (
                <div
                  className={`text-sm p-3 rounded-md ${
                    corosSyncResult.type === "success"
                      ? "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200"
                      : "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200"
                  }`}
                >
                  {corosSyncResult.text}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {t("coros.backgroundSyncInfo")}
              </p>
            </div>
          ) : (
            /* ── Not Connected State ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <XCircle className="h-5 w-5" />
                <span>{t("coros.notConnected")}</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="coros-email">
                  {t("coros.emailLabel")}
                </Label>
                <Input
                  id="coros-email"
                  type="email"
                  value={corosEmail}
                  onChange={(e) => setCorosEmail(e.target.value)}
                  placeholder={t("coros.emailPlaceholder")}
                  disabled={corosConnecting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="coros-password">{t("coros.passwordLabel")}</Label>
                <Input
                  id="coros-password"
                  type="password"
                  value={corosPassword}
                  onChange={(e) => setCorosPassword(e.target.value)}
                  placeholder={t("coros.passwordPlaceholder")}
                  disabled={corosConnecting}
                />
              </div>

              <Button
                onClick={handleCorosConnect}
                disabled={corosConnecting || !corosEmail || !corosPassword}
              >
                {corosConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                    {t("coros.connecting")}
                  </>
                ) : (
                  <>
                    <Plug className="h-4 w-4 mr-2" />{" "}
                    {t("coros.connect")}
                  </>
                )}
              </Button>

              {corosConnectError && (
                <p className="text-sm text-destructive">
                  {corosConnectError}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                {t("coros.passwordNote")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Garmin Connect Card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> {t("garmin.title")}
          </CardTitle>
          <CardDescription>
            {t("garmin.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {garminStatus?.connected ? (
            /* ── Connected State ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">{t("garmin.connected")}</span>
                {garminStatus.displayName && (
                  <Badge variant="outline">{garminStatus.displayName}</Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm break-words">
                <div>
                  <span className="text-muted-foreground">
                    {t("garmin.activitiesSynced")}
                  </span>
                  <span className="ml-2 font-medium">
                    {garminStatus.garminActivityCount}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t("garmin.connectedSince")}
                  </span>
                  <span className="ml-2 font-medium">
                    {garminStatus.connectedAt
                      ? new Date(garminStatus.connectedAt).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t("garmin.lastActivitySync")}
                  </span>
                  <span className="ml-2 font-medium">
                    {garminStatus.lastSyncAt
                      ? new Date(
                          garminStatus.lastSyncAt
                        ).toLocaleString()
                      : t("garmin.never")}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t("garmin.lastHealthSync")}
                  </span>
                  <span className="ml-2 font-medium">
                    {garminStatus.lastHealthSyncAt
                      ? new Date(
                          garminStatus.lastHealthSyncAt
                        ).toLocaleString()
                      : t("garmin.never")}
                  </span>
                </div>
              </div>

              {/* ── Date Range Filter ──────────────────── */}
              <div className="flex flex-wrap items-end gap-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sync-from">{t("garmin.syncFrom")}</Label>
                  <Input
                    id="sync-from"
                    type="date"
                    value={syncFrom}
                    onChange={(e) => setSyncFrom(e.target.value)}
                    disabled={syncing}
                    className="w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sync-to">{t("garmin.syncTo")}</Label>
                  <Input
                    id="sync-to"
                    type="date"
                    value={syncTo}
                    onChange={(e) => setSyncTo(e.target.value)}
                    disabled={syncing}
                    className="w-40"
                  />
                </div>
                <p className="text-xs text-muted-foreground pb-1">
                  {t("garmin.leaveBlank")}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
                <Button
                  onClick={handleSync}
                  disabled={syncing}
                  variant="default"
                  className="w-full sm:w-auto"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                      {t("garmin.syncing")}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" /> {t("garmin.syncNow")}
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleDisconnect}
                  variant="destructive"
                  size="sm"
                  className="w-full sm:w-auto"
                >
                  <Unplug className="h-4 w-4 mr-2" /> {t("garmin.disconnect")}
                </Button>
                <Button
                  onClick={handleResetSync}
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                >
                  {t("garmin.resetSync")}
                </Button>
              </div>

              {syncResult && (
                <div
                  className={`text-sm p-3 rounded-md ${
                    syncResult.type === "success"
                      ? "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200"
                      : "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200"
                  }`}
                >
                  {syncResult.text}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {t("garmin.backgroundSyncInfo")}
              </p>
            </div>
          ) : (
            /* ── Not Connected State ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <XCircle className="h-5 w-5" />
                <span>{t("garmin.notConnected")}</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="garmin-email">
                  {t("garmin.emailLabel")}
                </Label>
                <Input
                  id="garmin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("garmin.emailPlaceholder")}
                  disabled={connecting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="garmin-password">{t("garmin.passwordLabel")}</Label>
                <Input
                  id="garmin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("garmin.passwordPlaceholder")}
                  disabled={connecting || mfaRequired}
                />
              </div>

              {mfaRequired && (
                <div className="space-y-2">
                  <Label htmlFor="garmin-mfa">
                    {t("garmin.mfaCodeLabel")}
                  </Label>
                  <Input
                    id="garmin-mfa"
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder={t("garmin.mfaCodePlaceholder")}
                    disabled={connecting}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("garmin.mfaHelpText")}
                  </p>
                </div>
              )}

              <Button
                onClick={handleConnect}
                disabled={
                  connecting ||
                  !email ||
                  !password ||
                  (mfaRequired && !mfaCode)
                }
              >
                {connecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                    {t("garmin.connecting")}
                  </>
                ) : (
                  <>
                    <Plug className="h-4 w-4 mr-2" />{" "}
                    {mfaRequired
                      ? t("garmin.verifyMfa")
                      : t("garmin.connect")}
                  </>
                )}
              </Button>

              {connectError && (
                <p className="text-sm text-destructive">{connectError}</p>
              )}

              <p className="text-xs text-muted-foreground">
                {mfaRequired
                  ? t("garmin.mfaLoginHelp")
                  : t("garmin.passwordNote")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
