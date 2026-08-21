/**
 * Shared LLM provider → base URL / model presets.
 *
 * Pure constants — no imports — so this module can be imported safely by
 * both server code (`src/lib/llm.ts`) and client components (the AI Coach
 * settings page and the admin LLM settings page). `src/lib/llm.ts` is the
 * canonical source; it re-exports these for backward compatibility.
 */

export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  anthropic: "https://api.anthropic.com/v1",
  ollama: "http://localhost:11434/v1",
};

export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  deepseek: ["deepseek-v4-flash"],
  deepinfra: ["deepseek-ai/DeepSeek-V4-Flash-0731"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest", "claude-3-opus-latest", "claude-3-haiku-latest"],
  ollama: ["llama3", "mistral", "mixtral", "codellama", "gemma"],
};

/** Display order for provider dropdowns. */
/** Display order for provider dropdowns. */
export const PROVIDER_ORDER: string[] = ["openai", "deepseek", "deepinfra", "anthropic", "ollama"];

/** Human-readable provider names for the UI (dropdowns, badges, notices). */
export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  deepinfra: "DeepInfra",
  anthropic: "Anthropic",
  ollama: "Ollama",
};
