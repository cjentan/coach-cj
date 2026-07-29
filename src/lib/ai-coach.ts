/**
 * Unified AI Coach service.
 *
 * Orchestrates LLM-powered training analysis, conversational follow-ups,
 * and plan-suggestion lifecycle — all within persistent CoachConversation
 * threads.
 *
 * ── Architecture ─────────────────────────────────────────
 *   analyze() → LLM (jsonMode) → coach notes + structured suggestions
 *   chat()    → LLM (conversational) → response + inline suggestions
 *   applySuggestion() → persist plan change → mark suggestion applied
 */
import { z } from "zod";
import { prisma } from "./prisma";
import { ask, chatWithTools, resolveUserLlmConfig, isLlmConfigured } from "./llm";
import type { LlmMessage } from "./llm";
import { ALL_COACH_TOOLS, executeTool, executeCreateTrainingPhase } from "./ai-coach-tools";
import { gatherTrainingContext } from "./training-context";
import { getWeekStart, formatDistance, formatDuration } from "./utils";
import { resolvePrompt, PROMPT_KEYS, getLanguageInstruction } from "./coach-prompts";
import { type PageContext } from "./page-context";

// ── Zod schemas ────────────────────────────────────────

const SuggestionSchema = z.object({
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

const AnalyzeResponseSchema = z.object({
  analysis: z.string().min(1),
  suggestions: z.array(SuggestionSchema).default([]),
});

// ── Types ──────────────────────────────────────────────

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

export type ChatProgressEvent = PhaseProgressEvent | StatusEvent | ToolCallEvent | {
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
}

export interface ConversationListItem {
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ── System prompts (resolved from DB with hardcoded fallback) ──

async function getAnalyzePrompt(): Promise<string> {
  return resolvePrompt(PROMPT_KEYS.ANALYZE);
}

async function getChatPrompt(): Promise<string> {
  return resolvePrompt(PROMPT_KEYS.CHAT);
}

async function getSummarizePrompt(): Promise<string> {
  return resolvePrompt(PROMPT_KEYS.SUMMARIZE);
}

async function getActivityAnalyzePrompt(): Promise<string> {
  return resolvePrompt(PROMPT_KEYS.ACTIVITY_ANALYZE);
}

// ── Helpers ────────────────────────────────────────────

function buildContextSummary(ctx: Awaited<ReturnType<typeof gatherTrainingContext>>, locale = "en"): string {
  const today = new Date().toLocaleDateString(locale, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
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

function sanitizeJsonText(text: string): string {
  // Strip markdown code fences if the LLM wraps JSON in them
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1].trim() : text.trim();
}

/** Derive phase structure (name + weeks) from athlete's training context. */
function derivePhaseStructure(ctx: Awaited<ReturnType<typeof gatherTrainingContext>>): Array<{ name: string; weeks: number }> {
  const goal = ctx.goals[0];
  if (!goal) return [{ name: "Base", weeks: 4 }, { name: "Build", weeks: 4 }, { name: "Peak", weeks: 2 }, { name: "Taper", weeks: 1 }];

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
function getNextMondayStr(): string {
  const d = new Date();
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  return d.toISOString().split("T")[0];
}

/** Generate a phase goal string from the phase name. */
function generatePhaseGoal(name: string): string {
  switch (name) {
    case "Base": return "Build aerobic foundation and endurance base";
    case "Build": return "Introduce race-specific intensity and quality workouts";
    case "Peak": return "Sharpen fitness with race-pace rehearsal sessions";
    case "Taper": return "Reduce volume while maintaining intensity for peak freshness";
    default: return `${name} phase training`;
  }
}

// ── Guardrails (applied after analyze) ─────────────────

interface GuardrailCheck {
  violations: string[];
  correctedPlan?: Record<string, unknown>;
}

function checkGuardrails(
  suggestions: z.infer<typeof SuggestionSchema>[],
  ctx: Awaited<ReturnType<typeof gatherTrainingContext>>
): GuardrailCheck {
  const violations: string[] = [];

  // Check for volume suggestions exceeding 15% cap
  for (const s of suggestions) {
    if (s.type === "volume_change" && ctx.weeklyPlan) {
      const changes = s.changes as Record<string, number>;
      if (changes.targetVolumeMeters) {
        const baseline = ctx.weeklyPlan.targetVolumeMeters || ctx.recentWeeks.reduce((a, w) => a + w.volumeMeters, 0) / Math.max(1, ctx.recentWeeks.length);
        if (baseline > 0 && changes.targetVolumeMeters > baseline * 1.15) {
          violations.push(`Volume suggestion "${s.title}" exceeds +15% cap (${formatDistance(baseline)} → ${formatDistance(changes.targetVolumeMeters)})`);
        }
      }
    }

    if (s.type === "rest_day_addition" && ctx.weeklyPlan) {
      const existingRestDays = ctx.weeklyPlan.plannedSessions.filter((ps) => ps.type === "rest").length;
      const changes = s.changes as Record<string, unknown>;
      const newRestDay = changes.dayOfWeek !== undefined;
      if (existingRestDays >= 6 && newRestDay) {
        violations.push(`Too many rest days — plan already has ${existingRestDays} rest day(s)`);
      }
    }
  }

  return { violations };
}

// ── Plan proposal schema (structured card data) ────────

const PhaseProposalSchema = z.object({
  name: z.enum(["Base", "Build", "Peak", "Taper"]),
  weeks: z.number().int().positive(),
  focus: z.string().min(1),
  peakVolume: z.string().min(1),
});

const PlanProposalSchema = z.object({
  totalWeeks: z.number().int().positive(),
  raceGoalName: z.string().min(1),
  raceDate: z.string(),
  currentVolume: z.string().min(1),
  peakVolume: z.string().min(1),
  proposedStartDate: z.string().optional(),
  phases: z.array(PhaseProposalSchema).min(1).max(6),
  adjustments: z.array(z.string()).default([]),
});

const StartInterviewResponseSchema = z.object({
  summary: z.string().min(1),
  proposal: PlanProposalSchema,
});

// ── Coach notes evolution ──────────────────────────────

/**
 * Summarize the full conversation into updated coach notes.
 * This is called when the user wants to finalize their coaching conversation,
 * or automatically when suggestions are applied.
 */
export async function summarizeConversation(
  conversationId: string,
  userId: string,
  locale = "en"
): Promise<{ summary: string } | { error: string; code: string }> {
  const conv = await prisma.coachConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        where: { role: { not: "system" } },
        orderBy: { createdAt: "asc" },
      },
      suggestions: {
        where: { status: "applied" },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!conv || conv.userId !== userId) {
    return { error: "Conversation not found.", code: "NOT_FOUND" };
  }

  const llmConfig = await resolveUserLlmConfig(userId);
  if (!isLlmConfigured(llmConfig.apiKey, llmConfig.provider)) {
    return { error: "AI coach is not configured.", code: "NOT_CONFIGURED" };
  }

  // Build a condensed thread for the LLM to summarize
  let thread = "## Coaching Conversation Thread\n\n";
  for (const m of conv.messages) {
    thread += `${m.role === "user" ? "Athlete" : "Coach"}: ${m.content.slice(0, 500)}\n\n`;
  }

  if (conv.suggestions.length > 0) {
    thread += "## Applied Changes\n";
    for (const s of conv.suggestions) {
      thread += `- ${s.title}: ${s.description}\n`;
    }
    thread += "\n";
  }

  const langInstruction = getLanguageInstruction(locale);
  const systemPrompt = `${langInstruction}${await getSummarizePrompt()}`;

  const summary = await ask(systemPrompt, thread, {
    temperature: 0.3,
    maxTokens: 1024,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
  });

  if (!summary) {
    return { error: "Failed to generate summary.", code: "LLM_FAILED" };
  }

  // Replace the conversation thread with just the summary.
  // Delete all old messages and pending suggestions, then
  // create a single summary message.
  await prisma.coachMessage.deleteMany({
    where: { conversationId },
  });
  await prisma.coachSuggestion.deleteMany({
    where: { conversationId, status: "pending" },
  });

  const summaryHeader = locale === "zh-CN"
    ? "📋 **对话摘要**\n\n"
    : locale === "zh-TW"
      ? "📋 **對話摘要**\n\n"
      : "📋 **Conversation Summary**\n\n";
  const summaryFooter = locale === "zh-CN"
    ? "\n\n---\n*详细对话已浓缩为摘要。发送新消息继续教练指导。*"
    : locale === "zh-TW"
      ? "\n\n---\n*詳細對話已濃縮為摘要。發送新消息繼續教練指導。*"
      : "\n\n---\n*The detailed conversation has been condensed into this summary. Start a new message to continue coaching.*";

  await prisma.coachMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: `${summaryHeader}${summary}${summaryFooter}`,
    },
  });

  // Update the context snapshot to reflect the summarized state
  const ctx = await gatherTrainingContext(userId);
  const summaryText = buildContextSummary(ctx, locale);
  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: {
      contextSnapshot: { summaryText, lastSummary: summary },
      updatedAt: new Date(),
    },
  });

  // Persist the updated summary as the latest coach notes
  await persistLegacyNotes(userId, summary, ctx);

  return { summary };
}

/**
 * Build a page-context summary string from the given page context.
 * Fetches additional data (activity, goal) as needed and returns
 * a markdown section the LLM can reference. Returns null (no section)
 * when there's nothing specific to report.
 */
