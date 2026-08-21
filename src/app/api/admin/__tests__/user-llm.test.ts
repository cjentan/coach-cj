import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "../user-llm/route";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { createRequest, jsonRequest, queryRequest } from "@/test/utils";

vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const adminUser = { id: "admin-1", email: "admin@test.com", role: "admin" } as any;

describe("GET /api/admin/user-llm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    const res = await GET(createRequest("/api/admin/user-llm"));
    expect(res.status).toBe(403);
  });

  it("returns paginated users with keys masked to booleans", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "u1",
        email: "a@test.com",
        name: "Alice",
        llmProvider: "deepseek",
        llmModel: "deepseek-chat",
        llmBaseUrl: "https://api.deepseek.com",
        llmApiKey: "sk-secret-1",
      },
      {
        id: "u2",
        email: "b@test.com",
        name: "Bob",
        llmProvider: null,
        llmModel: null,
        llmBaseUrl: null,
        llmApiKey: null,
      },
    ] as any);
    vi.mocked(prisma.user.count).mockResolvedValue(2);

    const res = await GET(createRequest("/api/admin/user-llm"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.users[0]).toEqual({
      id: "u1",
      email: "a@test.com",
      name: "Alice",
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      hasKey: true,
    });
    expect(body.users[1].hasKey).toBe(false);
    expect(body.users[1].provider).toBe("");
    // Never leak the raw key.
    expect(JSON.stringify(body)).not.toContain("sk-secret-1");
  });

  it("passes the search query as a case-insensitive OR filter", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.user.count).mockResolvedValue(0);

    await GET(queryRequest("/api/admin/user-llm", { q: "ali" }));

    const findManyArgs = vi.mocked(prisma.user.findMany).mock.calls[0][0];
    expect(findManyArgs?.where).toEqual({
      OR: [
        { email: { contains: "ali", mode: "insensitive" } },
        { name: { contains: "ali", mode: "insensitive" } },
      ],
    });
    expect(findManyArgs?.skip).toBe(0);
    expect(findManyArgs?.take).toBe(50);
  });

  it("caps take at 100", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.user.count).mockResolvedValue(0);

    await GET(queryRequest("/api/admin/user-llm", { take: "999" }));
    expect(vi.mocked(prisma.user.findMany).mock.calls[0][0]?.take).toBe(100);
  });
});

describe("PUT /api/admin/user-llm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    const res = await PUT(jsonRequest("/api/admin/user-llm", { userId: "u1", provider: "openai" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the user does not exist", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await PUT(jsonRequest("/api/admin/user-llm", { userId: "missing" }));
    expect(res.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("sets key/provider and auto-fills baseUrl from the provider map", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    const res = await PUT(
      jsonRequest("/api/admin/user-llm", {
        userId: "u1",
        provider: "deepinfra",
        model: "deepseek-ai/DeepSeek-V4-Flash-0731",
        apiKey: "sk-new",
      })
    );
    expect(res.status).toBe(200);

    const data = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(data.llmProvider).toBe("deepinfra");
    expect(data.llmBaseUrl).toBe("https://api.deepinfra.com/v1/openai");
    expect(data.llmModel).toBe("deepseek-ai/DeepSeek-V4-Flash-0731");
    expect(data.llmApiKey).toBe("sk-new");
  });

  it("uses an explicit baseUrl instead of the provider default", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await PUT(
      jsonRequest("/api/admin/user-llm", {
        userId: "u1",
        provider: "openai",
        baseUrl: "https://proxy.example.com/v1",
      })
    );
    const data = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(data.llmBaseUrl).toBe("https://proxy.example.com/v1");
  });

  it("clears the key when apiKey is an empty string", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await PUT(jsonRequest("/api/admin/user-llm", { userId: "u1", apiKey: "" }));
    const data = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(data.llmApiKey).toBe("");
  });

  it("keeps the key when apiKey is omitted", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await PUT(jsonRequest("/api/admin/user-llm", { userId: "u1", model: "gpt-4" }));
    const data = vi.mocked(prisma.user.update).mock.calls[0][0]?.data as any;
    expect(data.llmModel).toBe("gpt-4");
    expect("llmApiKey" in data).toBe(false);
  });

  it("returns 400 for invalid request body", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    const badReq = new Request("http://localhost/api/admin/user-llm", {
      method: "PUT",
      body: "not-json",
    });
    const res = await PUT(badReq);
    expect(res.status).toBe(400);
  });
});
