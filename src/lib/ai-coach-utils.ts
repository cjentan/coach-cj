/**
 * Pure helpers, Zod schemas, and shared types for the AI Coach service.
 *
 * Everything in this module is side-effect free: no Prisma, no LLM calls,
 * no I/O. It exists so the large orchestrators in `ai-coach.ts` and the
 * per-activity analysis in `ai-coach-activity.ts` can share small building
 * blocks without pulling in each other's dependencies.
 *
 * `ai-coach.ts` re-exports the public surface of this module so existing
 * imports keep working unchanged.
 */
import { z } from "zod";
import { formatDistance, formatDuration } from "./utils";
import { type PageContext } from "./page-context";
import { type TrainingContext } from "./training-context";

/** Suffices for code that only needs the *shape* of training context. */
export type TrainingContextLike = TrainingContext;

// ── Zod schemas ────────────────────────────────────────

export const SuggestionSchema = z.object({
  type: z.enum([
    "volume_change",
    "session_change",
    "rest_day_addition",
    "intensity_change",
    "focus_change",
    "deload_week",
  ]),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  changes: z.record(z.unknown()),
});

export const AnalyzeResponseSchema = z.object({
  analysis: z.string().min(1),
  suggestions: z.array(SuggestionSchema).default([]),
});

export const PhaseProposalSchema = z.object({
  name: z.enum(["Base", "Build", "Peak", "Taper"]),
  weeks: z.number().int().positive(),
  focus: z.string().min(1),
  peakVolume: z.string().min(1),
});

export const PlanProposalSchema = z.object({
  totalWeeks: z.number().int().positive(),
  raceGoalName: z.string().min(1),
  raceDate: z.string(),
  currentVolume: z.string().min(1),
  peakVolume: z.string().min(1),
  proposedStartDate: z.string().optional(),
  phases: z.array(PhaseProposalSchema).min(1).max(6),
  adjustments: z.array(z.string()).default([]),
});

export const StartInterviewResponseSchema = z.object({
  summary: z.string().min(1),
  proposal: PlanProposalSchema,
});

export const ActivityAnalysisResultSchema = z.object({
  trainingType: z.enum([
    "easy_recovery",
    "long_run",
    "tempo",
    "threshold",
    "interval",
    "fartlek",
    "hill_repeats",
    "sprints",
    "aerobic_endurance",
    "race",
    "cross_training",
    "other",
  ]),
  trainingTypeLabel: z.string().min(1).max(60),
  analysis: z.string().min(1),
  flags: z.array(z.string()),
  verdict: z.enum(["productive", "neutral", "unproductive"]),
});

// ── Shared result / event types ───────────────────────

export interface CoachAnalysisResult {
  conversationId: string;
  analysis: string;
  suggestions: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    status: string;
  }>;
  guardrailViolations: string[];
}

export interface CoachChatResult {
  conversationId: string;
  response: string;
  suggestions: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    status: string;
  }>;
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
  /** Updated plan proposal, if plan-related tools were called during the chat. */
  proposal?: z.infer<typeof PlanProposalSchema> | null;
}

export interface PhaseProgressEvent {
  type: "phase_complete";
  phaseName: string;
  phaseOrder: number;
  phaseGoal: string;
  weekCount: number;
  weeks: string[];
  sessionCount: number;
  workoutCount?: number;
  restCount?: number;
}

export interface StatusEvent {
  type: "status";
  message: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  tool: string;
  phaseName?: string;
  action?: string;
}

export type ChatProgressEvent =
  | PhaseProgressEvent
  | StatusEvent
  | ToolCallEvent
  | {
      type: "progress";
      phaseName: string;
      phaseOrder: number;
      weekCurrent: number;
      weekTotal: number;
      weekStart: string;
      message: string;
    };

export interface ChatOptions {
  onProgress?: (event: ChatProgressEvent) => void;
  signal?: AbortSignal;
  /** Pre-built training context to avoid re-fetching from DB. */
  trainingContext?: TrainingContextLike;
}

// ── Pure helpers ──────────────────────────────────────

/** Strip markdown code fences if the LLM wraps JSON in them. */
export function sanitizeJsonText(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1].trim() : text.trim();
}

/** Derive phase structure (name + weeks) from athlete's training context. */
export function derivePhaseStructure(
  ctx: TrainingContextLike
): Array<{ name: string; weeks: number }> {
  const goal = ctx.goals[0];
  if (!goal)
    return [
      { name: "Base", weeks: 4 },
      { name: "Build", weeks: 4 },
      { name: "Peak", weeks: 2 },
      { name: "Taper", weeks: 1 },
    ];

  const diffMs = new Date(goal.targetDate).getTime() - Date.now();
  const totalWeeks = Math.max(4, Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)));

  const baseWeeks = Math.max(2, Math.round(totalWeeks * 0.4));
  const buildWeeks = Math.max(2, Math.round(totalWeeks * 0.3));
  const peakWeeks = Math.max(1, Math.round(totalWeeks * 0.15));
  const taperWeeks = Math.max(1, totalWeeks - baseWeeks - buildWeeks - peakWeeks);

  return [
    { name: "Base", weeks: baseWeeks },
    { name: "Build", weeks: buildWeeks },
    { name: "Peak", weeks: peakWeeks },
    { name: "Taper", weeks: taperWeeks },
  ];
}

