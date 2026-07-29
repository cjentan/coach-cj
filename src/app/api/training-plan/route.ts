import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart } from "@/lib/utils";
import { clearContext } from "@/lib/ai-conversation";
import { PHASE_COLORS, SHORT_DAY_NAMES } from "@/lib/constants";
import type {
  TrainingPlanResponse,
  TrainingPlanPhase,
  PlanWeekData,
  PlanDay,
  PlanDayPlanned,
  PlanDayActual,
} from "@/lib/training-plan-types";

// ── Phase detection ─────────────────────────────────────

const PHASE_NAMES = ["Base", "Build", "Peak", "Taper", "Race"] as const;

/**
 * Map an AI-generated phase name to one of the canonical phase names.
 * Handles variants like "Base Phase", "Build Phase 1", "Peak Phase", etc.
 */
function mapPhaseName(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (lower.includes("base")) return "Base";
  if (lower.includes("build")) return "Build";
  if (lower.includes("peak")) return "Peak";
  if (lower.includes("taper")) return "Taper";
  if (lower.includes("race")) return "Race";
  return null;
}

/**
 * Extract the canonical phase name from a weekly plan record.
 *
 * Priority order (most reliable first):
 *  1. adjustmentHistory[0].prompt — the canonical `phaseName` the AI passed
 *     to create_training_phase, stored as "AI Coach: Build Phase 1 (Phase 2)…"
 *  2. adjustments[] entries — "🏋️ Build Phase 1 W1: …"
 *  3. coachNotes text matching — the old keyword-based heuristic
 */
function extractPhaseNameFromWeek(plan: {
  coachNotes: string | null;
  adjustmentHistory: unknown;
  adjustments: string[];
}): string | null {
  // ── Source 1: adjustmentHistory[0].prompt ──
  // The create_training_phase tool stores the canonical phaseName here.
  // Format: "AI Coach: Build Phase 1 (Phase 2) — Introduce threshold work"
  const history = plan.adjustmentHistory as Array<{ prompt?: string }> | null;
  if (Array.isArray(history) && history.length > 0) {
    const prompt = history[0]?.prompt;
    if (prompt) {
      const match = /AI Coach:\s*(.+?)\s*(?:\(Phase\s+\d+\)|—|$)/i.exec(prompt);
      if (match) {
        const canonical = mapPhaseName(match[1].trim());
        if (canonical) return canonical;
      }
    }
  }

  // ── Source 2: adjustments[] entries ──
  // The create_training_phase tool also stores "🏋️ Build Phase 1 W1: …"
  if (Array.isArray(plan.adjustments) && plan.adjustments.length > 0) {
    for (const adj of plan.adjustments) {
      if (adj.startsWith("🏋️")) {
        const match = /🏋️\s*(.+?)\s+W\d/i.exec(adj);
        if (match) {
          const canonical = mapPhaseName(match[1].trim());
          if (canonical) return canonical;
        }
      }
    }
  }

  // ── Source 3: fall back to coachNotes text matching ──
  return detectPhaseInText(plan.coachNotes);
}

/**
 * Fallback: scan coachNotes for phase keywords.
 * Only used when adjustmentHistory/adjustments don't have a phase name.
 */
