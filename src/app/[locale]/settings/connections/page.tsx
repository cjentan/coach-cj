"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plug, Unplug, RefreshCw, CheckCircle2, XCircle, Loader2,
  Activity, Watch, Key, Plus, Trash2, Eye, EyeOff, Check, Copy, Terminal,
} from "lucide-react";

// ─── Integration Types ─────────────────────────────────────────────────────
interface GarminStatus {
  connected: boolean; displayName: string | null;
  lastSyncAt: string | null; lastHealthSyncAt: string | null;
  connectedAt: string | null; garminActivityCount: number;
}

interface CorosStatus {
  connected: boolean; displayName: string | null;
  corosUserId: string | null; lastSyncAt: string | null;
  connectedAt: string | null; corosActivityCount: number;
}

interface ApiKeyInfo {
  id: string; name: string; keyPrefix: string;
  lastUsedAt: string | null; createdAt: string;
}

// ─── Section: Garmin Connect ───────────────────────────────────────────────
function GarminSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const [status, setStatus] = useState<GarminStatus | null>(null);
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

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/integrations/garmin/status");
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  useEffect(() => { fetchStatus(); }, []);

  const doConnect = async () => {
    if (!email || !password) return;
    setConnecting(true); setConnectError(null);
    try {
      const body: Record<string, string> = { email, password };
      if (mfaCode) body.mfaCode = mfaCode;
      const res = await fetch("/api/integrations/garmin/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) { setEmail(""); setPassword(""); setMfaCode(""); setMfaRequired(false); await fetchStatus(); }
      else if (data.mfaRequired) { setMfaRequired(true); setConnectError(t("garmin.mfaMessage")); }
      else setConnectError(data.error || t("garmin.connectFailed"));
    } catch { setConnectError(t("garmin.networkError")); }
    finally { setConnecting(false); }
  };

  const doDisconnect = async () => {
    if (!confirm(t("garmin.disconnectConfirm"))) return;
    await fetch("/api/integrations/garmin/disconnect", { method: "DELETE" });
    setStatus(null); setSyncResult(null);
  };

  const doSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const body: Record<string, string> = {};
      if (syncFrom) body.fromDate = syncFrom;
      if (syncTo) body.toDate = syncTo;
      const res = await fetch("/api/integrations/garmin/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) setSyncResult({ type: "success", text: t("garmin.syncComplete", { count: data.activitiesImported, healthDays: data.healthDaysSynced }) });
      else setSyncResult({ type: "error", text: t("garmin.syncError", { error: data.error }) });
    } catch { setSyncResult({ type: "error", text: t("garmin.syncNetworkError") }); }
    finally { setSyncing(false); }
  };

  const doResetSync = async () => {
    if (!confirm(t("garmin.resetSyncConfirm"))) return;
    const res = await fetch("/api/integrations/garmin/reset-sync", { method: "POST" });
    if (res.ok) setSyncResult({ type: "success", text: t("garmin.resetSyncComplete") });
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> {t("garmin.title")}</CardTitle>
        <CardDescription>{t("garmin.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-medium">{t("garmin.connected")}</span>
              {status.displayName && <Badge variant="outline">{status.displayName}</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">{t("garmin.activitiesSynced")}</span><span className="ml-2 font-medium">{status.garminActivityCount}</span></div>
              <div><span className="text-muted-foreground">{t("garmin.connectedSince")}</span><span className="ml-2 font-medium">{status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : "—"}</span></div>
              <div><span className="text-muted-foreground">{t("garmin.lastActivitySync")}</span><span className="ml-2 font-medium">{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : t("garmin.never")}</span></div>
              <div><span className="text-muted-foreground">{t("garmin.lastHealthSync")}</span><span className="ml-2 font-medium">{status.lastHealthSyncAt ? new Date(status.lastHealthSyncAt).toLocaleString() : t("garmin.never")}</span></div>
            </div>
            <div className="flex flex-wrap items-end gap-4 pt-2">
              <div className="space-y-1.5"><Label>{t("garmin.syncFrom")}</Label><Input type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} disabled={syncing} className="w-40" /></div>
              <div className="space-y-1.5"><Label>{t("garmin.syncTo")}</Label><Input type="date" value={syncTo} onChange={(e) => setSyncTo(e.target.value)} disabled={syncing} className="w-40" /></div>
              <p className="text-xs text-muted-foreground pb-1">{t("garmin.leaveBlank")}</p>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button onClick={doSync} disabled={syncing}>{syncing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("garmin.syncing")}</> : <><RefreshCw className="h-4 w-4 mr-2" /> {t("garmin.syncNow")}</>}</Button>
              <Button onClick={doDisconnect} variant="destructive" size="sm"><Unplug className="h-4 w-4 mr-2" /> {t("garmin.disconnect")}</Button>
              <Button onClick={doResetSync} variant="outline" size="sm">{t("garmin.resetSync")}</Button>
            </div>
            {syncResult && <div className={`text-sm p-3 rounded-md ${syncResult.type === "success" ? "bg-green-50 dark:bg-green-950 text-green-800" : "bg-red-50 dark:bg-red-950 text-red-800"}`}>{syncResult.text}</div>}
            <p className="text-xs text-muted-foreground">{t("garmin.backgroundSyncInfo")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2"><XCircle className="h-5 w-5" /><span>{t("garmin.notConnected")}</span></div>
            <div className="space-y-2"><Label>{t("garmin.emailLabel")}</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("garmin.emailPlaceholder")} disabled={connecting} /></div>
            <div className="space-y-2"><Label>{t("garmin.passwordLabel")}</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("garmin.passwordPlaceholder")} disabled={connecting || mfaRequired} /></div>
            {mfaRequired && (
              <div className="space-y-2"><Label>{t("garmin.mfaCodeLabel")}</Label><Input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder={t("garmin.mfaCodePlaceholder")} disabled={connecting} autoFocus /></div>
            )}
            <Button onClick={doConnect} disabled={connecting || !email || !password || (mfaRequired && !mfaCode)}>
              {connecting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("garmin.connecting")}</> : <><Plug className="h-4 w-4 mr-2" /> {mfaRequired ? t("garmin.verifyMfa") : t("garmin.connect")}</>}
            </Button>
            {connectError && <p className="text-sm text-destructive">{connectError}</p>}
            <p className="text-xs text-muted-foreground">{mfaRequired ? t("garmin.mfaLoginHelp") : t("garmin.passwordNote")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: COROS ────────────────────────────────────────────────────────
function CorosSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const [status, setStatus] = useState<CorosStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{type: "success" | "error"; text: string} | null>(null);
  const [syncFrom, setSyncFrom] = useState("");
  const [syncTo, setSyncTo] = useState("");

  const fetchStatus = async () => {
    try { const res = await fetch("/api/integrations/coros/status"); if (res.ok) setStatus(await res.json()); } catch {}
  };

  useEffect(() => { fetchStatus(); }, []);

  const doConnect = async () => {
    if (!email || !password) return;
    setConnecting(true); setConnectError(null);
    try {
      const res = await fetch("/api/integrations/coros/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (res.ok) { setEmail(""); setPassword(""); await fetchStatus(); }
      else setConnectError(data.error || t("coros.connectFailed"));
    } catch { setConnectError(t("coros.networkError")); }
    finally { setConnecting(false); }
  };

  const doDisconnect = async () => {
    if (!confirm(t("coros.disconnectConfirm"))) return;
    await fetch("/api/integrations/coros/disconnect", { method: "DELETE" });
    setStatus(null); setSyncResult(null);
  };

  const doSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const body: Record<string, string> = {};
      if (syncFrom) body.fromDate = syncFrom; if (syncTo) body.toDate = syncTo;
      const res = await fetch("/api/integrations/coros/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) setSyncResult({ type: "success", text: t("coros.syncComplete", { count: data.activitiesImported }) });
      else setSyncResult({ type: "error", text: t("coros.syncError", { error: data.error }) });
    } catch { setSyncResult({ type: "error", text: t("coros.syncNetworkError") }); }
    finally { setSyncing(false); }
  };

  const doResetSync = async () => {
    if (!confirm(t("coros.resetSyncConfirm"))) return;
    const res = await fetch("/api/integrations/coros/reset-sync", { method: "POST" });
    if (res.ok) setSyncResult({ type: "success", text: t("coros.resetSyncComplete") });
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Watch className="h-5 w-5" /> {t("coros.title")}</CardTitle>
        <CardDescription>{t("coros.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" /><span className="font-medium">{t("coros.connected")}</span>{status.displayName && <Badge variant="outline">{status.displayName}</Badge>}</div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">{t("coros.activitiesSynced")}</span><span className="ml-2 font-medium">{status.corosActivityCount}</span></div>
              <div><span className="text-muted-foreground">{t("coros.connectedSince")}</span><span className="ml-2 font-medium">{status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : "—"}</span></div>
              <div><span className="text-muted-foreground">{t("coros.lastSync")}</span><span className="ml-2 font-medium">{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : t("coros.never")}</span></div>
            </div>
            <div className="flex flex-wrap items-end gap-4 pt-2">
              <div className="space-y-1.5"><Label>{t("coros.syncFrom")}</Label><Input type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} disabled={syncing} className="w-40" /></div>
              <div className="space-y-1.5"><Label>{t("coros.syncTo")}</Label><Input type="date" value={syncTo} onChange={(e) => setSyncTo(e.target.value)} disabled={syncing} className="w-40" /></div>
              <p className="text-xs text-muted-foreground pb-1">{t("coros.leaveBlank")}</p>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button onClick={doSync} disabled={syncing}>{syncing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("coros.syncing")}</> : <><RefreshCw className="h-4 w-4 mr-2" /> {t("coros.syncNow")}</>}</Button>
              <Button onClick={doDisconnect} variant="destructive" size="sm"><Unplug className="h-4 w-4 mr-2" /> {t("coros.disconnect")}</Button>
              <Button onClick={doResetSync} variant="outline" size="sm">{t("coros.resetSync")}</Button>
            </div>
            {syncResult && <div className={`text-sm p-3 rounded-md ${syncResult.type === "success" ? "bg-green-50 dark:bg-green-950 text-green-800" : "bg-red-50 dark:bg-red-950 text-red-800"}`}>{syncResult.text}</div>}
            <p className="text-xs text-muted-foreground">{t("coros.backgroundSyncInfo")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2"><XCircle className="h-5 w-5" /><span>{t("coros.notConnected")}</span></div>
            <div className="space-y-2"><Label>{t("coros.emailLabel")}</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("coros.emailPlaceholder")} disabled={connecting} /></div>
            <div className="space-y-2"><Label>{t("coros.passwordLabel")}</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("coros.passwordPlaceholder")} disabled={connecting} /></div>
            <Button onClick={doConnect} disabled={connecting || !email || !password}>{connecting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("coros.connecting")}</> : <><Plug className="h-4 w-4 mr-2" /> {t("coros.connect")}</>}</Button>
            {connectError && <p className="text-sm text-destructive">{connectError}</p>}
            <p className="text-xs text-muted-foreground">{t("coros.passwordNote")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: API Keys (Push API) ──────────────────────────────────────────
function ApiKeysSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{ rawKey: string; name: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); };
  }, []);

  useEffect(() => {
    fetch("/api/settings/api-keys").then((r) => r.json()).then((data) => { setApiKeys(data.keys || []); setLoading(false); });
  }, []);

  async function createKey() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/settings/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newKeyName.trim() }) });
    if (res.ok) {
      const data = await res.json();
      setNewlyCreatedKey({ rawKey: data.rawKey, name: data.key.name });
      setShowKey(false); setCopied(false); setNewKeyName("");
      const listRes = await fetch("/api/settings/api-keys");
      setApiKeys((await listRes.json()).keys || []);
    }
    setCreating(false);
  }

  async function revokeKey(id: string) {
    setRevoking(id);
    await fetch(`/api/settings/api-keys?id=${id}`, { method: "DELETE" });
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
    setRevoking(null);
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  if (loading) return <p className="py-4 text-sm text-muted-foreground">{common("loading")}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> {t("apiKeys")}</CardTitle>
        <CardDescription>{t("apiKeysDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border p-4 space-y-3 text-sm">
          <h3 className="font-semibold">{t("pushApi")} <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">POST /api/push/activity</code></h3>
          <p className="text-xs text-muted-foreground">{t("pushApiDescription")}</p>
          <div><span className="font-medium">{t("authentication")}</span>
            <div className="mt-1 font-mono bg-muted/50 p-2 rounded text-[11px]">Authorization: Bearer &lt;your_api_key&gt;</div>
          </div>
          <div><span className="font-medium">{t("supportedFormats")}</span>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li><strong>GPX</strong> — <code className="font-mono bg-muted px-1 rounded">Content-Type: application/gpx+xml</code></li>
              <li><strong>TCX</strong> — <code className="font-mono bg-muted px-1 rounded">Content-Type: application/vnd.garmin.tcx+xml</code></li>
              <li><strong>FIT</strong> — use <code className="font-mono bg-muted px-1 rounded">-F file=@activity.fit</code></li>
            </ul>
          </div>
        </div>

        {apiKeys.length > 0 && (
          <div className="space-y-2">
            <Label>{t("yourKeys")}</Label>
            <div className="border rounded-lg divide-y">
              {apiKeys.map((key) => (
                <div key={key.id} className="flex items-center justify-between p-3 text-sm gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{key.name}</div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <code className="font-mono">{key.keyPrefix}…</code>
                      {key.lastUsedAt && <span>{t("lastUsed")} {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
                      <span>{t("created")} {new Date(key.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive shrink-0" disabled={revoking === key.id} onClick={() => revokeKey(key.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 p-4 rounded-lg bg-muted/50">
          <Label className="font-medium">{t("createKey")}</Label>
          <div className="flex gap-2 flex-col sm:flex-row">
            <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder={t("createKeyPlaceholder")} disabled={creating} onKeyDown={(e) => e.key === "Enter" && createKey()} />
            <Button onClick={createKey} disabled={creating || !newKeyName.trim()}>{creating ? t("creating") : <><Plus className="h-4 w-4 mr-1" /> {t("createButton")}</>}</Button>
          </div>
        </div>

        {newlyCreatedKey && (
          <div className="space-y-3 p-4 rounded-lg border-2 border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /><span className="font-medium text-sm">{t("keyCreated")}</span></div>
            <p className="text-xs text-muted-foreground">{t("keyCreatedDescription")}</p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="flex-1 p-2 rounded bg-muted font-mono text-xs break-all select-all">{showKey ? newlyCreatedKey.rawKey : "•".repeat(48)}</code>
              <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(newlyCreatedKey.rawKey); setCopied(true); copiedTimer.current = setTimeout(() => setCopied(false), 3000); }}>{copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}</Button>
            </div>
            <p className="text-xs text-destructive font-medium">{t("keyWarning")}</p>
            <div className="space-y-2">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Terminal className="h-3 w-3" /> {t("examplePushCommands")}</div>
              <div className="space-y-2 text-xs font-mono">
                <div className="p-2 rounded bg-muted overflow-x-auto"><span className="text-muted-foreground">{t("pushGpx")}</span><br />curl -X POST {baseUrl}/api/push/activity \<br />{"  "}-H &quot;Authorization: Bearer {showKey ? newlyCreatedKey.rawKey : "coach_…"}&quot; \<br />{"  "}-H &quot;Content-Type: application/gpx+xml&quot; \<br />{"  "}<span className="text-muted-foreground">--data-binary @activity.gpx</span></div>
                <div className="p-2 rounded bg-muted overflow-x-auto"><span className="text-muted-foreground">{t("pushFit")}</span><br />curl -X POST {baseUrl}/api/push/activity \<br />{"  "}-H &quot;Authorization: Bearer {showKey ? newlyCreatedKey.rawKey : "coach_…"}&quot; \<br />{"  "}<span className="text-muted-foreground">-F &quot;file=@activity.fit&quot;</span></div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function SettingsConnectionsPage() {
  const t = useTranslations("settings.integrations");
  const credT = useTranslations("settings.credentials");
  const common = useTranslations("common");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Connections</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your training devices and manage API keys for external tools.
        </p>
      </div>

      <CorosSection t={t} common={common} />
      <GarminSection t={t} common={common} />
      <ApiKeysSection t={credT} common={common} />
    </div>
  );
}
