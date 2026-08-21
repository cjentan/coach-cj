import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { localDateStr, localDayOfWeek, localWeekStart } from "@/lib/utils";
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

/** Add `days` to a "YYYY-MM-DD" date string (calendar arithmetic, TZ-independent). */
function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDate = new Date(Date.UTC(y, m - 1, d));
  jsDate.setUTCDate(jsDate.getUTCDate() + days);
  const my = String(jsDate.getUTCMonth() + 1).padStart(2, "0");
  const md = String(jsDate.getUTCDate()).padStart(2, "0");
  return `${jsDate.getUTCFullYear()}-${my}-${md}`;
}

/** Day of week (0=Sun..6=Sat) of a "YYYY-MM-DD" date string. */
function dayOfWeekFromDateStr(dateStr: string): number {
  return new Date(dateStr + "T00:00:00Z").getUTCDay();
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Format a Date as "YYYY-MM-DD" using LOCAL timezone components.
 *
 * Imported from lib/utils. Uses local-timezone getters so `toISOString()`'s
 * UTC shift doesn't break date matching between plan dates (stored as
 * midnight in the server timezone) and training log UTC timestamps.
 *
 * See lib/utils.ts `localDateStr()` for full docs.
 */
// Shared implementation in src/lib/utils.ts — imported above.
// (Local copy removed in favor of shared utility.)

