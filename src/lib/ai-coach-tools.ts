/**
 * Tool execution functions and dispatcher for the AI Coach.
 *
 * These tools let the LLM modify user data directly during a coaching
 * conversation — updating training context, managing race goals,
 * promoting activities to goals, managing training plans, and
 * querying activity history.
 *
 * The static tool descriptors sent to the LLM live in
 * `ai-coach-tools-defs.ts` and are re-exported here so existing imports
 * of `ai-coach-tools` keep working unchanged.
 */
import { prisma } from "./prisma";
import { getWeekStart } from "./utils";
import {
  UPDATE_TRAINING_CONTEXT_TOOL,
  MANAGE_GOALS_TOOL,
  SET_ACTIVITY_AS_GOAL_TOOL,
  UPDATE_WEEKLY_PLAN_TOOL,
  GET_WEEKLY_PLAN_TOOL,
  UPDATE_TRAINING_DAY_TOOL,
  QUERY_ACTIVITIES_TOOL,
  CREATE_TRAINING_PHASE_TOOL,
  CREATE_FULL_TRAINING_PLAN_TOOL,
  LOOKUP_RACE_TOOL,
  ALL_COACH_TOOLS,
} from "./ai-coach-tools-defs";

// Re-export the tool descriptors so existing importers of "./ai-coach-tools"
// keep working without modification.
export {
  UPDATE_TRAINING_CONTEXT_TOOL,
  MANAGE_GOALS_TOOL,
  SET_ACTIVITY_AS_GOAL_TOOL,
  UPDATE_WEEKLY_PLAN_TOOL,
  GET_WEEKLY_PLAN_TOOL,
  UPDATE_TRAINING_DAY_TOOL,
  QUERY_ACTIVITIES_TOOL,
  CREATE_TRAINING_PHASE_TOOL,
  CREATE_FULL_TRAINING_PLAN_TOOL,
  LOOKUP_RACE_TOOL,
  ALL_COACH_TOOLS,
} from "./ai-coach-tools-defs";

// ── Progress callback type ────────────────────────────

/**
 * Callback for forwarding granular progress events from tool execution
 * back through the SSE stream to the frontend.
 */
export type ToolProgressCallback = (event: Record<string, unknown>) => void;

// ── Tool execution ────────────────────────────────────

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  onProgress?: ToolProgressCallback
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "update_training_context":
      return executeUpdateTrainingContext(userId, args);
    case "manage_goals":
      return executeManageGoals(userId, args);
    case "set_activity_as_goal":
      return executeSetActivityAsGoal(userId, args);
    case "update_weekly_plan":
      return executeUpdateWeeklyPlan(userId, args);
    case "get_weekly_plan":
      return executeGetWeeklyPlan(userId, args);
    case "update_training_day":
      return executeUpdateTrainingDay(userId, args);
    case "query_activities":
      return executeQueryActivities(userId, args);
    case "create_training_phase":
      return executeCreateTrainingPhase(userId, args, onProgress);
    case "lookup_race":
      return executeLookupRace(userId, args);
    default:
      return { success: false, message: `Unknown tool: ${toolName}` };
  }
}

// ── Tool implementations ──────────────────────────────

async function executeUpdateTrainingContext(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const trainingContext = args.trainingContext as string;
  if (!trainingContext || typeof trainingContext !== "string") {
    return { success: false, message: "trainingContext must be a non-empty string." };
  }
  await prisma.user.update({
    where: { id: userId },
    data: { trainingContext },
  });
  return {
    success: true,
    message: "Training context updated successfully.",
    data: { trainingContext },
  };
}