async function buildPageContextSummary(
  pageContext: PageContext,
  userId: string,
  locale = "en"
): Promise<string | null> {
  switch (pageContext.page) {
    case "dashboard":
      return "You are on the dashboard overview page, viewing your training stats, Performance Management Chart (PMC), and training plan.";

    case "activity-detail": {
      if (!pageContext.activityId) return null;
      const activity = await prisma.trainingLog.findUnique({
        where: { id: pageContext.activityId },
      });
      if (!activity || activity.userId !== userId) return null;

      const parts: string[] = [
        `The athlete is currently viewing the activity detail page for **${activity.name}** (${activity.type}).`,
      ];
      if (activity.distanceMeters) {
        parts.push(`Distance: ${formatDistance(activity.distanceMeters, undefined, locale)}`);
      }
      if (activity.durationSeconds) {
        parts.push(`Duration: ${formatDuration(activity.durationSeconds, locale)}`);
      }
      if (activity.elevationGainMeters) {
        parts.push(`Elevation: ${Math.round(activity.elevationGainMeters)}m`);
      }
      if (activity.tss != null) {
        parts.push(`TSS: ${activity.tss}`);
      }
      if (activity.averageHr) {
        parts.push(`Avg HR: ${activity.averageHr} bpm`);
      }
      parts.push(`Date: ${activity.startDate.toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" })}`);
      return parts.join(" · ");
    }

    case "goal-detail": {
      if (!pageContext.goalId) return null;
      const goal = await prisma.raceGoal.findUnique({
        where: { id: pageContext.goalId },
      });
      if (!goal || goal.userId !== userId) return null;

      const parts = [
        `The athlete is viewing their goal: **${goal.name}** (${formatDistance(goal.distanceMeters, undefined, locale)}).`,
        `Target date: ${goal.targetDate.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`,
      ];
      if (goal.targetTimeSeconds) {
        parts.push(`Target time: ${formatDuration(goal.targetTimeSeconds)}.`);
      }
      if (goal.elevationGainMeters) {
        parts.push(`Course elevation: ${Math.round(goal.elevationGainMeters)}m.`);
      }
      if (goal.notes) {
        parts.push(`Notes: ${goal.notes}`);
      }
      return parts.join(" ");
    }

    case "activity-list":
      return "The athlete is browsing their activity history / activity list.";

    case "goal-list":
      return "The athlete is viewing their race goals list.";

    case "body-metrics":
      return "The athlete is viewing their body metrics (weight, resting HR) trends.";

    case "availability":
      return "The athlete is managing their training availability and schedule.";

    default:
      return null;
  }
}

// ── Main service ───────────────────────────────────────

/**
 * Run a full training analysis: generate coach notes + plan suggestions.
 * Creates a new conversation or appends to an active one.
 */
export async function analyze(
  userId: string,
  conversationId?: string,
  pageContext?: PageContext | null,
  locale = "en"
): Promise<CoachAnalysisResult | { error: string; code: string }> {
  // 1. Resolve LLM config
  const llmConfig = await resolveUserLlmConfig(userId);
  if (!isLlmConfigured(llmConfig.apiKey, llmConfig.provider)) {
    return { error: "AI coach is not configured. Set up your API key in Settings → API & Credentials.", code: "NOT_CONFIGURED" };
  }

  // 2. Gather training context
  const ctx = await gatherTrainingContext(userId);

  // 3. Find active conversation or create one
  let conversation;
  if (conversationId) {
    conversation = await prisma.coachConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.userId !== userId) {
      conversation = await findOrCreateConversation(userId, ctx, locale);
    }
  } else {
    conversation = await findOrCreateConversation(userId, ctx, locale);
  }

  // 4. Check if a training plan exists — skip suggestions if there's no plan to save resources
  const planCount = await prisma.weeklyPlan.count({
    where: { userId, weekStartDate: { gte: getWeekStart(new Date()) } },
  });
  const hasPlan = planCount > 0;

  // 5. Build context + call LLM
  let contextStr = buildContextSummary(ctx, locale);
  if (pageContext) {
    const pageStr = await buildPageContextSummary(pageContext, userId, locale);
    if (pageStr) {
      contextStr += `\n\n## Page Context\n${pageStr}`;
    }
  }
  const langInstruction = getLanguageInstruction(locale);
  const systemPrompt = `${langInstruction}${await getAnalyzePrompt()}\n\n## Current Training Context\n${contextStr}`;

  const userMessage = hasPlan
    ? "Analyze my training data and suggest plan adjustments."
    : "Analyze my training data. Do not suggest any plan changes since there is no training plan yet — only provide coaching analysis.";

  const result = await ask(systemPrompt, userMessage, {
    temperature: 0.4,
    maxTokens: 4096,
    jsonMode: true,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
  });

  if (!result) {
    return { error: "AI coach returned no response. The model may be unavailable.", code: "LLM_FAILED" };
  }

  // 6. Parse and validate
  let parsed: z.infer<typeof AnalyzeResponseSchema>;
  try {
    parsed = AnalyzeResponseSchema.parse(JSON.parse(sanitizeJsonText(result)));
  } catch {
    // Retry once
    const retry = await ask(
      systemPrompt,
      `Your previous response was invalid JSON. Return ONLY valid JSON matching the schema.`,
      { temperature: 0.2, maxTokens: 4096, jsonMode: true, apiKey: llmConfig.apiKey, baseUrl: llmConfig.baseUrl, model: llmConfig.model }
    );
    if (!retry) return { error: "AI coach failed to generate valid analysis.", code: "PARSE_FAILED" };
    try {
      parsed = AnalyzeResponseSchema.parse(JSON.parse(sanitizeJsonText(retry)));
    } catch {
      return { error: "AI coach returned invalid data after retry.", code: "PARSE_FAILED" };
    }
  }

  // 7. Apply guardrails and filter suggestions when no plan exists
  let guardrailViolations: string[] = [];
  let suggestionsToStore = parsed.suggestions;

  if (hasPlan) {
    const guardrails = checkGuardrails(parsed.suggestions, ctx);
    guardrailViolations = guardrails.violations;
  } else {
    // No plan exists — discard any suggestions the LLM generated
    suggestionsToStore = [];
  }

  // 7. Store system marker + assistant message
  await prisma.coachMessage.create({
    data: {
      conversationId: conversation.id,
      role: "system",
      content: "[Analysis triggered — new training data snapshot]",
    },
  });

  const assistantMsg = await prisma.coachMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: parsed.analysis,
    },
  });

  // 8. Store suggestions (skipped automatically when no plan exists)
  const storedSuggestions: CoachAnalysisResult["suggestions"] = [];
  for (const s of suggestionsToStore) {
    const stored = await prisma.coachSuggestion.create({
      data: {
        conversationId: conversation.id,
        userId,
        suggestionType: s.type,
        title: s.title,
        description: s.description,
        changes: structuredClone(s.changes) as any,
        status: "pending",
      },
    });
    storedSuggestions.push({
      id: stored.id,
      type: stored.suggestionType,
      title: stored.title,
      description: stored.description,
      status: stored.status,
    });
  }

  // 9. Backward compatibility: persist to WeeklyPlan.coachNotes + AnalysisReport
  await persistLegacyNotes(userId, parsed.analysis, ctx);

  // 10. Update conversation timestamp
  await prisma.coachConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return {
    conversationId: conversation.id,
    analysis: parsed.analysis,
    suggestions: storedSuggestions,
    guardrailViolations: guardrailViolations,
  };
}

/**
 * Start a context-gathering interview for a new training plan.
 * Creates a fresh conversation, calls the LLM to generate the first
 * interview question, and returns the conversation + response.
 */
