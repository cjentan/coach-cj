/**
 * Tool definitions and execution functions for the AI Coach.
 *
 * These tools let the LLM modify user data directly during a coaching
 * conversation — updating training context, managing race goals,
 * promoting activities to goals, managing training plans, and
 * querying activity history.
 */
import { prisma } from "./prisma";
import type { ToolDefinition } from "./llm";
import { getWeekStart } from "./utils";

// ── Tool definitions (sent to the LLM) ────────────────

export const UPDATE_TRAINING_CONTEXT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_training_context",
    description: "Update the athlete's training context — a free-text description of where and when they train, their equipment, schedule constraints, and any other environment details. The AI coach uses this to give personalized recommendations. Replaces the previous context entirely.",
    parameters: {
      type: "object",
      properties: {
        trainingContext: {
          type: "string",
          description: "The new training context text. Should be detailed — include location, times, equipment, constraints, and anything relevant to training recommendations.",
        },
      },
      required: ["trainingContext"],
    },
  },
};

export const MANAGE_GOALS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "manage_goals",
    description: "Create, update, delete, or list race goals. Use this when the athlete wants to set a new race target, modify an existing goal, remove one, or view their current goals. Always confirm with the athlete before making changes.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "delete", "list"],
          description: "What to do with the goal. Use 'list' to fetch all active goals without any goal data — the LLM can use this to remind the athlete of their current goals.",
        },
        goal: {
          type: "object",
          description: "Goal data. Required for create and update actions.",
          properties: {
            id: { type: "string", description: "Goal ID. Required for update and delete." },
            name: { type: "string", description: "Race/event name." },
            raceType: {
              type: "string",
              enum: ["trail_run", "road_run", "marathon", "ultra", "triathlon", "cycling", "other"],
              description: "Type of event.",
            },
            targetDate: { type: "string", description: "Event date in YYYY-MM-DD format." },
            distanceMeters: { type: "number", description: "Race distance in meters." },
            elevationGainMeters: { type: "number", description: "Total elevation gain in meters." },
            targetTimeSeconds: { type: "number", description: "Target finish time in seconds." },
            priority: { type: "string", enum: ["A", "B", "C"], description: "Goal priority. A = most important." },
            goalStatement: { type: "string", description: "Personal statement or motivation for this goal." },
            status: {
              type: "string",
              enum: ["active", "completed", "cancelled"],
              description: "Goal status.",
            },
          },
        },
      },
      required: ["action"],
    },
  },
};

export const SET_ACTIVITY_AS_GOAL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "set_activity_as_goal",
    description: "Promote an existing activity (training log entry) to a race goal. Pre-fills the goal name, distance, and elevation from the activity. The athlete can then refine the goal settings.",
    parameters: {
      type: "object",
      properties: {
        activityId: {
          type: "string",
          description: "The ID of the activity to promote to a goal.",
        },
        priority: {
          type: "string",
          enum: ["A", "B", "C"],
          description: "Goal priority. Defaults to B if not specified.",
        },
        targetDate: {
          type: "string",
          description: "The race date in YYYY-MM-DD format. Defaults to a reasonable date after the activity if not specified.",
        },
        goalStatement: {
          type: "string",
          description: "Optional personal statement for this goal.",
        },
      },
      required: ["activityId"],
    },
  },
};