async function executeManageGoals(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const action = args.action as string;
  const goal = args.goal as Record<string, unknown> | undefined;

  switch (action) {
    case "create": {
      if (!goal?.name || !goal?.raceType || !goal?.targetDate || !goal?.distanceMeters) {
        return { success: false, message: "Creating a goal requires: name, raceType, targetDate, distanceMeters." };
      }
      const created = await prisma.raceGoal.create({
        data: {
          userId,
          name: goal.name as string,
          raceType: goal.raceType as string,
          targetDate: new Date(goal.targetDate as string),
          distanceMeters: goal.distanceMeters as number,
          elevationGainMeters: (goal.elevationGainMeters as number) ?? undefined,
          targetTimeSeconds: (goal.targetTimeSeconds as number) ?? undefined,
          priority: (goal.priority as "A" | "B" | "C") ?? "B",
          goalStatement: (goal.goalStatement as string) ?? undefined,
        },
      });
      return {
        success: true,
        message: `Goal "${created.name}" created successfully.`,
        data: { id: created.id, name: created.name },
      };
    }

    case "update": {
      const goalId = goal?.id as string;
      if (!goalId) return { success: false, message: "Updating a goal requires goal.id." };
      const existing = await prisma.raceGoal.findUnique({ where: { id: goalId } });
      if (!existing || existing.userId !== userId) return { success: false, message: "Goal not found." };
      if (!goal) return { success: false, message: "Goal data is required for update." };

      const updateData: Record<string, unknown> = {};
      if (goal?.name !== undefined) updateData.name = goal.name;
      if (goal?.raceType !== undefined) updateData.raceType = goal.raceType;
      if (goal?.targetDate !== undefined) updateData.targetDate = new Date(goal.targetDate as string);
      if (goal?.distanceMeters !== undefined) updateData.distanceMeters = goal.distanceMeters;
      if (goal?.elevationGainMeters !== undefined) updateData.elevationGainMeters = goal.elevationGainMeters;
      if (goal?.targetTimeSeconds !== undefined) updateData.targetTimeSeconds = goal.targetTimeSeconds;
      if (goal?.priority !== undefined) updateData.priority = goal.priority;
      if (goal?.goalStatement !== undefined) updateData.goalStatement = goal.goalStatement;
      if (goal?.status !== undefined) updateData.status = goal.status;

      if (Object.keys(updateData).length === 0) return { success: false, message: "No fields provided to update." };
      await prisma.raceGoal.update({ where: { id: goalId }, data: updateData });
      return { success: true, message: "Goal updated successfully." };
    }

    case "list": {
      const allGoals = await prisma.raceGoal.findMany({
        where: { userId },
        orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
        select: {
          id: true, name: true, raceType: true, targetDate: true,
          distanceMeters: true, elevationGainMeters: true,
          targetTimeSeconds: true, priority: true, status: true, goalStatement: true,
        },
      });
      if (allGoals.length === 0) return { success: true, message: "You have no race goals set up yet.", data: { goals: [] } };
      return {
        success: true,
        message: `Found ${allGoals.length} goal(s).`,
        data: {
          count: allGoals.length,
          goals: allGoals.map((g) => ({
            id: g.id, name: g.name, raceType: g.raceType,
            targetDate: g.targetDate.toISOString().split("T")[0],
            distanceMeters: g.distanceMeters,
            elevationGainMeters: g.elevationGainMeters,
            targetTimeSeconds: g.targetTimeSeconds,
            priority: g.priority, status: g.status, goalStatement: g.goalStatement,
          })),
        },
      };
    }

    case "delete": {
      const goalId = goal?.id as string;
      if (!goalId) return { success: false, message: "Deleting a goal requires goal.id." };
      const existing = await prisma.raceGoal.findUnique({ where: { id: goalId } });
      if (!existing || existing.userId !== userId) return { success: false, message: "Goal not found." };
      await prisma.raceGoal.delete({ where: { id: goalId } });
      return { success: true, message: `Goal "${existing.name}" deleted.` };
    }

    default:
      return { success: false, message: `Unknown action: ${action}. Use create, update, delete, or list.` };
  }
}

async function executeSetActivityAsGoal(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const activityId = args.activityId as string;
  if (!activityId) return { success: false, message: "activityId is required." };

  const activity = await prisma.trainingLog.findUnique({ where: { id: activityId } });
  if (!activity || activity.userId !== userId) return { success: false, message: "Activity not found." };

  let raceType = "other";
  if (activity.type === "run") {
    const distKm = (activity.distanceMeters || 0) / 1000;
    if (distKm >= 42.195) raceType = "marathon";
    else if (distKm > 30) raceType = "ultra";
    else raceType = "road_run";
  } else if (activity.type === "ride") raceType = "cycling";
  else if (activity.type === "swim") raceType = "triathlon";

  const activityDate = new Date(activity.startDate);
  const defaultTarget = new Date(activityDate);
  defaultTarget.setDate(defaultTarget.getDate() + 84);
  const targetDate = args.targetDate ? new Date(args.targetDate as string) : defaultTarget;

  const created = await prisma.raceGoal.create({
    data: {
      userId, name: activity.name, raceType, targetDate,
      distanceMeters: activity.distanceMeters || 0,
      elevationGainMeters: activity.elevationGainMeters ?? undefined,
      priority: (args.priority as "A" | "B" | "C") ?? "B",
      goalStatement: (args.goalStatement as string) ?? undefined,
    },
  });

  return {
    success: true,
    message: `"${activity.name}" has been set as a race goal. Priority: ${created.priority}, Target date: ${created.targetDate.toISOString().split("T")[0]}`,
    data: { id: created.id, name: created.name, distanceMeters: created.distanceMeters, targetDate: created.targetDate.toISOString().split("T")[0] },
  };
}

