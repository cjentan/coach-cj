"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowLeft, Copy, Trash2, Key, Plus, Eye, EyeOff, Terminal } from "lucide-react";
import Link from "next/link";

interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function CredentialsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [publicUrl, setPublicUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // API keys
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{ rawKey: string; name: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
    else if (status === "authenticated") {
      Promise.all([
        fetch("/api/settings/credentials").then((r) => r.json()),
        fetch("/api/settings/api-keys").then((r) => r.json()),
      ]).then(([credData, keyData]) => {
        setPublicUrl(credData.public_url || "");
        setApiKeys(keyData.keys || []);
        setLoading(false);
      });
    }
  }, [status, router]);

  async function savePublicUrl() {
    await fetch("/api/settings/credentials", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_url: publicUrl }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function createKey() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewlyCreatedKey({ rawKey: data.rawKey, name: data.key.name });
      setShowKey(false);
      setCopied(false);
      setNewKeyName("");
      // Refresh list
      const listRes = await fetch("/api/settings/api-keys");
      const listData = await listRes.json();
      setApiKeys(listData.keys || []);
    }
    setCreating(false);
  }

  async function revokeKey(id: string) {
    setRevoking(id);
    await fetch(`/api/settings/api-keys?id=${id}`, { method: "DELETE" });
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
    setRevoking(null);
  }

  function copyKey() {
    if (!newlyCreatedKey) return;
    navigator.clipboard.writeText(newlyCreatedKey.rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  if (loading) return <div className="container mx-auto px-4 py-8 max-w-2xl">Loading...</div>;

  const baseUrl = publicUrl || (typeof window !== "undefined" ? window.location.origin : "");

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4">
        <ArrowLeft className="h-3 w-3" /> Back to Settings
      </Link>

      <h1 className="text-3xl font-bold mb-2">API Credentials</h1>
      <p className="text-muted-foreground mb-8">Manage your API keys and public URL for remote access.</p>

      {/* ── Public URL ──────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Public URL</CardTitle>
          <CardDescription>
            Your app&apos;s public URL. Used for callback links and external references.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Public URL</Label>
            <Input
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder="https://coach.oryx-everest.ts.net"
            />
            <p className="text-xs text-muted-foreground">
              Set this to your Tailscale domain or public IP so the push API example commands show the correct URL.
            </p>
          </div>
          <Button onClick={savePublicUrl}>
            {saved ? <><Check className="h-4 w-4 mr-2" /> Saved</> : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* ── API Keys ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> API Keys</CardTitle>
          <CardDescription>
            Create API keys to push GPX, TCX, or FIT files remotely via the push API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Existing keys */}
          {apiKeys.length > 0 && (
            <div className="space-y-2">
              <Label>Your Keys</Label>
              <div className="border rounded-lg divide-y">
                {apiKeys.map((key) => (
                  <div key={key.id} className="flex items-center justify-between p-3 text-sm">
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-medium truncate">{key.name}</div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <code className="font-mono">{key.keyPrefix}…</code>
                        {key.lastUsedAt && (
                          <span>Last used: {new Date(key.lastUsedAt).toLocaleDateString()}</span>
                        )}
                        <span>Created: {new Date(key.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive shrink-0 ml-2"
                      disabled={revoking === key.id}
                      onClick={() => revokeKey(key.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Create new key form */}
          <div className="space-y-3 p-4 rounded-lg bg-muted/50">
            <Label className="font-medium">Create a New Key</Label>
            <div className="flex gap-2">
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Watch Push, Zapier, iOS Shortcut"
                disabled={creating}
                onKeyDown={(e) => e.key === "Enter" && createKey()}
              />
              <Button onClick={createKey} disabled={creating || !newKeyName.trim()}>
                <Plus className="h-4 w-4 mr-1" /> {creating ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>

          {/* Newly created key — shown once */}
          {newlyCreatedKey && (
            <div className="space-y-3 p-4 rounded-lg border-2 border-primary/30 bg-primary/5">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="font-medium text-sm">Key Created — Copy It Now</span>
              </div>
              <p className="text-xs text-muted-foreground">
                This is the only time the full key will be shown. Store it securely.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 rounded bg-muted font-mono text-xs break-all select-all">
                  {showKey ? newlyCreatedKey.rawKey : "•".repeat(48)}
                </code>
                <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="sm" onClick={copyKey}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-destructive font-medium">
                This key grants full access to push activities to your account. Do not share it.
              </p>

              {/* Example curl */}
              <div className="space-y-2">
                <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Terminal className="h-3 w-3" /> Example push commands
                </div>
                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2 rounded bg-muted overflow-x-auto">
                    <span className="text-muted-foreground"># Push a GPX file</span><br />
                    curl -X POST {baseUrl}/api/push/activity \<br />
                    {"  "}-H &quot;Authorization: Bearer {showKey ? newlyCreatedKey.rawKey : "coach_…"}&quot; \<br />
                    {"  "}-H &quot;Content-Type: application/gpx+xml&quot; \<br />
                    {"  "}<span className="text-muted-foreground">--data-binary @activity.gpx</span>
                  </div>
                  <div className="p-2 rounded bg-muted overflow-x-auto">
                    <span className="text-muted-foreground"># Push a FIT file (multipart)</span><br />
                    curl -X POST {baseUrl}/api/push/activity \<br />
                    {"  "}-H &quot;Authorization: Bearer {showKey ? newlyCreatedKey.rawKey : "coach_…"}&quot; \<br />
                    {"  "}<span className="text-muted-foreground">-F &quot;file=@activity.fit&quot;</span>
                  </div>
                  <div className="p-2 rounded bg-muted overflow-x-auto">
                    <span className="text-muted-foreground"># Override name and type</span><br />
                    curl -X POST &quot;{baseUrl}/api/push/activity?name=Morning+Run&amp;type=run&quot; \<br />
                    {"  "}-H &quot;Authorization: Bearer {showKey ? newlyCreatedKey.rawKey : "coach_…"}&quot; \<br />
                    {"  "}<span className="text-muted-foreground">-F &quot;file=@activity.tcx&quot;</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