export async function startInterview(
  userId: string,
  options?: ChatOptions,
  locale = "en",
  pageContext?: PageContext | null,
): Promise<{ conversationId: string; response: string; proposal: z.infer<typeof PlanProposalSchema> | null; needsGoal?: boolean } | { error: string; code: string }> {
  // 1. Resolve LLM config
  const llmConfig = await resolveUserLlmConfig(userId);
  if (!isLlmConfigured(llmConfig.apiKey, llmConfig.provider)) {
    return { error: "AI coach is not configured. Set up your API key in Settings → API & Credentials.", code: "NOT_CONFIGURED" };
  }

  // 2. Gather training context
  options?.onProgress?.({ type: "status", message: "Loading your training data from recent activities..." });
  const ctx = await gatherTrainingContext(userId);
  let contextStr = buildContextSummary(ctx, locale);

  // Append page context if available (e.g. user was on a specific activity/goal page)
  if (pageContext) {
    const pageStr = await buildPageContextSummary(pageContext, userId, locale);
    if (pageStr) {
      contextStr += `\n\n## Page Context\n${pageStr}`;
    }
  }

  // 3. Archive old active conversation and create a fresh one
  await prisma.coachConversation.updateMany({
    where: { userId, status: "active" },
    data: { status: "archived" },
  });

  const conversation = await prisma.coachConversation.create({
    data: {
      userId,
      title: `Plan Interview — ${new Date().toLocaleDateString(locale, { month: "short", day: "numeric" })}`,
      status: "active",
      contextSnapshot: { summaryText: contextStr, interviewMode: true },
    },
  });

  // 4. Fire status event
  options?.onProgress?.({ type: "status", message: "Reviewing your training data to design a personalized plan..." });

  // ── No-goal guard: ask the user to set a goal before designing a plan ──
  if (ctx.goals.length === 0) {
    const noGoalResponse = locale.startsWith("zh")
      ? "我很想幫你建立訓練計畫！不過首先，我需要知道你要訓練什麼。\n\n能告訴我你的目標賽事嗎？例如：\n• 比賽名稱（如「台北馬拉松」、「高雄超馬」）\n• 比賽距離（如 42 公里、21 公里）\n• 目標日期\n• 爬升量、目標時間 (選擇性)\n\n你也可以到設定頁面新增目標賽事，之後我就能為你設計個人化訓練計畫。"
      : "I'd love to build you a training plan! First, I need to know what you're training for.\n\nTell me about your goal race:\n• **Event name** (e.g. \"Chicago Marathon\", \"Leadville 100\")\n• **Distance** (e.g. 42.2 km, 50 miles)\n• **Target date**\n• Elevation gain, target time (optional)\n\nOr you can set a goal in your **Settings → Goals** page and I'll design a plan around it.";

    await prisma.coachMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: noGoalResponse,
      },
    });

    return {
      conversationId: conversation.id,
      response: noGoalResponse,
      proposal: null,
      needsGoal: true,
    };
  }

  // 5. Determine total training duration from the nearest goal
  const nearestGoal = ctx.goals[0];
  const nowDate = new Date();
  const raceTargetDate = new Date(nearestGoal.targetDate);
  const diffMs = raceTargetDate.getTime() - nowDate.getTime();
  const totalWeeks = Math.max(1, Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)));

  // Long-term average weekly volume (last 12 weeks) — more stable than 4-week
  const avgVolumeKm = ctx.longTermVolumeKm;

  const distanceKm = nearestGoal.distanceMeters ? nearestGoal.distanceMeters / 1000 : 0;
  const raceGoalName = `${nearestGoal.name}${distanceKm > 0 ? ` (${distanceKm.toFixed(0)}K)` : ""}`;
  const raceDateFormatted = raceTargetDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // ── Deterministic volume computation (overrides LLM output) ──────────
  // Training-log data may be incomplete, so set a minimum floor based on
  // race distance.  A runner targeting a marathon needs at least ~35 km/wk.
  const minimumVolumeKm = distanceKm > 0
    ? Math.max(20, Math.round(distanceKm * 0.5))
    : 20;
  const effectiveStartKm = Math.max(avgVolumeKm, minimumVolumeKm);
  // Peak scales with race distance: shorter races → lower multiplier
  const peakMultiplier = distanceKm < 21 ? 1.5 : distanceKm < 42 ? 1.6 : distanceKm < 80 ? 1.7 : 2.0;
  const effectivePeakKm = Math.round(effectiveStartKm * peakMultiplier);

  // Default start date: the coming Monday (or today if Monday)
  const defaultStartDate = new Date(nowDate);
  const dayOfWeek = defaultStartDate.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
  defaultStartDate.setDate(defaultStartDate.getDate() + daysUntilMonday);
  const defaultStartStr = defaultStartDate.toISOString().split("T")[0];

  // 6. Build LLM prompt with periodization rules — LLM determines phase lengths
  //    from athlete data, with deterministic fallback on parse failure.
  const langInstruction = getLanguageInstruction(locale);
  const proposalSystemPrompt = `${langInstruction}You are an expert endurance coach. Based on the athlete's training data below, design a personalized training plan proposal.

Output JSON only, matching this schema:
{
  "summary": "2-3 sentence intro for the athlete — concise, welcoming, tells them what you've designed. If you don't yet know when they want to start, ask: 'When would you like to begin?'. Your response must also include a proposed start date below.",
  "proposal": {
    "totalWeeks": number of weeks from now until the nearest race goal,
    "raceGoalName": "name of the nearest race goal",
    "raceDate": "YYYY-MM-DD of the race",
    "currentVolume": "string like '~45 km/wk' showing current weekly volume from their data",
    "peakVolume": "string like '~80 km/wk' showing the highest weekly volume in the plan",
    "proposedStartDate": "YYYY-MM-DD — propose a start date. Default to ${defaultStartStr} (next Monday) unless the athlete has indicated a preference. Mention this in the summary and ask for confirmation.",
    "phases": [
      { "name": "Base", "weeks": number, "focus": "short focus description (5-10 words)", "peakVolume": "volume string" },
      { "name": "Build", "weeks": number, "focus": "short focus description (5-10 words)", "peakVolume": "volume string" },
      { "name": "Peak", "weeks": number, "focus": "short focus description (5-10 words)", "peakVolume": "volume string" },
      { "name": "Taper", "weeks": number, "focus": "short focus description (5-10 words)", "peakVolume": "volume string" }
    ],
    "adjustments": ["1-3 notable deviations from a generic plan"]
  }
}

PHASE LENGTH RULES — base your decisions on the athlete's actual fitness data (CTL, recent volume):
- BASE (aerobic foundation): Longer for less experienced / low volume athletes (up to 50% of weeks for CTL < 30), shorter for experienced athletes (25-35% for CTL > 50). Minimum 2 weeks.
- BUILD (race-specific intensity): Typically 30-40% of total weeks. Longer for races needing specific adaptations (hilly, technical terrain). Minimum 2 weeks.
- PEAK (sharpen, race rehearsal): 2-4 weeks. Shorter (2 weeks) for ultras >100K. Minimum 1 week.
- TAPER (rest and prepare): Marathon → 2-3 weeks, Ultra → 1-2 weeks, <21K → 1 week. Minimum 1 week.
- The sum of all phase weeks must equal totalWeeks (${totalWeeks}).

VOLUME NOTES (for reference only — volumes are computed by the system):
- Current weekly volume average: ~${avgVolumeKm} km/wk (from last 4 weeks)
- Include volume references in focus descriptions so the athlete understands the training load
- The peakVolume field for each phase will be automatically set to a realistic value

ADJUSTMENTS RULES:
- List 1-3 notable deviations from a generic plan appropriate for this athlete
- Consider: terrain-specific work for hilly races, schedule constraints, intensity focus, vert work

## Current Training Context
${contextStr}`;

  const proposalPrompt = "Design a training plan proposal for this athlete following the schema above. Consider their actual fitness data and training history when determining phase lengths and volumes.";

  // Detect disconnect before calling LLM
  if (options?.signal?.aborted) {
    return { error: "Request was cancelled.", code: "ABORTED" };
  }

  // Notify the user that the AI is designing the plan
  options?.onProgress?.({ type: "status", message: `Designing a ${totalWeeks}-week training plan based on your fitness data...` });

  console.error(`[COACH] Calling LLM for plan proposal (model=${llmConfig.model})`);
  const t0 = Date.now();

  const rawResult = await ask(proposalSystemPrompt, proposalPrompt, {
    temperature: 0.2,
    maxTokens: 8192,
    jsonMode: true,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
    signal: options?.signal,
  });

  const elapsed = Date.now() - t0;
  console.error(`[COACH] LLM call completed in ${elapsed}ms, result=${rawResult ? `(${rawResult.length} chars)` : "NULL"}`);

  if (!rawResult) {
    return { error: "AI coach failed to start the interview. Try again.", code: "LLM_FAILED" };
  }

  // 7. Try to parse LLM response; fall back to deterministic formula on failure
  let parsed!: z.infer<typeof StartInterviewResponseSchema>;
  let usedFallback = false;
  try {
    parsed = StartInterviewResponseSchema.parse(JSON.parse(sanitizeJsonText(rawResult)));
  } catch {
    // Retry once with a more explicit instruction
    const retry = await ask(proposalSystemPrompt, "Your previous response didn't match the required JSON schema. Output ONLY valid JSON matching the schema exactly.", {
      temperature: 0.1,
      maxTokens: 8192,
      jsonMode: true,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
    });
    if (retry) {
      try {
        parsed = StartInterviewResponseSchema.parse(JSON.parse(sanitizeJsonText(retry)));
      } catch {
        usedFallback = true;
      }
    } else {
      usedFallback = true;
    }
  }

  // Fallback: generate deterministic proposal from available data
  if (usedFallback) {
    const baseWeeks = Math.max(2, Math.round(totalWeeks * 0.4));
    const buildWeeks = Math.max(2, Math.round(totalWeeks * 0.3));
    const peakWeeks = Math.max(1, Math.round(totalWeeks * 0.15));
    const taperWeeks = Math.max(1, totalWeeks - baseWeeks - buildWeeks - peakWeeks);
    const peakVol = Math.max(avgVolumeKm, Math.round(avgVolumeKm * 1.5));
    const phasePeakStr = `~${peakVol} km/wk`;

    const fallbackSummary = locale.startsWith("zh")
      ? `我已根據你的目標設計了一份訓練計畫大綱。訓練將從 ${defaultStartStr} 開始，共 ${totalWeeks} 週，涵蓋基礎期、發展期、巔峰期和減量期。請確認開始日期和計畫內容。`
      : `I've designed a training plan outline based on your goal. Starting ${defaultStartStr}, the plan covers ${totalWeeks} weeks across Base, Build, Peak, and Taper phases. Please review the details and confirm when you'd like to start.`;

    parsed = {
      summary: fallbackSummary,
      proposal: {
        totalWeeks,
        raceGoalName,
        raceDate: raceDateFormatted,
        currentVolume: `~${avgVolumeKm} km/wk`,
        peakVolume: phasePeakStr,
        proposedStartDate: defaultStartStr,
        phases: [
          { name: "Base", weeks: baseWeeks, focus: "Build aerobic foundation", peakVolume: `~${Math.round(peakVol * 0.8)} km/wk` },
          { name: "Build", weeks: buildWeeks, focus: "Race-specific intensity", peakVolume: phasePeakStr },
          { name: "Peak", weeks: peakWeeks, focus: "Sharpen and rehearse", peakVolume: phasePeakStr },
          { name: "Taper", weeks: taperWeeks, focus: "Rest and prepare", peakVolume: `~${Math.round(peakVol * 0.5)} km/wk` },
        ],
        adjustments: ["Phases adjusted based on available training data"],
      },
    };
  }

  // TypeScript guard — both parse attempts and fallback must produce a result
  if (!parsed) {
    return { error: "Failed to generate a plan proposal after all attempts.", code: "PARSE_FAILED" };
  }

  // ── Override ALL volumes with deterministic values ───────────────
  // Training-log data may be incomplete, so we apply a race-distance-based
  // minimum floor and compute a proper progression curve.  This guarantees
  // the same result every click and prevents unrealistically low volumes.
  const effectiveStartStr = `~${effectiveStartKm} km/wk`;
  const effectivePeakStr = `~${effectivePeakKm} km/wk`;
  parsed.proposal.currentVolume = effectiveStartStr;
  parsed.proposal.peakVolume = effectivePeakStr;

  for (const phase of parsed.proposal.phases) {
    switch (phase.name) {
      case "Base":
        phase.peakVolume = effectiveStartStr;
        break;
      case "Build":
        phase.peakVolume = `~${Math.round(effectiveStartKm + (effectivePeakKm - effectiveStartKm) * 0.6)} km/wk`;
        break;
      case "Peak":
        phase.peakVolume = effectivePeakStr;
        break;
      case "Taper":
        phase.peakVolume = `~${Math.round(effectivePeakKm * 0.5)} km/wk`;
        break;
    }
  }

  // 8. Store the summary as the conversation message
  await prisma.coachMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: parsed.summary,
    },
  });

  // 9. Fire progress so the frontend can show the first proposal
  options?.onProgress?.({
    type: "status",
    message: "Plan proposal ready — review the details and let me know if you’d like any changes.",
  });

  return {
    conversationId: conversation.id,
    response: parsed.summary,
    proposal: parsed.proposal || null,
  };
}

