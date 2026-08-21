"use client";

import { Button } from "@/components/ui/button";
import { Loader2, Brain, Sparkles, Wand2 } from "lucide-react";

type HeaderT = (
  key: string,
  values?: Record<string, string | number | boolean | Date | null | undefined>
) => string;

interface CoachChatHeaderProps {
  t: HeaderT;
  locale: string;
  variant: "default" | "floating";
  /** Root container classes. Both coach layouts pass their own wrapper styles here. */
  className?: string;
  initialNotesAt?: string | null;
  hasMessages: boolean;
  messageCount: number;
  summarizing: boolean;
  analyzing: boolean;
  onSummarize: () => void;
  onAnalyze: () => void;
}

/**
 * Header shared by both the floating and inline coach layouts.
 *
 * Renders the coach title, the date of any pre-existing analysis, and the
 * Summarize / Analyze action buttons. The layout-specific wrapper classes
 * are supplied via `className`; the per-variant button chrome is resolved
 * inside from `variant`.
 */
export default function CoachChatHeader({
  t,
  locale,
  variant,
  className,
  initialNotesAt,
  hasMessages,
  messageCount,
  summarizing,
  analyzing,
  onSummarize,
  onAnalyze,
}: CoachChatHeaderProps) {
  const isFloating = variant === "floating";
  const showAnalyzedDate = initialNotesAt && !hasMessages;

  const summarizeButton =
    hasMessages &&
    messageCount >= 2 &&
    (isFloating ? (
      <Button
        size="sm"
        variant="ghost"
        onClick={onSummarize}
        disabled={summarizing}
        title={t("summarizeTitle")}
      >
        {summarizing ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 mr-1" />
        )}
        {t("summarize")}
      </Button>
    ) : (
      <Button size="sm" variant="ghost" onClick={onSummarize} disabled={summarizing}>
        {summarizing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span className="ml-1 hidden sm:inline">{t("summarize")}</span>
      </Button>
    ));

  return (
    <div className={className ?? "flex items-center justify-between shrink-0"}>
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </h2>
        {showAnalyzedDate && (
          <span className="text-[0.625rem] text-muted-foreground">
            {new Date(initialNotesAt).toLocaleDateString(locale, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
      <div className={isFloating ? "flex items-center gap-1" : "flex flex-col items-end gap-1"}>
        <div className="flex items-center gap-2">
          {summarizeButton}
          <Button
            size="sm"
            onClick={onAnalyze}
            disabled={analyzing}
            title={isFloating ? t("analyzeTitle") : undefined}
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> {t("analyzing")}
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-1" /> {t("analyze")}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
