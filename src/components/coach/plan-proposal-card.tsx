"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Calendar, TrendingUp, AlertCircle, Brain, Target, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanProposal, PhaseProposal } from "@/lib/training-plan-types";

// ── Phase colours (mirrors the phase-bar component) ─────

const PHASE_COLORS: Record<string, string> = {
  Base: "#3b82f6",
  Build: "#f59e0b",
  Peak: "#ef4444",
  Taper: "#22c55e",
  Race: "#a855f7",
};

// ── Props ────────────────────────────────────────────────

interface PlanProposalCardProps {
  proposal: PlanProposal;
  editable?: boolean;
  onProposalChange?: (updated: PlanProposal) => void;
  onApprove: () => void;
  onAdjust: () => void;
}

// ── Helpers ──────────────────────────────────────────────

/** Extract numeric value from a volume string like "~80 km/wk" */
function parseVolumeKm(v: string): number {
  const m = v.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Build a volume string from a numeric km value */
function volumeStr(km: number): string {
  return `~${km} km/wk`;
}

/** Compute total weeks between a start date string and a race date string. */
function computeTotalWeeks(startDateStr: string, raceDateStr: string): number {
  const start = new Date(startDateStr);
  const race = new Date(raceDateStr);
  if (isNaN(start.getTime()) || isNaN(race.getTime())) return 0;
  return Math.max(1, Math.round((race.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)));
}

/** Minimum weeks per phase name */
const PHASE_MIN_WEEKS: Record<string, number> = {
  Base: 2,
  Build: 2,
  Peak: 1,
  Taper: 1,
};

/**
 * Redistribute phase weeks proportionally to match a new total.
 * Uses the original proposal phases as the ratio basis so edits don't compound.
 */
function redistributePhases(
  origPhases: PhaseProposal[],
  origTotal: number,
  newTotal: number
): PhaseProposal[] {
  if (origPhases.length === 0) return origPhases;
  const safeTotal = Math.max(origPhases.length, newTotal);
  const origSum = Math.max(origTotal, origPhases.reduce((s, p) => s + p.weeks, 0));

  // Proportional allocation from original
  const result = origPhases.map((p) => ({
    ...p,
    weeks: Math.max(PHASE_MIN_WEEKS[p.name] || 1, Math.round((p.weeks / origSum) * safeTotal)),
  }));

  // Fix rounding to match safeTotal exactly
  let sum = result.reduce((s, p) => s + p.weeks, 0);
  let diff = safeTotal - sum;
  let safety = 0;

  while (diff !== 0 && safety < 20) {
    safety++;
    if (diff > 0) {
      // Give extra weeks to non-Taper phases first
      for (let i = 0; i < result.length && diff > 0; i++) {
        if (result[i].name !== "Taper") { result[i].weeks++; diff--; }
      }
      if (diff > 0) { result[result.length - 1].weeks += diff; break; }
    } else {
      // Take from Taper first, then from phases above their minimum
      for (let i = result.length - 1; i >= 0 && diff < 0; i--) {
        const min = PHASE_MIN_WEEKS[result[i].name] || 1;
        while (result[i].weeks > min && diff < 0) { result[i].weeks--; diff++; }
      }
    }
  }

  return result;
}

/** Adjust a phase's week count while keeping totalWeeks fixed. */
function adjustPhaseWeeks(
  phases: PhaseProposal[],
  index: number,
  delta: number
): PhaseProposal[] {
  const result = phases.map((p) => ({ ...p }));
  const target = result[index];
  const taperIdx = result.length - 1;
  const minTarget = PHASE_MIN_WEEKS[target.name] || 1;

  if (delta > 0) {
    // Adding a week — take from Taper (or Peak if Taper at min)
    if (result[taperIdx].weeks > PHASE_MIN_WEEKS.Taper!) {
      target.weeks += 1;
      result[taperIdx].weeks -= 1;
    } else if (taperIdx >= 2 && result[taperIdx - 1].weeks > PHASE_MIN_WEEKS.Peak!) {
      target.weeks += 1;
      result[taperIdx - 1].weeks -= 1;
    }
    // else: can't add — no slack anywhere
  } else {
    // Removing a week — give to Taper
    if (target.weeks > minTarget) {
      target.weeks -= 1;
      result[taperIdx].weeks += 1;
    }
    // else: can't remove — at minimum
  }

  return result;
}

// ── Component ────────────────────────────────────────────

export default function PlanProposalCard({
  proposal,
  editable = false,
  onProposalChange,
  onApprove,
  onAdjust,
}: PlanProposalCardProps) {
  const t = useTranslations("coach");
  const { phases, totalWeeks, raceGoalName, raceDate, currentVolume, peakVolume, adjustments } = proposal;

  // Local editable state — initialised from proposal, updated as user edits
  const [edits, setEdits] = useState<{
    startDate: string;
    phases: PhaseProposal[];
    peakKm: number;
  }>({
    startDate: proposal.proposedStartDate || "",
    phases: phases.map((p) => ({ ...p })),
    peakKm: parseVolumeKm(peakVolume),
  });

  // ── Computed total weeks from edited start date ──────────

  const effectiveTotalWeeks = (() => {
    if (!raceDate || !edits.startDate) return totalWeeks;
    return computeTotalWeeks(edits.startDate, raceDate);
  })();

  // Sync edits back to parent — includes the recalculated totalWeeks
  const commitEdits = useCallback(
    (next: typeof edits) => {
      setEdits(next);
      const computedTotal = raceDate && next.startDate
        ? computeTotalWeeks(next.startDate, raceDate)
        : totalWeeks;
      onProposalChange?.({
        ...proposal,
        totalWeeks: computedTotal,
        proposedStartDate: next.startDate || undefined,
        phases: next.phases,
        peakVolume: volumeStr(next.peakKm),
      });
    },
    [proposal, raceDate, totalWeeks, onProposalChange]
  );

  // ── Phase week adjustment callbacks ────────────────────

  const handlePhaseUp = (i: number) => {
    const next = adjustPhaseWeeks(edits.phases, i, +1);
    commitEdits({ ...edits, phases: next, peakKm: edits.peakKm });
  };

  const handlePhaseDown = (i: number) => {
    const next = adjustPhaseWeeks(edits.phases, i, -1);
    commitEdits({ ...edits, phases: next, peakKm: edits.peakKm });
  };

  // ── Peak volume change ─────────────────────────────────

  const handlePeakVolumeChange = (val: string) => {
    const km = Math.max(1, parseInt(val, 10) || 0);
    commitEdits({ ...edits, peakKm: km });
  };

  // ── Training period display ────────────────────────────

  const trainingPeriod = (() => {
    if (!raceDate) return null;
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const race = new Date(raceDate);
    if (isNaN(race.getTime())) return null;
    const start = edits.startDate
      ? new Date(edits.startDate)
      : new Date(race.getTime() - totalWeeks * 7 * 24 * 60 * 60 * 1000);
    if (isNaN(start.getTime())) return null;
    return { start: fmt(start), end: fmt(race) };
  })();

  // ── Start date change (redistributes phase weeks) ──────

  const handleStartDateChange = (val: string) => {
    const race = new Date(raceDate);
    const newStart = new Date(val);
    if (!isNaN(race.getTime()) && !isNaN(newStart.getTime())) {
      const newTotal = computeTotalWeeks(val, raceDate);
      if (newTotal !== totalWeeks && newTotal >= phases.length) {
        const newPhases = redistributePhases(phases, totalWeeks, newTotal);
        commitEdits({ ...edits, startDate: val, phases: newPhases });
        return;
      }
    }
    commitEdits({ ...edits, startDate: val });
  };

  const displayPhases = editable ? edits.phases : phases;
  const displayPeak = editable ? volumeStr(edits.peakKm) : peakVolume;
  const displayCurrent = currentVolume;

  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-background p-4 max-w-[420px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Brain className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{t("proposalTitle")}</p>
          <p className="text-[10px] text-muted-foreground">
            {effectiveTotalWeeks > 0 ? t("proposalWeeksUntil", { count: effectiveTotalWeeks }) : ""}
          </p>
        </div>
      </div>

      {/* Goal race highlight */}
      <div className="rounded-lg border-2 border-primary/20 bg-primary/[0.06] p-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
              {t("proposalGoalRace")}
            </p>
            <p className="text-base font-bold leading-tight text-foreground break-words">
              {raceGoalName}
            </p>
            <div className="flex items-center gap-3 mt-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span className="font-medium">{raceDate}</span>
              </div>
              {effectiveTotalWeeks > 0 && (
                <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {t("proposalWeeksToTrain", { count: effectiveTotalWeeks })}
                </span>
              )}
            </div>

            {/* Training period — editable start date */}
            {trainingPeriod && (
              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground/70">
                <span className="text-[10px]">📅</span>
                {editable ? (
                  <div className="flex items-center gap-1 text-xs">
                    <span>Start:</span>
                    <input
                      type="date"
                      value={edits.startDate}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      className="bg-background border border-input rounded px-1 py-0.5 text-xs w-36"
                    />
                    <span>→ {trainingPeriod.end}</span>
                  </div>
                ) : (
                  <span>{trainingPeriod.start} → {trainingPeriod.end}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Phase timeline — editable weeks */}
      <div className="mb-3">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {t("proposalWeeksCount", { count: effectiveTotalWeeks })} · {t("proposalPhasesCount", { count: phases.length })}
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {displayPhases.map((phase, i) => {
            const color = PHASE_COLORS[phase.name] || "#6b7280";
            return (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border"
                style={{
                  backgroundColor: `${color}14`,
                  borderColor: `${color}30`,
                  color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span>{phase.name}</span>
                <span className="opacity-60">{phase.weeks}w</span>

                {editable && (
                  <span className="flex items-center gap-0.5 ml-0.5">
                    <button
                      type="button"
                      onClick={() => handlePhaseDown(i)}
                      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded hover:bg-muted transition-colors"
                      aria-label={`Reduce ${phase.name} by 1 week`}
                    >
                      <Minus className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePhaseUp(i)}
                      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded hover:bg-muted transition-colors"
                      aria-label={`Increase ${phase.name} by 1 week`}
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Volume progression — editable peak */}
      <div className="rounded-lg bg-muted/50 p-2.5 mb-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <TrendingUp className="h-3 w-3" />
          <span className="font-medium text-foreground">{t("proposalVolume")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("proposalCurrent")}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-amber-400"
              style={{ width: `${Math.min(100, (parseInt(displayCurrent) / Math.max(1, parseInt(displayPeak))) * 100)}%` }}
            />
          </div>
          {editable ? (
            <input
              type="number"
              min="1"
              max="300"
              value={edits.peakKm}
              onChange={(e) => handlePeakVolumeChange(e.target.value)}
              className="w-16 bg-background border border-input rounded px-1 py-0.5 text-xs font-semibold text-right"
            />
          ) : (
            <span className="text-xs font-semibold">{displayPeak}</span>
          )}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground mt-0.5">
          <span>{displayCurrent}</span>
          <span>{t("proposalPeak")}</span>
        </div>
      </div>

      {/* Phase details — show edited weeks */}
      <div className="space-y-1.5 mb-3">
        {displayPhases.map((phase, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span
              className="w-2 h-2 rounded-full mt-0.5 shrink-0"
              style={{ backgroundColor: PHASE_COLORS[phase.name] || "#6b7280" }}
            />
            <div className="min-w-0">
              <span className="font-medium">{phase.name}</span>
              <span className="text-muted-foreground">
                {" "}· {phase.weeks}w · {phase.focus}
              </span>
              <span className="text-muted-foreground/60"> · {phase.peakVolume}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Adjustments */}
      {adjustments.length > 0 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 p-2.5 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">
            <AlertCircle className="h-3 w-3" />
            <span>{t("proposalAdjustments")}</span>
          </div>
          <ul className="space-y-0.5">
            {adjustments.map((adj, i) => (
              <li key={i} className="text-[11px] text-amber-700/80 dark:text-amber-400/80 flex items-start gap-1.5">
                <span className="mt-0.5">·</span>
                <span>{adj}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 h-8 text-xs gap-1.5" onClick={onApprove}>
          <span>✓</span>
          {editable ? "Build this plan" : t("proposalApprove")}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1.5" onClick={onAdjust}>
          <span>✎</span> {t("proposalAdjust")}
        </Button>
      </div>
    </div>
  );
}
