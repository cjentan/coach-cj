/**
 * Conversation management for the AI Coach.
 *
 * CRUD operations for CoachConversation threads: list, get, create,
 * summarize, and clear. Does not depend on ai-coach.ts internals —
 * purely a DB + LLM helper layer.
 */
import { prisma } from "./prisma";
import { getWeekStart } from "./utils";
import { ask, resolveUserLlmConfig, isLlmConfigured } from "./llm";
import { resolvePrompt, PROMPT_KEYS, getLanguageInstruction } from "./coach-prompts";

// ── Types ──────────────────────────────────────────────

export interface ConversationListItem {
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ── Summarize ──────────────────────────────────────────

/**
 * Summarize the full conversation into updated coach notes.
 * Called when the user wants to finalize their coaching conversation,
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
  const systemPrompt = `${langInstruction}${await resolvePrompt(PROMPT_KEYS.SUMMARIZE)}`;

  const summary = await ask(systemPrompt, thread, {
    temperature: 0.3,
    maxTokens: 1024,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
  });

  if (!summary) {
    return { error: "LLM returned no response.", code: "LLM_FAILED" };
  }

  return { summary };
}

// ── List ──────────────────────────────────────────────

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

// ── Get ────────────────────────────────────────────────

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

// ── Create ─────────────────────────────────────────────

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

// ── Clear ────────────────────────────────────────────────

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
