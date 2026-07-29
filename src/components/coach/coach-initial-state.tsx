"use client";

import { useTranslations } from "next-intl";
import { Brain, Sparkles, BarChart3, Activity, LineChart, Heart, MessageCircle, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type PageContext } from "@/lib/page-context";

interface CoachInitialStateProps {
  pageContext: PageContext | null | undefined;
  hasExistingPlan: boolean;
  hasMessages: boolean;
  initialNotes?: string | null;
  onAnalyze: () => void;
  onStartPlanInterview: () => void;
  onSendMessage: (text: string) => void;
  onAskQuestion?: () => void;
  interviewStarting: boolean;
}

/**
 * Page-aware initial state for the CoachChat component.
 *
 * Shows a greeting tailored to the user's current page and provides
 * quick-action buttons relevant to the page context and plan state.
 * When initialNotes exist (restored conversation), those take precedence.
 */
export default function CoachInitialState({
  pageContext,
  hasExistingPlan,
  hasMessages,
  initialNotes,
  onAnalyze,
  onStartPlanInterview,
  onSendMessage,
  onAskQuestion,
  interviewStarting,
}: CoachInitialStateProps) {
  const t = useTranslations("coach");

  // If there are already messages, render nothing (the message thread takes over)
  if (hasMessages) return null;

  // If the conversation has initial notes (from a restored conversation), show them
  if (initialNotes) {
    return (
      <div className="rounded-lg border bg-primary/5 p-4 mb-4">
        <p className="text-sm whitespace-pre-line leading-relaxed">{initialNotes}</p>
      </div>
    );
  }

  // Derive greeting and actions from page context + plan state
  const page = pageContext?.page ?? "unknown";
  const greetingKey = getGreetingKey(page);
  const actions = getActions(page, hasExistingPlan);

  return (
    <div className="mb-4">
      {/* Greeting */}
      <div className="text-center py-4 text-sm text-muted-foreground">
        <Brain className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm leading-relaxed max-w-xs mx-auto">
          {t(greetingKey)}
        </p>
      </div>

      {/* Quick-action buttons */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.key}
                size="sm"
                variant={action.primary ? "default" : "outline"}
                onClick={() => action.onClick({
                  onAnalyze,
                  onStartPlanInterview,
                  onSendMessage,
                  onAskQuestion: onAskQuestion || (() => {}),
                })}
                disabled={interviewStarting && action.key === "createPlan"}
                className="gap-1.5"
              >
                <Icon className="h-3.5 w-3.5" />
                {t(action.labelKey)}
              </Button>
            );
          })}
        </div>
      )}

      {/* Hint when plan exists but no conversation started */}
      {hasExistingPlan && (
        <p className="text-xs text-center mt-3 text-muted-foreground">
          {t("followUpHint")}
        </p>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────

function getGreetingKey(page: string): string {
  switch (page) {
    case "dashboard":
      return "pageGreeting.dashboard";
    case "training-plan":
      return "pageGreeting.trainingPlan";
    case "activity-detail":
      return "pageGreeting.activityDetail";
    case "activity-list":
      return "pageGreeting.activityList";
    case "goal-detail":
      return "pageGreeting.goalDetail";
    case "goal-list":
      return "pageGreeting.goalList";
    case "body-metrics":
      return "pageGreeting.bodyMetrics";
    case "availability":
      return "pageGreeting.availability";
    default:
      return "pageGreeting.default";
  }
}

interface ActionDefinition {
  key: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  primary: boolean;
  onClick: (handlers: {
    onAnalyze: () => void;
    onStartPlanInterview: () => void;
    onSendMessage: (text: string) => void;
    onAskQuestion: () => void;
  }) => void;
}

function getActions(page: string, hasPlan: boolean): ActionDefinition[] {
  if (hasPlan) {
    // Actions shown when a training plan exists
    switch (page) {
      case "dashboard":
        return [
          {
            key: "analyze",
            labelKey: "quickActions.checkStatus",
            icon: BarChart3,
            primary: true,
            onClick: ({ onAnalyze }) => onAnalyze(),
          },
          {
            key: "reviewPlan",
            labelKey: "quickActions.reviewPlan",
            icon: Calendar,
            primary: false,
            onClick: ({ onSendMessage }) => onSendMessage("Review my current training plan"),
          },
        ];
      case "training-plan":
        return [
          {
            key: "adjustWeek",
            labelKey: "quickActions.adjustWeek",
            icon: Activity,
            primary: true,
            onClick: ({ onSendMessage }) => onSendMessage("I'd like to adjust this week's training"),
          },
          {
            key: "reviewPhase",
            labelKey: "quickActions.reviewPlan",
            icon: Calendar,
            primary: false,
            onClick: ({ onSendMessage }) => onSendMessage("Review my current training phase"),
          },
        ];
      case "activity-detail":
        return [
          {
            key: "analyzeWorkout",
            labelKey: "quickActions.analyzeWorkout",
            icon: Activity,
            primary: true,
            onClick: ({ onSendMessage }) => onSendMessage("Analyze this activity"),
          },
          {
            key: "adjustPlan",
            labelKey: "quickActions.adjustWeek",
            icon: Calendar,
            primary: false,
            onClick: ({ onSendMessage }) => onSendMessage("I need to adjust my training plan"),
          },
        ];
      case "activity-list":
        return [
          {
            key: "analyzeTrends",
            labelKey: "quickActions.analyzeTrends",
            icon: LineChart,
            primary: true,
            onClick: ({ onAnalyze }) => onAnalyze(),
          },
          {
            key: "adjustPlan",
            labelKey: "quickActions.adjustWeek",
            icon: Calendar,
            primary: false,
            onClick: ({ onSendMessage }) => onSendMessage("I need to adjust my training plan"),
          },
        ];
      case "goal-detail":
        return [
          {
            key: "assessReadiness",
            labelKey: "quickActions.assessReadiness",
            icon: Heart,
            primary: true,
            onClick: ({ onSendMessage }) => onSendMessage("How ready am I for this goal race?"),
          },
          {
            key: "reviewPlan",
            labelKey: "quickActions.reviewPlan",
            icon: Calendar,
            primary: false,
            onClick: ({ onSendMessage }) => onSendMessage("Review my training plan for this goal"),
          },
        ];
      case "goal-list":
      case "body-metrics":
        return [
          {
            key: "analyze",
            labelKey: "quickActions.checkStatus",
            icon: BarChart3,
            primary: true,
            onClick: ({ onAnalyze }) => onAnalyze(),
          },
          {
            key: "askQuestion",
            labelKey: "quickActions.askQuestion",
            icon: MessageCircle,
            primary: false,
            onClick: ({ onAskQuestion }) => onAskQuestion(),
          },
        ];
      default:
        return [
          {
            key: "analyze",
            labelKey: "quickActions.checkStatus",
            icon: BarChart3,
            primary: true,
            onClick: ({ onAnalyze }) => onAnalyze(),
          },
          {
            key: "askQuestion",
            labelKey: "quickActions.askQuestion",
            icon: MessageCircle,
            primary: false,
            onClick: ({ onAskQuestion }) => onAskQuestion(),
          },
        ];
    }
  }

  // No plan — show plan creation prominently, plus page-relevant alternatives
  switch (page) {
    case "dashboard":
      return [
        {
          key: "analyze",
          labelKey: "quickActions.checkStatus",
          icon: BarChart3,
          primary: false,
          onClick: ({ onAnalyze }) => onAnalyze(),
        },
        {
          key: "createPlan",
          labelKey: "createPlanButton",
          icon: Sparkles,
          primary: true,
          onClick: ({ onStartPlanInterview }) => onStartPlanInterview(),
        },
      ];
    case "activity-detail":
      return [
        {
          key: "analyzeWorkout",
          labelKey: "quickActions.analyzeWorkout",
          icon: Activity,
          primary: true,
          onClick: ({ onSendMessage }) => onSendMessage("Analyze this activity"),
        },
        {
          key: "createPlan",
          labelKey: "createPlanButton",
          icon: Sparkles,
          primary: false,
          onClick: ({ onStartPlanInterview }) => onStartPlanInterview(),
        },
      ];
    case "activity-list":
      return [
        {
          key: "analyzeTrends",
          labelKey: "quickActions.analyzeTrends",
          icon: LineChart,
          primary: true,
          onClick: ({ onAnalyze }) => onAnalyze(),
        },
        {
          key: "createPlan",
          labelKey: "createPlanButton",
          icon: Sparkles,
          primary: false,
          onClick: ({ onStartPlanInterview }) => onStartPlanInterview(),
        },
      ];
    case "training-plan":
    case "goal-detail":
    case "goal-list":
      return [
        {
          key: "createPlan",
          labelKey: "createPlanButton",
          icon: Sparkles,
          primary: true,
          onClick: ({ onStartPlanInterview }) => onStartPlanInterview(),
        },
      ];
    default:
      // home, unknown, body-metrics, availability
      return [
        {
          key: "askQuestion",
          labelKey: "quickActions.askQuestion",
          icon: MessageCircle,
          primary: true,
          onClick: ({ onAskQuestion }) => onAskQuestion(),
        },
        {
          key: "createPlan",
          labelKey: "createPlanButton",
          icon: Sparkles,
          primary: false,
          onClick: ({ onStartPlanInterview }) => onStartPlanInterview(),
        },
      ];
  }
}
