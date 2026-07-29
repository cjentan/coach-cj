"use client";

import { Check, Calendar, TrendingUp, Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PHASE_COLORS } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────

export interface PhaseSummary {
  name: string;
  weekCount: number;
  sessionCount: number;
  phaseOrder?: number;
}

interface TrainingPlanSummaryCardProps {
  totalWeeks: number;
  phases: PhaseSummary[];
  /** Optional — when true (default) shows a success header */
  showHeader?: boolean;
}

// ── Helpers ──────────────────────────────────────────────

function formatPhaseName(name: string): string {
  return name
    .replace(/phase/i, "")
    .replace(/\s*\d+$/, "")
    .trim();
}

function iconForPhase(name: string): string {
  const l = name.toLowerCase();
  if (l.includes("base")) return "🧱";
  if (l.includes("build") || l.includes("peak")) return "📈";
  if (l.includes("taper")) return "🧘";
  if (l.includes("race")) return "🏁";
  if (l.includes("recover") || l.includes("rebuild")) return "🔄";
  return "📅";
}

// ── Component ────────────────────────────────────────────

export default function TrainingPlanSummaryCard({
  totalWeeks,
  phases,
  showHeader = true,
}: TrainingPlanSummaryCardProps) {
  // Group consecutive phases with the same color for visual clarity
  const visible = phases.filter((p) => p.weekCount > 0);

  if (visible.length === 0) return null;

  // Compute total sessions
  const totalSessions = visible.reduce((s, p) => s + p.sessionCount, 0);

  return (
    <div className="rounded-xl border border-green-200 dark:border-green-900 bg-gradient-to-b from-green-50/50 to-background dark:from-green-950/20 p-4 max-w-[420px] w-full">
      {/* Header */}
      {showHeader && (
        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-8 w-8 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
            <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight text-green-800 dark:text-green-300">
              Your training plan is built!
            </p>
            <p className="text-[11px] text-muted-foreground">
              {totalWeeks} week{totalWeeks !== 1 ? "s" : ""} · {totalSessions} session{totalSessions !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      )}

      {/* Phase progress bar */}
      <div className="flex h-2 rounded-full overflow-hidden mb-4 bg-muted/50">
        {visible.map((phase, i) => {
          const color = PHASE_COLORS[phase.name.split(/\s+/)[0]] || "#6b7280";
          const width = (phase.weekCount / totalWeeks) * 100;
          return (
            <div
              key={i}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${width}%`,
                backgroundColor: color,
                opacity: 0.7,
              }}
              title={`${phase.name}: ${phase.weekCount} weeks`}
            />
          );
        })}
      </div>

      {/* Phase cards */}
      <div className="space-y-2">
        {visible.map((phase, i) => {
          const rawName = phase.name;
          const displayName = formatPhaseName(rawName) || rawName;
          const color = PHASE_COLORS[rawName.split(/\s+/)[0]] || "#6b7280";
          const icon = iconForPhase(rawName);

          return (
            <div
              key={i}
              className="rounded-lg border bg-card p-2.5 transition-colors"
              style={{ borderColor: `${color}25` }}
            >
              <div className="flex items-center gap-2.5">
                {/* Color dot + icon */}
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-xs"
                  style={{
                    backgroundColor: `${color}14`,
                    color,
                  }}
                >
                  {icon}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold leading-tight" style={{ color }}>
                      {displayName}
                    </p>
                    {phase.phaseOrder !== undefined && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                        P{phase.phaseOrder}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {phase.weekCount} week{phase.weekCount !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {phase.sessionCount} session{phase.sessionCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend hint */}
      {visible.length > 1 && (
        <p className="text-[10px] text-muted-foreground/60 text-center mt-3">
          The plan progresses from left to right through each phase
        </p>
      )}
    </div>
  );
}
