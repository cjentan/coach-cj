"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Brain, Sparkles, Wand2, Check, X, AlertCircle, Trash2 } from "lucide-react";

// ── Types ──────────────────────────────────────────────

interface PlanDayActual {
  type: string;
  name: string;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  durationSeconds: number;
  activityId: string;
  source: string;
}

interface PlanDayPlanned {
  type: string;
  description: string;
  targetDistance: number | null;
  targetElevation: number | null;
  targetDuration: number | null;
  changedAt?: string;
  changeReason?: string;
}

interface PlanDay {
  date: string;
  dayLabel: string;
  dayOfWeek: number;
  planned: PlanDayPlanned | null;
  actual: PlanDayActual | null;
  isPast: boolean;
  isToday: boolean;
}

interface PlanData {
  weekStart: string;
  weekEnd: string;
  days: PlanDay[];
  targetVolumeMeters?: number;
  targetElevationMeters?: number;
  adjustments?: string[];
  coachNotes?: string;
}

interface CoachMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  suggestionId?: string | null;
  createdAt: string;
}

interface CoachSuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
}

interface CoachChatProps {
  plan: PlanData | null;
  onPlanApplied: () => void;
  initialNotes?: string | null;
  initialNotesAt?: string | null;
}

// ── API helper ─────────────────────────────────────────

