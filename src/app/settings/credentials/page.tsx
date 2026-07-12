"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowLeft, Copy, Trash2, Key, Plus, Eye, EyeOff, Terminal, Brain } from "lucide-react";
import Link from "next/link";

interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

// Provider → default base URL
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  ollama: "http://localhost:11434/v1",
};

// Provider → available models
const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest", "claude-3-opus-latest", "claude-3-haiku-latest"],
  ollama: ["llama3", "mistral", "mixtral", "codellama", "gemma"],
};

export default function CredentialsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [publicUrl, setPublicUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // LLM settings
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmProvider, setLlmProvider] = useState("");
  const [llmSaved, setLlmSaved] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);

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
        fetch("/api/settings/llm").then((r) => r.json()),
      ]).then(([credData, keyData, llmData]) => {
        setPublicUrl(credData.public_url || "");
        setApiKeys(keyData.keys || []);
        setHasStoredKey(llmData.hasUserKey);
        setLlmApiKey("");
        setLlmBaseUrl(llmData.llmBaseUrl || "");
        setLlmModel(llmData.llmModel || "");
        setLlmProvider(llmData.llmProvider || "");
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

      {/* ── AI Provider ──────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" /> AI Provider
          </CardTitle>
          <CardDescription>
            Choose your preferred AI provider and enter your own API key.
            All AI coaching features use <strong>your</strong> key — no server key is shared.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasStoredKey && !llmApiKey && !llmProvider && (
            <div className="p-3 rounded-md bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 text-sm flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" />
              Your AI provider is configured. Change settings below to update.
            </div>
          )}

          {/* Provider */}
          <div className="space-y-2">
            <Label htmlFor="llm-provider">Provider</Label>
            <select
              id="llm-provider"
              value={llmProvider}
              onChange={(e) => {
                const provider = e.target.value;
                setLlmProvider(provider);
                // Reset model when provider changes
                setLlmModel("");
                // Auto-populate base URL
                setLlmBaseUrl(PROVIDER_BASE_URLS[provider] || "");
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select a provider…</option>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="anthropic">Anthropic</option>
              <option value="ollama">Ollama (local)</option>
            </select>
          </div>

          {/* Model (populated based on provider) */}
          {llmProvider && (
            <div className="space-y-2">
              <Label htmlFor="llm-model">Model</Label>
              <select
                id="llm-model"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select a model…</option>
                {(PROVIDER_MODELS[llmProvider] || []).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="llm-api-key">API Key</Label>
            <div className="relative">
              <Input
                id="llm-api-key"
                type={showLlmKey ? "text" : "password"}
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                placeholder={hasStoredKey ? "Enter new key to replace saved one" : "sk-..."}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowLlmKey(!showLlmKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showLlmKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your key is stored in the database and never shared with other users.
              {llmProvider === "ollama" && " Ollama runs locally — a placeholder key is fine."}
            </p>
          </div>

          {/* Auto-generated base URL (read-only) */}
          {llmProvider && llmBaseUrl && (
            <div className="p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
              <span className="font-medium">Endpoint: </span>
              <code className="font-mono">{llmBaseUrl}/chat/completions</code>
            </div>
          )}

          <Button
            disabled={!llmProvider || !llmModel || (llmProvider !== "ollama" && !llmApiKey)}
            onClick={async () => {
              await fetch("/api/settings/llm", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  llmApiKey: llmApiKey || undefined,
                  llmBaseUrl: llmBaseUrl || undefined,
                  llmModel: llmModel || undefined,
                  llmProvider: llmProvider || undefined,
                }),
              });
              setHasStoredKey(!!llmApiKey || llmProvider === "ollama");
              setLlmSaved(true);
              setTimeout(() => setLlmSaved(false), 2500);
            }}
          >
            {llmSaved ? <><Check className="h-4 w-4 mr-2" /> Saved</> : "Save AI Settings"}
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
