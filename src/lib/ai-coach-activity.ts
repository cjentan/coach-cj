/**
 * Per-activity AI analysis for the AI Coach service.
 *
 * Handles the structured analysis of a single training activity against the
 * athlete's training plan and goals, plus the chat-driven flow that resolves
 * which activity the athlete means and offers to save the analysis.
 */
import { z } from "zod";
import { prisma } from "./prisma";
import { ask, chatWithTools, resolveUserLlmConfig, isLlmConfigured } from "./llm";
import type { LlmMessage } from "./llm";
import { QUERY_ACTIVITIES_TOOL, executeTool } from "./ai-coach-tools";
import { gatherTrainingContext } from "./training-context";
import { getWeekStart, formatDuration } from "./utils";
import { resolvePrompt, PROMPT_KEYS, getLanguageInstruction } from "./coach-prompts";
import { buildContextSummary, sanitizeJsonText, ActivityAnalysisResultSchema } from "./ai-coach-utils";
import { type PageContext } from "./page-context";

async function getActivityAnalyzePrompt(): Promise<string> {
  return resolvePrompt(PROMPT_KEYS.ACTIVITY_ANALYZE);
}

/**
 * Analyze a single activity against the athlete's training plan and goals.
 * Stores the analysis result in TrainingLog.coachAnalysis.
 */