async function executeUpdateWeeklyPlan(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let weekStart: Date;
  if (args.weekStart) {
    weekStart = getWeekStart(new Date(args.weekStart as string));
  } else {
    weekStart = getWeekStart(now);
    weekStart.setDate(weekStart.getDate() + 7);
  }

  const rawSessions = args.sessions as Array<Record<string, unknown>> | undefined;
  const targetVolumeMeters = args.targetVolumeMeters as number | undefined;
  const targetElevationMeters = args.targetElevationMeters as number | undefined;
  const targetDurationSeconds = args.targetDurationSeconds as number | undefined;
  const coachNotes = args.coachNotes as string | undefined;

  const updateData: Record<string, unknown> = { overridesExisting: true, generatedAt: now };
  const perDayChanges: Array<{ dayOfWeek: number; reason: string }> = [];
  let validSessions: Array<Record<string, unknown>> | undefined;

  if (rawSessions !== undefined) {
    validSessions = [];
    for (const s of rawSessions) {
      const dow = s.dayOfWeek as number;
      const sessionDate = new Date(weekStart);
      sessionDate.setDate(sessionDate.getDate() + dow);
      if (sessionDate < todayStart) {
        perDayChanges.push({ dayOfWeek: dow, reason: "Skipped — this day has already passed" });
      } else {
        const desc = s.description as string;
        perDayChanges.push({ dayOfWeek: dow, reason: `Updated: ${desc.slice(0, 80)}` });
        validSessions.push(s);
      }
    }
    updateData.plannedSessions = structuredClone(validSessions) as any;
  }

  if (targetVolumeMeters !== undefined) updateData.targetVolumeMeters = targetVolumeMeters;
  if (targetElevationMeters !== undefined) updateData.targetElevationMeters = targetElevationMeters;
  if (targetDurationSeconds !== undefined) updateData.targetDurationSeconds = targetDurationSeconds;
  if (coachNotes !== undefined) updateData.coachNotes = coachNotes;

  const skippedCount = perDayChanges.filter((c) => c.reason.startsWith("Skipped")).length;
  const changedCount = perDayChanges.filter((c) => c.reason.startsWith("Updated")).length;

  const adjEntry = {
    timestamp: now.toISOString(),
    prompt: "AI Coach: Training plan update",
    summary: coachNotes
      ? `AI Coach: ${coachNotes.slice(0, 200)}`
      : `AI Coach: ${changedCount} session(s) updated${skippedCount > 0 ? `, ${skippedCount} past day(s) skipped` : ""}`,
    dayChanges: perDayChanges,
  };

  let plan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
  });

  if (plan) {
    const history = (plan.adjustmentHistory as Array<Record<string, unknown>>) || [];
    history.push(adjEntry);
    updateData.adjustmentHistory = history;
    updateData.adjustments = [`🤖 ${adjEntry.summary}`, ...(plan.adjustments || [])];
    await prisma.weeklyPlan.update({ where: { id: plan.id }, data: updateData });
  } else {
    await prisma.weeklyPlan.create({
      data: {
        userId, weekStartDate: weekStart,
        plannedSessions: validSessions ? structuredClone(validSessions) as any : [],
        targetVolumeMeters: targetVolumeMeters ?? undefined,
        targetElevationMeters: targetElevationMeters ?? undefined,
        targetDurationSeconds: targetDurationSeconds ?? undefined,
        coachNotes: coachNotes ?? undefined,
        overridesExisting: true, generatedAt: now,
        adjustments: [`🤖 ${adjEntry.summary}`],
        adjustmentHistory: [adjEntry],
      },
    });
  }

  return {
    success: true,
    message: `Weekly plan updated for ${weekStart.toISOString().split("T")[0]}.`,
    data: {
      weekStart: weekStart.toISOString().split("T")[0],
      sessionCount: validSessions?.length ?? 0,
      skippedPastDays: skippedCount,
      ...(targetVolumeMeters !== undefined ? { targetVolumeMeters } : {}),
    },
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Read one week's planned sessions from the training plan.
 * Returns the full daily breakdown so the LLM can examine a specific
 * week or day before proposing changes.
 */
async function executeGetWeeklyPlan(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  let weekStart: Date;
  if (args.weekStart) {
    const ws = new Date(args.weekStart as string);
    if (isNaN(ws.getTime())) {
      return { success: false, message: "Invalid weekStart date. Use YYYY-MM-DD format." };
    }
    weekStart = getWeekStart(ws);
  } else {
    weekStart = getWeekStart(new Date());
  }
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const plan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
  });

  if (!plan) {
    return {
      success: true,
      message: `No training plan exists for the week of ${weekStartStr}.`,
      data: { weekStart: weekStartStr, sessions: [] },
    };
  }

  const sessions = (Array.isArray(plan.plannedSessions) ? plan.plannedSessions : []) as Array<Record<string, unknown>>;
  const dayLabels = DAY_NAMES.map((n, i) => {
    const s = sessions.find((x) => x.dayOfWeek === i);
    return s ? `${n}: ${s.type}${s.description ? ` — ${(s.description as string).slice(0, 60)}` : ""}` : `${n}: no plan`;
  });

  return {
    success: true,
    message: `Week of ${weekStartStr}: ${sessions.length} planned session(s).\n${dayLabels.join("\n")}`,
    data: {
      weekStart: weekStartStr,
      targetVolumeMeters: plan.targetVolumeMeters,
      targetElevationMeters: plan.targetElevationMeters,
      targetDurationSeconds: plan.targetDurationSeconds,
      coachNotes: plan.coachNotes,
      sessions: sessions.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        type: s.type,
        description: s.description,
        targetDistance: s.targetDistance,
        targetElevation: s.targetElevation,
        targetDuration: s.targetDuration,
        facility: s.facility,
      })),
    },
  };
}