/** Return the next Monday as YYYY-MM-DD (or today if Monday). */
export function getNextMondayStr(): string {
  const d = new Date();
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  return d.toISOString().split("T")[0];
}

/** Generate a phase goal string from the phase name. */
export function generatePhaseGoal(name: string): string {
  switch (name) {
    case "Base":
      return "Build aerobic foundation and endurance base";
    case "Build":
      return "Introduce race-specific intensity and quality workouts";
    case "Peak":
      return "Sharpen fitness with race-pace rehearsal sessions";
    case "Taper":
      return "Reduce volume while maintaining intensity for peak freshness";
    default:
      return `${name} phase training`;
  }
}

/** Build a textual summary of the athlete's training context for LLM prompts. */
export function buildContextSummary(ctx: TrainingContextLike, locale = "en"): string {
  const today = new Date().toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  let s = `## Athlete: ${ctx.athleteName}\n`;
  s += `Today's date: ${today}\n\n`;

  // Goals with full detail
  if (ctx.goals.length > 0) {
    s += "### Race Goals\n";
    for (const g of ctx.goals) {
      s += `- **${g.name}** — ${formatDistance(g.distanceMeters, undefined, locale)}, target ${g.targetDate}, priority ${g.priority}\n`;

      if (g.elevationGainMeters && g.elevationGainMeters > 0) {
        s += `  - Elevation gain: ${formatDistance(g.elevationGainMeters, undefined, locale)}\n`;
      }
      if (g.targetTimeSeconds) {
        const hrs = Math.floor(g.targetTimeSeconds / 3600);
        const mins = Math.round((g.targetTimeSeconds % 3600) / 60);
        s += `  - Target time: ${hrs}h ${mins}m\n`;
      }
      // Course profile summary
      if (g.courseProfileSummary) {
        s += `  - Course: ${formatDistance(g.courseProfileSummary.distanceMeters, undefined, locale)}, `;
        s += `${formatDistance(g.courseProfileSummary.elevationGainMeters, undefined, locale)} vert, `;
        s += `max ele ${Math.round(g.courseProfileSummary.maxElevation)}m\n`;
      }
      // Previous best at this distance
      if (g.bestPrevious) {
        const hrs = Math.floor(g.bestPrevious.timeSeconds / 3600);
        const mins = Math.round((g.bestPrevious.timeSeconds % 3600) / 60);
        s += `  - Previous best at this distance: ${hrs}h ${mins}m `;
        s += `(${g.bestPrevious.pacePerKm}) on ${g.bestPrevious.date}`;
        if (g.bestPrevious.activityName !== g.name) {
          s += ` — "${g.bestPrevious.activityName}"`;
        }
        s += "\n";
      }

      // Weeks until goal
      const weeksUntil = Math.ceil(
        (new Date(g.targetDate).getTime() - Date.now()) / (7 * 86400000)
      );
      if (weeksUntil > 0) {
        s += `  - ${weeksUntil} weeks to train\n`;
      }
    }
    s += "\n";
  } else {
    s += "### Race Goals\nNo goals set.\n\n";
  }

  // PMC
  s += `### Fitness\nCTL: ${ctx.pmc.ctl}, ATL: ${ctx.pmc.atl}, TSB: ${ctx.pmc.tsb} (${ctx.pmc.tsbTrend})\n\n`;

  // Recent weeks
  s += "### Recent Weeks\n";
  for (const w of ctx.recentWeeks) {
    s += `- ${w.label}: ${formatDistance(w.volumeMeters, undefined, locale)}, ${w.activityCount} activities\n`;
  }

  // Current week
  s += `\n### This Week\nVolume: ${formatDistance(ctx.currentWeek.volumeMeters, undefined, locale)}, Activities: ${ctx.currentWeek.activityCount}\n`;

  // Fatigue
  if (ctx.fatigue) {
    s += `\n### Fatigue: ${ctx.fatigue.severity.toUpperCase()}\n`;
    for (const sig of ctx.fatigue.signals) s += `- ${sig}\n`;
  }

  // Health
  if (ctx.dailyHealth) {
    s += `\n### Health (7d avg)\n`;
    s += `Sleep: ${ctx.dailyHealth.sleepAvg}min, HRV: ${ctx.dailyHealth.hrvAvg}ms, Resting HR: ${ctx.dailyHealth.restingHrAvg}bpm\n`;
  }

  // Training context
  if (ctx.trainingContext) {
    s += `\n### Training Context\n${ctx.trainingContext}\n`;
  }

  // Full plan arc (capped at 12 weeks to save tokens)
  if (ctx.planWeeks.length > 0) {
    s += "\n### Training Plan (All Weeks)\n";
    const displayWeeks = ctx.planWeeks.slice(0, 12);
    for (const pw of displayWeeks) {
      const vol = pw.targetVolumeMeters
        ? `${formatDistance(pw.targetVolumeMeters, undefined, locale)}, `
        : "";
      s += `- Week of ${pw.weekStartDate}: ${vol}${pw.sessionCount} session(s)`;
      if (pw.adjustmentSummary) {
        s += ` — ${pw.adjustmentSummary}`;
      }
      s += "\n";
    }
    if (ctx.planWeeks.length > 12) {
      s += `- …${ctx.planWeeks.length - 12} more weeks remaining\n`;
    }
    s += "\n";
  }

  return s;
}

/** Re-export so callers that only need the PageContext type keep working. */
export type { PageContext };
