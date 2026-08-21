"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, AlertCircle } from "lucide-react";
import type { PlanProposal } from "@/lib/training-plan-types";
import PlanProposalCard from "@/components/coach/plan-proposal-card";
import TrainingContextOfferCard from "@/components/coach/training-context-offer-card";
import TrainingPlanSummaryCard, {
  type PhaseSummary,
} from "@/components/coach/training-plan-summary-card";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Shared Types ──────────────────────────────────────────

export interface CoachMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  suggestionId?: string | null;
  createdAt: string;
}

export interface CoachSuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
}

export interface PhaseProgress {
  phaseName: string;
  phaseOrder: number;
  phaseGoal: string;
  weekCount: number;
  weeks: string[];
  sessionCount: number;
  workoutCount?: number;
  restCount?: number;
}

export interface StatusEntry {
  id: number;
  text: string;
  timestamp: number;
}

export interface SaveProgressInfo {
  phaseName: string;
  weekCurrent: number;
  weekTotal: number;
  message: string;
}

/** Pending "save this analysis to the activity" prompt attached to an assistant message. */
export interface SaveAnalysisPrompt {
  activityId: string;
  activityName: string;
  messageId: string;
}

// ── Component Props ───────────────────────────────────────

interface CoachMessageListProps {
  variant: "default" | "floating";
  messages: CoachMessage[];
  suggestions: CoachSuggestion[];
  hasExistingPlan: boolean;
  currentProposal: PlanProposal | null;
  completedPhases: PhaseSummary[];
  loading: boolean;
  interviewStarting: boolean;
  phaseProgress: PhaseProgress[];
  statusFeed: StatusEntry[];
  saveProgress: SaveProgressInfo | null;
  error: string | null;
  feedback: string | null;
  t: (
    key: string,
    values?: Record<string, string | number | boolean | Date | null | undefined>
  ) => string;
  onApplySuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
  onProposalChange: (proposal: PlanProposal) => void;
  onApproveProposal: () => void;
  onAdjustProposal: () => void;
  savePrompt?: SaveAnalysisPrompt | null;
  savingAnalysis?: boolean;
  onSaveAnalysis: () => void;
  onDiscardAnalysis: () => void;
  showContextOffer?: boolean;
  onStartContextInterview?: () => void;
  onSkipContextInterview?: () => void;
}

// ── Component ─────────────────────────────────────────────

