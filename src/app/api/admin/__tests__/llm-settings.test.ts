import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "../llm-settings/route";
import { requireAdmin } from "@/lib/admin";
import { getAdminLlmDefault, saveAdminLlmDefault } from "@/lib/llm-defaults";
import { jsonRequest } from "@/test/utils";

vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/llm-defaults", () => ({
  getAdminLlmDefault: vi.fn(),
  saveAdminLlmDefault: vi.fn(),
}));

const adminUser = { id: "admin-1", email: "admin@test.com", role: "admin" } as any;

describe("GET /api/admin/llm-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns masked default config (no raw apiKey)", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "",
      apiKey: "sk-secret",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("deepseek");
    expect(body.model).toBe("deepseek-chat");
    // Blank stored baseUrl falls back to the provider's known default.
    expect(body.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(body.hasApiKey).toBe(true);
    expect(body.apiKey).toBeUndefined();
  });

  it("uses the stored baseUrl when present", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: "openai",
      model: "gpt-4",
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "",
    });

    const res = await GET();
    const body = await res.json();
    expect(body.baseUrl).toBe("https://proxy.example.com/v1");
    expect(body.hasApiKey).toBe(false);
  });
});

describe("PUT /api/admin/llm-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    const res = await PUT(jsonRequest("/api/admin/llm-settings", { provider: "openai" }));
    expect(res.status).toBe(403);
  });

  it("persists provided fields", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-kept",
    });

    const res = await PUT(
      jsonRequest("/api/admin/llm-settings", {
        provider: "deepseek",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-new",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(saveAdminLlmDefault).toHaveBeenCalledWith({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-new",
    });
  });

  it("clears the key when apiKey is an empty string", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-old",
    });

    await PUT(jsonRequest("/api/admin/llm-settings", { apiKey: "" }));
    expect(saveAdminLlmDefault).toHaveBeenCalledWith({ apiKey: "" });
  });

  it("keeps the key when apiKey is omitted", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-kept",
    });

    await PUT(jsonRequest("/api/admin/llm-settings", { model: "deepseek-reasoner" }));
    const call = vi.mocked(saveAdminLlmDefault).mock.calls[0][0];
    expect(call).toEqual({ model: "deepseek-reasoner" });
    expect("apiKey" in (call as object)).toBe(false);
  });

  it("rejects a key with no provider configured", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: "",
      model: "",
      baseUrl: "",
      apiKey: "",
    });

    const res = await PUT(jsonRequest("/api/admin/llm-settings", { apiKey: "sk-new" }));
    expect(res.status).toBe(400);
    expect(saveAdminLlmDefault).not.toHaveBeenCalled();
  });

  it("accepts a key when a provider already exists", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    vi.mocked(getAdminLlmDefault).mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-old",
    });

    const res = await PUT(jsonRequest("/api/admin/llm-settings", { apiKey: "sk-new" }));
    expect(res.status).toBe(200);
    expect(saveAdminLlmDefault).toHaveBeenCalledWith({ apiKey: "sk-new" });
  });

  it("returns 400 for invalid request body", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminUser);
    const badReq = new Request("http://localhost/api/admin/llm-settings", {
      method: "PUT",
      body: "not-json",
    });
    const res = await PUT(badReq);
    expect(res.status).toBe(400);
  });
});
