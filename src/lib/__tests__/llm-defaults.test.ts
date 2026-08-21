import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAdminLlmDefault, saveAdminLlmDefault } from "../llm-defaults";
import { prisma } from "../prisma";

vi.mock("../prisma", () => ({
  prisma: {
    appSetting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe("getAdminLlmDefault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty strings when no rows exist", async () => {
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([] as any);

    const result = await getAdminLlmDefault();
    expect(result).toEqual({ provider: "", model: "", baseUrl: "", apiKey: "" });
  });

  it('maps stored rows into the config, missing fields as ""', async () => {
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([
      { key: "llm_default_provider", value: "deepseek" },
      { key: "llm_default_model", value: "deepseek-chat" },
    ] as any);

    const result = await getAdminLlmDefault();
    expect(result).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "",
      apiKey: "",
    });
  });

  it("queries only the LLM default keys", async () => {
    vi.mocked(prisma.appSetting.findMany).mockResolvedValue([] as any);

    await getAdminLlmDefault();
    const where = vi.mocked(prisma.appSetting.findMany).mock.calls[0][0]?.where as any;
    expect(where.key.in.sort()).toEqual(
      [
        "llm_default_api_key",
        "llm_default_base_url",
        "llm_default_model",
        "llm_default_provider",
      ].sort()
    );
  });
});

describe("saveAdminLlmDefault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts each provided field with its setting key", async () => {
    await saveAdminLlmDefault({
      provider: "openai",
      model: "gpt-4",
    });

    expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "llm_default_provider" },
      create: { key: "llm_default_provider", value: "openai" },
      update: { value: "openai" },
    });
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "llm_default_model" },
      create: { key: "llm_default_model", value: "gpt-4" },
      update: { value: "gpt-4" },
    });
  });

  it("clears a field when passed an empty string", async () => {
    await saveAdminLlmDefault({ apiKey: "" });

    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "llm_default_api_key" },
      create: { key: "llm_default_api_key", value: "" },
      update: { value: "" },
    });
  });

  it("does nothing when given no fields", async () => {
    await saveAdminLlmDefault({});
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
  });
});