export const UPDATE_WEEKLY_PLAN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_weekly_plan",
    description: "Update a single week of the athlete's training plan — modify planned sessions, adjust volume/elevation/duration targets, or add coach notes. Use this when the athlete asks to adjust a specific week or make minor changes to an existing plan. For full multi-week plan creation (phases leading to a race goal), use create_training_phase instead. Past days (already passed) are automatically skipped.",
    parameters: {
      type: "object",
      properties: {
        weekStart: {
          type: "string",
          description: "Optional ISO date (YYYY-MM-DD) for the Monday of the week to plan. Omit to plan the upcoming week (next Monday).",
        },
        sessions: {
          type: "array",
          description: "Planned sessions for the upcoming week. If omitted, session targets are not changed. Each session represents one day's workout.",
          items: {
            type: "object",
            properties: {
              dayOfWeek: {
                type: "integer",
                minimum: 0,
                maximum: 6,
                description: "Day of the week (0=Sunday, 1=Monday, ..., 6=Saturday).",
              },
              type: {
                type: "string",
                enum: ["run", "ride", "swim", "rest", "workout", "hike", "other"],
                description: "Type of session.",
              },
              description: {
                type: "string",
                description: "Full description of the session, including workout details, pace zones, duration, etc.",
              },
              targetDistance: {
                type: "number",
                description: "Target distance in meters. Omit or set to 0 for rest days or non-distance sessions.",
              },
              targetElevation: {
                type: "number",
                description: "Target elevation gain in meters.",
              },
              targetDuration: {
                type: "integer",
                description: "Target duration in seconds.",
              },
            },
            required: ["dayOfWeek", "type"],
          },
        },
        targetVolumeMeters: {
          type: "number",
          description: "Target weekly volume in meters.",
        },
        targetElevationMeters: {
          type: "number",
          description: "Target weekly elevation gain in meters.",
        },
        targetDurationSeconds: {
          type: "integer",
          description: "Target weekly duration in seconds.",
        },
        coachNotes: {
          type: "string",
          description: "Optional coach notes explaining the rationale for this week's plan.",
        },
      },
    },
  },
};

export const QUERY_ACTIVITIES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "query_activities",
    description: "Query the athlete's training activity history. Use this when the athlete asks about past performances, PRs, recent workouts, pace data, or wants to compare previous efforts. Returns up to 20 activities matching the filters with key stats (distance, duration, pace, elevation, HR, power, TSS, remarks).",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["run", "ride", "swim", "hike", "walk", "workout", "other"],
          description: "Filter by activity type.",
        },
        since: {
          type: "string",
          description: "Earliest date in YYYY-MM-DD format.",
        },
        until: {
          type: "string",
          description: "Latest date in YYYY-MM-DD format.",
        },
        search: {
          type: "string",
          description: "Free-text search against activity names. Use distance filters (minDistance/maxDistance) when names are unknown.",
        },
        minDistance: {
          type: "number",
          description: "Minimum distance in meters — e.g., 42000 for marathon, 10000 for 10k.",
        },
        maxDistance: {
          type: "number",
          description: "Maximum distance in meters.",
        },
        limit: {
          type: "integer",
          maximum: 20,
          description: "Maximum number of activities to return (1-20, default 10).",
        },
        sort: {
          type: "string",
          enum: ["date_desc", "date_asc", "distance_desc", "distance_asc", "duration_desc", "pace_asc", "tss_desc"],
          description: "How to order results (default: date_desc).",
        },
      },
    },
  },
};

export const CREATE_TRAINING_PHASE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "create_training_phase",
    description: "Create one training phase (2-8 weeks) as part of a periodized plan leading to a race goal. THIS IS THE PRIMARY TOOL FOR BUILDING TRAINING PLANS. Use this when the athlete has a goal and needs a plan — do NOT just list data and say 'Done'. Phases build on each other: Base → Build → Peak → Taper. Call this tool MULTIPLE TIMES in sequence to build the full plan, one phase at a time. After saving each phase, check its output then immediately create the next phase — do not stop mid-way. Consider recent training volume, training context (terrain/schedule), race course profile, target time, and the athlete's fitness (PMC: CTL/ATL/TSB) when designing each phase.",
    parameters: {
      type: "object",
      properties: {
        phaseName: {
          type: "string",
          description: "Name of this training phase (e.g. 'Base Phase', 'Build Phase 1', 'Build Phase 2', 'Peak Phase', 'Taper'). Indicates its position in the periodization cycle.",
        },
        phaseGoal: {
          type: "string",
          description: "The specific training goal for this phase, e.g. 'Build aerobic base from 50km to 65km/week with 80% easy running' or 'Introduce threshold work with one quality session per week'",
        },
        raceGoalId: {
          type: "string",
          description: "The ID of the race goal this phase targets. Get this from the training context's race goals list.",
        },
        phaseOrder: {
          type: "integer",
          minimum: 1,
          description: "Sequence number of this phase in the overall plan (1, 2, 3...). Phase 1 is the first phase from the start date.",
        },
        weeks: {
          type: "array",
          minItems: 2,
          maxItems: 8,
          description: "The weeks in this phase (2-6 weeks). Weeks must be consecutive starting from the phase start date.",
          items: {
            type: "object",
            required: ["weekNumber", "weekStart", "sessions"],
            properties: {
              weekNumber: { type: "integer", minimum: 1, description: "Week number within this phase (1-based)." },
              weekStart: { type: "string", description: "ISO date (YYYY-MM-DD) of the Monday of this week." },
              coachNotes: { type: "string", description: "Optional rationale for this week — e.g. 'Volume build week', 'Cutback/recovery week at ~80% volume', 'Peak intensity week'" },
              targetVolumeMeters: { type: "number", description: "Target weekly volume in meters. Progression within phase: generally increasing with occasional cutback weeks." },
              targetElevationMeters: { type: "number", description: "Target weekly elevation gain in meters. Scale with volume; if the race course is hilly include meaningful elevation." },
              sessions: {
                type: "array",
                description: "All 7 daily sessions for this week (include rest days explicitly). Past days (already passed) are auto-skipped.",
                items: {
                  type: "object",
                  required: ["dayOfWeek", "type"],
                  properties: {
                    dayOfWeek: { type: "integer", minimum: 0, maximum: 6, description: "0=Sunday, 1=Monday ... 6=Saturday" },
                    type: { type: "string", enum: ["run", "ride", "swim", "rest", "workout", "hike", "other"] },
                    description: { type: "string", description: "Full description — workout details, pace zones, duration, terrain, intensity cues" },
                    targetDistance: { type: "number", description: "Distance in meters" },
                    targetElevation: { type: "number", description: "Elevation gain in meters" },
                    targetDuration: { type: "integer", description: "Duration in seconds" },
                  },
                },
              },
            },
          },
        },
      },
      required: ["phaseName", "phaseGoal", "raceGoalId", "phaseOrder", "weeks"],
    },
  },
};

