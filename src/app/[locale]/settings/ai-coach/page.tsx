"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Brain, Save, Loader2, CalendarDays, Clock, Check, Eye, EyeOff,
  Zap, Server, Send, CheckCircle2, XCircle, Loader2 as Spinner,
} from "lucide-react";
import { LONG_DAY_NAMES } from "@/lib/constants";

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  ollama: "http://localhost:11434/v1",
};

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  deepseek: ["deepseek-v4-flash"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest", "claude-3-opus-latest", "claude-3-haiku-latest"],
  ollama: ["llama3", "mistral", "mixtral", "codellama", "gemma"],
};

const QUICK_PROMPTS = [
  { label: "Training week", prompt: "Summarize a training week: 62km running, 1800m elevation, 5h 23min across 6 sessions. The athlete has a 100km trail race in 12 weeks. What should they focus on?" },
  { label: "Fatigue check", prompt: "An athlete reports feeling tired, with resting HR 5 bpm above baseline, and training monotony at 0.82. Their TSB is -15. What's your assessment and recommendation?" },
  { label: "Simple test", prompt: "In one sentence, what is the most important principle of endurance training?" },
];

// ─── Section: Analysis Schedule ────────────────────────────────────────────
function AnalysisScheduleSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const [trigger, setTrigger] = useState("weekly");
  const [triggerValue, setTriggerValue] = useState(3);
  const [reviewDay, setReviewDay] = useState("0");
  const [reviewTime, setReviewTime] = useState("18:00");
  const [reviewDayOfMonth, setReviewDayOfMonth] = useState(1);
  const [lastAnalysisAt, setLastAnalysisAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/analysis")
      .then((r) => r.json())
      .then((data) => {
        setTrigger(data.analysisTrigger || "weekly");
        setTriggerValue(data.analysisTriggerValue || 3);
        setReviewDay(String(data.reviewDayOfWeek ?? 0));
        setReviewTime(data.reviewTime ?? "18:00");
        setReviewDayOfMonth(data.reviewDayOfMonth ?? 1);
        setLastAnalysisAt(data.lastAnalysisAt);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const body: Record<string, any> = { analysisTrigger: trigger, analysisTriggerValue: triggerValue, reviewTime };
      if (trigger === "weekly" || trigger === "daily") body.reviewDayOfWeek = Number(reviewDay);
      if (trigger === "monthly") body.reviewDayOfMonth = reviewDayOfMonth;
      const res = await fetch("/api/settings/analysis", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { setError(t("saveError")); }
    setSaving(false);
  }

  if (loading) return <p className="py-4 text-sm text-muted-foreground">{common("loading")}</p>;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><Brain className="h-5 w-5" /> {t("frequency")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>{t("frequencyLabel")}</Label>
          <Select value={trigger} onValueChange={setTrigger}>
            <SelectTrigger className="w-full max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="activity_count">{t("optionActivityCount")}</SelectItem>
              <SelectItem value="every_n_days">{t("optionEveryNDays")}</SelectItem>
              <SelectItem value="daily">{t("optionDaily")}</SelectItem>
              <SelectItem value="weekly">{t("optionWeekly")}</SelectItem>
              <SelectItem value="monthly">{t("optionMonthly")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            {trigger === "activity_count" && t("descActivityCount")}
            {trigger === "every_n_days" && t("descEveryNDays")}
            {trigger === "daily" && t("descDaily")}
            {trigger === "weekly" && t("descWeekly")}
            {trigger === "monthly" && t("descMonthly")}
          </p>
        </div>

        <div className="space-y-4">
          {trigger === "activity_count" && (
            <div className="space-y-2">
              <Label>{t("activitiesBetweenLabel")}</Label>
              <Input type="number" min={1} max={20} value={triggerValue} onChange={(e) => setTriggerValue(Math.max(1, Math.min(20, Number(e.target.value))))} className="w-24" />
              <p className="text-xs text-muted-foreground">{t("activitiesBetweenDescription", { count: triggerValue })}</p>
            </div>
          )}
          {trigger === "every_n_days" && (
            <div className="space-y-2">
              <Label>{t("daysBetweenLabel")}</Label>
              <Input type="number" min={1} max={90} value={triggerValue} onChange={(e) => setTriggerValue(Math.max(1, Math.min(90, Number(e.target.value))))} className="w-24" />
              <p className="text-xs text-muted-foreground">{t("daysBetweenDescription", { count: triggerValue })}</p>
            </div>
          )}
          {trigger === "weekly" && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><CalendarDays className="h-4 w-4" /> {t("dayOfWeek")}</Label>
              <Select value={reviewDay} onValueChange={setReviewDay}>
                <SelectTrigger className="w-full max-w-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{LONG_DAY_NAMES.map((d, i) => (<SelectItem key={i} value={String(i)}>{d}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          )}
          {trigger === "monthly" && (
            <div className="space-y-2">
              <Label>{t("dayOfMonth")}</Label>
              <Input type="number" min={1} max={31} value={reviewDayOfMonth} onChange={(e) => setReviewDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))} className="w-24" />
              <p className="text-xs text-muted-foreground">{t("dayOfMonthDescription", { day: reviewDayOfMonth })}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1"><Clock className="h-4 w-4" /> {t("reviewTime")}</Label>
          <Input type="time" value={reviewTime} onChange={(e) => setReviewTime(e.target.value)} className="w-32" />
        </div>

        <div className="pt-4 border-t">
          <Label className="text-muted-foreground">{t("lastAnalysis")}</Label>
          <p className="text-sm mt-1">{lastAnalysisAt ? new Date(lastAnalysisAt).toLocaleString() : t("noAnalysis")}</p>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}
        {saved && <div className="text-sm text-green-600 flex items-center gap-1"><Check className="h-4 w-4" /> Saved</div>}

        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Spinner className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? common("saving") : common("save")}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Section: AI Provider ──────────────────────────────────────────────────
function AiProviderSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const { status } = useSession();
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmProvider, setLlmProvider] = useState("");
  const [llmSaved, setLlmSaved] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [hasServerDefault, setHasServerDefault] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [loading, setLoading] = useState(true);

  // Test state
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<{ success: boolean; response?: string; error?: string; durationMs: number; tokenEstimate?: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/settings/llm")
      .then((r) => r.json())
      .then((data) => {
        setHasStoredKey(data.hasUserKey);
        setHasServerDefault(data.hasServerDefault);
        setLlmBaseUrl(data.llmBaseUrl || "");
        setLlmModel(data.llmModel || "");
        setLlmProvider(data.llmProvider || "");
        setLoading(false);
      });
  }, [status]);

  async function runTest(testPrompt?: string) {
    const p = testPrompt || prompt;
    if (!p.trim()) return;
    setTesting(true); setResult(null); setTestError(null);
    try {
      const res = await fetch("/api/llm-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: p }) });
      setResult(await res.json());
    } catch { setTestError("Network error — is the server running?"); }
    finally { setTesting(false); }
  }

  if (loading) return <p className="py-4 text-sm text-muted-foreground">{common("loading")}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" /> {t("aiProvider")}</CardTitle>
        <CardDescription>{t("aiProviderDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasServerDefault && !hasStoredKey && !llmApiKey && !llmProvider && (
          <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200 text-sm flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" />
            <span>{t("serverDefaultNotice")}</span>
          </div>
        )}
        {hasStoredKey && !llmApiKey && !llmProvider && (
          <div className="p-3 rounded-md bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 text-sm flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" />
            {t("configuredNotice")}
          </div>
        )}

        <div className="space-y-2">
          <Label>{t("provider")}</Label>
          <select value={llmProvider} onChange={(e) => { const p = e.target.value; setLlmProvider(p); setLlmModel(""); setLlmBaseUrl(PROVIDER_BASE_URLS[p] || ""); }}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">{t("selectProvider")}</option>
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">{t("providerOllama")}</option>
          </select>
        </div>

        {llmProvider && (
          <div className="space-y-2">
            <Label>{t("model")}</Label>
            <select value={llmModel} onChange={(e) => setLlmModel(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">{t("selectModel")}</option>
              {(PROVIDER_MODELS[llmProvider] || []).map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
          </div>
        )}

        <div className="space-y-2">
          <Label>{t("apiKey")}</Label>
          <div className="relative">
            <Input type={showLlmKey ? "text" : "password"} value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)}
              placeholder={hasStoredKey ? t("apiKeyPlaceholderReplace") : t("apiKeyPlaceholder")} className="pr-10" />
            <button type="button" onClick={() => setShowLlmKey(!showLlmKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showLlmKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t("apiKeyDescription")}{llmProvider === "ollama" && <> {t("ollamaKeyDescription")}</>}</p>
        </div>

        {llmProvider && llmBaseUrl && (
          <div className="p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
            <span className="font-medium">{t("endpoint")}</span>
            <code className="font-mono">{llmBaseUrl}/chat/completions</code>
          </div>
        )}

        <Button disabled={!llmProvider || !llmModel || (llmProvider !== "ollama" && !llmApiKey)}
          onClick={async () => {
            await fetch("/api/settings/llm", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ llmApiKey: llmApiKey || undefined, llmBaseUrl: llmBaseUrl || undefined, llmModel: llmModel || undefined, llmProvider: llmProvider || undefined }) });
            setHasStoredKey(!!llmApiKey || llmProvider === "ollama");
            setLlmSaved(true);
            setTimeout(() => setLlmSaved(false), 2500);
          }}
        >
          {llmSaved ? <><Check className="h-4 w-4 mr-2" /> {t("saved")}</> : t("saveSettings")}
        </Button>

        {/* Test Connection */}
        <div className="border-t pt-6 mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Server className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-medium">{t("testConnection")}</h3>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {QUICK_PROMPTS.map((qp, i) => (
              <Button key={i} variant="outline" size="sm" disabled={testing} onClick={() => { setPrompt(qp.prompt); runTest(qp.prompt); }}>
                <Zap className="h-3 w-3 mr-1" /> {t(qp.label === "Training week" ? "quickTrainingWeek" : qp.label === "Fatigue check" ? "quickFatigueCheck" : "quickSimpleTest")}
              </Button>
            ))}
          </div>

          <div className="flex gap-2 mb-4">
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("customPromptPlaceholder")} onKeyDown={(e) => e.key === "Enter" && runTest()} disabled={testing} />
            <Button variant="secondary" onClick={() => runTest()} disabled={testing || !prompt.trim()}>
              {testing ? <Spinner className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>

          {(testing || result || testError) && (
            <div className="rounded-md border">
              <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {testing ? <><Spinner className="h-4 w-4 animate-spin" /> {t("testing")}</>
                    : result?.success ? <><CheckCircle2 className="h-4 w-4 text-green-500" /> {t("response")}</>
                    : <><XCircle className="h-4 w-4 text-destructive" /> {t("failed")}</>}
                </div>
                {result && !testing && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {result.durationMs}ms</span>
                    {result.tokenEstimate && <span>~{result.tokenEstimate} tokens</span>}
                  </div>
                )}
              </div>
              <div className="p-4">
                {testing ? (
                  <div className="flex items-center gap-3 justify-center text-muted-foreground py-4">
                    <Spinner className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{t("waitingForResponse")}</span>
                  </div>
                ) : testError ? (
                  <div className="text-sm text-destructive">{testError}</div>
                ) : result?.error ? (
                  <div className="text-sm text-destructive">{result.error}</div>
                ) : result?.response ? (
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{result.response}</div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function SettingsAiCoachPage() {
  const t = useTranslations("settings.analysis");
  const credT = useTranslations("settings.credentials");
  const common = useTranslations("common");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">AI Coach</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how your AI coach analyzes your training and which AI model powers it.
        </p>
      </div>

      <AnalysisScheduleSection t={t} common={common} />
      <AiProviderSection t={credT} common={common} />
    </div>
  );
}
