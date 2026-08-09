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
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  /** External abort signal (e.g. from request.signal) — paired with the internal timeout. */
  signal?: AbortSignal;
  /** DeepSeek only: "disabled" forces non-thinking mode; "low" keeps thinking on at low effort. Ignored for other providers. */
  thinking?: "disabled" | "low";
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
    model: "deepseek-v4-flash",
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
  deepseek: ["deepseek-v4-flash"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest", "claude-3-opus-latest", "claude-3-haiku-latest"],
  ollama: ["llama3", "mistral", "mixtral", "codellama", "gemma"],
};

/**
 * Shared: send a chat completion request with full body control.
 * Builds the request body, manages the abort-signal race (internal 110s timeout
 * vs caller's signal), executes the fetch, handles response errors, and returns
 * the parsed message (content + toolCalls) or null on failure.
 */
async function sendChatCompletion(
  model: string,
  messages: LlmMessage[],
  opts: {
    temperature: number;
    maxTokens: number;
    apiKey: string;
    baseUrl: string;
    jsonMode?: boolean;
    tools?: ToolDefinition[];
    toolChoice?: LlmOptions["toolChoice"];
    signal?: AbortSignal;
    thinking?: LlmOptions["thinking"];
  }
): Promise<{ content: string | null; toolCalls: ToolCall[] } | null> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
  };

  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  }

  // DeepSeek thinking-mode control. deepseek-v4-flash defaults to high-effort
  // thinking, which can dominate wall-clock time before any output is produced.
  // "disabled" forces non-thinking mode; "low" keeps thinking on at low effort.
  // Gated on DeepSeek so OpenAI/Ollama/Anthropic payloads are never touched.
  const isDeepSeek =
    opts.baseUrl.toLowerCase().includes("deepseek.com") ||
    model.toLowerCase().startsWith("deepseek");
  if (isDeepSeek && opts.thinking) {
    if (opts.thinking === "disabled") {
      // Must NOT pair reasoning_effort with a disabled thinking block.
      body.thinking = { type: "disabled" };
    } else {
      body.reasoning_effort = "low";
    }
  }

  const t0 = Date.now();
  try {
    // Internal timeout (300s) raced with the caller's signal (client disconnect / platform timeout).
    // This lets the app respond gracefully before the platform kills the function.
    const internalTimeout = AbortSignal.timeout(300000);
    const abortSignal = opts.signal
      ? AbortSignal.any([internalTimeout, opts.signal])
      : internalTimeout;

    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    const ttfb = Date.now() - t0;
    if (!res.ok) {
      const respBody = (await res.text().catch(() => "")).slice(0, 500);
      console.error(`[llm] model=${model} maxTokens=${opts.maxTokens} FAILED status=${res.status} in ${Date.now() - t0}ms: ${respBody}`);
      return null;
    }

    const data = await res.json();
    // Total latency must include reading the full response body — DeepSeek's
    // thinking mode sends headers early, so time-to-headers alone (ttfb) can
    // under-report a 35s call as a few hundred ms.
    const dur = Date.now() - t0;
    const message = data.choices?.[0]?.message;
    const usage = (data.usage ?? null) as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    if (!message) {
      console.error(`[llm] model=${model} maxTokens=${opts.maxTokens} FAILED missing message in ${dur}ms — status=${res.status}, choices=${data.choices?.length || 0}, finish_reason=${data.choices?.[0]?.finish_reason || "none"}, usage=${usage ? JSON.stringify(usage) : "n/a"}`);
      if (data.choices?.[0]?.message) {
        console.error(`[llm] response message keys: ${Object.keys(data.choices[0].message).join(", ")}`);
      }
      return null;
    }

    console.log(`[llm] model=${model} maxTokens=${opts.maxTokens} OK in ${dur}ms (ttfb=${ttfb}ms) finish=${data.choices?.[0]?.finish_reason ?? "n/a"} content=${message.content?.trim()?.length ?? 0}ch toolCalls=${message.tool_calls?.length ?? 0} usage=${usage ? JSON.stringify(usage) : "n/a"}`);
    return {
      content: message.content?.trim() || null,
      toolCalls: message.tool_calls || [],
    };
  } catch (err) {
    const dur = Date.now() - t0;
    const msg = (err as Error).message || "unknown";
    if ((err as Error).name === "TimeoutError" || msg.includes("timed out")) {
      console.error(`[llm] model=${model} TIMED OUT after ${dur}ms`);
    } else if ((err as Error).name === "AbortError") {
      console.error(`[llm] model=${model} ABORTED after ${dur}ms`);
    } else {
      console.error(`[llm] model=${model} FAILED after ${dur}ms:`, msg);
    }
    return null;
  }
}

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
    signal,
    thinking,
  } = opts;

  if (!apiKey || !baseUrl || !model) {
    console.error("LLM not configured — missing apiKey, baseUrl, or model");
    return null;
  }

  const result = await sendChatCompletion(model, messages, {
    temperature,
    maxTokens,
    apiKey,
    baseUrl,
    jsonMode,
    signal,
    thinking,
  });

  return result?.content ?? null;
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

/**
 * Send a chat completion with tool/function calling support.
 * The caller is responsible for executing any tool calls returned
 * and feeding the results back in a follow-up request.
 *
 * Returns the raw response with content and toolCalls.
 */
export async function chatWithTools(
  messages: LlmMessage[],
  opts: LlmOptions = {}
): Promise<LlmResponse | null> {
  const {
    temperature = 0.3,
    maxTokens = 1024,
    apiKey,
    baseUrl,
    model,
    tools,
    toolChoice,
    signal,
    thinking,
  } = opts;

  if (!apiKey || !baseUrl || !model) {
    console.error("LLM not configured — missing apiKey, baseUrl, or model");
    return null;
  }

  const result = await sendChatCompletion(model, messages, {
    temperature,
    maxTokens,
    apiKey,
    baseUrl,
    tools,
    toolChoice,
    signal,
    thinking,
  });

  if (result) {
    console.error(`[AI-COACH] LLM response: tool_calls=${result.toolCalls.length}, content_length=${(result.content || "").length}`);
  }

  return result;
}
