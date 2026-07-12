/**
 * Multi-provider LLM abstraction.
 * Supports: Ollama (local), DeepSeek, OpenAI, Anthropic.
 * All use OpenAI-compatible chat completions except Anthropic (native SDK).
 *
 * Configure via env:
 *   LLM_PROVIDER=ollama|deepseek|openai|anthropic
 *   LLM_BASE_URL=http://ollama:11434/v1   (Ollama/OpenAI-compatible)
 *   LLM_API_KEY=sk-xxx                     (not needed for Ollama)
 *   LLM_MODEL=mistral:7b                   (model name)
 */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

const LLM_PROVIDER = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://ollama:11434/v1";
const LLM_API_KEY = process.env.LLM_API_KEY || "ollama"; // Ollama ignores the key
const LLM_MODEL = process.env.LLM_MODEL || "mistral:7b";

export function isLlmConfigured(): boolean {
  // Ollama doesn't need an API key — it's always "configured" if the service is up
  if (LLM_PROVIDER === "ollama") return true;
  // For cloud providers, check the key is set
  return LLM_API_KEY.length > 8;
}

export function getLlmProvider(): string {
  return LLM_PROVIDER;
}

export function getLlmModel(): string {
  return LLM_MODEL;
}

/**
 * Send a chat completion request. Returns the model's text response.
 * Falls back to null if the LLM is unavailable.
 */
export async function chat(
  messages: LlmMessage[],
  opts: LlmOptions = {}
): Promise<string | null> {
  const { temperature = 0.3, maxTokens = 1024, jsonMode = false } = opts;

  const body: Record<string, unknown> = {
    model: LLM_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000), // 5 min timeout for slow local LLMs
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
