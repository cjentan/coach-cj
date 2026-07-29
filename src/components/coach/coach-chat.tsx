"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Brain, Sparkles, Wand2, Check, X, AlertCircle, Trash2, Target } from "lucide-react";
import { type PageContext } from "@/lib/page-context";
import type { PlanProposal, PlanDay, PlanDayPlanned, PlanDayActual, PlanWeekData } from "@/lib/training-plan-types";
import PlanProposalCard from "@/components/coach/plan-proposal-card";
import TrainingPlanSummaryCard, { type PhaseSummary } from "@/components/coach/training-plan-summary-card";
import { notifyPlanUpdated } from "@/lib/coach-chat-events";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CoachInitialState from "@/components/coach/coach-initial-state";

// ── Types ──────────────────────────────────────────────

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

interface PhaseProgress {
  phaseName: string;
  phaseOrder: number;
  phaseGoal: string;
  weekCount: number;
  weeks: string[];
  sessionCount: number;
}

interface StatusEntry {
  id: number;
  text: string;
  timestamp: number;
}

interface SaveProgressInfo {
  phaseName: string;
  weekCurrent: number;
  weekTotal: number;
  message: string;
}

interface CoachChatProps {
  plan?: PlanWeekData | null;
  onPlanApplied?: () => void;
  initialNotes?: string | null;
  initialNotesAt?: string | null;
  variant?: "default" | "floating";
  onClose?: () => void;
  pageContext?: PageContext | null;
  /** When set to 'start-interview', auto-starts the plan interview on next render. */
  pendingAction?: string | null;
  /** Called after the pending action has been handled. */
  onPendingActionHandled?: () => void;
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

/**
 * SSE streaming variant of coachApi.
 * Calls the given action, delivers progress events to onProgress,
 * and resolves with the complete payload on the "complete" event.
 * Rejects on HTTP error or "error" SSE event.
 */
async function coachApiStream(
  action: string,
  body: Record<string, unknown>,
  onProgress: (data: unknown) => void,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const res = await fetch("/api/dashboard/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Response body is not readable");

  const decoder = new TextDecoder();
  let buffer = "";

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    async function read() {
      try {
        let currentEvent = "";
        let currentData = "";

        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";

          for (const line of parts) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "" && currentEvent && currentData) {
              // Empty line delimits an SSE event
              try {
                const parsed = JSON.parse(currentData);
                if (currentEvent === "complete") {
                  resolve(parsed);
                  return;
                } else if (currentEvent === "error") {
                  reject(new Error((parsed as { error?: string }).error || "Unknown error"));
                  return;
                } else {
                  onProgress(parsed);
                }
              } catch {
                // Skip malformed events
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } catch (err) {
        reject(err);
      }
    }
    read();
  });
}

// ── Component ──────────────────────────────────────────

