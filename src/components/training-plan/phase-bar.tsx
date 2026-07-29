"use client";

import { useMemo, useRef, useEffect } from "react";
import type { TrainingPlanPhase } from "@/lib/training-plan-types";
import { startOfMonth, isWithinInterval, parseISO } from "date-fns";

interface PhaseBarProps {
  phases: TrainingPlanPhase[];
  currentMonth: Date;
  onPhaseClick: (phase: TrainingPlanPhase) => void;
}

/**
 * Horizontal bar showing training phases as coloured pill badges.
 * Each pill is a button that jumps the calendar to that phase's month.
 * The phase containing the current month is highlighted.
 */
export function PhaseBar({ phases, currentMonth, onPhaseClick }: PhaseBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const currentMonthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth]);

  // Determine which phase(s) the current month falls into
  const activePhaseNames = useMemo(() => {
    return phases
      .filter((p) =>
        isWithinInterval(currentMonthStart, {
          start: parseISO(p.weekStart),
          end: parseISO(p.weekEnd),
        }),
      )
      .map((p) => p.name);
  }, [phases, currentMonthStart]);

  // Auto-scroll the active phase button into view
  useEffect(() => {
    if (!barRef.current || activePhaseNames.length === 0) return;
    const activeBtn = barRef.current.querySelector<HTMLButtonElement>(
      "[data-active=true]",
    );
    activeBtn?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activePhaseNames]);

  if (phases.length === 0) return null;

  return (
    <div
      ref={barRef}
      className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin"
    >
      {phases.map((phase) => {
        const isActive = activePhaseNames.includes(phase.name);

        return (
          <PhaseButton
            key={`${phase.name}-${phase.weekStart}`}
            phase={phase}
            isActive={isActive}
            onClick={onPhaseClick}
          />
        );
      })}
    </div>
  );
}

/** Single phase pill button. */
function PhaseButton({
  phase,
  isActive,
  onClick,
}: {
  phase: TrainingPlanPhase;
  isActive: boolean;
  onClick: (p: TrainingPlanPhase) => void;
}) {
  const startLabel = useMemo(() => formatShortDate(phase.weekStart), [phase.weekStart]);
  const endLabel = useMemo(() => formatShortDate(phase.weekEnd), [phase.weekEnd]);

  return (
    <button
      data-active={isActive}
      onClick={() => onClick(phase)}
      title={`Go to ${phase.name} phase — ${phase.weekStart} to ${phase.weekEnd}`}
      aria-label={`${phase.name} phase: ${phase.weekStart} to ${phase.weekEnd}, click to jump calendar to this phase`}
      className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all border cursor-pointer"
      style={{
        backgroundColor: isActive ? `${phase.color}20` : "transparent",
        borderColor: isActive ? phase.color : "var(--border)",
        color: isActive ? phase.color : "var(--muted-foreground)",
      }}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: phase.color }}
      />
      <span>{phase.name}</span>
      <span className="opacity-60">
        {startLabel} &ndash; {endLabel}
      </span>
    </button>
  );
}

function formatShortDate(iso: string): string {
  const d = parseISO(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
