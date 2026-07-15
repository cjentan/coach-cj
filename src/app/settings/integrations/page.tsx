"use client";

import { useState, useEffect } from "react";
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
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncFrom, setSyncFrom] = useState("");
  const [syncTo, setSyncTo] = useState("");

  // COROS state
  const [corosEmail, setCorosEmail] = useState("");
  const [corosPassword, setCorosPassword] = useState("");
  const [corosConnecting, setCorosConnecting] = useState(false);
  const [corosConnectError, setCorosConnectError] = useState<string | null>(null);
  const [corosSyncing, setCorosSyncing] = useState(false);
  const [corosSyncResult, setCorosSyncResult] = useState<string | null>(null);
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
        setConnectError(
          "Multi-factor authentication is enabled. Enter the code from your authenticator app or email."
        );
      } else {
        setConnectError(data.error || "Connection failed");
      }
    } catch {
      setConnectError("Network error — check your connection");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        "Disconnect Garmin? This will remove all synced activities and health data."
      )
    )
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
        setCorosConnectError(data.error || "Connection failed");
      }
    } catch {
      setCorosConnectError("Network error — check your connection");
    } finally {
      setCorosConnecting(false);
    }
  };

  const handleCorosDisconnect = async () => {
    if (
      !confirm(
        "Disconnect COROS? This will remove all synced activities."
      )
    )
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
        setCorosSyncResult(
          `Synced ${data.activitiesImported} activities.`
        );
        await fetchCorosStatus();
      } else {
        setCorosSyncResult(`Sync failed: ${data.error}`);
      }
    } catch {
      setCorosSyncResult("Sync failed: network error");
    } finally {
      setCorosSyncing(false);
    }
  };

  const handleCorosResetSync = async () => {
    if (
      !confirm(
        "Reset COROS sync state? The next sync will re-fetch all activities from COROS."
      )
    )
      return;
    try {
      const res = await fetch("/api/integrations/coros/reset-sync", {
        method: "POST",
      });
      if (res.ok) {
        setCorosSyncResult("Sync state reset. Use 'Sync Now' to re-fetch all data.");
        await fetchCorosStatus();
      }
    } catch {
      // Ignore
    }
  };

  const handleResetSync = async () => {
    if (
      !confirm(
        "Reset Garmin sync state? The next sync will re-fetch all activities and health data from the last 30 days."
      )
    )
      return;
    try {
      const res = await fetch("/api/integrations/garmin/reset-sync", {
        method: "POST",
      });
      if (res.ok) {
        setSyncResult("Sync state reset. Use 'Sync Now' to re-fetch all recent data.");
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
        setSyncResult(
          `Synced ${data.activitiesImported} activities and ${data.healthDaysSynced} health days.`
        );
        await fetchStatus();
      } else {
        setSyncResult(`Sync failed: ${data.error}`);
      }
    } catch {
      setSyncResult("Sync failed: network error");
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
      <h1 className="text-2xl font-bold mb-2">Integrations</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Connect external services to auto-import your training and health data.
      </p>

      {/* COROS Card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Watch className="h-5 w-5" /> COROS Training Hub
          </CardTitle>
          <CardDescription>
            Sync your activities from COROS watches directly via the COROS
            Training Hub.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {corosStatus?.connected ? (
            /* ── Connected State ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">Connected</span>
                {corosStatus.displayName && (
                  <Badge variant="outline">
                    {corosStatus.displayName}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">
                    Activities synced:
                  </span>
                  <span className="ml-2 font-medium">
                    {corosStatus.corosActivityCount}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Connected since:
                  </span>
                  <span className="ml-2 font-medium">
                    {corosStatus.connectedAt
                      ? new Date(
                          corosStatus.connectedAt
                        ).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Last sync:
                  </span>
                  <span className="ml-2 font-medium">
                    {corosStatus.lastSyncAt
                      ? new Date(
                          corosStatus.lastSyncAt
                        ).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>

              {/* ── Date Range Filter ── */}
              <div className="flex flex-wrap items-end gap-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="coros-sync-from">From</Label>
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
                  <Label htmlFor="coros-sync-to">To</Label>
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
                  Leave blank for full sync
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleCorosSync}
                  disabled={corosSyncing}
                  variant="default"
                >
                  {corosSyncing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" /> Sync Now
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleCorosDisconnect}
                  variant="destructive"
                  size="sm"
                >
                  <Unplug className="h-4 w-4 mr-2" /> Disconnect
                </Button>
                <Button
                  onClick={handleCorosResetSync}
                  variant="outline"
                  size="sm"
                >
                  Reset Sync State
                </Button>
              </div>

              {corosSyncResult && (
                <div
                  className={`text-sm p-3 rounded-md ${
                    corosSyncResult.startsWith("Synced")
                      ? "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200"
                      : "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200"
                  }`}
                >
                  {corosSyncResult}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Background sync runs every 4 hours. Use &ldquo;Sync
                Now&rdquo; to trigger an immediate sync.
              </p>
            </div>
          ) : (
            /* ── Not Connected State ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <XCircle className="h-5 w-5" />
                <span>Not connected</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="coros-email">
                  COROS Account Email
                </Label>
                <Input
                  id="coros-email"
                  type="email"
                  value={corosEmail}
                  onChange={(e) => setCorosEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  disabled={corosConnecting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="coros-password">Password</Label>
                <Input
                  id="coros-password"
                  type="password"
                  value={corosPassword}
                  onChange={(e) => setCorosPassword(e.target.value)}
                  placeholder="COROS account password"
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
                    Connecting...
                  </>
                ) : (
                  <>
                    <Plug className="h-4 w-4 mr-2" />{" "}
                    Connect COROS Account
                  </>
                )}
              </Button>

              {corosConnectError && (
                <p className="text-sm text-destructive">
                  {corosConnectError}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                Your password is used only for initial authentication. An
                access token is stored securely and your password is not
                saved.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Garmin Connect Card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> Garmin Connect
          </CardTitle>
          <CardDescription>
            Sync activities and daily health metrics (heart rate, sleep, stress,
            HRV, body battery) from your Garmin devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {garminStatus?.connected ? (
            /* ── Connected State ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">Connected</span>
                {garminStatus.displayName && (
                  <Badge variant="outline">{garminStatus.displayName}</Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">
                    Activities synced:
                  </span>
                  <span className="ml-2 font-medium">
                    {garminStatus.garminActivityCount}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Connected since:
                  </span>
                  <span className="ml-2 font-medium">
                    {garminStatus.connectedAt
                      ? new Date(garminStatus.connectedAt).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Last activity sync:
                  </span>
                  <span className="ml-2 font-medium">
                    {garminStatus.lastSyncAt
                      ? new Date(
                          garminStatus.lastSyncAt
                        ).toLocaleString()
                      : "Never"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Last health sync:
                  </span>
                  <span className="ml-2 font-medium">
                    {garminStatus.lastHealthSyncAt
                      ? new Date(
                          garminStatus.lastHealthSyncAt
                        ).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>

              {/* ── Date Range Filter ──────────────────── */}
              <div className="flex flex-wrap items-end gap-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sync-from">From</Label>
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
                  <Label htmlFor="sync-to">To</Label>
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
                  Leave blank for full sync
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSync}
                  disabled={syncing}
                  variant="default"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" /> Sync Now
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleDisconnect}
                  variant="destructive"
                  size="sm"
                >
                  <Unplug className="h-4 w-4 mr-2" /> Disconnect
                </Button>
                <Button
                  onClick={handleResetSync}
                  variant="outline"
                  size="sm"
                >
                  Reset Sync State
                </Button>
              </div>

              {syncResult && (
                <div
                  className={`text-sm p-3 rounded-md ${
                    syncResult.startsWith("Synced")
                      ? "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200"
                      : "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200"
                  }`}
                >
                  {syncResult}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Background sync runs every 4 hours. Use &ldquo;Sync Now&rdquo;
                to trigger an immediate sync.
              </p>
            </div>
          ) : (
            /* ── Not Connected State ── */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <XCircle className="h-5 w-5" />
                <span>Not connected</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="garmin-email">
                  Garmin Connect Email
                </Label>
                <Input
                  id="garmin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  disabled={connecting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="garmin-password">Password</Label>
                <Input
                  id="garmin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Garmin password"
                  disabled={connecting || mfaRequired}
                />
              </div>

              {mfaRequired && (
                <div className="space-y-2">
                  <Label htmlFor="garmin-mfa">
                    MFA Code
                  </Label>
                  <Input
                    id="garmin-mfa"
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="Enter the 6-digit code"
                    disabled={connecting}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Check your authenticator app or email for the verification
                    code from Garmin.
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
                    Connecting...
                  </>
                ) : (
                  <>
                    <Plug className="h-4 w-4 mr-2" />{" "}
                    {mfaRequired
                      ? "Verify MFA Code"
                      : "Connect Garmin Account"}
                  </>
                )}
              </Button>

              {connectError && (
                <p className="text-sm text-destructive">{connectError}</p>
              )}

              <p className="text-xs text-muted-foreground">
                {mfaRequired
                  ? "Enter the verification code from your Garmin account to complete the login."
                  : "Your password is used only for initial authentication. OAuth tokens are stored securely and your password is not saved. Garmin sessions typically last about a year before requiring re-authentication."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