/**
 * Approve the interview proposal and build the full training plan in ONE LLM call.
 *
 * Instead of entering the chat tool loop (which takes 4–6 LLM iterations to build
 * phases one at a time), this makes a single call with `tool_choice` forced to
 * `create_full_training_plan`, which generates ALL phases and ALL weeks at once.
 *
 * The result is 1 LLM call + DB writes, down from 5–6 LLM calls.
 */
export async function approvePlanProposal(
  conversationId: string,
  userId: string,
  options?: ChatOptions,
  locale = "en",
  proposalOverrides?: Record<string, unknown>,
): Promise<
  | { success: true; response: string; phases: Array<{ name: string; weekCount: number; sessionCount: number }> }
  | { error: string; code: string }
> {
  // 1. Load conversation + config
  const conversation = await prisma.coachConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conversation || conversation.userId !== userId) {
    return { error: "Conversation not found.", code: "NOT_FOUND" };
  }

  const llmConfig = await resolveUserLlmConfig(userId);
  if (!isLlmConfigured(llmConfig.apiKey, llmConfig.provider)) {
    return { error: "AI coach is not configured.", code: "NOT_CONFIGURED" };
  }

  // 2. Gather fresh training context
  const ctx = await gatherTrainingContext(userId);
  const contextStr = buildContextSummary(ctx, locale);

  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: { contextSnapshot: { ...(conversation.contextSnapshot as Record<string, unknown> || {}), summaryText: contextStr }, updatedAt: new Date() },
  });

  // 3. Generate the plan ONE PHASE AT A TIME using JSON mode.
  //    DeepSeek's thinking mode doesn't support tool calling, so we bypass it
  //    with ask()+jsonMode.  Each phase is a separate LLM call so the user
  //    sees continuous progress in the frontend.

  const primaryGoal = ctx.goals[0];
  if (!primaryGoal) {
    return { error: "No race goal found. Set a goal before building a plan.", code: "NOT_FOUND" };
  }

  // ── Determine phase structure ──────────────────────────
  const overrides = proposalOverrides as {
    proposedStartDate?: string;
    phases?: Array<{ name: string; weeks: number }>;
    peakVolume?: string;
  } | undefined;

  const phaseStructure = overrides?.phases?.length
    ? overrides.phases
    : derivePhaseStructure(ctx);

  // ── Determine start date ───────────────────────────────
  const proposedStartDate = overrides?.proposedStartDate;
  const planStartDate = proposedStartDate || getNextMondayStr();
  const startDate = new Date(planStartDate);
  if (isNaN(startDate.getTime())) {
    return { error: "Invalid start date.", code: "PARSE_FAILED" };
  }

  // ── Build shared context string for per-phase prompts ──
  // Include the full training context so the LLM can tailor sessions
  // to the athlete's terrain, schedule, and constraints.
  const athleteContextParts: string[] = [
    `Goal: "${primaryGoal.name}" (${(primaryGoal.distanceMeters / 1000).toFixed(1)}K)`,
    `Goal ID: "${primaryGoal.id}"`,
    `Target date: ${primaryGoal.targetDate}`,
    `Plan start: ${planStartDate}`,
    `Current volume: ~${ctx.longTermVolumeKm} km/wk (12-week avg)`,
    `CTL: ${ctx.pmc.ctl}, ATL: ${ctx.pmc.atl}, TSB: ${ctx.pmc.tsb} (${ctx.pmc.tsbTrend})`,
  ];

  // Athlete's free-text training context (where/when they train, constraints)
  if (ctx.trainingContext) {
    athleteContextParts.push(`\n### Training Context\n${ctx.trainingContext}`);
  }

  // Recent 4-week volume trend
  if (ctx.recentWeeks.length > 0) {
    const weekLines = ctx.recentWeeks.map((w) =>
      `  ${w.label}: ${(w.volumeMeters / 1000).toFixed(0)} km, ${w.elevationMeters.toFixed(0)}m vert, ${w.activityCount} activities`
    ).join("\n");
    athleteContextParts.push(`\n### Recent 4 Weeks\n${weekLines}`);
  }

  // Goals with course profiles and best previous performances
  if (ctx.goals.length > 0) {
    const goalLines: string[] = [];
    for (const g of ctx.goals) {
      let line = `- ${g.name} (${(g.distanceMeters / 1000).toFixed(0)} km), target ${g.targetDate}`;
      if (g.elevationGainMeters && g.elevationGainMeters > 0) {
        line += `, ${g.elevationGainMeters.toFixed(0)}m vert`;
      }
      if (g.courseProfileSummary) {
        line += `, course: ${(g.courseProfileSummary.distanceMeters / 1000).toFixed(0)}km / ${g.courseProfileSummary.elevationGainMeters.toFixed(0)}m vert`;
      }
      if (g.bestPrevious) {
        line += ` — previous best: ${g.bestPrevious.pacePerKm} on ${g.bestPrevious.date}`;
      }
      goalLines.push(line);
    }
    athleteContextParts.push(`\n### Goals\n${goalLines.join("\n")}`);
  }

  // Fatigue
  if (ctx.fatigue) {
    athleteContextParts.push(`\n### Fatigue (${ctx.fatigue.severity})\n${ctx.fatigue.signals.join("\n")}`);
  }

  // Health
  if (ctx.dailyHealth) {
    athleteContextParts.push(
      `\n### Health (7d avg)\nSleep: ${ctx.dailyHealth.sleepAvg} min, HRV: ${ctx.dailyHealth.hrvAvg} ms, Resting HR: ${ctx.dailyHealth.restingHrAvg} bpm`
    );
  }

  const goalContext = athleteContextParts.join("\n");

  const toolProgressCb = options?.onProgress
    ? (event: Record<string, unknown>) => { options.onProgress!(event as ChatProgressEvent); }
    : undefined;

  const savedPhases: Array<{ name: string; phaseOrder: number; weekCount: number; sessionCount: number }> = [];
  let currentStartDate = new Date(startDate);
  let anyFailure: string | null = null;

  for (let i = 0; i < phaseStructure.length; i++) {
    const ps = phaseStructure[i];
    const phaseOrder = i + 1;

    if (options?.signal?.aborted) {
      return { error: "Request was cancelled.", code: "ABORTED" };
    }

    options?.onProgress?.({
      type: "status",
      message: `Generating ${ps.name} phase (${ps.weeks} week${ps.weeks > 1 ? "s" : ""})...`,
    });

    // Call LLM to generate weeks + sessions for this one phase
    const phaseSystemPrompt = `You are a training-plan designer. Output ONLY valid JSON (no markdown, no code fences).

Generate the weeks and daily sessions for the **${ps.name}** phase (phase ${phaseOrder} of ${phaseStructure.length}) of a training plan.

${goalContext}

## Phase Requirements
- Phase: ${ps.name}
- Number of weeks: ${ps.weeks}
- Phase order: ${phaseOrder}
- Phase starts: ${currentStartDate.toISOString().split("T")[0]} (Monday)
${overrides?.peakVolume ? `- Target peak weekly volume: ${overrides.peakVolume}` : ""}

Output a JSON object with a "weeks" array. Each week has:
{
  "weekNumber": integer (1, 2, 3...),
  "weekStart": "YYYY-MM-DD" (Monday date for this week),
  "targetVolumeMeters": number (weekly volume in meters),
  "targetElevationMeters": number (optional),
  "coachNotes": "string — rationale for this week",
  "sessions": [
    {
      "dayOfWeek": 0-6 (0=Sun, 1=Mon ... 6=Sat),
      "type": "run" | "ride" | "swim" | "rest" | "workout" | "hike" | "other",
      "description": "Full workout details — pace zones, effort levels, duration, terrain cues, specific intervals",
      "targetDistance": number (meters, 0 for rest),
      "targetDuration": integer (seconds),
      "targetElevation": number (optional, meters)
    }
    // ... 7 sessions per week, one per day
  ]
}

Design rules:
- Week starts are consecutive Mondays. Week 1 starts on the phase start date above.
- Volume should progress sensibly within the phase (build weeks, cutback weeks at ~80%)
- Include specific pace zones, effort levels, and terrain cues in descriptions
- Rest days: type "rest", targetDistance 0, targetDuration 0
- Include some quality sessions appropriate for the ${ps.name} phase
- CRITICAL: Use the athlete's Training Context (terrain, schedule, constraints), Goals, Health, and Fatigue data above to tailor every session — do NOT generate generic workouts
- Past days (before today) should still be included — the system skips them automatically`;

    const rawResult = await ask(phaseSystemPrompt, "Generate the phase JSON now. Output ONLY the JSON object with the weeks array.", {
      temperature: 0.3,
      maxTokens: 16384,
      jsonMode: true,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
    });

    if (!rawResult) {
      anyFailure = `Failed to generate ${ps.name} phase. Try again.`;
      break;
    }

    let weeksData: Array<Record<string, unknown>> | null = null;
    try {
      const parsed = JSON.parse(sanitizeJsonText(rawResult));
      weeksData = parsed.weeks as Array<Record<string, unknown>> | undefined || null;
      if (!weeksData || !Array.isArray(weeksData) || weeksData.length === 0) {
        // Try wrapping in weeks if it looks like a single-phase response
        if (parsed.phaseName || parsed.phaseOrder) {
          weeksData = parsed.weeks || null;
        }
      }
    } catch {
      // Parse failed — retry this phase once
      const retry = await ask(phaseSystemPrompt, "Your previous response wasn't valid JSON. Output ONLY a JSON object with a weeks array. No other text.", {
        temperature: 0.2, maxTokens: 16384, jsonMode: true,
        apiKey: llmConfig.apiKey, baseUrl: llmConfig.baseUrl, model: llmConfig.model,
      });
      if (retry) {
        try {
          const parsed = JSON.parse(sanitizeJsonText(retry));
          weeksData = parsed.weeks as Array<Record<string, unknown>> | undefined || null;
        } catch { /* still bad — give up on this phase */ }
      }
    }

    if (!weeksData || weeksData.length === 0) {
      anyFailure = `Failed to parse ${ps.name} phase data. Try again.`;
      break;
    }

    // Fire tool_call event so frontend registers this phase
    options?.onProgress?.({
      type: "tool_call",
      tool: "create_training_phase",
      phaseName: `${ps.name} Phase`,
    } as ToolCallEvent);

    // Save the phase to DB
    const saveResult = await executeCreateTrainingPhase(userId, {
      phaseName: `${ps.name} Phase`,
      phaseGoal: generatePhaseGoal(ps.name),
      raceGoalId: primaryGoal.id,
      phaseOrder,
      weeks: weeksData,
    }, toolProgressCb);

    if (!saveResult.success) {
      anyFailure = saveResult.message;
      break;
    }

    // Fire phase_complete for the frontend's progress list
    options?.onProgress?.({
      type: "phase_complete",
      phaseName: `${ps.name} Phase`,
      phaseOrder,
      phaseGoal: generatePhaseGoal(ps.name),
      weekCount: (saveResult.data?.weekCount as number) || weeksData.length,
      weeks: (saveResult.data?.weeks as string[]) || [],
      sessionCount: (saveResult.data?.sessionCount as number) || 0,
    } as PhaseProgressEvent);

    savedPhases.push({
      name: `${ps.name} Phase`,
      phaseOrder,
      weekCount: (saveResult.data?.weekCount as number) || weeksData.length,
      sessionCount: (saveResult.data?.sessionCount as number) || 0,
    });

    // Advance the start date for the next phase
    currentStartDate = new Date(currentStartDate.getTime() + ps.weeks * 7 * 86400000);
  }

  if (anyFailure) {
    return { error: anyFailure, code: "TOOL_FAILED" };
  }

  // 8. Store messages in the conversation
  await prisma.coachMessage.create({
    data: {
      conversationId,
      role: "user",
      content: "Approved the plan proposal — building it now.",
    },
  });

  const phaseSummary = savedPhases.map(p => `${p.name} (${p.weekCount}w, ${p.sessionCount} sessions)`).join(", ");
  const finalText = `Your training plan is ready! ${phaseSummary}`;

  await prisma.coachMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: finalText,
    },
  });

  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return {
    success: true,
    response: finalText,
    phases: savedPhases,
  };
}