export default function CoachChat({
  plan,
  onPlanApplied,
  initialNotes,
  initialNotesAt,
  variant = "default",
  onClose,
  pageContext,
  pendingAction,
  onPendingActionHandled,
}: CoachChatProps) {
  const t = useTranslations("coach");
  const locale = useLocale();
  const isFloating = variant === "floating";
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
  const [phaseProgress, setPhaseProgress] = useState<PhaseProgress[]>([]);
  const [statusFeed, setStatusFeed] = useState<StatusEntry[]>([]);
  const [saveProgress, setSaveProgress] = useState<SaveProgressInfo | null>(null);
  const [interviewStarting, setInterviewStarting] = useState(false);
  const [currentProposal, setCurrentProposal] = useState<PlanProposal | null>(null);
  const [editedProposal, setEditedProposal] = useState<PlanProposal | null>(null);
  const [completedPhases, setCompletedPhases] = useState<PhaseSummary[]>([]);
  const [internalPlan, setInternalPlan] = useState<PlanWeekData | null>(null);
  const [internalPlanLoading, setInternalPlanLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const feedIdRef = useRef(0);
  const pendingMessageRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // In floating mode, fetch plan data internally if no plan prop provided
  const effectivePlan = isFloating && plan === undefined ? internalPlan : plan;
  const hasExistingPlan = effectivePlan
    ? (effectivePlan.totalPlanCount ?? 0) > 0
    : false;

  // Internal plan fetcher
  const fetchInternalPlan = useCallback(async () => {
    if (!isFloating) return;
    setInternalPlanLoading(true);
    try {
      const res = await fetch("/api/dashboard/plan?weekOffset=0");
      const data = res.ok ? await res.json() : null;
      setInternalPlan(data);
    } catch {
      // Silently fail — plan-specific features just won't show
    } finally {
      setInternalPlanLoading(false);
    }
  }, [isFloating]);

  // Fetch internal plan on mount for floating mode
  useEffect(() => {
    if (isFloating && plan === undefined) {
      fetchInternalPlan();
    }
  }, [isFloating, plan, fetchInternalPlan]);

  // Wrapper around onPlanApplied that also refreshes internal plan and notifies plan-updated event
  const handlePlanApplied = useCallback(() => {
    onPlanApplied?.();
    if (isFloating && plan === undefined) {
      fetchInternalPlan();
    }
    notifyPlanUpdated();
  }, [onPlanApplied, isFloating, plan, fetchInternalPlan]);

  // Scroll to bottom on new messages — but only if the user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, userScrolledUp, completedPhases, currentProposal]);

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

  // Abort in-flight SSE request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Clear stale suggestions when plan loads and no training plan exists
  useEffect(() => {
    if (!hasExistingPlan && suggestions.length > 0) {
      setSuggestions([]);
    }
  }, [hasExistingPlan, suggestions]);

  // Auto-start interview when the parent requests it (e.g. from the training plan page).
  // NOTE: we intentionally do NOT check hasExistingPlan here — internalPlan may be stale
  // (the component stays mounted across panel open/close via CSS translate), so a plan
  // that was reset on another page still lingers in internalPlan. The caller
  // (openCoachChat(true)) is only invoked when the server-side plan is confirmed empty.
  useEffect(() => {
    if (pendingAction !== "start-interview") return;
    if (interviewStarting) return;

    // Clear stale state before starting
    if (isFloating && plan === undefined) {
      setInternalPlan(null);
    }

    startPlanInterview();
    // Clear the pending action so the effect doesn't re-trigger (interviewStarting
    // will be set synchronously inside startPlanInterview).
    onPendingActionHandled?.();
  }, [pendingAction, interviewStarting, onPendingActionHandled, isFloating, plan]);

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
      const data = await coachApi("analyze", { conversationId, pageContext, locale });
      setConversationId(data.conversationId);
      setMessages([{ id: "analysis", role: "assistant", content: data.analysis, createdAt: new Date().toISOString() }]);
      if (data.suggestions) setSuggestions(data.suggestions);
      if (data.guardrailViolations?.length > 0) {
        setError(`⚠️ ${data.guardrailViolations.join("; ")}`);
      }
      // Refresh dashboard — coach notes and suggestions updated
      handlePlanApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    }
    setAnalyzing(false);
  }, [conversationId, pageContext, handlePlanApplied]);

  async function startPlanInterview() {
    setInterviewStarting(true);
    setError(null);
    setPhaseProgress([]);
    setStatusFeed([]);
    setSaveProgress(null);
    setMessages([]);
    setSuggestions([]);
    setConfirmClear(false);
    setCurrentProposal(null);
    setCompletedPhases([]);
    try {
      // Start a fresh conversation with interview mode
      const newConv = await coachApi("new-conversation");
      const cid = newConv.conversationId;
      setConversationId(cid);

      // Use streaming so the user sees progress updates during data gathering + LLM call
      let feedId = 0;
      const data = await coachApiStream("start-interview", { locale, pageContext },
        (eventData) => {
          const pd = eventData as Record<string, unknown>;
          if (pd.type === "status") {
            setStatusFeed((prev) => [...prev, {
              id: feedId++,
              text: pd.message as string,
              timestamp: Date.now(),
            }]);
          }
        },
      );

      // Use the interview's conversation ID (startInterview creates its own conversation)
      const interviewConvId = data.conversationId as string;
      if (interviewConvId) {
        setConversationId(interviewConvId);
      }

      // Store structured proposal data for card display (only when a goal race exists)
      if (data.proposal) {
        setCurrentProposal(data.proposal as PlanProposal);
      } else {
        setCurrentProposal(null);
      }

      // Show the AI's response as a message
      const assistantMsg: CoachMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.response as string,
        createdAt: new Date().toISOString(),
      };
      setMessages([assistantMsg]);

      // If no goal race exists, flag it so we can show a set-goal prompt
      if (data.needsGoal) {
        // Add a hint to set a goal — the conversation is ready for the user to describe their goal
        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Interview failed");
    } finally {
      setInterviewStarting(false);
    }
  }

  const sendMessage = useCallback(async () => {
    // Check for programmatic message (from Approve button) first
    const text = pendingMessageRef.current || input.trim();
    pendingMessageRef.current = null;
    if (!text || loading) return;

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

    const userMessage = text;
    setInput("");
    setCompletedPhases([]);
    setLoading(true);
    setError(null);
    setPhaseProgress([]);
    setStatusFeed([]);
    setSaveProgress(null);

    // Optimistically add user message
    const userMsg: CoachMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // Try SSE streaming first
      let finalResponse = "";
      let suggestions: CoachSuggestion[] = [];

      const streamResult = await coachApiStream(
        "chat-stream",
        { conversationId: cid, message: userMessage, pageContext, locale },
        (data) => {
          const pd = data as Record<string, unknown>;
          const type = pd.type as string;
          const id = feedIdRef.current++;
          switch (type) {
            case "phase_complete":
              setPhaseProgress((prev) => [...prev, pd as unknown as PhaseProgress]);
              break;
            case "status":
              setStatusFeed((prev) => [...prev, { id, text: pd.message as string, timestamp: Date.now() }]);
              break;
            case "tool_call": {
              const tool = pd.tool as string;
              let text = `🔧 ${tool}`;
              if (pd.phaseName) text += ` — ${pd.phaseName}`;
              if (pd.action) text += ` (${pd.action})`;
              setStatusFeed((prev) => [...prev, { id, text, timestamp: Date.now() }]);
              break;
            }
            case "progress":
              setSaveProgress({
                phaseName: pd.phaseName as string,
                weekCurrent: pd.weekCurrent as number,
                weekTotal: pd.weekTotal as number,
                message: pd.message as string,
              });
              break;
          }
        },
        abortController.signal
      );

      finalResponse = (streamResult.response as string) || "";
      suggestions = ((streamResult.suggestions as unknown[]) || []).map(
        (s) => s as CoachSuggestion
      );

      // Capture updated proposal from chat response (e.g. after plan adjustments)
      const rawProposal = streamResult.proposal as Record<string, unknown> | undefined;
      if (rawProposal) {
        setCurrentProposal(rawProposal as unknown as PlanProposal);
      }

      if (finalResponse) {
        const assistantMsg: CoachMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: finalResponse,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
      if (suggestions.length > 0) {
        setSuggestions((prev) => [...prev, ...suggestions]);
      }
      handlePlanApplied();
    } catch {
      // Fallback to JSON mode if SSE fails
      console.error("[COACH-CHAT] SSE failed, falling back to JSON chat");
      try {
        const data = await coachApi("chat", { conversationId: cid, message: userMessage, pageContext, locale });
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
        handlePlanApplied();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chat failed");
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setPhaseProgress([]);
      setStatusFeed([]);
      setSaveProgress(null);
    }
  }, [input, loading, conversationId, handlePlanApplied, pageContext]);

  // ── Track edits to the proposal card ─────────────────

  const handleProposalChange = useCallback((updated: PlanProposal) => {
    setEditedProposal(updated);
  }, []);

  // ── Build the full plan (approve) ────────────────────

  const handleApproveProposal = useCallback(async () => {
    if (!conversationId) return;

    setCurrentProposal(null);
    setCompletedPhases([]);
    setLoading(true);
    setPhaseProgress([]);
    setStatusFeed([]);
    setSaveProgress(null);
    setError(null);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const body: Record<string, unknown> = { conversationId };
      // If the user made edits before approving, pass them along
      if (editedProposal) {
        body.proposalOverrides = {
          proposedStartDate: editedProposal.proposedStartDate,
          phases: editedProposal.phases.map((p) => ({ name: p.name, weeks: p.weeks })),
          peakVolume: editedProposal.peakVolume,
        };
      }

      const result = await coachApiStream(
        "approve-plan",
        body,
        (data) => {
          const pd = data as Record<string, unknown>;
          const id = feedIdRef.current++;
          switch (pd.type as string) {
            case "status":
              setStatusFeed((prev) => [...prev, { id, text: pd.message as string, timestamp: Date.now() }]);
              break;
            case "tool_call": {
              let text = `🔧 ${pd.tool as string}`;
              if (pd.phaseName) text += ` — ${pd.phaseName as string}`;
              setStatusFeed((prev) => [...prev, { id, text, timestamp: Date.now() }]);
              break;
            }
            case "progress":
              setSaveProgress({
                phaseName: pd.phaseName as string,
                weekCurrent: pd.weekCurrent as number,
                weekTotal: pd.weekTotal as number,
                message: pd.message as string,
              });
              break;
            case "phase_complete":
              setPhaseProgress((prev) => [...prev, pd as unknown as PhaseProgress]);
              break;
          }
        },
        abortController.signal
      );

      if (result.response) {
        const assistantMsg: CoachMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: result.response as string,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }

      // Store phases for the summary card
      const rawPhases = result.phases as Array<Record<string, unknown>> | undefined;
      if (rawPhases && rawPhases.length > 0) {
        const mapped: PhaseSummary[] = rawPhases.map((p) => ({
          name: (p.name as string) || "",
          weekCount: (p.weekCount as number) || 0,
          sessionCount: (p.sessionCount as number) || 0,
          phaseOrder: p.phaseOrder as number | undefined,
        }));
        setCompletedPhases(mapped);
      }

      handlePlanApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build plan");
    } finally {
      abortRef.current = null;
      setLoading(false);
      setPhaseProgress([]);
      setStatusFeed([]);
      setSaveProgress(null);
    }
  }, [conversationId, handlePlanApplied, editedProposal]);

  const handleAdjustProposal = useCallback(() => {
    setCompletedPhases([]);
    // Focus the input and set a starter prompt
    setInput("Can we adjust the plan? I'd like to...");
    inputRef.current?.focus();
  }, []);

  const applySuggestion = useCallback(async (suggestionId: string) => {
    try {
      const data = await coachApi("apply-suggestion", { suggestionId });
      if (data.success) {
        setFeedback(t("applied"));
        setTimeout(() => setFeedback(null), 4000);
        setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
        // Trigger full dashboard reload — goals, plan, readiness etc.
        handlePlanApplied();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply suggestion");
    }
  }, [handlePlanApplied, t]);

  const dismissSuggestion = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  }, []);

  const summarize = useCallback(async () => {
    if (!conversationId || messages.length < 2) return;
    setSummarizing(true);
    setError(null);
    try {
      const data = await coachApi("summarize", { conversationId, locale });
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
      setPhaseProgress([]);
      setInput("");
      setError(null);
      setConfirmClear(false);
      // Refresh dashboard — plans are wiped
      handlePlanApplied();
      notifyPlanUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear context");
      setConfirmClear(false);
    }
  }, [handlePlanApplied]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /** Send a pre-filled quick-action message (bypasses the input textarea). */
  const handleQuickActionMessage = useCallback((text: string) => {
    pendingMessageRef.current = text;
    sendMessage();
  }, [sendMessage]);

  /** Focus the input bar — used by the "Ask a question" quick action. */
  const focusInput = useCallback(() => {
    // Small delay so the component has a chance to settle (e.g. after open animation)
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // ── Render states ──────────────────────────────────

  if (!initialized) {
    if (isFloating) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground ml-2">{t("loading")}</p>
        </div>
      );
    }
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

  // ── Floating mode uses a different outer layout ───────
  if (isFloating) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                {t("title")}
              </h2>
              {initialNotesAt && !hasMessages && (
                <span className="text-[0.625rem] text-muted-foreground">
                  {new Date(initialNotesAt).toLocaleDateString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {hasMessages && messages.length >= 2 && (
                <Button size="sm" variant="ghost" onClick={summarize} disabled={summarizing} title={t("summarizeTitle")}>
                  {summarizing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                  {t("summarize")}
                </Button>
              )}
              <Button size="sm" onClick={analyze} disabled={analyzing} title={t("analyzeTitle")}>
                {analyzing ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {t("analyzing")}</>
                ) : (
                  <><Wand2 className="h-4 w-4 mr-1" /> {t("analyze")}</>
                )}
              </Button>
            </div>
          </div>
          {/* Initial state — page-aware greeting + quick actions */}
          <CoachInitialState
            pageContext={pageContext}
            hasExistingPlan={hasExistingPlan}
            hasMessages={hasMessages}
            initialNotes={initialNotes}
            onAnalyze={analyze}
            onStartPlanInterview={startPlanInterview}
            onSendMessage={handleQuickActionMessage}
            interviewStarting={interviewStarting}
            onAskQuestion={focusInput}
          />

          {/* Message thread */}
          {hasMessages && (
            <div ref={messagesContainerRef} onScroll={handleScroll} className="space-y-3 mb-4 overflow-y-auto">
              {/* Suggestion cards pinned at top — only when a plan exists */}
              {hasExistingPlan && suggestions.filter((s) => s.status === "pending").length > 0 && (
                <div className="space-y-2 mb-4">
                  {suggestions.filter((s) => s.status === "pending").map((s) => (
                    <div key={s.id} className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Badge variant="outline" className="text-[0.625rem] mb-1">{s.type.replace(/_/g, " ")}</Badge>
                          <p className="text-sm font-medium">{s.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => applySuggestion(s.id)}>
                          <Check className="h-3 w-3 mr-1" /> {t("apply")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dismissSuggestion(s.id)}>
                          <X className="h-3 w-3 mr-1" /> {t("dismiss")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Plan proposal card (shown once after interview) */}
              {currentProposal && !loading && (
                <div className="flex justify-start">
                  <PlanProposalCard
                    proposal={currentProposal}
                    editable
                    onProposalChange={handleProposalChange}
                    onApprove={handleApproveProposal}
                    onAdjust={handleAdjustProposal}
                  />
                </div>
              )}

              {/* Completed plan summary card (shown after plan is built) */}
              {completedPhases.length > 0 && (
                <div className="flex justify-start">
                  <TrainingPlanSummaryCard
                    totalWeeks={completedPhases.reduce((s, p) => s + p.weekCount, 0)}
                    phases={completedPhases}
                  />
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
                    <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.id === "summary" && (
                      <p className="text-[0.625rem] text-muted-foreground mt-1 italic">{t("conversationSummary")}</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Loading indicator */}
          {(loading || interviewStarting) && (
            <div className="mb-4">
              {(statusFeed.length > 0 || saveProgress) && (
                <div className="space-y-1 mb-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">{t("activity")}</p>
                  <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                    {statusFeed.slice(-8).map((entry) => (
                      <div key={entry.id} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0 mt-0.5 text-[0.625rem]">💬</span>
                        <span className="leading-relaxed">{entry.text}</span>
                      </div>
                    ))}
                  </div>
                  {saveProgress && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 p-2 rounded border border-primary/10 bg-primary/5">
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                      <span className="flex-1">{saveProgress.message}</span>
                      <Badge variant="outline" className="text-[0.625rem] shrink-0">{saveProgress.weekCurrent}/{saveProgress.weekTotal}</Badge>
                    </div>
                  )}
                </div>
              )}
              {phaseProgress.length > 0 && (
                <div className="space-y-2 mb-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("trainingPlanProgress")}</p>
                  {phaseProgress.map((p, i) => (
                    <div key={i} className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                          <Check className="h-3 w-3 text-green-600" />
                        </div>
                        <span className="font-medium">{p.phaseName}</span>
                        <Badge variant="outline" className="ml-auto text-[0.625rem]">{t("phase", { phaseOrder: p.phaseOrder })}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 ml-7">{p.phaseGoal}</p>
                      <p className="text-xs text-muted-foreground ml-7">{t("weeksCount", { count: p.weekCount })} · {t("sessionsCount", { count: p.sessionCount })}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                <Loader2 className="h-4 w-4 animate-spin" />
                {statusFeed.length === 0 && !saveProgress && phaseProgress.length === 0 ? t("thinking") : t("processing")}
              </div>
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
        </div>

        {/* Input bar — pinned to bottom in floating mode */}
        <div className="px-4 pb-4 pt-2 border-t">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder={t("placeholder")}
              disabled={loading || analyzing || interviewStarting}
              rows={1}
              className="flex-1 min-h-[40px] max-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
            <Button size="icon" onClick={sendMessage} disabled={loading || analyzing || interviewStarting || !input.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {hasMessages && (
            <p className="text-[0.625rem] text-muted-foreground text-center mt-1">{t("sendHint")}</p>
          )}
        </div>
      </div>
    );
  }

  // ── Default mode (inline card) ─────────────────────────
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
              <span className="text-[0.625rem] text-muted-foreground">
                {new Date(initialNotesAt).toLocaleDateString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              {hasMessages && messages.length >= 2 && (
                <Button size="sm" variant="ghost" onClick={summarize} disabled={summarizing}>
                  {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span className="ml-1 hidden sm:inline">{t("summarize")}</span>
                </Button>
              )}
              <Button size="sm" onClick={analyze} disabled={analyzing}>
                {analyzing ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {t("analyzing")}</>
                ) : (
                  <><Wand2 className="h-4 w-4 mr-1" /> {t("analyze")}</>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Initial state — page-aware greeting + quick actions */}
        <CoachInitialState
          pageContext={pageContext}
          hasExistingPlan={hasExistingPlan}
          hasMessages={hasMessages}
          initialNotes={initialNotes}
          onAnalyze={analyze}
          onStartPlanInterview={startPlanInterview}
          onSendMessage={handleQuickActionMessage}
          interviewStarting={interviewStarting}
          onAskQuestion={focusInput}
        />

        {/* Message thread */}
        {hasMessages && (
          <div ref={messagesContainerRef} onScroll={handleScroll} className="space-y-3 mb-4 max-h-[500px] overflow-y-auto">
            {hasExistingPlan && suggestions.filter((s) => s.status === "pending").length > 0 && (
              <div className="space-y-2 mb-4">
                {suggestions.filter((s) => s.status === "pending").map((s) => (
                  <div key={s.id} className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Badge variant="outline" className="text-[0.625rem] mb-1">{s.type.replace(/_/g, " ")}</Badge>
                        <p className="text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => applySuggestion(s.id)}>
                        <Check className="h-3 w-3 mr-1" /> {t("apply")}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dismissSuggestion(s.id)}>
                        <X className="h-3 w-3 mr-1" /> {t("dismiss")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Plan proposal card (shown once after interview) */}
            {currentProposal && !loading && (
              <div className="flex justify-start mb-3">
                <PlanProposalCard
                  proposal={currentProposal}
                  editable
                  onProposalChange={handleProposalChange}
                  onApprove={handleApproveProposal}
                  onAdjust={handleAdjustProposal}
                />
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : msg.id === "summary"
                      ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                      : "bg-muted"
                }`}>
                  <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.id === "summary" && (
                    <p className="text-[0.625rem] text-muted-foreground mt-1 italic">{t("conversationSummary")}</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div className="mb-4">
            {(statusFeed.length > 0 || saveProgress) && (
              <div className="space-y-1 mb-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">{t("activity")}</p>
                <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                  {statusFeed.slice(-8).map((entry) => (
                    <div key={entry.id} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <span className="shrink-0 mt-0.5 text-[0.625rem]">💬</span>
                      <span className="leading-relaxed">{entry.text}</span>
                    </div>
                  ))}
                </div>
                {saveProgress && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 p-2 rounded border border-primary/10 bg-primary/5">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    <span className="flex-1">{saveProgress.message}</span>
                    <Badge variant="outline" className="text-[0.625rem] shrink-0">{saveProgress.weekCurrent}/{saveProgress.weekTotal}</Badge>
                  </div>
                )}
              </div>
            )}
            {phaseProgress.length > 0 && (
              <div className="space-y-2 mb-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Training Plan Progress</p>
                {phaseProgress.map((p, i) => (
                  <div key={i} className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                        <Check className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="font-medium">{p.phaseName}</span>
                      <Badge variant="outline" className="ml-auto text-[0.625rem]">Phase {p.phaseOrder}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-7">{p.phaseGoal}</p>
                    <p className="text-xs text-muted-foreground ml-7">{p.weekCount} week{p.weekCount !== 1 ? "s" : ""} · {p.sessionCount} session{p.sessionCount !== 1 ? "s" : ""}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              {statusFeed.length === 0 && !saveProgress && phaseProgress.length === 0 ? t("thinking") : "Processing..."}
            </div>
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
        <div className="flex gap-2 mt-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("placeholder")}
            disabled={loading || analyzing || interviewStarting}
            rows={1}
            className="flex-1 min-h-[40px] max-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
          />
          <Button size="icon" onClick={sendMessage} disabled={loading || analyzing || interviewStarting || !input.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {hasMessages && (
          <p className="text-[0.625rem] text-muted-foreground text-center mt-1">{t("sendHint")}</p>
        )}
      </CardContent>
    </Card>
  );
}