const CoachMessageList = memo(function CoachMessageList({
  variant,
  messages,
  suggestions,
  hasExistingPlan,
  currentProposal,
  completedPhases,
  loading,
  interviewStarting,
  phaseProgress,
  statusFeed,
  saveProgress,
  error,
  feedback,
  t,
  onApplySuggestion,
  onDismissSuggestion,
  onProposalChange,
  onApproveProposal,
  onAdjustProposal,
  savePrompt,
  savingAnalysis,
  onSaveAnalysis,
  onDiscardAnalysis,
  showContextOffer,
  onStartContextInterview,
  onSkipContextInterview,
}: CoachMessageListProps) {
  const isFloating = variant === "floating";
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

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

  const showLoading = loading || (isFloating && interviewStarting);

  return (
    <>
      {/* Message thread */}
      {messages.length > 0 && (
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className={`space-y-3 mb-4 overflow-y-auto${isFloating ? "" : " max-h-[500px]"}`}
        >
          {/* Suggestion cards pinned at top — only when a plan exists */}
          {hasExistingPlan && suggestions.filter((s) => s.status === "pending").length > 0 && (
            <div className="space-y-2 mb-4">
              {suggestions
                .filter((s) => s.status === "pending")
                .map((s) => (
                  <div key={s.id} className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Badge variant="outline" className="text-[0.625rem] mb-1">
                          {s.type.replace(/_/g, " ")}
                        </Badge>
                        <p className="text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => onApplySuggestion(s.id)}
                      >
                        <Check className="h-3 w-3 mr-1" /> {t("apply")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => onDismissSuggestion(s.id)}
                      >
                        <X className="h-3 w-3 mr-1" /> {t("dismiss")}
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Plan proposal card (shown once after interview — only before a plan is built) */}
          {!hasExistingPlan && currentProposal && !loading && (
            <div className={`flex justify-start${isFloating ? "" : " mb-3"}`}>
              <PlanProposalCard
                proposal={currentProposal}
                editable
                onProposalChange={onProposalChange}
                onApprove={onApproveProposal}
                onAdjust={onAdjustProposal}
              />
            </div>
          )}

          {/* Non-blocking training-context offer (shown when the athlete has no saved context) */}
          {showContextOffer && !loading && (
            <div className={`flex justify-start${isFloating ? "" : " mb-3"}`}>
              <TrainingContextOfferCard
                onStart={onStartContextInterview ?? (() => {})}
                onSkip={onSkipContextInterview ?? (() => {})}
              />
            </div>
          )}

          {/* Completed plan summary card (shown after plan is built; floating mode only) */}
          {isFloating && completedPhases.length > 0 && (
            <div className="flex justify-start">
              <TrainingPlanSummaryCard
                totalWeeks={completedPhases.reduce((s, p) => s + p.weekCount, 0)}
                phases={completedPhases}
              />
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : msg.id.startsWith("summary")
                      ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                      : "bg-muted"
                }`}
              >
                <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
                {msg.id.startsWith("summary") && (
                  <p className="text-[0.625rem] text-muted-foreground mt-1 italic">
                    {t("conversationSummary")}
                  </p>
                )}
                {savePrompt && savePrompt.messageId === msg.id && (
                  <div className="mt-2 pt-2 border-t border-border/60">
                    <p className="text-xs text-muted-foreground mb-1">
                      {t("saveAnalysisPrompt", { name: savePrompt.activityName })}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={onSaveAnalysis}
                        disabled={savingAnalysis}
                      >
                        {savingAnalysis ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3 mr-1" />
                        )}
                        {t("saveToActivity")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={onDiscardAnalysis}
                      >
                        <X className="h-3 w-3 mr-1" /> {t("discard")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Loading indicator */}
      {showLoading && (
        <div className="mb-4">
          {(statusFeed.length > 0 || saveProgress) && (
            <div className="space-y-1 mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                {t("activity")}
              </p>
              <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                {statusFeed.slice(-8).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <span className="shrink-0 mt-0.5 text-[0.625rem]">💬</span>
                    <span className="leading-relaxed">{entry.text}</span>
                  </div>
                ))}
              </div>
              {saveProgress && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 p-2 rounded border border-primary/10 bg-primary/5">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span className="flex-1">{saveProgress.message}</span>
                  <Badge variant="outline" className="text-[0.625rem] shrink-0">
                    {saveProgress.weekCurrent}/{saveProgress.weekTotal}
                  </Badge>
                </div>
              )}
            </div>
          )}
          {phaseProgress.length > 0 && (
            <div className="space-y-2 mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("trainingPlanProgress")}
              </p>
              {phaseProgress.map((p, i) => {
                const countStr =
                  p.workoutCount !== undefined && p.restCount !== undefined
                    ? isFloating
                      ? `${t("weeksCount", { count: p.weekCount })} · ${t("workoutsCount", { count: p.workoutCount })} · ${t("restCount", { count: p.restCount })}`
                      : `${p.weekCount} week${p.weekCount !== 1 ? "s" : ""} · ${p.workoutCount} workout${p.workoutCount !== 1 ? "s" : ""} · ${p.restCount} rest`
                    : isFloating
                      ? `${t("weeksCount", { count: p.weekCount })} · ${t("sessionsCount", { count: p.sessionCount })}`
                      : `${p.weekCount} week${p.weekCount !== 1 ? "s" : ""} · ${p.sessionCount} session${p.sessionCount !== 1 ? "s" : ""}`;
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                        <Check className="h-3 w-3 text-green-600" />
                      </div>
                      <span className="font-medium">{p.phaseName}</span>
                      <Badge variant="outline" className="ml-auto text-[0.625rem]">
                        {isFloating
                          ? t("phase", { phaseOrder: p.phaseOrder })
                          : `Phase ${p.phaseOrder}`}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-7">{p.phaseGoal}</p>
                    <p className="text-xs text-muted-foreground ml-7">{countStr}</p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            {statusFeed.length === 0 && !saveProgress && phaseProgress.length === 0
              ? t("thinking")
              : isFloating
                ? t("processing")
                : "Processing..."}
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
    </>
  );
});

export default CoachMessageList;