/**
 * Send a follow-up message in an ongoing conversation.
 * Uses tool calling to let the LLM modify user data (goals, training context, etc.)
 * and generate plan suggestions during the conversation.
 */
export async function chat(
  conversationId: string,
  userId: string,
  message: string,
  options?: ChatOptions,
  pageContext?: PageContext | null,
  locale = "en"
): Promise<CoachChatResult | { error: string; code: string }> {
  // 1. Load conversation + config
  const conversation = await prisma.coachConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conversation || conversation.userId !== userId) {
    return { error: "Conversation not found.", code: "NOT_FOUND" };
  }

  const llmConfig = await resolveUserLlmConfig(userId);
  if (!isLlmConfigured(llmConfig.apiKey, llmConfig.provider)) {
    return { error: "AI coach is not configured.", code: "NOT_CONFIGURED" };
  }

  // 2. Gather fresh training context (always current, not the stale snapshot)
  const ctx = await gatherTrainingContext(userId);
  let freshContextSummary = buildContextSummary(ctx, locale);

  // Append page context if available
  if (pageContext) {
    const pageStr = await buildPageContextSummary(pageContext, userId, locale);
    if (pageStr) {
      freshContextSummary += `\n\n## Page Context\n${pageStr}`;
    }
  }

  // Also update the stored snapshot so subsequent calls benefit
  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: {
      contextSnapshot: { ...(conversation.contextSnapshot as Record<string, unknown> || {}), summaryText: freshContextSummary },
      updatedAt: new Date(),
    },
  });

  const langInstruction = getLanguageInstruction(locale);
  const recentMessages = conversation.messages.slice(-20);
  const llmMessages: LlmMessage[] = [
    { role: "system", content: `${langInstruction}${await getChatPrompt()}\n\n## Current Training Context\n${freshContextSummary}` },
  ];

  for (const m of recentMessages) {
    if (m.role === "system") continue;
    llmMessages.push({
      role: m.role as "user" | "assistant",
      content: m.content,
    });
  }
  llmMessages.push({ role: "user", content: message });

  // 3. Tool-calling loop
  const MAX_TOOL_ITERATIONS = 10;
  let iterations = 0;
  let finalResponse = "I wasn't able to complete that request. Please try again.";
  const suggestions: CoachChatResult["suggestions"] = [];
  let allToolCallsExecuted = false;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    console.error(`[AI-COACH] Tool loop iteration ${iterations}, messages count: ${llmMessages.length}`);

    // Check for client disconnect before making another LLM call
    if (options?.signal?.aborted) {
      console.error(`[AI-COACH] Request aborted by client, breaking tool loop`);
      finalResponse = "Request was cancelled.";
      break;
    }

    // Notify frontend that the LLM is thinking
    if (options?.onProgress) {
      options.onProgress({
        type: "status",
        message: iterations === 1
          ? "Analyzing your training data and crafting a plan..."
          : `Working on next steps (iteration ${iterations})...`,
      });
    }

    const response = await chatWithTools(llmMessages, {
      temperature: 0.3,
      maxTokens: 4096,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
      tools: ALL_COACH_TOOLS,
      toolChoice: "auto",
    });

    if (!response) {
      console.error(`[AI-COACH] chatWithTools returned null on iteration ${iterations}`);
      if (iterations === 1) {
        return { error: "AI coach returned no response. Try again.", code: "LLM_FAILED" };
      }
      break;
    }

    // Store the assistant's response text (may be null if only tool calls)
    const assistantContent = response.content || "";
    console.error(`[AI-COACH] Iteration ${iterations}: content length=${assistantContent.length}, toolCalls=${response.toolCalls?.length || 0}`);

    // Add assistant message to the context
    llmMessages.push({
      role: "assistant",
      content: assistantContent,
      tool_calls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    });

    // Relay LLM's reasoning + tool intent to the frontend
    if (response.toolCalls?.length && options?.onProgress) {
      // If LLM produced text alongside tool calls, show a snippet of its reasoning
      const trimmed = assistantContent.trim();
      if (trimmed && trimmed.length > 10) {
        const snippet = trimmed.replace(/\n+/g, " ").slice(0, 140);
        options.onProgress({
          type: "status",
          message: snippet + (trimmed.length > 140 ? "…" : ""),
        });
      }
      // Also describe which tools the LLM wants to use
      const toolNames = response.toolCalls.map((tc) => tc.function.name);
      const toolDescriptions = toolNames.map((name) => {
        switch (name) {
          case "create_training_phase": return "Creating training phase";
          case "update_weekly_plan": return "Updating weekly plan";
          case "manage_goals": return "Managing race goals";
          case "query_activities": return "Looking up your activity history";
          case "update_training_context": return "Updating training context";
          case "set_activity_as_goal": return "Setting activity as goal";
          default: return name.replace(/_/g, " ");
        }
      });
      options.onProgress({
        type: "status",
        message: `→ ${toolDescriptions.join(", ")}`,
      });
    }

    // If no tool calls, decide whether to accept or push back
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const trimmed = assistantContent.trim().toLowerCase();
      const bailed = !trimmed || trimmed === "done." || trimmed === "done" || trimmed === "ok." || trimmed === "ok" || trimmed === "okay";

      if (bailed && iterations < 5) {
        // Push back — the LLM bailed without doing anything
        console.error(`[AI-COACH] Bail detected (iter ${iterations}), pushing back`);
        llmMessages.push({
          role: "user",
          content: "That's not actionable. You have the athlete's data — use create_training_phase to design their training plan phase by phase. Build at least Phase 1 now with appropriate weeks and sessions.",
        });
        continue;
      }

      finalResponse = assistantContent || "Done.";
      console.error(`[AI-COACH] No tool calls, final response: "${finalResponse.slice(0, 100)}"`);
      break;
    }

    // Execute each tool call
    for (const toolCall of response.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        console.error(`[AI-COACH] Failed to parse tool call args for "${toolCall.function.name}": length=${toolCall.function.arguments?.length || 0}, start=${toolCall.function.arguments?.slice(0, 120)}`);
        console.error(`[AI-COACH] End of truncated args: ${toolCall.function.arguments?.slice(-200)}`);
      }

      console.error(`[AI-COACH] Executing tool: ${toolCall.function.name} with args: ${JSON.stringify(args).slice(0, 200)}`);

      // Fire tool_call event so frontend shows what the LLM is doing
      if (options?.onProgress) {
        const toolName = toolCall.function.name;
        const toolEvent: ToolCallEvent = { type: "tool_call", tool: toolName };
        if (toolName === "create_training_phase" && args.phaseName) {
          toolEvent.phaseName = args.phaseName as string;
        } else if (toolName === "manage_goals" && args.action) {
          toolEvent.action = args.action as string;
        } else if (toolName === "query_activities" && args.type) {
          toolEvent.tool = `query_activities (${args.type})`;
        }
        options.onProgress(toolEvent);
      }

      // Wrap onProgress from chat() to forward progress events from tool execution
      const toolProgressCb = options?.onProgress
        ? (event: Record<string, unknown>) => { options.onProgress!(event as ChatProgressEvent); }
        : undefined;

      const result = await executeTool(toolCall.function.name, args, userId, toolProgressCb);
      console.error(`[AI-COACH] Tool result: success=${result.success}, message="${result.message?.slice(0, 100)}"`);

      llmMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });

      // Fire progress callback after a training phase is saved
      if (
        toolCall.function.name === "create_training_phase" &&
        result.success &&
        result.data &&
        options?.onProgress
      ) {
        options.onProgress({
          type: "phase_complete",
          phaseName: (args.phaseName as string) || "Unknown Phase",
          phaseOrder: (args.phaseOrder as number) || 0,
          phaseGoal: (args.phaseGoal as string) || "",
          weekCount: (result.data.weekCount as number) || 0,
          weeks: (result.data.weeks as string[]) || [],
          sessionCount: (result.data.sessionCount as number) || 0,
        });
      }

      // If a goal was created, surface it as a suggestion for the UI
      if (
        toolCall.function.name === "manage_goals" &&
        args.action === "create" &&
        result.success &&
        result.data
      ) {
        suggestions.push({
          id: result.data.id as string,
          type: "goal_created",
          title: `Goal: ${(result.data.name as string) || ""}`,
          description: result.message,
          status: "applied",
        });
      }
    }
  }

  // Store user message
  const userMsg = await prisma.coachMessage.create({
    data: { conversationId, role: "user", content: message },
  });

  // Store the final assistant response and any tool messages
  await prisma.coachMessage.create({
    data: { conversationId, role: "assistant", content: finalResponse },
  });

  // Update conversation timestamp
  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  // Optionally build an updated proposal if plan data was modified during the tool loop
  const updatedProposal = await buildProposalFromState(userId, message);

  return {
    conversationId,
    response: finalResponse,
    suggestions,
    messages: [
      { id: userMsg.id, role: "user", content: userMsg.content, createdAt: userMsg.createdAt.toISOString() },
      { id: "assistant-msg", role: "assistant", content: finalResponse, createdAt: new Date().toISOString() },
    ],
    ...(updatedProposal ? { proposal: updatedProposal } : {}),
  };
}