/**
 * Change a single day's planned session in a specific week.
 * Only the provided fields are merged onto that day's session — all other
 * days in the week are preserved. Creates the weekly plan if none exists.
 */
async function executeUpdateTrainingDay(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const weekStartStr = args.weekStart as string;
  if (!weekStartStr) {
    return { success: false, message: "weekStart (YYYY-MM-DD) is required." };
  }
  const parsedWeekStart = new Date(weekStartStr);
  if (isNaN(parsedWeekStart.getTime())) {
    return { success: false, message: "Invalid weekStart date. Use YYYY-MM-DD format." };
  }
  const weekStart = getWeekStart(parsedWeekStart);
  const dayOfWeek = args.dayOfWeek as number;
  if (dayOfWeek === undefined || dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6) {
    return { success: false, message: "dayOfWeek (0-6) is required." };
  }

  // Merge only the fields the LLM provided
  const overrides: Record<string, unknown> = {};
  if (args.type !== undefined) overrides.type = args.type;
  if (args.description !== undefined) overrides.description = args.description;
  if (args.targetDistance !== undefined) overrides.targetDistance = args.targetDistance;
  if (args.targetElevation !== undefined) overrides.targetElevation = args.targetElevation;
  if (args.targetDuration !== undefined) overrides.targetDuration = args.targetDuration;
  if (args.facility !== undefined) overrides.facility = args.facility;

  if (Object.keys(overrides).length === 0) {
    return { success: false, message: "Provide at least one field to change (type, description, targetDistance, targetElevation, targetDuration, or facility)." };
  }

  // A rest day carries no training targets — zero them so a workout's stale
  // distance/duration don't linger on the rest session.
  if (overrides.type === "rest") {
    if (overrides.targetDistance === undefined) overrides.targetDistance = null;
    if (overrides.targetElevation === undefined) overrides.targetElevation = null;
    if (overrides.targetDuration === undefined) overrides.targetDuration = 0;
  }

  // Reject changes to days that have already passed
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionDate = new Date(weekStart);
  sessionDate.setDate(sessionDate.getDate() + dayOfWeek);
  if (sessionDate < todayStart) {
    const dateStr = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`;
    return { success: false, message: `Cannot change ${DAY_NAMES[dayOfWeek]} (${dateStr}) — this day has already passed.` };
  }

  // Load the current week's sessions (or start fresh)
  const existingPlan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
  });
  const sessions = (Array.isArray(existingPlan?.plannedSessions) ? existingPlan.plannedSessions : []) as Array<Record<string, unknown>>;

  const idx = sessions.findIndex((s) => s.dayOfWeek === dayOfWeek);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...overrides };
  } else {
    sessions.push({ dayOfWeek, ...overrides });
  }

  const updated = sessions[idx >= 0 ? idx : sessions.length - 1];
  const changeSummary = updated.type === "rest"
    ? `${DAY_NAMES[dayOfWeek]} set to rest day`
    : `${DAY_NAMES[dayOfWeek]} updated to ${updated.type}: ${String(updated.description || "").slice(0, 80)}`;

  const adjEntry = {
    timestamp: now.toISOString(),
    prompt: "AI Coach: Training day update",
    summary: changeSummary,
    dayChanges: [{ dayOfWeek, reason: `Updated: ${changeSummary}` }],
  };

  const updateData: Record<string, unknown> = {
    plannedSessions: structuredClone(sessions) as any,
    overridesExisting: true,
    generatedAt: now,
  };

  if (existingPlan) {
    const history = (existingPlan.adjustmentHistory as Array<Record<string, unknown>>) || [];
    history.push(adjEntry);
    updateData.adjustmentHistory = history;
    updateData.adjustments = [`🤖 ${changeSummary}`, ...(existingPlan.adjustments || [])];
    await prisma.weeklyPlan.update({ where: { id: existingPlan.id }, data: updateData });
  } else {
    await prisma.weeklyPlan.create({
      data: {
        userId,
        weekStartDate: weekStart,
        plannedSessions: structuredClone(sessions) as any,
        overridesExisting: true,
        generatedAt: now,
        adjustments: [`🤖 ${changeSummary}`],
        adjustmentHistory: [adjEntry],
      },
    });
  }

  return {
    success: true,
    message: `Week of ${weekStartStr}, ${changeSummary}.`,
    data: {
      weekStart: weekStartStr,
      dayOfWeek,
      session: {
        dayOfWeek: updated.dayOfWeek,
        type: updated.type,
        description: updated.description,
        targetDistance: updated.targetDistance,
        targetElevation: updated.targetElevation,
        targetDuration: updated.targetDuration,
        facility: updated.facility,
      },
    },
  };
}

export async function executeCreateTrainingPhase(
  userId: string,
  args: Record<string, unknown>,
  onProgress?: ToolProgressCallback
): Promise<ToolExecutionResult> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const phaseName = args.phaseName as string;
  const phaseGoal = args.phaseGoal as string;
  const raceGoalId = args.raceGoalId as string;
  const phaseOrder = args.phaseOrder as number;
  const weeks = args.weeks as Array<Record<string, unknown>> | undefined;

  if (!phaseName || !phaseGoal || !raceGoalId || !phaseOrder || !weeks || !Array.isArray(weeks)) {
    return { success: false, message: "phaseName, phaseGoal, raceGoalId, phaseOrder, and weeks array are required." };
  }
  if (weeks.length < 1) {
    return { success: false, message: "A phase must have at least 1 week." };
  }

  // Verify the race goal exists and belongs to this user
  const goal = await prisma.raceGoal.findUnique({
    where: { id: raceGoalId },
    select: { userId: true, name: true },
  });
  if (!goal || goal.userId !== userId) {
    return { success: false, message: "Race goal not found." };
  }

  const savedWeeks: string[] = [];
  let totalSessionsSaved = 0;
  let totalWorkoutsSaved = 0;
  let totalRestSaved = 0;
  let totalPastSkipped = 0;

  const totalWeeks = weeks.length;
  for (let wi = 0; wi < totalWeeks; wi++) {
    const week = weeks[wi];
    const weekStartStr = week.weekStart as string;
    if (!weekStartStr) {
      return { success: false, message: "Each week must have a weekStart (YYYY-MM-DD)." };
    }

    // Fire per-week saving progress
    onProgress?.({
      type: "progress",
      phaseName,
      phaseOrder,
      weekCurrent: wi + 1,
      weekTotal: totalWeeks,
      weekStart: weekStartStr,
      message: `Saving week ${wi + 1} of ${totalWeeks} for ${phaseName}`,
    });

    const weekStart = getWeekStart(new Date(weekStartStr));
    const sessions = week.sessions as Array<Record<string, unknown>> | undefined;
    const targetVolumeMeters = week.targetVolumeMeters as number | undefined;
    const targetElevationMeters = week.targetElevationMeters as number | undefined;
    const coachNotes = week.coachNotes as string | undefined;

    if (!sessions || !Array.isArray(sessions)) {
      return { success: false, message: `Week ${weekStartStr} has no sessions array.` };
    }

    // Filter past days + build per-day change log
    const perDayChanges: Array<{ dayOfWeek: number; reason: string }> = [];
    const validSessions: Array<Record<string, unknown>> = [];

    for (const s of sessions) {
      const dow = s.dayOfWeek as number;
      const sessionDate = new Date(weekStart);
      sessionDate.setDate(sessionDate.getDate() + dow);

      if (sessionDate < todayStart) {
        perDayChanges.push({ dayOfWeek: dow, reason: "Skipped — this day has already passed" });
        totalPastSkipped++;
      } else {
        const desc = (s.description as string) || "";
        perDayChanges.push({ dayOfWeek: dow, reason: `Created: ${desc.slice(0, 80)}` });
        validSessions.push(s);
        totalSessionsSaved++;
        // Separate rest days from actual workouts so phase summaries don't
        // read like every day is a training session.
        if (String(s.type) === "rest") {
          totalRestSaved++;
        } else {
          totalWorkoutsSaved++;
        }
      }
    }

    // Build adjustment entry for this week
    const adjEntry = {
      timestamp: now.toISOString(),
      prompt: `AI Coach: ${phaseName} (Phase ${phaseOrder}) — ${phaseGoal}`,
      summary: coachNotes
        ? `${phaseName} Week ${week.weekNumber}: ${coachNotes.slice(0, 200)}`
        : `${phaseName} Week ${week.weekNumber}: ${validSessions.length} session(s)`,
      dayChanges: perDayChanges,
    };

    // Upsert the weekly plan
    const existingPlan = await prisma.weeklyPlan.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
    });

    if (existingPlan) {
      const history = (existingPlan.adjustmentHistory as Array<Record<string, unknown>>) || [];
      history.push(adjEntry);

      const updateData: Record<string, unknown> = {
        plannedSessions: structuredClone(validSessions) as any,
        targetVolumeMeters: targetVolumeMeters ?? undefined,
        targetElevationMeters: targetElevationMeters ?? undefined,
        coachNotes: coachNotes ?? undefined,
        overridesExisting: true,
        generatedAt: now,
        anchorGoalId: raceGoalId,
        adjustmentHistory: structuredClone(history) as any,
        adjustments: [
          `🏋️ ${phaseName} W${week.weekNumber}: ${coachNotes || `${validSessions.length} session(s)`}`,
          ...(existingPlan.adjustments || []),
        ],
      };

      await prisma.weeklyPlan.update({
        where: { id: existingPlan.id },
        data: updateData,
      });
    } else {
      const createData: Record<string, unknown> = {
        userId,
        weekStartDate: weekStart,
        plannedSessions: structuredClone(validSessions) as any,
        targetVolumeMeters: targetVolumeMeters ?? undefined,
        targetElevationMeters: targetElevationMeters ?? undefined,
        coachNotes: coachNotes ?? undefined,
        overridesExisting: true,
        generatedAt: now,
        anchorGoalId: raceGoalId,
        adjustmentHistory: structuredClone([adjEntry]) as any,
        adjustments: [`🏋️ ${phaseName} W${week.weekNumber}: ${coachNotes || `${validSessions.length} session(s)`}`],
      };

      await prisma.weeklyPlan.create({
        data: createData as any,
      });
    }

    savedWeeks.push(weekStartStr);
  }

  return {
    success: true,
    message: `Phase "${phaseName}" (${phaseOrder}) saved: ${savedWeeks.length} weeks from ${savedWeeks[0]} to ${savedWeeks[savedWeeks.length - 1]}. ${totalWorkoutsSaved} workouts + ${totalRestSaved} rest day(s), ${totalPastSkipped} past day(s) skipped.`,
    data: {
      phaseName,
      phaseOrder,
      raceGoalName: goal.name,
      weekCount: savedWeeks.length,
      weeks: savedWeeks,
      sessionCount: totalSessionsSaved,
      workoutCount: totalWorkoutsSaved,
      restCount: totalRestSaved,
      pastDaysSkipped: totalPastSkipped,
    },
  };
}

async function executeQueryActivities(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const activityType = args.type as string | undefined;
  const since = args.since as string | undefined;
  const until = args.until as string | undefined;
  const search = args.search as string | undefined;
  const minDist = args.minDistance as number | undefined;
  const maxDist = args.maxDistance as number | undefined;
  const limit = Math.min(20, Math.max(1, (args.limit as number) || 10));
  const sort = (args.sort as string) || "date_desc";

  const where: Record<string, unknown> = { userId, mergedIntoId: null };
  if (activityType) where.type = activityType;
  if (since || until) {
    const dateFilter: Record<string, Date> = {};
    if (since) dateFilter.gte = new Date(since);
    if (until) dateFilter.lte = new Date(until + "T23:59:59.999Z");
    where.startDate = dateFilter;
  }
  if (search) where.name = { contains: search, mode: "insensitive" };
  if (minDist !== undefined || maxDist !== undefined) {
    const distFilter: Record<string, number> = {};
    if (minDist !== undefined) distFilter.gte = minDist;
    if (maxDist !== undefined) distFilter.lte = maxDist;
    where.distanceMeters = distFilter;
  }

  let orderBy: Record<string, string>;
  switch (sort) {
    case "date_asc": orderBy = { startDate: "asc" }; break;
    case "distance_desc": orderBy = { distanceMeters: "desc" }; break;
    case "distance_asc": orderBy = { distanceMeters: "asc" }; break;
    case "duration_desc": orderBy = { durationSeconds: "desc" }; break;
    case "pace_asc": orderBy = { distanceMeters: "desc" }; break;
    case "tss_desc": orderBy = { tss: "desc" }; break;
    default: orderBy = { startDate: "desc" };
  }

  const activities = await prisma.trainingLog.findMany({
    where: where as any,
    orderBy,
    take: limit,
    select: {
      id: true,
      name: true, type: true, subType: true, startDate: true,
      durationSeconds: true, distanceMeters: true, elevationGainMeters: true,
      averageHr: true, maxHr: true, averagePower: true,
      normalizedPower: true, tss: true, remarks: true, source: true,
    },
  });

  const formatted = activities.map((a) => {
    const distanceKm = a.distanceMeters ? (a.distanceMeters / 1000).toFixed(1) : "?";
    const pacePerKm = a.distanceMeters && a.distanceMeters > 0 && a.durationSeconds > 0
      ? (a.durationSeconds / (a.distanceMeters / 1000)) : null;
    return {
      id: a.id,
      name: a.name, type: a.type, subType: a.subType,
      date: a.startDate.toISOString().split("T")[0],
      distanceKm: parseFloat(distanceKm),
      durationMinutes: Math.round(a.durationSeconds / 60),
      pace: pacePerKm ? `${Math.floor(pacePerKm / 60)}:${Math.round(pacePerKm % 60).toString().padStart(2, "0")} /km` : null,
      elevationGainMeters: a.elevationGainMeters ? Math.round(a.elevationGainMeters) : null,
      avgHr: a.averageHr ? Math.round(a.averageHr) : null,
      avgPower: a.averagePower ? Math.round(a.averagePower) : null,
      tss: a.tss ? Math.round(a.tss) : null,
      source: a.source,
    };
  });

  return {
    success: true,
    message: `${formatted.length} activities found`,
    data: { count: formatted.length, activities: formatted },
  };
}

/**
 * Look up race details — tries Wikipedia first, then general web search.
 * Wikipedia returns structured data for well-known races (Chicago Marathon,
 * Leadville 100, etc.), while the web search fallback catches lesser-known
 * and international events (LangBiang 100K, CCC, etc.).
 */
async function executeLookupRace(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const raceName = (args.raceName as string || "").trim();
  const year = (args.year as string || "").trim();

  if (!raceName) {
    return { success: false, message: "raceName is required." };
  }

  // Step 1: Try Wikipedia (structured data, best quality when available)
  const wikiResult = await tryWikipediaSearch(raceName, year);
  if (wikiResult) return wikiResult;

  // Step 2: Fall back to general web search via DuckDuckGo
  const webResult = await tryWebSearch(raceName, year);
  if (webResult) return webResult;

  return {
    success: true,
    message: `No information found for "${raceName}". You may need to ask the athlete for the race details directly.`,
    data: { raceName, source: "none" },
  };
}

/**
 * Search Wikipedia's REST API for a race page.
 * Returns null if no page is found.
 */
async function tryWikipediaSearch(
  raceName: string,
  year: string
): Promise<ToolExecutionResult | null> {
  // Build search titles — try exact name first, then common variations
  const searchTerms = [raceName];
  if (year) {
    searchTerms.unshift(`${raceName} ${year}`);
  }

  const lower = raceName.toLowerCase();
  if (lower.includes("trail") || lower.includes("ultra") || lower.includes("100")) {
    searchTerms.push(`${raceName} ultramarathon`);
  }

  for (const term of searchTerms) {
    try {
      const encoded = encodeURIComponent(
        term
          .replace(/[^\w\s-]/g, "")    // strip punctuation
          .replace(/\s+/g, "_")        // spaces to underscores
          .replace(/_+/g, "_")
      );

      const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (response.ok) {
        const data = await response.json() as {
          title?: string;
          extract?: string;
          content_urls?: { desktop?: { page?: string } };
          thumbnail?: { source?: string };
        };

        if (data.title && data.extract) {
          const extract = data.extract.slice(0, 3000);
          const pageUrl = data.content_urls?.desktop?.page || "";
          const imgUrl = data.thumbnail?.source || "";

          return {
            success: true,
            message: `Found Wikipedia entry: "${data.title}"`,
            data: {
              title: data.title,
              description: extract,
              url: pageUrl,
              image: imgUrl,
              source: "wikipedia",
            },
          };
        }
      }
    } catch {
      // Try next search term
      continue;
    }
  }

  return null;
}

/**
 * Search the web via DuckDuckGo Lite (no API key required).
 * Parses the HTML result page and returns formatted snippets.
 */
async function tryWebSearch(
  raceName: string,
  year: string
): Promise<ToolExecutionResult | null> {
  // Build focused search queries
  const queries: string[] = [];
  if (year) {
    queries.push(`${raceName} ${year} race`);
  }
  queries.push(`${raceName} ultramarathon race`);
  queries.push(`${raceName} race course elevation`);
  queries.push(`${raceName}`);

  const seenUrls = new Set<string>();
  const allResults: Array<{ title: string; url: string; snippet: string; source: string }> = [];

  for (const query of queries) {
    if (allResults.length >= 5) break;

    try {
      const html = await fetchDuckDuckGoLite(query);
      if (!html) continue;

      const results = parseDuckDuckGoResults(html, seenUrls);
      for (const r of results) {
        if (allResults.length >= 5) break;
        allResults.push({ ...r, source: query });
      }
    } catch {
      continue;
    }
  }

  if (allResults.length === 0) return null;

  // Format results for the LLM
  const formatted = allResults.map((r, i) =>
    `${i + 1}. ${r.title}\n   ${r.snippet}\n   (${r.url})`
  ).join("\n\n");

  return {
    success: true,
    message: `Found search results for "${raceName}" — review the details below.`,
    data: {
      title: raceName,
      description: formatted,
      source: "web_search",
    },
  };
}

/**
 * Fetch search results from DuckDuckGo Lite HTML endpoint.
 */
async function fetchDuckDuckGoLite(query: string): Promise<string | null> {
  const response = await fetch("https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }),
    signal: AbortSignal.timeout(6000),
    redirect: "follow",
  });

  if (!response.ok) return null;
  return response.text();
}

/**
 * Parse DuckDuckGo Lite HTML results.
 * The page uses a simple table structure:
 * - class="result-link" anchors for titles + URLs
 * - class="result-snippet" for descriptions
 * - class="result-url" for display URLs
 */
function parseDuckDuckGoResults(
  html: string,
  seenUrls: Set<string>
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Split by result rows. Each result is in a <tr class="result-row"> or
  // follows the pattern: link row (<a class="result-link">) then snippet row.
  // We use a simpler approach: find all result-link anchors with their snippets.

  const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /class="result-snippet">([\s\S]*?)<\/td>/gi;

  let linkMatch: RegExpExecArray | null;
  const titles: string[] = [];
  const urls: string[] = [];

  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const url = linkMatch[1].trim();
    const title = linkMatch[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (url && title && !seenUrls.has(url)) {
      seenUrls.add(url);
      urls.push(url);
      titles.push(title);
    }
  }

  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetRegex.exec(html)) !== null) {
    const snippet = snippetMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (snippet) {
      snippets.push(snippet);
    }
  }

  for (let i = 0; i < titles.length && results.length < 5; i++) {
    results.push({
      title: titles[i],
      url: urls[i],
      snippet: snippets[i] || "",
    });
  }

  return results;
}