export const ALL_COACH_TOOLS: ToolDefinition[] = [
  UPDATE_TRAINING_CONTEXT_TOOL,
  MANAGE_GOALS_TOOL,
  SET_ACTIVITY_AS_GOAL_TOOL,
  UPDATE_WEEKLY_PLAN_TOOL,
  QUERY_ACTIVITIES_TOOL,
  CREATE_TRAINING_PHASE_TOOL,
];

// ── Tool execution ────────────────────────────────────

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string
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
    case "query_activities":
      return executeQueryActivities(userId, args);
    case "create_training_phase":
      return executeCreateTrainingPhase(userId, args);
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
    updateData.plannedSessions = JSON.parse(JSON.stringify(validSessions));
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
        plannedSessions: validSessions ? JSON.parse(JSON.stringify(validSessions)) : [],
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

async function executeCreateTrainingPhase(
  userId: string,
  args: Record<string, unknown>
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
  if (weeks.length < 2 || weeks.length > 8) {
    return { success: false, message: "A phase must have between 2 and 8 weeks." };
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
  let totalPastSkipped = 0;

  for (const week of weeks) {
    const weekStartStr = week.weekStart as string;
    if (!weekStartStr) {
      return { success: false, message: "Each week must have a weekStart (YYYY-MM-DD)." };
    }

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
        plannedSessions: JSON.parse(JSON.stringify(validSessions)),
        targetVolumeMeters: targetVolumeMeters ?? undefined,
        targetElevationMeters: targetElevationMeters ?? undefined,
        coachNotes: coachNotes ?? undefined,
        overridesExisting: true,
        generatedAt: now,
        adjustmentHistory: JSON.parse(JSON.stringify(history)),
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
        plannedSessions: JSON.parse(JSON.stringify(validSessions)),
        targetVolumeMeters: targetVolumeMeters ?? undefined,
        targetElevationMeters: targetElevationMeters ?? undefined,
        coachNotes: coachNotes ?? undefined,
        overridesExisting: true,
        generatedAt: now,
        adjustmentHistory: JSON.parse(JSON.stringify([adjEntry])),
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
    message: `Phase "${phaseName}" (${phaseOrder}) saved: ${savedWeeks.length} weeks from ${savedWeeks[0]} to ${savedWeeks[savedWeeks.length - 1]}. ${totalSessionsSaved} sessions planned, ${totalPastSkipped} past day(s) skipped.`,
    data: {
      phaseName,
      phaseOrder,
      raceGoalName: goal.name,
      weekCount: savedWeeks.length,
      weeks: savedWeeks,
      sessionCount: totalSessionsSaved,
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
