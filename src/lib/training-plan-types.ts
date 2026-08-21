/**
 * Shared training plan types — used by the dashboard, AI coach chat,
 * and the dedicated Training Plan page.
 *
 * Centralises types that were previously duplicated across
 * dashboard/page.tsx and coach-chat.tsx.
 */

// ── Day-level types ────────────────────────────────────

export interface PlanDayPlanned {
  type: string;
  description: string;
  targetDistance: number | null;
  targetElevation: number | null;
  targetDuration: number | null;
  changedAt?: string;
  changeReason?: string;
}

export interface PlanDayActual {
  type: string;
  name: string;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  durationSeconds: number;
  activityId: string;
  source: string;
}

export interface PlanDay {
  date: string;
  dayLabel: string;
  dayOfWeek: number;
  planned: PlanDayPlanned | null;
  actual: PlanDayActual | null;
  isPast: boolean;
  isToday: boolean;
}

// ── Week-level types ───────────────────────────────────

export interface PlanWeekData {
  weekStart: string;
  weekEnd: string;
  days: PlanDay[];
  targetVolumeMeters?: number;
  targetElevationMeters?: number;
  targetDurationSeconds?: number;
  adjustments?: string[];
  coachNotes?: string;
  /** Phase name derived from coachNotes, if any. */
  phaseName?: string | null;
  /** Total number of plans the user has, for display in coach chat. */
  totalPlanCount?: number;
}

// ── Phase types ────────────────────────────────────────

export interface TrainingPlanPhase {
  name: string; // "Base" | "Build" | "Peak" | "Taper" | "Race" | "General"
  weekStart: string;
  weekEnd: string;
  description: string | null;
  /** CSS colour for visual distinction in the phase bar. */
  color?: string;
}

// ── API response ───────────────────────────────────────

export interface TrainingPlanResponse {
  planStartDate: string;
  planEndDate: string;
  phases: TrainingPlanPhase[];
  weeks: PlanWeekData[];
}

// ── Plan proposal (card display in Coach chat) ──────────

export interface PhaseProposal {
  name: string; // "Base" | "Build" | "Peak" | "Taper"
  weeks: number;
  focus: string;
  peakVolume: string; // e.g. "55 km/wk"
}

export interface PlanProposal {
  totalWeeks: number;
  raceGoalName: string;
  raceDate: string;
  currentVolume: string; // e.g. "~45 km/wk"
  peakVolume: string; // e.g. "~80 km/wk"
  proposedStartDate?: string; // YYYY-MM-DD — when the plan should begin
  phases: PhaseProposal[];
  adjustments: string[];
}
