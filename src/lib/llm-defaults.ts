/**
 * Site-wide default LLM configuration, editable by admins.
 *
 * Stored as `AppSetting` rows (one per field), so the admin can configure a
 * fallback LLM that applies to any user who hasn't set their own API key.
 * Read via `getAdminLlmDefault`; written via `saveAdminLlmDefault`. An empty
 * string means "unset" (the default resolver treats it as no value).
 *
 * NOTE: this module imports prisma at the top level. It is only ever
 * dynamically imported from `src/lib/llm.ts`, which must stay prisma-free at
 * import time (it runs in scripts and prisma-mocking tests).
 */

import { prisma } from "./prisma";

export const LLM_DEFAULT_KEYS = {
  provider: "llm_default_provider",
  model: "llm_default_model",
  baseUrl: "llm_default_base_url",
  apiKey: "llm_default_api_key",
} as const;

export interface AdminLlmDefault {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

/** Read the admin-configured default; missing fields come back as "". */
export async function getAdminLlmDefault(): Promise<AdminLlmDefault> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: Object.values(LLM_DEFAULT_KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    provider: map.get(LLM_DEFAULT_KEYS.provider) || "",
    model: map.get(LLM_DEFAULT_KEYS.model) || "",
    baseUrl: map.get(LLM_DEFAULT_KEYS.baseUrl) || "",
    apiKey: map.get(LLM_DEFAULT_KEYS.apiKey) || "",
  };
}

/**
 * Upsert the given fields. Only provided keys are touched. Pass `""` to clear
 * a field (e.g. remove the default API key).
 */
export async function saveAdminLlmDefault(values: Partial<AdminLlmDefault>): Promise<void> {
  const entries = Object.entries(values) as [keyof AdminLlmDefault, string][];
  for (const [field, value] of entries) {
    const key = LLM_DEFAULT_KEYS[field];
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: value ?? "" },
      update: { value: value ?? "" },
    });
  }
}
