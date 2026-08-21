import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "../llm/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getDefaultLlmConfig } from "@/lib/llm";
import { createRequest, jsonRequest } from "@/test/utils";

vi.mock("next-auth");
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/llm", () => ({
  isLlmConfigured: vi.fn(),
  getDefaultLlmConfig: vi.fn(async () => null),
  PROVIDER_BASE_URLS: {
    deepseek: "https://api.deepseek.com",
    deepinfra: "https://api.deepinfra.com/v1/openai",
  },
}));

describe("GET /api/settings/llm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns LLM config when user has a key", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      llmApiKey: "sk-xxx",
      llmBaseUrl: "https://api.openai.com",
      llmModel: "gpt-4",
      llmProvider: "openai",
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasUserKey).toBe(true);
    expect(body.llmProvider).toBe("openai");
    expect(body.llmModel).toBe("gpt-4");
    expect(body.configured).toBe(true);
  });

  it("shows configured=false when no key exists", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      llmApiKey: null,
      llmBaseUrl: null,
      llmModel: null,
      llmProvider: null,
    } as any);

    const res = await GET();
    const body = await res.json();
    expect(body.hasUserKey).toBe(false);
    expect(body.configured).toBe(false);
  });

  it("shows configured=true and the default provider/model when a server default is set", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      llmApiKey: null,
      llmBaseUrl: null,
      llmModel: null,
      llmProvider: null,
    } as any);
    vi.mocked(getDefaultLlmConfig).mockResolvedValue({
      apiKey: "sk-default",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      provider: "openai",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasServerDefault).toBe(true);
    expect(body.defaultProvider).toBe("openai");
    expect(body.defaultModel).toBe("gpt-4o");
    expect(body.hasUserKey).toBe(false);
    expect(body.configured).toBe(true);
  });
});

describe("PUT /api/settings/llm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const res = await PUT(jsonRequest("/api/settings/llm", {}));
    expect(res.status).toBe(401);
  });

  it("updates LLM settings", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    const res = await PUT(
      jsonRequest("/api/settings/llm", {
        llmApiKey: "sk-new",
        llmProvider: "deepseek",
        llmModel: "deepseek-chat",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const updateData = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(updateData.llmApiKey).toBe("sk-new");
    expect(updateData.llmProvider).toBe("deepseek");
    expect(updateData.llmModel).toBe("deepseek-chat");
  });

  it("auto-populates base URL from PROVIDER_BASE_URLS when not provided", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await PUT(
      jsonRequest("/api/settings/llm", {
        llmProvider: "deepseek",
      })
    );
    const updateData = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(updateData.llmBaseUrl).toBe("https://api.deepseek.com");
  });

  it("auto-populates DeepInfra base URL from PROVIDER_BASE_URLS when not provided", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await PUT(
      jsonRequest("/api/settings/llm", {
        llmProvider: "deepinfra",
      })
    );
    const updateData = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(updateData.llmBaseUrl).toBe("https://api.deepinfra.com/v1/openai");
  });

  it("returns 400 for invalid request body", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "test-user" } } as any);
    const badReq = new Request("http://localhost/api/settings/llm", {
      method: "PUT",
      body: "not-json",
    });
    const res = await PUT(badReq);
    expect(res.status).toBe(400);
  });
});
