/**
 * Multi-provider LLM abstraction.
 * Supports: Ollama (local), DeepSeek, OpenAI, Anthropic.
 * All use OpenAI-compatible chat completions.
 *
 * Each user must configure their own API key in Settings → API Credentials.
 * No server-side fallback — LLM features are hidden when no key is set.
 */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Check whether a user has configured an LLM.
 * Requires a non-empty API key (or Ollama provider).
 */
export function isLlmConfigured(apiKey?: string, provider?: string): boolean {
  if (provider === "ollama") return true;
  return !!apiKey && apiKey.length > 8;
}

/**
 * Provider → default base URL map.
 */
export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  ollama: "http://localhost:11434/v1",
};

/**
 * Provider → available models.
 */
export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest", "claude-3-opus-latest", "claude-3-haiku-latest"],
  ollama: ["llama3", "mistral", "mixtral", "codellama", "gemma"],
};

/**
 * Send a chat completion request. Returns the model's text response.
 * Falls back to null if the LLM is unavailable.
 *
 * Requires apiKey, baseUrl, and model — either in opts or resolved externally.
 */
export async function chat(
  messages: LlmMessage[],
  opts: LlmOptions = {}
): Promise<string | null> {
  const {
    temperature = 0.3,
    maxTokens = 1024,
    jsonMode = false,
    apiKey,
    baseUrl,
    model,
  } = opts;

  if (!apiKey || !baseUrl || !model) {
    console.error("LLM not configured — missing apiKey, baseUrl, or model");
    return null;
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });

    if (!res.ok) {
      console.error(`LLM error ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("LLM request failed:", (err as Error).message);
    return null;
  }
}

/**
 * Convenience: single-prompt chat (system + user).
 */
export async function ask(
  systemPrompt: string,
  userMessage: string,
  opts?: LlmOptions
): Promise<string | null> {
  return chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    opts
  );
}

/**
 * Fetch a user's LLM configuration from the database.
 */
export async function resolveUserLlmConfig(
  userId: string
): Promise<{ apiKey?: string; baseUrl?: string; model?: string; provider?: string }> {
  const { prisma } = await import("./prisma");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { llmApiKey: true, llmBaseUrl: true, llmModel: true, llmProvider: true },
  });
  return {
    apiKey: user?.llmApiKey ?? undefined,
    baseUrl: user?.llmBaseUrl ?? undefined,
    model: user?.llmModel ?? undefined,
    provider: user?.llmProvider ?? undefined,
  };
}
