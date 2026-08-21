import { describe, it, expect, vi, beforeEach } from "vitest";
import { summarizeConversation } from "../ai-conversation";

const mockPrisma = vi.hoisted(() => {
  const modelMethods = [
    "findMany",
    "findUnique",
    "findFirst",
    "create",
    "createMany",
    "update",
    "updateMany",
    "upsert",
    "delete",
    "deleteMany",
    "count",
    "aggregate",
  ];
  const makeMockModel = () => {
    const model: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of modelMethods) {
      model[method] = vi.fn();
    }
    return model;
  };
  return {
    coachConversation: makeMockModel(),
    coachMessage: makeMockModel(),
    coachSuggestion: makeMockModel(),
    $transaction: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const mockLlm = vi.hoisted(() => ({
  ask: vi.fn(),
  resolveUserLlmConfig: vi.fn(),
  isLlmConfigured: vi.fn(),
}));

vi.mock("@/lib/llm", () => mockLlm);

const mockPrompts = vi.hoisted(() => ({
  resolvePrompt: vi.fn(),
  getLanguageInstruction: vi.fn(),
  PROMPT_KEYS: { SUMMARIZE: "coach_summarize_prompt" },
}));

vi.mock("@/lib/coach-prompts", () => mockPrompts);

const conversationId = "conv-123";
const userId = "user-1";
const summaryText = "Condensed coach note";

function mockConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: conversationId,
    userId,
    // Mirrors the real query, which filters system markers out at the DB level
    messages: [
      { id: "m1", role: "user", content: "Hello coach", createdAt: new Date() },
      { id: "m2", role: "assistant", content: "Here is your plan", createdAt: new Date() },
    ],
    suggestions: [],
    ...overrides,
  };
}

describe("summarizeConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops));
    mockLlm.resolveUserLlmConfig.mockResolvedValue({
      apiKey: "key",
      baseUrl: "url",
      model: "model",
      provider: "custom",
    });
    mockLlm.isLlmConfigured.mockReturnValue(true);
    mockPrompts.resolvePrompt.mockResolvedValue("Summarize system prompt");
    mockPrompts.getLanguageInstruction.mockReturnValue("");
  });

  it("replaces all conversation messages with a single summary message", async () => {
    mockPrisma.coachConversation.findUnique.mockResolvedValue(mockConversation());
    mockLlm.ask.mockResolvedValue(summaryText);

    const result = await summarizeConversation(conversationId, userId);

    expect(result).toEqual({ summary: summaryText });

    // Thread sent to the LLM contains the non-system messages only
    expect(mockLlm.ask).toHaveBeenCalledTimes(1);
    const [, thread] = mockLlm.ask.mock.calls[0];
    expect(thread).toContain("Athlete: Hello coach");
    expect(thread).toContain("Coach: Here is your plan");

    // Old messages deleted, summary message created, conversation touched — in one transaction
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(3);

    expect(mockPrisma.coachMessage.deleteMany).toHaveBeenCalledWith({ where: { conversationId } });

    expect(mockPrisma.coachMessage.create).toHaveBeenCalledWith({
      data: {
        id: `summary-${conversationId}`,
        conversationId,
        role: "assistant",
        content: summaryText,
      },
    });

    expect(mockPrisma.coachConversation.update).toHaveBeenCalledWith({
      where: { id: conversationId },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("returns LLM_FAILED and leaves messages untouched when the LLM returns nothing", async () => {
    mockPrisma.coachConversation.findUnique.mockResolvedValue(mockConversation());
    mockLlm.ask.mockResolvedValue(null);

    const result = await summarizeConversation(conversationId, userId);

    expect(result).toEqual({ error: "LLM returned no response.", code: "LLM_FAILED" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.coachMessage.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.coachMessage.create).not.toHaveBeenCalled();
  });

  it("rejects when the conversation belongs to another user", async () => {
    mockPrisma.coachConversation.findUnique.mockResolvedValue(
      mockConversation({ userId: "someone-else" })
    );

    const result = await summarizeConversation(conversationId, userId);

    expect(result).toEqual({ error: "Conversation not found.", code: "NOT_FOUND" });
    expect(mockLlm.ask).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
