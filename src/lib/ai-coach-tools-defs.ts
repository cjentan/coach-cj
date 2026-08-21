/**
 * Tool definitions sent to the LLM for the AI Coach.
 *
 * These are static, self-contained JSON-like descriptors. Each tool
 * implementation lives in `ai-coach-tools.ts` and is dispatched by
 * `executeTool`. Keeping definitions separate from implementations
 * shrinks the orchestrator and lets tool descriptors be reused without
 * pulling in execution dependencies.
 */
import type { ToolDefinition } from "./llm";

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

export const GET_WEEKLY_PLAN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weekly_plan",
    description: "Read the detailed daily sessions for a specific week of the athlete's training plan. Returns every planned session for that week (one per day: type, description, distance/elevation/duration targets) plus the week's volume/elevation/duration targets and coach notes. Use this to EXAMINE a specific week or a specific day's planned workout before suggesting or making changes. If weekStart is omitted, returns the current week.",
    parameters: {
      type: "object",
      properties: {
        weekStart: {
          type: "string",
          description: "Optional ISO date (YYYY-MM-DD) of the Monday of the week to read. Omit to read the current week.",
        },
      },
    },
  },
};

export const UPDATE_TRAINING_DAY_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_training_day",
    description: "Change ONE day's planned session in a specific week of the athlete's training plan — e.g. turn a workout into a rest day, adjust a target distance, or rewrite the session description. Only the fields you provide are changed; all other days in that week are left untouched. Use this for single-day adjustments. For whole-week edits (volume targets, coach notes, full re-plan), use update_weekly_plan instead. Past days (already passed) are automatically rejected.",
    parameters: {
      type: "object",
      properties: {
        weekStart: {
          type: "string",
          description: "Required ISO date (YYYY-MM-DD) of the Monday of the week containing the day to change.",
        },
        dayOfWeek: {
          type: "integer",
          minimum: 0,
          maximum: 6,
          description: "Day of the week to change (0=Sunday, 1=Monday, ..., 6=Saturday).",
        },
        type: {
          type: "string",
          enum: ["run", "ride", "swim", "rest", "workout", "hike", "other"],
          description: "New session type. Set to 'rest' to make this day a rest day.",
        },
        description: {
          type: "string",
          description: "New session description (workout details, pace zones, duration, etc.).",
        },
        targetDistance: {
          type: "number",
          description: "New target distance in meters. Use 0 for rest days.",
        },
        targetElevation: {
          type: "number",
          description: "New target elevation gain in meters.",
        },
        targetDuration: {
          type: "integer",
          description: "New target duration in seconds. Use 0 for rest days.",
        },
        facility: {
          type: "string",
          description: "Optional facility/location for the session.",
        },
      },
      required: ["weekStart", "dayOfWeek"],
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
    description: "Create one training phase as part of a periodized plan leading to a race goal. THIS IS THE PRIMARY TOOL FOR BUILDING TRAINING PLANS. Use this when the athlete has a goal and needs a plan — do NOT just list data and say 'Done'. Phases build on each other: Base → Build → Peak → Taper. Call this tool MULTIPLE TIMES in sequence to build the full plan, one phase at a time. After saving each phase, check its output then immediately create the next phase — do not stop mid-way. Consider recent training volume, training context (terrain/schedule), race course profile, target time, and the athlete's fitness (PMC: CTL/ATL/TSB) when designing each phase.",
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
          minItems: 1,
          description: "The weeks in this phase (1+ weeks). Weeks must be consecutive starting from the phase start date.",
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

/**
 * Full-plan tool — NOT included in ALL_COACH_TOOLS.
 * This is a specialized tool used only by approvePlanProposal() for the
 * initial plan creation, where speed matters most.
 * Regular chat continues to use create_training_phase per-phase for adjustments.
 */
export const CREATE_FULL_TRAINING_PLAN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "create_full_training_plan",
    description: "Create a COMPLETE periodized training plan — ALL phases in one call. Use this when the athlete has approved a plan proposal and all phases need to be saved at once. This replaces calling create_training_phase multiple times. The phases array covers the full plan from start to race day: typically Base → Build (optionally multiple) → Peak → Taper. Each phase may have 1+ weeks with daily sessions.",
    parameters: {
      type: "object",
      properties: {
        phases: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          description: "All training phases for the plan, in chronological order",
          items: {
            type: "object",
            required: ["phaseName", "phaseGoal", "raceGoalId", "phaseOrder", "weeks"],
            properties: {
              phaseName: {
                type: "string",
                description: "Name of this training phase (e.g. 'Base Phase', 'Build Phase 1', 'Build Phase 2', 'Peak Phase', 'Taper'). Indicates its position in the periodization cycle.",
              },
              phaseGoal: {
                type: "string",
                description: "The specific training goal for this phase, e.g. 'Build aerobic base from 50km to 65km/week' or 'Introduce threshold work with one quality session per week'",
              },
              raceGoalId: {
                type: "string",
                description: "The ID of the race goal this phase targets. Get this from the training context's race goals list.",
              },
              phaseOrder: {
                type: "integer",
                minimum: 1,
                description: "Sequence number of this phase in the overall plan (1, 2, 3...). Phase 1 is the first phase.",
              },
              weeks: {
                type: "array",
                minItems: 1,
                description: "The weeks in this phase (1+ weeks). Weeks must be consecutive.",
                items: {
                  type: "object",
                  required: ["weekNumber", "weekStart", "sessions"],
                  properties: {
                    weekNumber: { type: "integer", minimum: 1, description: "Week number within this phase (1-based)." },
                    weekStart: { type: "string", description: "ISO date (YYYY-MM-DD) of the Monday of this week." },
                    coachNotes: { type: "string", description: "Optional rationale for this week — e.g. 'Volume build week', 'Cutback/recovery week at ~80% volume'" },
                    targetVolumeMeters: { type: "number", description: "Target weekly volume in meters." },
                    targetElevationMeters: { type: "number", description: "Target weekly elevation gain in meters." },
                    sessions: {
                      type: "array",
                      description: "All daily sessions for this week (include rest days explicitly). Past days are auto-skipped.",
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
          },
        },
      },
      required: ["phases"],
    },
  },
};

export const LOOKUP_RACE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "lookup_race",
    description: "Search the web for details about a specific race/event — date, distance, elevation, location, course profile. Use this when the athlete mentions a race name you can look up, to fill in missing details for a goal instead of asking the athlete. Searches Wikipedia then the general web for the best available information.",
    parameters: {
      type: "object",
      properties: {
        raceName: {
          type: "string",
          description: "The name of the race/event to look up (e.g. 'Chicago Marathon', 'Leadville 100', 'LangBiang 100K').",
        },
        year: {
          type: "string",
          description: "Optional year for edition-specific details (e.g. '2027').",
        },
      },
      required: ["raceName"],
    },
  },
};

export const ALL_COACH_TOOLS: ToolDefinition[] = [
  UPDATE_TRAINING_CONTEXT_TOOL,
  MANAGE_GOALS_TOOL,
  SET_ACTIVITY_AS_GOAL_TOOL,
  UPDATE_WEEKLY_PLAN_TOOL,
  GET_WEEKLY_PLAN_TOOL,
  UPDATE_TRAINING_DAY_TOOL,
  QUERY_ACTIVITIES_TOOL,
  CREATE_TRAINING_PHASE_TOOL,
  LOOKUP_RACE_TOOL,
];
