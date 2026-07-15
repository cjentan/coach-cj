/**
 * Multi-provider LLM abstraction.
 * Supports: Ollama (local), DeepSeek, OpenAI, Anthropic.
 * All use OpenAI-compatible chat completions.
 *
 * Users can configure their own API key in Settings → API Credentials,
 * or the server can provide a default DeepSeek API key via the
 * DEEPSEEK_API_KEY environment variable — enabling AI features for all
 * users without per-user configuration.
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
 * Check whether a user has configured an LLM (or a server default is available).
 * Requires a non-empty API key (or Ollama provider).
 */
export function isLlmConfigured(apiKey?: string, provider?: string): boolean {
  if (provider === "ollama") return true;
  return !!apiKey && apiKey.length > 8;
}

/**
 * Check if a server-wide default DeepSeek API key is configured via env var.
 */
export function hasServerDefaultKey(): boolean {
  return !!(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.length > 8);
}

/**
 * Return the server-default LLM config (DeepSeek via env var).
 * Returns null when DEEPSEEK_API_KEY is not set.
 */
export function getDefaultLlmConfig(): { apiKey: string; baseUrl: string; model: string; provider: string } | null {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || key.length <= 8) return null;
  return {
    apiKey: key,
    baseUrl: PROVIDER_BASE_URLS.deepseek,
    model: "deepseek-chat",
    provider: "deepseek",
  };
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
 * Falls back to the server-default DeepSeek key (env DEEPSEEK_API_KEY)
 * when the user hasn't configured their own API key.
 */
export async function resolveUserLlmConfig(
  userId: string
): Promise<{ apiKey?: string; baseUrl?: string; model?: string; provider?: string }> {
  const { prisma } = await import("./prisma");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { llmApiKey: true, llmBaseUrl: true, llmModel: true, llmProvider: true },
  });

  // User has their own key → use it
  if (user?.llmApiKey) {
    return {
      apiKey: user.llmApiKey,
      baseUrl: user.llmBaseUrl ?? undefined,
      model: user.llmModel ?? undefined,
      provider: user.llmProvider ?? undefined,
    };
  }

  // Fall back to server-default DeepSeek key
  const defaults = getDefaultLlmConfig();
  if (defaults) {
    return defaults;
  }

  return {
    apiKey: undefined,
    baseUrl: user?.llmBaseUrl ?? undefined,
    model: user?.llmModel ?? undefined,
    provider: user?.llmProvider ?? undefined,
  };
}