export async function analyzeActivity(
  userId: string,
  activityId: string,
  localeOverride?: string,
  options?: { persist?: boolean }
): Promise<{ success: true; analysis: string } | { error: string; code: string }> {
  // 1. Load activity — select only the scalar fields used below. The full row
  //    carries rawJson (full trackpoints, can exceed 10MB) which this analysis
  //    never touches; loading it inflated the worker heap on every analysis job.
  const activity = await prisma.trainingLog.findUnique({
    where: { id: activityId },
    select: {
      userId: true,
      name: true,
      type: true,
      subType: true,
      isRace: true,
      startDate: true,
      distanceMeters: true,
      durationSeconds: true,
      elevationGainMeters: true,
      averageHr: true,
      maxHr: true,
      averagePower: true,
      tss: true,
    },
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
    maxTokens: 4096,
    jsonMode: true,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
    thinking: "disabled",
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
      { temperature: 0.2, maxTokens: 4096, jsonMode: true, apiKey: llmConfig.apiKey, baseUrl: llmConfig.baseUrl, model: llmConfig.model, thinking: "disabled" }
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

  // 12. Save to DB — skipped for dry-runs (e.g. chat analysis awaiting user confirmation)
  if (options?.persist !== false) {
    await prisma.trainingLog.update({
      where: { id: activityId },
      data: { coachAnalysis: analysisText, analysisStatus: "completed" },
    });
  }

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

/**
 * Resolve the specific activity the athlete is asking to analyze from a
 * free-form chat message. Uses the query_activities tool (via a short
 * tool-calling loop) so the LLM can search by date, name, distance, etc.
 * Returns the activity id + name, or null if no single activity matches.
 */
async function resolveActivityFromMessage(
  userId: string,
  message: string,
  pageContext?: PageContext | null,
  locale = "en"
): Promise<{ activityId: string; activityName: string } | null> {
  // Fast path: on the activity detail page and the message refers to the
  // currently-viewed activity — no extra LLM call needed.
  if (pageContext?.page === "activity-detail" && pageContext.activityId) {
    const refersToCurrent =
      /\b(this|the current|today's?)\s+(activity|workout|session|run|ride|race)\b/i.test(message) ||
      /\bmy\s+(activity|workout|session|run|ride|race|long run|tempo|interval)\b/i.test(message) ||
      /\banalyze this\b/i.test(message) ||
      /\bhow'?s\s+(my\s+)?(run|workout|session|activity|ride|race)\b/i.test(message) ||
      /\bwhat (do|did) (you|ya) think (of|about)\s+(my\s+)?(run|workout|session|activity|ride|race)\b/i.test(message);
    // Don't hijack requests that point at a specific past session ("my run
    // from yesterday", "last Sunday's long run") — those need real resolution.
    const hasPastDateRef =
      /\b(yesterday|last\s+(night|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\w+)|ago|previous|\d+\s+(days?|weeks?)|on\s+(mon|tue|wed|thu|fri|sat|sun))\b/i.test(message);
    if (refersToCurrent && !hasPastDateRef) {
      const currentActivity = await prisma.trainingLog.findUnique({
        where: { id: pageContext.activityId, userId },
        select: { id: true, name: true },
      });
      if (currentActivity) {
        return { activityId: currentActivity.id, activityName: currentActivity.name };
      }
    }
  }

  const llmConfig = await resolveUserLlmConfig(userId);
  if (!isLlmConfigured(llmConfig.apiKey, llmConfig.provider)) return null;

  const langInstruction = getLanguageInstruction(locale);
  const contextStr =
    pageContext?.page === "activity-detail" && pageContext.activityId
      ? `The athlete is currently viewing the activity with id "${pageContext.activityId}" — use it only if their message refers to it (e.g. "this activity").`
      : "";
  const systemPrompt = `${langInstruction}
You identify which specific training activity an athlete is asking to have analyzed.

The athlete's message: "${message}"

Use the query_activities tool to search their activity history (by date, name, or distance) until you find the single activity they mean.
${contextStr}
Respond with ONLY a JSON object and nothing else:
{"activityId": "<the activity id>", "activityName": "<the activity name>"}
The activityId MUST come from a query_activities result. If you cannot determine a single specific activity, respond with {"activityId": null}.`;

  const llmMessages: LlmMessage[] = [{ role: "system", content: systemPrompt }];
  let finalContent = "";
  const MAX_ITERATIONS = 6;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await chatWithTools(llmMessages, {
      temperature: 0.2,
      maxTokens: 4096,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
      tools: [QUERY_ACTIVITIES_TOOL],
      toolChoice: "auto",
    });
    if (!response) return null;

    llmMessages.push({
      role: "assistant",
      content: response.content || "",
      tool_calls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    });

    if (response.toolCalls.length > 0) {
      for (const toolCall of response.toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch { /* keep empty args */ }
        const result = await executeTool(toolCall.function.name, args, userId);
        llmMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
      continue;
    }

    finalContent = response.content || "";
    break;
  }

  if (!finalContent) return null;

  // Tolerantly parse the final JSON response
  const tryParse = (text: string) => {
    try {
      const parsed = JSON.parse(sanitizeJsonText(text)) as { activityId?: string | null; activityName?: string | null };
      if (parsed.activityId) {
        return { activityId: parsed.activityId, activityName: parsed.activityName || "" };
      }
    } catch { /* try next strategy */ }
    return null;
  };

  const direct = tryParse(finalContent);
  if (direct) return direct;

  // Fallback: extract the first JSON object from the text
  const objectMatch = finalContent.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const extracted = tryParse(objectMatch[0]);
    if (extracted) return extracted;
  }

  // Last resort: the LLM couldn't pin down a specific activity. If the
  // athlete is on the activity-detail page and their message doesn't point
  // at a specific past session, default to the activity they're viewing —
  // that's overwhelmingly what they mean, and it keeps the structured
  // save-prompt flow from silently falling back to plain chat.
  if (pageContext?.page === "activity-detail" && pageContext.activityId) {
    const hasPastDateRef =
      /\b(yesterday|last\s+(night|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\w+)|ago|previous|\d+\s+(days?|weeks?)|on\s+(mon|tue|wed|thu|fri|sat|sun))\b/i.test(message);
    if (!hasPastDateRef) {
      const currentActivity = await prisma.trainingLog.findUnique({
        where: { id: pageContext.activityId, userId },
        select: { id: true, name: true },
      });
      if (currentActivity) {
        return { activityId: currentActivity.id, activityName: currentActivity.name };
      }
    }
  }

  return null;
}

/**
 * Analyze a specific activity referenced in a chat message.
 * Resolves the activity, runs the structured analysis as a dry-run
 * (no TrainingLog write), and records the exchange in the conversation.
 * The frontend offers to save the returned analysis under the activity.
 */
export async function analyzeActivityInChat(
  conversationId: string,
  userId: string,
  message: string,
  pageContext?: PageContext | null,
  locale = "en"
): Promise<
  { conversationId: string; activityId: string; activityName: string; analysis: string }
  | { error: string; code: string }
> {
  const conversation = await prisma.coachConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true },
  });
  if (!conversation || conversation.userId !== userId) {
    return { error: "Conversation not found.", code: "NOT_FOUND" };
  }

  const resolved = await resolveActivityFromMessage(userId, message, pageContext, locale);
  if (!resolved) {
    return {
      error: "I couldn't identify the specific activity you'd like me to analyze. Try including its date or name, e.g. \"analyze my long run on June 15\".",
      code: "NOT_FOUND",
    };
  }

  const analysisResult = await analyzeActivity(userId, resolved.activityId, locale, { persist: false });
  if ("error" in analysisResult) return analysisResult;

  // Persist the exchange only after resolution + analysis succeeded, so a
  // failed attempt can fall back to normal chat without duplicate messages.
  await prisma.coachMessage.create({
    data: { conversationId, role: "user", content: message },
  });
  await prisma.coachMessage.create({
    data: { conversationId, role: "assistant", content: analysisResult.analysis },
  });
  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return {
    conversationId,
    activityId: resolved.activityId,
    activityName: resolved.activityName,
    analysis: analysisResult.analysis,
  };
}
