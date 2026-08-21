"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Brain, Users, Save, Loader2, Check, Eye, EyeOff, Pencil, Search, Key,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { PROVIDER_BASE_URLS, PROVIDER_MODELS, PROVIDER_ORDER, PROVIDER_LABELS } from "@/lib/llm-providers";

type LlmForm = { provider: string; model: string; baseUrl: string; apiKey: string };
type LlmUser = { id: string; email: string; name: string; provider: string; model: string; baseUrl: string; hasKey: boolean };

const PAGE_SIZE = 50;

/**
 * Provider → model → base URL → API key form fields. Shared between the
 * site-wide default card and the per-user edit dialog. The raw key is never
 * rendered — only `hasKey` drives the placeholder ("leave blank to keep").
 */
function ProviderFields({
  form,
  onChange,
  hasKey,
  t,
}: {
  form: LlmForm;
  onChange: (patch: Partial<LlmForm>) => void;
  hasKey: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t("llm.provider")}</Label>
        <Select
          value={form.provider || undefined}
          onValueChange={(p) => onChange({ provider: p, model: "", baseUrl: PROVIDER_BASE_URLS[p] || "" })}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder={t("llm.selectProvider")} /></SelectTrigger>
          <SelectContent>
            {PROVIDER_ORDER.map((p) => (
              <SelectItem key={p} value={p}>{PROVIDER_LABELS[p] || p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {form.provider && (
        <div className="space-y-2">
          <Label>{t("llm.model")}</Label>
          <Select value={form.model || undefined} onValueChange={(m) => onChange({ model: m })}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("llm.selectModel")} /></SelectTrigger>
            <SelectContent>
              {(PROVIDER_MODELS[form.provider] || []).map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(PROVIDER_MODELS[form.provider] || []).length === 0 && (
            <p className="text-xs text-muted-foreground">{t("llm.noModels")}</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label>{t("llm.baseUrl")}</Label>
        <Input
          value={form.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">{t("llm.baseUrlHint")}</p>
      </div>

      <div className="space-y-2">
        <Label>{t("llm.apiKey")}</Label>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={form.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder={hasKey ? t("llm.keepKeyPlaceholder") : t("llm.apiKeyPlaceholder")}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LlmSettingsSection() {
  const t = useTranslations("admin");
  const router = useRouter();
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Site-wide default state ──
  const [defaultForm, setDefaultForm] = useState<LlmForm>({ provider: "", model: "", baseUrl: "", apiKey: "" });
  const [defaultHasKey, setDefaultHasKey] = useState(false);
  const [defaultLoading, setDefaultLoading] = useState(true);
  const [defaultSaving, setDefaultSaving] = useState(false);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [defaultError, setDefaultError] = useState("");

  // ── Per-user list state ──
  const [users, setUsers] = useState<LlmUser[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");

  // ── Edit dialog state ──
  const [editing, setEditing] = useState<LlmUser | null>(null);
  const [editForm, setEditForm] = useState<LlmForm>({ provider: "", model: "", baseUrl: "", apiKey: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const checkForbidden = (res: Response) => {
    if (res.status === 403) router.push("/dashboard");
    return res;
  };

  const loadDefault = async () => {
    try {
      const res = await checkForbidden(await fetch("/api/admin/llm-settings"));
      if (!res.ok) throw new Error(t("fetchFailed"));
      const data = await res.json();
      setDefaultForm({
        provider: data.provider || "",
        model: data.model || "",
        baseUrl: data.baseUrl || "",
        apiKey: "",
      });
      setDefaultHasKey(data.hasApiKey);
    } catch (e) {
      setDefaultError(e instanceof Error ? e.message : t("networkError"));
    } finally {
      setDefaultLoading(false);
    }
  };

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const params = new URLSearchParams({ skip: String(skip), take: String(PAGE_SIZE) });
      if (debouncedQuery) params.set("q", debouncedQuery);
      const res = await checkForbidden(await fetch(`/api/admin/user-llm?${params}`));
      if (!res.ok) throw new Error(t("fetchFailed"));
      const data = await res.json();
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : t("networkError"));
    } finally {
      setUsersLoading(false);
    }
  }, [skip, debouncedQuery, t, router]);

  useEffect(() => {
    loadDefault();
  }, []);

  // Reset to first page when the search query changes.
  useEffect(() => {
    setSkip(0);
  }, [debouncedQuery]);

  // Debounce the search box.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  const flashSaved = () => {
    setDefaultSaved(true);
    savedTimer.current = setTimeout(() => setDefaultSaved(false), 2000);
  };

  const saveDefault = async () => {
    setDefaultSaving(true);
    setDefaultError("");
    try {
      const res = await checkForbidden(await fetch("/api/admin/llm-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: defaultForm.provider,
          model: defaultForm.model,
          baseUrl: defaultForm.baseUrl,
          apiKey: defaultForm.apiKey.trim() || undefined,
        }),
      }));
      if (!res.ok) throw new Error(t("saveFailed"));
      if (defaultForm.apiKey.trim()) setDefaultHasKey(true);
      setDefaultForm((f) => ({ ...f, apiKey: "" }));
      flashSaved();
    } catch (e) {
      setDefaultError(e instanceof Error ? e.message : t("networkError"));
    } finally {
      setDefaultSaving(false);
    }
  };

  const removeDefaultKey = async () => {
    setDefaultSaving(true);
    setDefaultError("");
    try {
      const res = await checkForbidden(await fetch("/api/admin/llm-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "" }),
      }));
      if (!res.ok) throw new Error(t("saveFailed"));
      setDefaultHasKey(false);
      flashSaved();
    } catch (e) {
      setDefaultError(e instanceof Error ? e.message : t("networkError"));
    } finally {
      setDefaultSaving(false);
    }
  };

  const openEdit = (u: LlmUser) => {
    setEditing(u);
    setEditForm({ provider: u.provider, model: u.model, baseUrl: u.baseUrl, apiKey: "" });
    setEditError("");
  };

  const saveUser = async () => {
    if (!editing) return;
    setEditSaving(true);
    setEditError("");
    try {
      const res = await checkForbidden(await fetch("/api/admin/user-llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editing.id,
          provider: editForm.provider,
          model: editForm.model,
          baseUrl: editForm.baseUrl,
          apiKey: editForm.apiKey.trim() || undefined,
        }),
      }));
      if (!res.ok) throw new Error(t("saveFailed"));
      setEditing(null);
      loadUsers();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("networkError"));
    } finally {
      setEditSaving(false);
    }
  };

  const resetUser = async () => {
    if (!editing) return;
    setEditSaving(true);
    setEditError("");
    try {
      const res = await checkForbidden(await fetch("/api/admin/user-llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: editing.id, provider: "", model: "", baseUrl: "", apiKey: "" }),
      }));
      if (!res.ok) throw new Error(t("saveFailed"));
      setEditing(null);
      loadUsers();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("networkError"));
    } finally {
      setEditSaving(false);
    }
  };

  if (defaultLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const saveDisabled = !defaultForm.provider || !defaultForm.model
    || (defaultForm.provider !== "ollama" && !defaultForm.apiKey && !defaultHasKey);

  return (
    <div className="space-y-6">
      {/* ── Site-wide default ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" /> {t("llm.defaultTitle")}</CardTitle>
          <CardDescription>{t("llm.defaultDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProviderFields
            form={defaultForm}
            onChange={(p) => setDefaultForm((f) => ({ ...f, ...p }))}
            hasKey={defaultHasKey}
            t={t}
          />

          <div className="flex items-center gap-2">
            {defaultHasKey && (
              <>
                <Badge variant="secondary"><Key className="h-3 w-3 mr-1" /> {t("llm.keySet")}</Badge>
                <Button variant="outline" size="sm" disabled={defaultSaving} onClick={removeDefaultKey}>
                  {t("llm.removeKey")}
                </Button>
              </>
            )}
          </div>

          {defaultError && <div className="text-sm text-destructive">{defaultError}</div>}

          <Button disabled={saveDisabled} onClick={saveDefault} className="gap-2">
            {defaultSaving ? <Loader2 className="h-4 w-4 animate-spin" />
              : defaultSaved ? <Check className="h-4 w-4" />
              : <Save className="h-4 w-4" />}
            {defaultSaving ? t("llm.saving") : defaultSaved ? t("llm.saved") : t("llm.save")}
          </Button>
        </CardContent>
      </Card>

      {/* ── Per-user settings ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> {t("llm.usersTitle")}</CardTitle>
          <CardDescription>{t("llm.usersDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-xs">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("llm.searchPlaceholder")}
              className="pl-9"
            />
          </div>

          {usersError && <div className="text-sm text-destructive">{usersError}</div>}

          {usersLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t("llm.noResults")}</p>
          ) : (
            <div className="space-y-3">
              {users.map((u) => (
                <div key={u.id} className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{u.name}</span>
                      <Badge variant={u.provider ? "secondary" : "outline"} className="text-muted-foreground">
                        {u.provider ? `${u.provider} · ${u.model || "—"}` : t("llm.noConfig")}
                      </Badge>
                      <Badge variant={u.hasKey ? "default" : "outline"}>
                        {u.hasKey ? t("llm.keySet") : t("llm.noKey")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">{u.email}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                    <Pencil className="h-3 w-3 mr-1" /> {t("llm.edit")}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {total > 0 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {t("llm.pageInfo", { from: skip + 1, to: Math.min(skip + PAGE_SIZE, total), total })}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={skip === 0 || usersLoading} onClick={() => setSkip((s) => Math.max(0, s - PAGE_SIZE))}>
                  <ChevronLeft className="h-3 w-3 mr-1" /> {t("llm.prev")}
                </Button>
                <Button variant="outline" size="sm" disabled={skip + PAGE_SIZE >= total || usersLoading} onClick={() => setSkip((s) => s + PAGE_SIZE)}>
                  {t("llm.next")} <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Per-user edit dialog ── */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("llm.editTitle")}</DialogTitle>
            <DialogDescription>
              {editing ? `${editing.name} · ${editing.email}` : ""}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <>
              <ProviderFields
                form={editForm}
                onChange={(p) => setEditForm((f) => ({ ...f, ...p }))}
                hasKey={editing.hasKey}
                t={t}
              />
              {editError && <div className="text-sm text-destructive">{editError}</div>}
              <DialogFooter className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" disabled={editSaving} onClick={resetUser}>
                  {t("llm.resetToDefault")}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>{t("llm.cancel")}</Button>
                  <Button onClick={saveUser} disabled={editSaving} className="gap-2">
                    {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {t("llm.save")}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