/**
 * Build a PlanProposal object from the current DB state (goals + plan weeks + recent volume).
 * Used after chat() tool calls to return an updated proposal to the frontend.
 */
async function buildProposalFromState(
  userId: string,
  _message: string
): Promise<z.infer<typeof PlanProposalSchema> | null> {
  try {
    // Get the nearest active A-priority goal, fall back to any active goal
    const goal = await prisma.raceGoal.findFirst({
      where: { userId, status: "active" },
      orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
    });
    if (!goal) return null;

    const now = new Date();
    const raceDate = goal.targetDate;
    const diffMs = raceDate.getTime() - now.getTime();
    const totalWeeks = Math.max(1, Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)));

    // Get plan weeks
    const planWeeks = await prisma.weeklyPlan.findMany({
      where: { userId, weekStartDate: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) } },
      orderBy: { weekStartDate: "asc" },
    });

    const hasPlan = planWeeks.length > 0;

    // Get recent weekly volume for "current volume" estimate
    const recentActivities = await prisma.trainingLog.findMany({
      where: {
        userId,
        mergedIntoId: null,
        type: { in: ["run", "ride", "hike"] },
        startDate: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { distanceMeters: true },
    });
    const recentVolumeKm = recentActivities.reduce((s, a) => s + (a.distanceMeters || 0), 0) / 1000;

    // Derive phases from plan weeks
    const phaseData: Array<{ name: "Base" | "Build" | "Peak" | "Taper"; weeks: number; focus: string; peakVolume: string }> = [];
    if (hasPlan) {
      // Group consecutive weeks by theme extracted from coachNotes
      let currentPhase: { name: "Base" | "Build" | "Peak" | "Taper"; focus: string; weeks: number; peakVolume: number } | null = null;
      for (const pw of planWeeks) {
        const notes = (pw.coachNotes || "").toLowerCase();
        let phaseName: "Base" | "Build" | "Peak" | "Taper" = "Build";
        if (notes.includes("base")) phaseName = "Base";
        else if (notes.includes("build")) phaseName = "Build";
        else if (notes.includes("peak")) phaseName = "Peak";
        else if (notes.includes("taper")) phaseName = "Taper";
        else if (notes.includes("race")) phaseName = "Peak";
        else if (notes.includes("recover") || notes.includes("reload")) phaseName = "Base";

        const vol = pw.targetVolumeMeters ? Math.round(pw.targetVolumeMeters / 1000) : 0;

        if (currentPhase && currentPhase.name === phaseName) {
          currentPhase.weeks++;
          if (vol > currentPhase.peakVolume) currentPhase.peakVolume = vol;
        } else {
          if (currentPhase) {
            phaseData.push({
              name: currentPhase.name,
              weeks: currentPhase.weeks,
              focus: currentPhase.focus,
              peakVolume: `~${currentPhase.peakVolume} km/wk`,
            });
          }
          currentPhase = { name: phaseName, focus: phaseName, weeks: 1, peakVolume: vol };
        }
      }
      if (currentPhase) {
        phaseData.push({
          name: currentPhase.name,
          weeks: currentPhase.weeks,
          focus: currentPhase.focus,
          peakVolume: `~${currentPhase.peakVolume} km/wk`,
        });
      }
    }

    // If no real phases from plan, generate simple structure from totalWeeks
    if (phaseData.length === 0) {
      const baseWeeks = Math.max(2, Math.round(totalWeeks * 0.4));
      const buildWeeks = Math.max(2, Math.round(totalWeeks * 0.3));
      const peakWeeks = Math.max(1, Math.round(totalWeeks * 0.15));
      const taperWeeks = Math.max(1, totalWeeks - baseWeeks - buildWeeks - peakWeeks);
      const peakVol = Math.round(recentVolumeKm * 1.5);
      phaseData.push({ name: "Base", weeks: baseWeeks, focus: "Build aerobic base", peakVolume: `~${peakVol} km/wk` });
      phaseData.push({ name: "Build", weeks: buildWeeks, focus: "Race-specific training", peakVolume: `~${peakVol} km/wk` });
      phaseData.push({ name: "Peak", weeks: peakWeeks, focus: "Sharpen and rehearse", peakVolume: `~${peakVol} km/wk` });
      phaseData.push({ name: "Taper", weeks: taperWeeks, focus: "Rest and prepare", peakVolume: `~${Math.round(peakVol * 0.6)} km/wk` });
    }

    // Calculate peak volume
    const peakVol = Math.max(...phaseData.map((p) => parseInt(p.peakVolume) || 0), Math.round(recentVolumeKm * 1.3));

    const distanceKm = goal.distanceMeters ? goal.distanceMeters / 1000 : 0;
    const raceName = `${goal.name}${distanceKm > 0 ? ` (${distanceKm.toFixed(0)}K)` : ""}`;
    const formattedDate = raceDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    const adjustments: string[] = [];
    if (phaseData.length > 0) {
      adjustments.push(`${phaseData.length} training phases planned`);
    }

    return {
      totalWeeks,
      raceGoalName: raceName,
      raceDate: formattedDate,
      currentVolume: `~${Math.round(recentVolumeKm)} km/wk`,
      peakVolume: `~${peakVol} km/wk`,
      phases: phaseData.slice(0, 6),
      adjustments,
    };
  } catch {
    // Silently fail — proposal is optional
    return null;
  }
}

