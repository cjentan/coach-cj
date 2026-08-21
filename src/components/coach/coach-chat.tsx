"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { type PageContext } from "@/lib/page-context";
import type { PlanProposal, PlanWeekData } from "@/lib/training-plan-types";
import { notifyPlanUpdated, notifyActivityAnalysisSaved } from "@/lib/coach-chat-events";
import { isActivityAnalysisRequest } from "@/lib/activity-analysis-intent";
import CoachInitialState from "@/components/coach/coach-initial-state";
import CoachMessageList from "@/components/coach/coach-message-list";
import type { CoachMessage, CoachSuggestion, PhaseProgress, StatusEntry, SaveProgressInfo, SaveAnalysisPrompt } from "@/components/coach/coach-message-list";
import type { PhaseSummary } from "@/components/coach/training-plan-summary-card";
import CoachInputBar from "@/components/coach/coach-input-bar";
import CoachChatHeader from "@/components/coach/coach-chat-header";
import { coachApi, coachApiStream, type CoachT } from "@/components/coach/coach-api";

// ── Component ──────────────────────────────────────────

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
  const [pendingSave, setPendingSave] = useState<(SaveAnalysisPrompt & { analysis: string }) | null>(null);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const feedIdRef = useRef(0);
  const pendingMessageRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showContextOffer, setShowContextOffer] = useState(false);
  const contextOfferStartedRef = useRef(false);

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

  const loadActiveConversation = useCallback(async () => {
    try {
      const data = await coachApi("list-conversations", undefined, t);
      const active = data.conversations?.find((c: { status: string }) => c.status === "active");

      if (active) {
        setConversationId(active.id);
        const convData = await coachApi("get-conversation", { conversationId: active.id }, t);
        if (convData.conversation) {
          setMessages(convData.conversation.messages.filter((m: CoachMessage) => m.role !== "system"));
          setSuggestions(convData.conversation.suggestions.filter((s: CoachSuggestion) => s.status === "pending"));
        }
      }
    } catch { /* No conversation yet — that's fine */ }
    setInitialized(true);
  }, [t]);

  // Load active conversation on mount
  useEffect(() => {
    loadActiveConversation();
  }, [loadActiveConversation]);

  // Abort in-flight SSE request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Cap messages at 100 to prevent unbounded memory growth
  useEffect(() => {
    if (messages.length > 100) {
      setMessages(prev => prev.length > 100 ? prev.slice(-80) : prev);
    }
  }, [messages.length]);

  // Clear stale suggestions when plan loads and no training plan exists
  useEffect(() => {
    if (!hasExistingPlan && suggestions.length > 0) {
      setSuggestions([]);
    }
  }, [hasExistingPlan, suggestions]);

  const startPlanInterview = useCallback(async () => {
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
    setShowContextOffer(false);
    contextOfferStartedRef.current = false;
    try {
      // Start a fresh conversation with interview mode
      const newConv = await coachApi("new-conversation", undefined, t);
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
        t,
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

      // Offer to build the athlete's training context if they don't have one saved yet
      setShowContextOffer(!!data.needsContext);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("interviewFailed"));
    } finally {
      setInterviewStarting(false);
    }
  }, [locale, pageContext, t]);

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
  }, [pendingAction, interviewStarting, onPendingActionHandled, isFloating, plan, startPlanInterview]);

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const data = await coachApi("analyze", { conversationId, pageContext, locale }, t);
      setConversationId(data.conversationId);
      setMessages([{ id: "analysis", role: "assistant", content: data.analysis, createdAt: new Date().toISOString() }]);
      if (data.suggestions) setSuggestions(data.suggestions);
      if (data.guardrailViolations?.length > 0) {
        setError(`⚠️ ${data.guardrailViolations.join("; ")}`);
      }
      // Refresh dashboard — coach notes and suggestions updated
      handlePlanApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("analysisFailed"));
    }
    setAnalyzing(false);
  }, [conversationId, pageContext, handlePlanApplied, t, locale]);

  const sendMessage = useCallback(async () => {
    // Check for programmatic message (from Approve button) first
    const text = pendingMessageRef.current || input.trim();
    pendingMessageRef.current = null;
    if (!text || loading) return;

    // Start a conversation if needed
    let cid = conversationId;
    if (!cid) {
      try {
        const newConv = await coachApi("new-conversation", undefined, t);
        cid = newConv.conversationId;
        setConversationId(cid);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("startFailed"));
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
      // Activity-analysis requests route through the structured dry-run flow,
      // which returns { activityId, activityName, analysis } for the save prompt.
      let analysisRouted = false;
      if (isActivityAnalysisRequest(userMessage)) {
        try {
          const data = await coachApi("analyze-activity-in-chat", {
            conversationId: cid, message: userMessage, pageContext, locale,
          }, t);
          const assistantMsg: CoachMessage = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: data.analysis,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          setPendingSave({
            activityId: data.activityId,
            activityName: data.activityName,
            messageId: assistantMsg.id,
            analysis: data.analysis,
          });
          analysisRouted = true;
          handlePlanApplied();
        } catch {
          // Resolution or analysis failed — fall through to the normal chat flow.
        }
      }

      if (!analysisRouted) {
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
          t,
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
      }
    } catch {
      // Fallback to JSON mode if SSE fails
      console.error("[COACH-CHAT] SSE failed, falling back to JSON chat");
      try {
        const data = await coachApi("chat", { conversationId: cid, message: userMessage, pageContext, locale }, t);
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
        setError(err instanceof Error ? err.message : t("chatFailed"));
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setPhaseProgress([]);
      setStatusFeed([]);
      setSaveProgress(null);
    }
  }, [input, loading, conversationId, handlePlanApplied, pageContext, locale, t]);

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
        t,
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
          workoutCount: (p.workoutCount as number | undefined),
          restCount: (p.restCount as number | undefined),
        }));
        setCompletedPhases(mapped);
      }

      handlePlanApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("buildPlanFailed"));
    } finally {
      abortRef.current = null;
      setLoading(false);
      setPhaseProgress([]);
      setStatusFeed([]);
      setSaveProgress(null);
    }
  }, [conversationId, handlePlanApplied, editedProposal, t]);

  const handleAdjustProposal = useCallback(() => {
    setCompletedPhases([]);
    // Focus the input and set a starter prompt
    setInput(t("adjustHint"));
    inputRef.current?.focus();
  }, [t]);

  const applySuggestion = useCallback(async (suggestionId: string) => {
    try {
      const data = await coachApi("apply-suggestion", { suggestionId }, t);
      if (data.success) {
        setFeedback(t("applied"));
        setTimeout(() => setFeedback(null), 4000);
        setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
        // Trigger full dashboard reload — goals, plan, readiness etc.
        handlePlanApplied();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("applySuggestionFailed"));
    }
  }, [handlePlanApplied, t]);

  const dismissSuggestion = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  }, []);

  // ── Save / discard an activity analysis from chat ────

  const saveAnalysis = useCallback(async () => {
    if (!pendingSave || savingAnalysis) return;
    setSavingAnalysis(true);
    const activityId = pendingSave.activityId;
    const activityName = pendingSave.activityName;
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachAnalysis: pendingSave.analysis }),
      });
      if (!res.ok) throw new Error(t("saveAnalysisFailed"));
      setPendingSave(null);
      setFeedback(t("savedToActivity", { name: activityName }));
      setTimeout(() => setFeedback(null), 4000);
      notifyActivityAnalysisSaved(activityId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveAnalysisFailed"));
    }
    setSavingAnalysis(false);
  }, [pendingSave, savingAnalysis, t]);

  const discardAnalysis = useCallback(() => {
    setPendingSave(null);
  }, []);

  const summarize = useCallback(async () => {
    if (!conversationId || messages.length < 2) return;
    setSummarizing(true);
    setError(null);
    try {
      const data = await coachApi("summarize", { conversationId, locale }, t);
      if (data.summary) {
        // Reload the conversation — the backend replaced all messages
        // with just the summarized version
        const convData = await coachApi("get-conversation", { conversationId }, t);
        if (convData.conversation) {
          setMessages(convData.conversation.messages.filter((m: CoachMessage) => m.role !== "system"));
          setSuggestions([]);
          setFeedback(t("summarized"));
          setTimeout(() => setFeedback(null), 4000);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("summarizeFailed"));
    }
    setSummarizing(false);
  }, [conversationId, messages.length, t, locale]);

  const clearAll = useCallback(async () => {
    try {
      const data = await coachApi("clear-context", undefined, t);
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
      setError(err instanceof Error ? err.message : t("clearContextFailed"));
      setConfirmClear(false);
    }
  }, [handlePlanApplied, t]);

  /** Send a pre-filled quick-action message (bypasses the input textarea). */
  const handleQuickActionMessage = useCallback((text: string) => {
    pendingMessageRef.current = text;
    sendMessage();
  }, [sendMessage]);

  /** Kick off the context-building Q&A through the normal chat tool loop. */
  const handleStartContextInterview = useCallback(() => {
    if (contextOfferStartedRef.current || loading) return;
    contextOfferStartedRef.current = true;
    setShowContextOffer(false);
    handleQuickActionMessage(t("contextOfferTrigger"));
  }, [handleQuickActionMessage, loading, t]);

  /** Dismiss the offer for this interview session only. */
  const handleSkipContextInterview = useCallback(() => {
    setShowContextOffer(false);
  }, []);

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
        {/* Header — pinned, stays visible while scrolling the chat */}
        <CoachChatHeader
          t={t}
          locale={locale}
          variant="floating"
          className="flex items-center justify-between px-4 py-2 border-b shrink-0"
          initialNotesAt={initialNotesAt}
          hasMessages={hasMessages}
          messageCount={messages.length}
          summarizing={summarizing}
          analyzing={analyzing}
          onSummarize={summarize}
          onAnalyze={analyze}
        />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
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

          {/* Messages + loading + error + feedback */}
          <CoachMessageList
            variant={variant}
            messages={messages}
            suggestions={suggestions}
            hasExistingPlan={hasExistingPlan}
            currentProposal={currentProposal}
            completedPhases={completedPhases}
            loading={loading}
            interviewStarting={interviewStarting}
            phaseProgress={phaseProgress}
            statusFeed={statusFeed}
            saveProgress={saveProgress}
            error={error}
            feedback={feedback}
            t={t}
            onApplySuggestion={applySuggestion}
            onDismissSuggestion={dismissSuggestion}
            onProposalChange={handleProposalChange}
            onApproveProposal={handleApproveProposal}
            onAdjustProposal={handleAdjustProposal}
            savePrompt={pendingSave}
            savingAnalysis={savingAnalysis}
            onSaveAnalysis={saveAnalysis}
            onDiscardAnalysis={discardAnalysis}
            showContextOffer={showContextOffer}
            onStartContextInterview={handleStartContextInterview}
            onSkipContextInterview={handleSkipContextInterview}
          />
        </div>

        {/* Input bar — pinned to bottom in floating mode */}
        <div className="px-4 pb-4 pt-2 border-t shrink-0">
          <CoachInputBar
            ref={inputRef}
            input={input}
            onInputChange={setInput}
            onSend={sendMessage}
            disabled={loading || analyzing || interviewStarting}
            placeholder={t("placeholder")}
            loading={loading}
          />
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
        <CoachChatHeader
          t={t}
          locale={locale}
          variant="default"
          className="flex items-center justify-between mb-4"
          initialNotesAt={initialNotesAt}
          hasMessages={hasMessages}
          messageCount={messages.length}
          summarizing={summarizing}
          analyzing={analyzing}
          onSummarize={summarize}
          onAnalyze={analyze}
        />

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

        {/* Messages + loading + error + feedback */}
        <CoachMessageList
          variant={variant}
          messages={messages}
          suggestions={suggestions}
          hasExistingPlan={hasExistingPlan}
          currentProposal={currentProposal}
          completedPhases={completedPhases}
          loading={loading}
          interviewStarting={interviewStarting}
          phaseProgress={phaseProgress}
          statusFeed={statusFeed}
          saveProgress={saveProgress}
          error={error}
          feedback={feedback}
          t={t}
          onApplySuggestion={applySuggestion}
          onDismissSuggestion={dismissSuggestion}
          onProposalChange={handleProposalChange}
          onApproveProposal={handleApproveProposal}
          onAdjustProposal={handleAdjustProposal}
          savePrompt={pendingSave}
          savingAnalysis={savingAnalysis}
          onSaveAnalysis={saveAnalysis}
          onDiscardAnalysis={discardAnalysis}
          showContextOffer={showContextOffer}
          onStartContextInterview={handleStartContextInterview}
          onSkipContextInterview={handleSkipContextInterview}
        />

        {/* Input bar */}
        <CoachInputBar
          ref={inputRef}
          className="mt-2"
          input={input}
          onInputChange={setInput}
          onSend={sendMessage}
          disabled={loading || analyzing || interviewStarting}
          placeholder={t("placeholder")}
          loading={loading}
        />
        {hasMessages && (
          <p className="text-[0.625rem] text-muted-foreground text-center mt-1">{t("sendHint")}</p>
        )}
      </CardContent>
    </Card>
  );
}