// ── Route ───────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // The browser reports its local timezone offset (minutes, negative for
  // UTC+). The server runs in UTC, so all day bucketing below is shifted by
  // this offset so activities land on the date the user actually sees.
  const url = new URL(request.url);
  const tzOffset = parseInt(url.searchParams.get("tzOffset") || "0", 10);

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

  // 2. Determine plan end date.
  //    Plans are generated across the full set of active goals and can span many
  //    months (Aug→Dec in the multi-race case), so the end must be derived from
  //    the plan's own extent rather than truncated at the *earliest* active race
  //    goal — that earlier logic hid every week after the first race. The end is
  //    the later of:
  //      - the end of the last generated week (+6 days), and
  //      - a 24-week default window from plan start / today (keeps the calendar's
  //        future activity overlay working even for a short/partial plan).
  const latestPlan = await prisma.weeklyPlan.findFirst({
    where: { userId },
    orderBy: { weekStartDate: "desc" },
    select: { weekStartDate: true },
  });

  const now = new Date();
  const latestPlanEnd = (latestPlan?.weekStartDate.getTime() ?? 0) + 6 * 86400000;
  const defaultEnd = earliestPlan.weekStartDate.getTime() + 84 * 86400000;
  const todayEnd = now.getTime() + 84 * 86400000;
  const planEndDate = new Date(Math.max(latestPlanEnd, defaultEnd, todayEnd));

  // 3. Fetch all WeeklyPlan records in the plan range
  const dbPlans = await prisma.weeklyPlan.findMany({
    where: {
      userId,
      weekStartDate: { gte: planStartDate, lte: planEndDate },
    },
    orderBy: { weekStartDate: "asc" },
  });

  // 4. Fetch all TrainingLog records in the plan range AND recent past
  //    (so activities before the plan started show on the calendar).
  const planEndPlus1 = new Date(planEndDate);
  planEndPlus1.setDate(planEndPlus1.getDate() + 1);

  // Look back up to 60 days from today (or planStart, whichever is earlier)
  // so the current month's calendar always shows recorded activities.
  const logLookback = new Date(now.getTime() - 60 * 86400_000);
  const logQueryStart = logLookback < planStartDate ? logLookback : planStartDate;

  const logs = await prisma.trainingLog.findMany({
    where: {
      userId,
      startDate: { gte: logQueryStart, lt: planEndPlus1 },
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

  // Group logs by the USER's local date string for O(1) lookup. startDate is a
  // UTC timestamp, so we shift by the browser's tzOffset before formatting —
  // otherwise a 6am UTC+8 run (10pm UTC the previous day) would land on the
  // wrong calendar day (see localDateStr doc).
  const logsByDate = new Map<string, typeof logs>();
  for (const log of logs) {
    const dateKey = localDateStr(log.startDate, tzOffset);
    if (!logsByDate.has(dateKey)) logsByDate.set(dateKey, []);
    logsByDate.get(dateKey)!.push(log);
  }

  // "Today" from the user's perspective — compare as YYYY-MM-DD strings so
  // the UTC server's clock can't highlight the wrong day.
  const todayStr = localDateStr(now, tzOffset);

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
      const dateStr = localDateStr(d, tzOffset);
      const dow = d.getDay();
      const isPast = dateStr < todayStr;
      const isToday = dateStr === todayStr;

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
      weekStart: localDateStr(weekStart),
      weekEnd: localDateStr(weekEnd),
      days,
      targetVolumeMeters: plan.targetVolumeMeters ?? undefined,
      targetElevationMeters: plan.targetElevationMeters ?? undefined,
      targetDurationSeconds: plan.targetDurationSeconds ?? undefined,
      adjustments: plan.adjustments || [],
      coachNotes: plan.coachNotes ?? undefined,
      phaseName,
    });

    phaseInputs.push({
      weekStart: localDateStr(weekStart),
      phaseName,
    });
  }

  // 6. Build "orphan" weeks — dates with training logs that are NOT part
  //    of any planned week (e.g. activities recorded before the plan started).
  //    This lets the calendar overlay recorded activities even when no plan
  //    session exists for that date.

  // Collect all dates already covered by the plan's weeks
  const planDates = new Set<string>();
  for (const week of weekResults) {
    for (const day of week.days) {
      planDates.add(day.date);
    }
  }

  // Group orphan logs into the USER's local Mon–Sun weeks. Each activity's
  // local date string is its key and its local day-of-week places it in the
  // right cell.
  const orphanWeeksMap = new Map<
    string,
    { weekStartStr: string; days: Map<number, PlanDayActual> }
  >();
  for (const [dateStr, dateLogs] of Array.from(logsByDate)) {
    if (planDates.has(dateStr)) continue; // already covered by a planned week

    const best = dateLogs[0];
    const weekKey = localWeekStart(best.startDate, tzOffset);
    const dow = dayOfWeekFromDateStr(dateStr);

    if (!orphanWeeksMap.has(weekKey)) {
      orphanWeeksMap.set(weekKey, { weekStartStr: weekKey, days: new Map() });
    }
    orphanWeeksMap.get(weekKey)!.days.set(dow, {
      type: best.type,
      name: best.name,
      distanceMeters: best.distanceMeters,
      elevationGainMeters: best.elevationGainMeters,
      durationSeconds: best.durationSeconds,
      activityId: best.id,
      source: best.source,
    });
  }

  // Convert orphan weeks to PlanWeekData (full 7-day array, only actual days populated)
  const orphanWeeks: PlanWeekData[] = [];
  for (const [, wd] of Array.from(orphanWeeksMap)) {
    const days: PlanDay[] = [];

    for (let i = 0; i < 7; i++) {
      const dateStr = addDaysToDateStr(wd.weekStartStr, i);
      const dow = dayOfWeekFromDateStr(dateStr);
      const isPast = dateStr < todayStr;
      const isToday = dateStr === todayStr;

      days.push({
        date: dateStr,
        dayLabel: SHORT_DAY_NAMES[dow],
        dayOfWeek: dow,
        planned: null,
        actual: wd.days.get(dow) ?? null,
        isPast,
        isToday,
      });
    }

    orphanWeeks.push({
      weekStart: wd.weekStartStr,
      weekEnd: addDaysToDateStr(wd.weekStartStr, 6),
      days,
    });
  }

  // Merge orphan weeks with plan weeks, sorted chronologically
  weekResults.push(...orphanWeeks);
  weekResults.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Group into phases (orphan weeks are intentionally excluded from phaseInputs
  // since they represent unplanned activity-only periods)
  const phases = groupPhases(phaseInputs);

  return NextResponse.json<TrainingPlanResponse>({
    planStartDate: localDateStr(planStartDate),
    planEndDate: localDateStr(planEndDate),
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