/**
 * Apply a pending suggestion to the user's weekly plan.
 */
export async function applySuggestion(
  userId: string,
  suggestionId: string
): Promise<{ success: true; plan: Record<string, unknown> } | { error: string; code: string }> {
  const suggestion = await prisma.coachSuggestion.findUnique({
    where: { id: suggestionId },
  });

  if (!suggestion || suggestion.userId !== userId) {
    return { error: "Suggestion not found.", code: "NOT_FOUND" };
  }
  if (suggestion.status !== "pending") {
    return { error: `Suggestion was already ${suggestion.status}.`, code: "ALREADY_PROCESSED" };
  }

  const changes = suggestion.changes as Record<string, unknown>;
  const now = new Date();
  const weekStart = getWeekStart(now);
  weekStart.setDate(weekStart.getDate() + 7); // next Monday

  // Load current plan
  const existingPlan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
  });

  if (!existingPlan) {
    return { error: "No weekly plan exists. Generate a plan first.", code: "NO_PLAN" };
  }

  // Apply changes to planned sessions
  let sessions = (existingPlan.plannedSessions as Array<Record<string, unknown>>) || [];

  if (suggestion.suggestionType === "rest_day_addition" && changes.dayOfWeek !== undefined) {
    sessions = sessions.map((s) =>
      s.dayOfWeek === changes.dayOfWeek ? { ...s, type: "rest", description: "Rest day", targetDistance: null, targetElevation: null, targetDuration: 0 } : s
    );
  } else if (suggestion.suggestionType === "session_change" && changes.sessions) {
    const sessionChanges = changes.sessions as Array<Record<string, unknown>>;
    for (const sc of sessionChanges) {
      sessions = sessions.map((s) =>
        s.dayOfWeek === sc.dayOfWeek ? { ...s, ...sc } : s
      );
    }
  } else if (suggestion.suggestionType === "volume_change") {
    // Volume target changes are applied to the plan-level fields, not individual sessions
  }

  // Build adjustment summary
  const summary = `${suggestion.title}: ${suggestion.description}`;
  const adjustmentHistory = (existingPlan.adjustmentHistory as Array<{ timestamp: string; prompt: string; summary: string }>) || [];
  adjustmentHistory.push({
    timestamp: now.toISOString(),
    prompt: `Applied suggestion: ${suggestion.title}`,
    summary,
  });

  // Upsert plan
  const updateData: Record<string, unknown> = {
    plannedSessions: structuredClone(sessions) as any,
    overridesExisting: true,
    generatedAt: now,
    adjustments: [
      `🤖 ${summary}`,
      ...(existingPlan.adjustments || []),
    ],
    adjustmentHistory,
  };

  if (suggestion.suggestionType === "volume_change") {
    if (changes.targetVolumeMeters) updateData.targetVolumeMeters = changes.targetVolumeMeters;
    if (changes.targetElevationMeters) updateData.targetElevationMeters = changes.targetElevationMeters;
    if (changes.targetDurationSeconds) updateData.targetDurationSeconds = changes.targetDurationSeconds;
  }

  await prisma.weeklyPlan.update({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
    data: updateData,
  });

  // Mark suggestion as applied
  await prisma.coachSuggestion.update({
    where: { id: suggestionId },
    data: { status: "applied", appliedAt: now },
  });

  // Reload the plan to return
  const updatedPlan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
  });

  return { success: true, plan: updatedPlan as unknown as Record<string, unknown> };
}

// ── Per-activity analysis ──────────────────────────────

const ActivityAnalysisResultSchema = z.object({
  trainingType: z.enum([
    "easy_recovery", "long_run", "tempo", "threshold", "interval",
    "fartlek", "hill_repeats", "sprints", "aerobic_endurance",
    "race", "cross_training", "other",
  ]),
  trainingTypeLabel: z.string().min(1).max(60),
  analysis: z.string().min(1),
  flags: z.array(z.string()),
  verdict: z.enum(["productive", "neutral", "unproductive"]),
});

/**
 * Analyze a single activity against the athlete's training plan and goals.
 * Stores the analysis result in TrainingLog.coachAnalysis.
 */
export async function analyzeActivity(
  userId: string,
  activityId: string,
  localeOverride?: string
): Promise<{ success: true; analysis: string } | { error: string; code: string }> {
  // 1. Load activity
  const activity = await prisma.trainingLog.findUnique({
    where: { id: activityId },
  });

  if (!activity || activity.userId !== userId) {
    return { error: "Activity not found.", code: "NOT_FOUND" };
  }

  // 2. Resolve LLM config
  const llmConfig = await resolveUserLlmConfig(userId);
  if (!isLlmConfigured(llmConfig.apiKey, llmConfig.provider)) {
    return { error: "AI coach is not configured. Set up your API key in Settings → API & Credentials.", code: "NOT_CONFIGURED" };
  }

  // Determine locale (from override param or user DB record)
  const locale = localeOverride || (await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } }))?.locale || "en";

  // 3. Gather training context
  const ctx = await gatherTrainingContext(userId);

  // 4. Find the week this activity belongs to and the matching planned session
  const activityWeekStart = getWeekStart(activity.startDate);
  const activityDayOfWeek = activity.startDate.getDay(); // 0=Sun, 1=Mon, ...
  let plannedSession: string | null = null;

  // Find weekly plan for the activity's week
  const weekPlan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: activityWeekStart } },
  });

  if (weekPlan?.plannedSessions) {
    const sessions = weekPlan.plannedSessions as Array<Record<string, unknown>>;
    const matching = sessions.find((s) => s.dayOfWeek === activityDayOfWeek);
    if (matching) {
      plannedSession = [
        `Type: ${matching.type}`,
        matching.description ? `Description: ${matching.description}` : null,
        matching.targetDistance ? `Target distance: ${(matching.targetDistance as number) / 1000}km` : null,
        matching.targetDuration ? `Target duration: ${formatDuration(matching.targetDuration as number)}` : null,
        matching.targetElevation ? `Target elevation: ${Math.round(matching.targetElevation as number)}m` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  // 5. Build pace string
  const paceStr = activity.distanceMeters && activity.distanceMeters > 0 && activity.durationSeconds > 0
    ? `${Math.floor(activity.durationSeconds / 60 / (activity.distanceMeters / 1000))}:${String(Math.round((activity.durationSeconds / (activity.distanceMeters / 1000)) % 60)).padStart(2, "0")}/km`
    : null;

  // 6. Build activity summary
  const activitySummary = [
    `## Activity`,
    `Name: ${activity.name}`,
    `Type: ${activity.type}${activity.subType ? ` (${activity.subType})` : ""}`,
    `Is race: ${activity.isRace ? "Yes" : "No"}`,
    `Date: ${activity.startDate.toISOString().split("T")[0]}`,
    activity.distanceMeters ? `Distance: ${(activity.distanceMeters / 1000).toFixed(2)}km` : null,
    `Duration: ${formatDuration(activity.durationSeconds)}`,
    activity.elevationGainMeters ? `Elevation gain: ${Math.round(activity.elevationGainMeters)}m` : null,
    paceStr ? `Average pace: ${paceStr}` : null,
    activity.averageHr ? `Average HR: ${Math.round(activity.averageHr)} bpm` : null,
    activity.maxHr ? `Max HR: ${Math.round(activity.maxHr)} bpm` : null,
    activity.averagePower ? `Average power: ${Math.round(activity.averagePower)}W` : null,
    activity.tss ? `TSS: ${Math.round(activity.tss)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // 7. Build context summary (reuse shared buildContextSummary for consistency)
  const contextStr = buildContextSummary(ctx, locale) + (
    plannedSession
      ? `\n### Planned Session for That Day\n${plannedSession}\n`
      : "\n### Planned Session for That Day\nNo specific plan set for this day.\n"
  );

  // 9. Call LLM
  const langInstruction = getLanguageInstruction(locale);
  const systemPrompt = `${langInstruction}${await getActivityAnalyzePrompt()}\n\n${contextStr}`;
  const userPrompt = `${activitySummary}\n\nAnalyze this activity against the athlete's training plan and goals.`;

  const result = await ask(systemPrompt, userPrompt, {
    temperature: 0.3,
    maxTokens: 1024,
    jsonMode: true,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
  });

  if (!result) {
    return { error: "AI coach returned no response. The model may be unavailable.", code: "LLM_FAILED" };
  }

  // 10. Parse and validate (with one retry on parse failure)
  let parsed: z.infer<typeof ActivityAnalysisResultSchema>;
  try {
    parsed = ActivityAnalysisResultSchema.parse(JSON.parse(sanitizeJsonText(result)));
  } catch (firstErr) {
    console.error("[activity-analyze] First parse failed. Raw LLM response:", result?.substring(0, 2000));
    console.error("[activity-analyze] First parse error:", (firstErr as Error).message);

    // Retry once with stricter instruction
    const retry = await ask(
      systemPrompt,
      `Your previous response was invalid JSON. Return ONLY valid JSON matching the schema exactly.`,
      { temperature: 0.2, maxTokens: 1024, jsonMode: true, apiKey: llmConfig.apiKey, baseUrl: llmConfig.baseUrl, model: llmConfig.model }
    );
    if (!retry) return { error: "AI coach returned invalid data after retry.", code: "PARSE_FAILED" };
    try {
      parsed = ActivityAnalysisResultSchema.parse(JSON.parse(sanitizeJsonText(retry)));
    } catch (retryErr) {
      console.error("[activity-analyze] Retry parse also failed. Raw LLM response:", retry?.substring(0, 2000));
      console.error("[activity-analyze] Retry parse error:", (retryErr as Error).message);
      return { error: "AI coach returned invalid data after retry.", code: "PARSE_FAILED" };
    }
  }

  // 11. Build final analysis text
  const flagsStr = parsed.flags.length > 0 ? `\n\n**Flags:**\n- ${parsed.flags.join("\n- ")}` : "";
  const analysisText = `**${parsed.trainingTypeLabel}** · ${parsed.verdict === "productive" ? "✅ Productive" : parsed.verdict === "neutral" ? "➖ Neutral" : "⚠️ Unproductive"}${flagsStr}\n\n${parsed.analysis}`;

  // 12. Save to DB
  await prisma.trainingLog.update({
    where: { id: activityId },
    data: { coachAnalysis: analysisText, analysisStatus: "completed" },
  });

  return { success: true, analysis: analysisText };
}

/**
 * Analyze a single activity — worker-friendly wrapper that also handles
 * failure status updates. Same as analyzeActivity but catches errors
 * and sets analysisStatus to "failed" instead of throwing.
 */
export async function analyzeActivityWorker(
  userId: string,
  activityId: string
): Promise<{ success: true; analysis: string } | { error: string; code: string }> {
  try {
    // Mark as processing
    await prisma.trainingLog.update({
      where: { id: activityId },
      data: { analysisStatus: "processing" },
    });

    const result = await analyzeActivity(userId, activityId);

    if (!("success" in result)) {
      // analyzeActivity only sets status on success — set failed for errors
      await prisma.trainingLog.update({
        where: { id: activityId },
        data: { analysisStatus: "failed" },
      });
    }

    return result;
  } catch (err) {
    await prisma.trainingLog.update({
      where: { id: activityId },
      data: { analysisStatus: "failed" },
    }).catch(() => {}); // ignore if update fails

    return { error: (err as Error).message, code: "WORKER_FAILED" };
  }
}

// ── Conversation management ────────────────────────────

export async function listConversations(userId: string): Promise<{ conversations: ConversationListItem[] }> {
  const conversations = await prisma.coachConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: {
      _count: { select: { messages: true } },
    },
  });

  return {
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
    })),
  };
}