async function coachApi(action: string, body?: Record<string, unknown>) {
  const res = await fetch("/api/dashboard/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Component ──────────────────────────────────────────

export default function CoachChat({ plan, onPlanApplied, initialNotes, initialNotesAt }: CoachChatProps) {
  const t = useTranslations("coach");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [suggestions, setSuggestions] = useState<CoachSuggestion[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Scroll to bottom on new messages — but only if the user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, userScrolledUp]);

  // Track whether the user has scrolled up (to avoid auto-scrolling away from history)
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setUserScrolledUp(!isNearBottom);
  }, []);

  // Load active conversation on mount
  useEffect(() => {
    loadActiveConversation();
  }, []);

  async function loadActiveConversation() {
    try {
      const data = await coachApi("list-conversations");
      const active = data.conversations?.find((c: { status: string }) => c.status === "active");

      if (active) {
        setConversationId(active.id);
        const convData = await coachApi("get-conversation", { conversationId: active.id });
        if (convData.conversation) {
          setMessages(convData.conversation.messages.filter((m: CoachMessage) => m.role !== "system"));
          setSuggestions(convData.conversation.suggestions.filter((s: CoachSuggestion) => s.status === "pending"));
        }
      }
    } catch { /* No conversation yet — that's fine */ }
    setInitialized(true);
  }

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const data = await coachApi("analyze", { conversationId });
      setConversationId(data.conversationId);
      setMessages([{ id: "analysis", role: "assistant", content: data.analysis, createdAt: new Date().toISOString() }]);
      if (data.suggestions) setSuggestions(data.suggestions);
      if (data.guardrailViolations?.length > 0) {
        setError(`⚠️ ${data.guardrailViolations.join("; ")}`);
      }
      // Refresh dashboard — coach notes and suggestions updated
      onPlanApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    }
    setAnalyzing(false);
  }, [conversationId]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;

    // Start a conversation if needed
    let cid = conversationId;
    if (!cid) {
      try {
        const newConv = await coachApi("new-conversation");
        cid = newConv.conversationId;
        setConversationId(cid);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start conversation");
        return;
      }
    }

    const userMessage = input.trim();
    setInput("");
    setLoading(true);
    setError(null);

    // Optimistically add user message
    const userMsg: CoachMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const data = await coachApi("chat", { conversationId: cid, message: userMessage });
      const assistantMsg: CoachMessage = {
        id: data.messages?.[1]?.id || `assistant-${Date.now()}`,
        role: "assistant",
        content: data.response,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (data.suggestions?.length > 0) {
        setSuggestions((prev) => [...prev, ...data.suggestions]);
      }
      // Refresh dashboard — the LLM may have created goals or updated the plan
      onPlanApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
      // Remove the optimistically added message
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
    }
    setLoading(false);
  }, [input, loading, conversationId]);

  const applySuggestion = useCallback(async (suggestionId: string) => {
    try {
      const data = await coachApi("apply-suggestion", { suggestionId });
      if (data.success) {
        setFeedback(t("applied"));
        setTimeout(() => setFeedback(null), 4000);
        setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
        // Trigger full dashboard reload — goals, plan, readiness etc.
        onPlanApplied();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply suggestion");
    }
  }, [onPlanApplied, t]);

  const dismissSuggestion = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  }, []);

  const summarize = useCallback(async () => {
    if (!conversationId || messages.length < 2) return;
    setSummarizing(true);
    setError(null);
    try {
      const data = await coachApi("summarize", { conversationId });
      if (data.summary) {
        // Reload the conversation — the backend replaced all messages
        // with just the summarized version
        const convData = await coachApi("get-conversation", { conversationId });
        if (convData.conversation) {
          setMessages(convData.conversation.messages.filter((m: CoachMessage) => m.role !== "system"));
          setSuggestions([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summarization failed");
    }
    setSummarizing(false);
  }, [conversationId, messages.length]);

  const clearAll = useCallback(async () => {
    try {
      const data = await coachApi("clear-context");
      setConversationId(data.conversationId);
      setMessages([]);
      setSuggestions([]);
      setInput("");
      setError(null);
      setConfirmClear(false);
      // Refresh dashboard — plans are wiped
      onPlanApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear context");
      setConfirmClear(false);
    }
  }, [onPlanApplied]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Render states ──────────────────────────────────

  if (!initialized) {
    return (
      <Card className="mb-6">
        <CardContent className="py-6 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">{t("loading")}</p>
        </CardContent>
      </Card>
    );
  }

  const hasMessages = messages.length > 0;
  const showInitialState = !hasMessages && !analyzing;

  return (
    <Card className="mb-6">
      <CardContent className="py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
              {t("title")}
            </h2>
            {initialNotesAt && !hasMessages && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(initialNotesAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={confirmClear ? "destructive" : "ghost"}
                onClick={() => {
                  if (confirmClear) {
                    clearAll();
                  } else {
                    setConfirmClear(true);
                    setTimeout(() => setConfirmClear(false), 3000);
                  }
                }}
                disabled={loading || analyzing}
                title={t("resetPlanTitle")}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="ml-1 hidden sm:inline">{confirmClear ? t("resetPlanConfirm") : t("resetPlan")}</span>
              </Button>
              {hasMessages && messages.length >= 2 && (
                <Button size="sm" variant="ghost" onClick={summarize} disabled={summarizing}>
                  {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span className="ml-1 hidden sm:inline">{t("summarize")}</span>
                </Button>
              )}
              <Button size="sm" onClick={analyze} disabled={analyzing}>
                {analyzing ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Analyzing...</>
                ) : (
                  <><Wand2 className="h-4 w-4 mr-1" /> {t("analyze")}</>
                )}
              </Button>
            </div>
            {/* Confirmation explanation */}
            {confirmClear && (
              <p className="text-[11px] text-destructive text-right leading-tight">{t("resetPlanDetail")}</p>
            )}
          </div>
        </div>

        {/* Initial state — no messages yet */}
        {showInitialState && (
          <>
            {initialNotes ? (
              <div className="rounded-lg border bg-primary/5 p-4 mb-4">
                <p className="text-sm whitespace-pre-line leading-relaxed">{initialNotes}</p>
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <Brain className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>{t("clickToAnalyze")}</p>
                <p className="text-xs mt-1">You can then ask follow-up questions or request plan adjustments.</p>
              </div>
            )}
          </>
        )}

        {/* Message thread */}
        {hasMessages && (
          <div ref={messagesContainerRef} onScroll={handleScroll} className="space-y-3 mb-4 max-h-[500px] overflow-y-auto">
            {/* Suggestion cards pinned at top */}
            {suggestions.filter((s) => s.status === "pending").length > 0 && (
              <div className="space-y-2 mb-4">
                {suggestions.filter((s) => s.status === "pending").map((s) => (
                  <div key={s.id} className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Badge variant="outline" className="text-[10px] mb-1">{s.type.replace(/_/g, " ")}</Badge>
                        <p className="text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => applySuggestion(s.id)}>
                        <Check className="h-3 w-3 mr-1" /> Apply
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dismissSuggestion(s.id)}>
                        <X className="h-3 w-3 mr-1" /> Dismiss
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : msg.id === "summary"
                      ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                      : "bg-muted"
                }`}>
                  <p className="whitespace-pre-line leading-relaxed">{msg.content}</p>
                  {msg.id === "summary" && (
                    <p className="text-[10px] text-muted-foreground mt-1 italic">{t("conversationSummary")}</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("thinking")}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded mb-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Success feedback */}
        {feedback && (
          <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 dark:bg-green-950/30 dark:text-green-400 border border-green-200 dark:border-green-800 p-3 rounded mb-3">
            <Check className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Input bar */}
        {(hasMessages || initialNotes) && (
          <div className="flex gap-2 mt-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-resize
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder={t("placeholder")}
              disabled={loading || analyzing}
              rows={1}
              className="flex-1 min-h-[40px] max-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
            <Button size="icon" onClick={sendMessage} disabled={loading || analyzing || !input.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
        {hasMessages && (
          <p className="text-[10px] text-muted-foreground text-center mt-1">{t("sendHint")}</p>
        )}
      </CardContent>
    </Card>
  );
}
