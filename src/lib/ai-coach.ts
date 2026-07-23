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
import { ALL_COACH_TOOLS, executeTool } from "./ai-coach-tools";
import { gatherTrainingContext } from "./training-context";
import { getWeekStart, formatDistance, formatDuration } from "./utils";
import { resolvePrompt, PROMPT_KEYS } from "./coach-prompts";

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

function buildContextSummary(ctx: Awaited<ReturnType<typeof gatherTrainingContext>>): string {
  let s = `## Athlete: ${ctx.athleteName}\n\n`;

  // Goals with full detail
  if (ctx.goals.length > 0) {
    s += "### Race Goals\n";
    for (const g of ctx.goals) {
      s += `- **${g.name}** — ${formatDistance(g.distanceMeters)}, target ${g.targetDate}, priority ${g.priority}\n`;

      if (g.elevationGainMeters && g.elevationGainMeters > 0) {
        s += `  - Elevation gain: ${formatDistance(g.elevationGainMeters)}\n`;
      }
      if (g.targetTimeSeconds) {
        const hrs = Math.floor(g.targetTimeSeconds / 3600);
        const mins = Math.round((g.targetTimeSeconds % 3600) / 60);
        s += `  - Target time: ${hrs}h ${mins}m\n`;
      }
      // Course profile summary
      if (g.courseProfileSummary) {
        s += `  - Course: ${formatDistance(g.courseProfileSummary.distanceMeters)}, `;
        s += `${formatDistance(g.courseProfileSummary.elevationGainMeters)} vert, `;
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
    s += `- ${w.label}: ${formatDistance(w.volumeMeters)}, ${w.activityCount} activities\n`;
  }

  // Current week
  s += `\n### This Week\nVolume: ${formatDistance(ctx.currentWeek.volumeMeters)}, Activities: ${ctx.currentWeek.activityCount}\n`;

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

  // Full plan arc (all planned weeks up to nearest goal)
  if (ctx.planWeeks.length > 0) {
    s += "\n### Training Plan (All Weeks)\n";
    for (const pw of ctx.planWeeks) {
      const vol = pw.targetVolumeMeters
        ? `${formatDistance(pw.targetVolumeMeters)}, `
        : "";
      s += `- Week of ${pw.weekStartDate}: ${vol}${pw.sessionCount} session(s)`;
      if (pw.adjustmentSummary) {
        s += ` — ${pw.adjustmentSummary}`;
      }
      s += "\n";
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

// ── Coach notes evolution ──────────────────────────────

/**
 * Summarize the full conversation into updated coach notes.
 * This is called when the user wants to finalize their coaching conversation,
 * or automatically when suggestions are applied.
 */
export async function summarizeConversation(
  conversationId: string,
  userId: string
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

  const systemPrompt = await getSummarizePrompt();

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

  await prisma.coachMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: `📋 **Conversation Summary**\n\n${summary}\n\n---\n*The detailed conversation has been condensed into this summary. Start a new message to continue coaching.*`,
    },
  });

  // Update the context snapshot to reflect the summarized state
  const ctx = await gatherTrainingContext(userId);
  const summaryText = buildContextSummary(ctx);
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

// ── Main service ───────────────────────────────────────

/**
 * Run a full training analysis: generate coach notes + plan suggestions.
 * Creates a new conversation or appends to an active one.
 */
export async function analyze(
  userId: string,
  conversationId?: string
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
      conversation = await findOrCreateConversation(userId, ctx);
    }
  } else {
    conversation = await findOrCreateConversation(userId, ctx);
  }

  // 4. Build context + call LLM
  const contextStr = buildContextSummary(ctx);
  const systemPrompt = `${await getAnalyzePrompt()}\n\n## Current Training Context\n${contextStr}`;

  const result = await ask(systemPrompt, "Analyze my training data and suggest plan adjustments.", {
    temperature: 0.4,
    maxTokens: 2048,
    jsonMode: true,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
  });

  if (!result) {
    return { error: "AI coach returned no response. The model may be unavailable.", code: "LLM_FAILED" };
  }

  // 5. Parse and validate
  let parsed: z.infer<typeof AnalyzeResponseSchema>;
  try {
    parsed = AnalyzeResponseSchema.parse(JSON.parse(sanitizeJsonText(result)));
  } catch {
    // Retry once
    const retry = await ask(
      systemPrompt,
      `Your previous response was invalid JSON. Return ONLY valid JSON matching the schema.`,
      { temperature: 0.2, maxTokens: 2048, jsonMode: true, apiKey: llmConfig.apiKey, baseUrl: llmConfig.baseUrl, model: llmConfig.model }
    );
    if (!retry) return { error: "AI coach failed to generate valid analysis.", code: "PARSE_FAILED" };
    try {
      parsed = AnalyzeResponseSchema.parse(JSON.parse(sanitizeJsonText(retry)));
    } catch {
      return { error: "AI coach returned invalid data after retry.", code: "PARSE_FAILED" };
    }
  }

  // 6. Apply guardrails
  const { violations } = checkGuardrails(parsed.suggestions, ctx);

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

  // 8. Store suggestions
  const storedSuggestions: CoachAnalysisResult["suggestions"] = [];
  for (const s of parsed.suggestions) {
    const stored = await prisma.coachSuggestion.create({
      data: {
        conversationId: conversation.id,
        userId,
        suggestionType: s.type,
        title: s.title,
        description: s.description,
        changes: JSON.parse(JSON.stringify(s.changes)),
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
    guardrailViolations: violations,
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
  message: string
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
  const freshContextSummary = buildContextSummary(ctx);

  // Also update the stored snapshot so subsequent calls benefit
  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: {
      contextSnapshot: { summaryText: freshContextSummary },
      updatedAt: new Date(),
    },
  });

  const recentMessages = conversation.messages.slice(-20);
  const llmMessages: LlmMessage[] = [
    { role: "system", content: `${await getChatPrompt()}\n\n## Current Training Context\n${freshContextSummary}` },
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
  const MAX_TOOL_ITERATIONS = 25;
  let iterations = 0;
  let finalResponse = "I wasn't able to complete that request. Please try again.";
  const suggestions: CoachChatResult["suggestions"] = [];
  let allToolCallsExecuted = false;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    console.error(`[AI-COACH] Tool loop iteration ${iterations}, messages count: ${llmMessages.length}`);

    const response = await chatWithTools(llmMessages, {
      temperature: 0.3,
      maxTokens: 16384,
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
      const result = await executeTool(toolCall.function.name, args, userId);
      console.error(`[AI-COACH] Tool result: success=${result.success}, message="${result.message?.slice(0, 100)}"`);

      llmMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });

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

  return {
    conversationId,
    response: finalResponse,
    suggestions,
    messages: [
      { id: userMsg.id, role: "user", content: userMsg.content, createdAt: userMsg.createdAt.toISOString() },
      { id: "assistant-msg", role: "assistant", content: finalResponse, createdAt: new Date().toISOString() },
    ],
  };
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
    plannedSessions: JSON.parse(JSON.stringify(sessions)),
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
  activityId: string
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

  // 7. Build planned session summary
  const planSummary = plannedSession
    ? `## Planned Session for That Day\n${plannedSession}`
    : "## Planned Session for That Day\nNo specific plan set for this day.";

  // 8. Build context summary (focused on what's relevant)
  const goalsStr = ctx.goals.length > 0
    ? ctx.goals.map((g) => `- ${g.name} (${formatDistance(g.distanceMeters)}, target ${g.targetDate})`).join("\n")
    : "No goals set.";

  const recentWeeksStr = ctx.recentWeeks
    .map((w) => `- ${w.label}: ${formatDistance(w.volumeMeters)}, ${w.activityCount} activities`)
    .join("\n");

  const planWeeksStr = ctx.planWeeks.length > 0
    ? ctx.planWeeks.map((pw) => {
        const vol = pw.targetVolumeMeters ? `${formatDistance(pw.targetVolumeMeters)}, ` : "";
        return `- Week of ${pw.weekStartDate}: ${vol}${pw.sessionCount} session(s)`;
      }).join("\n")
    : "No upcoming plan weeks.";

  const contextStr = [
    `## Athlete Context`,
    `### Race Goals\n${goalsStr}`,
    `### Fitness\nCTL: ${ctx.pmc.ctl}, ATL: ${ctx.pmc.atl}, TSB: ${ctx.pmc.tsb} (${ctx.pmc.tsbTrend})`,
    `### Recent Training (last 4 weeks)\n${recentWeeksStr}`,
    `### Current Week\nVolume: ${formatDistance(ctx.currentWeek.volumeMeters)}, Activities: ${ctx.currentWeek.activityCount}`,
    `### Upcoming Training Plan\n${planWeeksStr}`,
  ].join("\n\n");

  // 9. Call LLM
  const systemPrompt = `${await getActivityAnalyzePrompt()}\n\n${contextStr}`;
  const userPrompt = `${activitySummary}\n\n${planSummary}\n\nAnalyze this activity against the athlete's training plan and goals.`;

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

  // 10. Parse and validate
  let parsed: z.infer<typeof ActivityAnalysisResultSchema>;
  try {
    parsed = ActivityAnalysisResultSchema.parse(JSON.parse(sanitizeJsonText(result)));
  } catch {
    return { error: "AI coach returned invalid data.", code: "PARSE_FAILED" };
  }

  // 11. Build final analysis text
  const flagsStr = parsed.flags.length > 0 ? `\n\n**Flags:**\n- ${parsed.flags.join("\n- ")}` : "";
  const analysisText = `**${parsed.trainingTypeLabel}** · ${parsed.verdict === "productive" ? "✅ Productive" : parsed.verdict === "neutral" ? "➖ Neutral" : "⚠️ Unproductive"}${flagsStr}\n\n${parsed.analysis}`;

  // 12. Save to DB
  await prisma.trainingLog.update({
    where: { id: activityId },
    data: { coachAnalysis: analysisText },
  });

  return { success: true, analysis: analysisText };
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
  ctx: Awaited<ReturnType<typeof gatherTrainingContext>>
) {
  // Try to find an active conversation
  let conv = await prisma.coachConversation.findFirst({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });

  if (conv) {
    // Update its context snapshot
    const summaryText = buildContextSummary(ctx);
    conv = await prisma.coachConversation.update({
      where: { id: conv.id },
      data: {
        contextSnapshot: { summaryText },
        updatedAt: new Date(),
      },
    });
  } else {
    // Create new
    const summaryText = buildContextSummary(ctx);
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
          ? JSON.parse(JSON.stringify(ctx.weeklyPlan.plannedSessions))
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