function detectPhaseInText(text: string | null | undefined): string | null {
  if (!text) return null;

  // Priority 1: explicit "Phase: Base" / "phase: build" pattern
  const explicit = /phase:\s*(Base|Build|Peak|Taper|Race)\b/i.exec(text);
  if (explicit) return capitalize(explicit[1]);

  // Priority 2: line starts with the phase name
  const startMatch = /^(Base|Build|Peak|Taper|Race)\b/i.exec(text);
  if (startMatch) return capitalize(startMatch[1]);

  // Priority 3: word-boundary match elsewhere in the text
  for (const name of PHASE_NAMES) {
    const re = new RegExp(`\\b${name}\\b`, "i");
    if (re.test(text)) return name;
  }

  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Group contiguous weeks with the same phase into TrainingPlanPhase objects.
 */
function groupPhases(
  weeks: Array<{ weekStart: string; phaseName: string | null }>,
): TrainingPlanPhase[] {
  const phases: TrainingPlanPhase[] = [];

  for (const week of weeks) {
    const name = week.phaseName || "General";
    const last = phases[phases.length - 1];

    if (last && last.name === name) {
      // Extend the current phase
      last.weekEnd = week.weekStart;
    } else {
      // Start a new phase
      phases.push({
        name,
        weekStart: week.weekStart,
        weekEnd: week.weekStart,
        description: null,
        color: PHASE_COLORS[name] ?? "#6b7280",
      });
    }
  }

  return phases;
}

// ── Route ───────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // 1. Find the earliest weekly plan to determine the plan start date
  const earliestPlan = await prisma.weeklyPlan.findFirst({
    where: { userId },
    orderBy: { weekStartDate: "asc" },
    select: { weekStartDate: true },
  });

  if (!earliestPlan) {
    // No plan at all — return empty response
    return NextResponse.json<TrainingPlanResponse>({
      planStartDate: "",
      planEndDate: "",
      phases: [],
      weeks: [],
    });
  }

  const planStartDate = earliestPlan.weekStartDate;

  // 2. Determine plan end date (nearest active RaceGoal, or +24 weeks)
  const nearestGoal = await prisma.raceGoal.findFirst({
    where: { userId, status: "active" },
    orderBy: { targetDate: "asc" },
    select: { targetDate: true },
  });

  const now = new Date();
  // Default plan end: 24 weeks from the earlier of planStart or today
  const defaultEnd = earliestPlan.weekStartDate.getTime() + 84 * 86400000;
  const todayEnd = now.getTime() + 84 * 86400000;
  const planEndDate = nearestGoal
    ? nearestGoal.targetDate
    : new Date(Math.max(defaultEnd, todayEnd));

  // 3. Fetch all WeeklyPlan records in the plan range
  const dbPlans = await prisma.weeklyPlan.findMany({
    where: {
      userId,
      weekStartDate: { gte: planStartDate, lte: planEndDate },
    },
    orderBy: { weekStartDate: "asc" },
  });

  // 4. Fetch all TrainingLog records in the same range
  const planEndPlus1 = new Date(planEndDate);
  planEndPlus1.setDate(planEndPlus1.getDate() + 1);

  const logs = await prisma.trainingLog.findMany({
    where: {
      userId,
      startDate: { gte: planStartDate, lt: planEndPlus1 },
      mergedIntoId: null,
    },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      startDate: true,
      distanceMeters: true,
      elevationGainMeters: true,
      durationSeconds: true,
      source: true,
    },
  });

  // Group logs by date string for O(1) lookup
  const logsByDate = new Map<string, typeof logs>();
  for (const log of logs) {
    const dateKey = log.startDate.toISOString().split("T")[0];
    if (!logsByDate.has(dateKey)) logsByDate.set(dateKey, []);
    logsByDate.get(dateKey)!.push(log);
  }

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 5. Build weeks + derived phases
  const weekResults: PlanWeekData[] = [];
  const phaseInputs: Array<{ weekStart: string; phaseName: string | null }> = [];

  for (const plan of dbPlans) {
    const weekStart = plan.weekStartDate;
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Parse sessions
    const sessions = (plan.plannedSessions as unknown as Array<{
      dayOfWeek: number;
      type: string;
      description: string;
      targetDistance?: number | null;
      targetElevation?: number | null;
      targetDuration?: number;
    }>) || [];

    // Parse adjustment history for changed-day info
    const adjHistory = (plan.adjustmentHistory as unknown as Array<{
      timestamp: string;
      dayChanges?: Array<{ dayOfWeek: number; reason: string }>;
      dayOfWeek?: number;
      reason?: string;
    }>) || [];

    const changedDays = new Map<number, { changedAt: string; changeReason: string }>();
    for (const entry of adjHistory) {
      const dayChanges = entry.dayChanges;
      if (dayChanges && Array.isArray(dayChanges)) {
        for (const dc of dayChanges) {
          if (dc.reason && !dc.reason.startsWith("Skipped")) {
            changedDays.set(dc.dayOfWeek, {
              changedAt: entry.timestamp,
              changeReason: dc.reason,
            });
          }
        }
      }
      if (entry.dayOfWeek !== undefined && entry.reason) {
        changedDays.set(entry.dayOfWeek, {
          changedAt: entry.timestamp,
          changeReason: entry.reason,
        });
      }
    }

    // Build days array
    const days: PlanDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const dow = d.getDay();
      const isPast = d < todayStart;
      const isToday = d.getTime() === todayStart.getTime();

      const session = sessions.find((s) => s.dayOfWeek === dow);
      const changeInfo = changedDays.get(dow);

      const planned: PlanDayPlanned | null = session
        ? {
            type: session.type,
            description: session.description,
            targetDistance: session.targetDistance ?? null,
            targetElevation: session.targetElevation ?? null,
            targetDuration: session.targetDuration ?? null,
            ...(changeInfo
              ? { changedAt: changeInfo.changedAt, changeReason: changeInfo.changeReason }
              : {}),
          }
        : null;

      let actual: PlanDayActual | null = null;
      const dateLogs = logsByDate.get(dateStr);
      if (dateLogs && dateLogs.length > 0) {
        const best = dateLogs[0];
        actual = {
          type: best.type,
          name: best.name,
          distanceMeters: best.distanceMeters,
          elevationGainMeters: best.elevationGainMeters,
          durationSeconds: best.durationSeconds,
          activityId: best.id,
          source: best.source,
        };
      }

      days.push({ date: dateStr, dayLabel: SHORT_DAY_NAMES[dow], dayOfWeek: dow, planned, actual, isPast, isToday });
    }

    // Detect phase — uses authoritative phase name from
    // adjustmentHistory (set by the AI tool call), with fallbacks.
    const phaseName = extractPhaseNameFromWeek({
      coachNotes: plan.coachNotes,
      adjustmentHistory: plan.adjustmentHistory,
      adjustments: plan.adjustments,
    });

    weekResults.push({
      weekStart: weekStart.toISOString().split("T")[0],
      weekEnd: weekEnd.toISOString().split("T")[0],
      days,
      targetVolumeMeters: plan.targetVolumeMeters ?? undefined,
      targetElevationMeters: plan.targetElevationMeters ?? undefined,
      targetDurationSeconds: plan.targetDurationSeconds ?? undefined,
      adjustments: plan.adjustments || [],
      coachNotes: plan.coachNotes ?? undefined,
      phaseName,
    });

    phaseInputs.push({
      weekStart: weekStart.toISOString().split("T")[0],
      phaseName,
    });
  }

  // Group into phases
  const phases = groupPhases(phaseInputs);

  return NextResponse.json<TrainingPlanResponse>({
    planStartDate: planStartDate.toISOString().split("T")[0],
    planEndDate: planEndDate.toISOString().split("T")[0],
    phases,
    weeks: weekResults,
  });
}

// ── DELETE: clear the user's training plan ────────────────

export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await clearContext(session.user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to clear plan";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