export async function getConversation(
  conversationId: string,
  userId: string
): Promise<{
  conversation: {
    id: string; title: string | null; status: string;
    contextSnapshot: unknown;
    messages: Array<{ id: string; role: string; content: string; suggestionId: string | null; createdAt: string }>;
    suggestions: Array<{ id: string; type: string; title: string; description: string; status: string; changes: unknown }>;
  };
} | { error: string; code: string }> {
  const conv = await prisma.coachConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      suggestions: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!conv || conv.userId !== userId) {
    return { error: "Conversation not found.", code: "NOT_FOUND" };
  }

  return {
    conversation: {
      id: conv.id,
      title: conv.title,
      status: conv.status,
      contextSnapshot: conv.contextSnapshot,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        suggestionId: m.suggestionId,
        createdAt: m.createdAt.toISOString(),
      })),
      suggestions: conv.suggestions.map((s) => ({
        id: s.id,
        type: s.suggestionType,
        title: s.title,
        description: s.description,
        status: s.status,
        changes: s.changes,
      })),
    },
  };
}

export async function startNewConversation(userId: string): Promise<{ conversationId: string }> {
  // Archive any active conversation
  await prisma.coachConversation.updateMany({
    where: { userId, status: "active" },
    data: { status: "archived" },
  });

  const conv = await prisma.coachConversation.create({
    data: { userId, title: null, status: "active" },
  });

  return { conversationId: conv.id };
}

/**
 * Clear the athlete's coaching context — archive current conversation,
 * start a fresh one, and delete all existing weekly plans so the
 * LLM builds a new plan from scratch.
 */
export async function clearContext(userId: string): Promise<{ conversationId: string }> {
  const now = new Date();
  const weekStart = getWeekStart(now);

  // Find the nearest active goal (or 12 weeks out)
  const nearestGoal = await prisma.raceGoal.findFirst({
    where: { userId, status: "active" },
    orderBy: { targetDate: "asc" },
    select: { targetDate: true },
  });
  const planEndDate = nearestGoal?.targetDate ?? new Date(now.getTime() + 84 * 86400000);

  // Delete all existing weekly plans from now until the plan horizon
  await prisma.weeklyPlan.deleteMany({
    where: {
      userId,
      weekStartDate: { gte: weekStart, lte: planEndDate },
    },
  });

  // Archive all active conversations and create a fresh one
  await prisma.coachConversation.updateMany({
    where: { userId, status: "active" },
    data: { status: "archived" },
  });

  const conv = await prisma.coachConversation.create({
    data: { userId, title: null, status: "active" },
  });

  return { conversationId: conv.id };
}

// ── Internal helpers ───────────────────────────────────

async function findOrCreateConversation(
  userId: string,
  ctx: Awaited<ReturnType<typeof gatherTrainingContext>>,
  locale = "en"
) {
  // Try to find an active conversation
  let conv = await prisma.coachConversation.findFirst({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });

  if (conv) {
    // Update its context snapshot
    const summaryText = buildContextSummary(ctx, locale);
    conv = await prisma.coachConversation.update({
      where: { id: conv.id },
      data: {
        contextSnapshot: { summaryText },
        updatedAt: new Date(),
      },
    });
  } else {
    // Create new
    const summaryText = buildContextSummary(ctx, locale);
    conv = await prisma.coachConversation.create({
      data: {
        userId,
        title: `Analysis — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        status: "active",
        contextSnapshot: { summaryText },
      },
    });
  }

  return conv;
}

async function persistLegacyNotes(
  userId: string,
  analysis: string,
  ctx: Awaited<ReturnType<typeof gatherTrainingContext>>
) {
  const now = new Date();
  const weekStart = getWeekStart(now);

  // Persist to WeeklyPlan.coachNotes
  try {
    await prisma.weeklyPlan.upsert({
      where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
      create: {
        userId,
        weekStartDate: weekStart,
        coachNotes: analysis,
        plannedSessions: ctx.weeklyPlan?.plannedSessions
          ? structuredClone(ctx.weeklyPlan.plannedSessions) as any
          : [],
        adjustments: ctx.weeklyPlan?.adjustments || [],
      },
      update: { coachNotes: analysis, generatedAt: now },
    });
  } catch { /* ignore upsert errors */ }

  // Create AnalysisReport
  try {
    await prisma.analysisReport.create({
      data: {
        userId,
        reportType: "coach_notes",
        triggeredBy: "manual",
        inputSnapshot: {
          goals: ctx.goals.length,
          dailyHealthAvailable: !!ctx.dailyHealth,
          pmcSnapshot: { ctl: ctx.pmc.ctl, atl: ctx.pmc.atl, tsb: ctx.pmc.tsb },
          weekVolume: ctx.currentWeek.volumeMeters,
        },
        outputContent: analysis,
        reasoning: {
          dataDrivers: [
            `CTL: ${Math.round(ctx.pmc.ctl)}`,
            `TSB: ${Math.round(ctx.pmc.tsb)}`,
            `Readiness: ${ctx.readinessScore}/100`,
            ...(ctx.dailyHealth ? [`Sleep: ${ctx.dailyHealth.sleepAvg}min`, `HRV: ${ctx.dailyHealth.hrvAvg}ms`] : []),
          ],
          strengths: [],
          concerns: [],
          keyDecisions: [],
        },
        metrics: {
          ctl: Math.round(ctx.pmc.ctl),
          atl: Math.round(ctx.pmc.atl),
          tsb: Math.round(ctx.pmc.tsb),
          readinessScore: ctx.readinessScore,
          volumeAdherence: ctx.volumeAdherence,
          consistency: ctx.consistencyScore,
          ...(ctx.dailyHealth ? {
            sleepAvg: ctx.dailyHealth.sleepAvg,
            hrvAvg: ctx.dailyHealth.hrvAvg,
            restingHrAvg: ctx.dailyHealth.restingHrAvg,
          } : {}),
        },
      },
    });
  } catch { /* ignore report errors */ }
}
