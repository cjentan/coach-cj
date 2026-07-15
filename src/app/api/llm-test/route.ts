import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { chat, isLlmConfigured, getDefaultLlmConfig, resolveUserLlmConfig } from "@/lib/llm";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await resolveUserLlmConfig(session.user.id);

  return NextResponse.json({
    configured: isLlmConfigured(config.apiKey, config.provider),
    provider: config.provider || "",
    model: config.model || "",
    baseUrl: config.baseUrl || "",
    hasUserKey: !!config.apiKey,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { prompt } = await req.json();
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const config = await resolveUserLlmConfig(session.user.id);

  if (!isLlmConfigured(config.apiKey, config.provider)) {
    const msg = getDefaultLlmConfig()
      ? "Server default DeepSeek key is set but appears invalid. Check the DEEPSEEK_API_KEY environment variable."
      : "No API key configured. Go to Settings → API Credentials to set up your AI provider.";
    return NextResponse.json({
      success: false,
      error: msg,
      durationMs: 0,
    });
  }

  const start = Date.now();

  const response = await chat(
    [
      {
        role: "system",
        content:
          "You are a helpful endurance sports coach. Answer concisely, in plain text, no markdown formatting.",
      },
      { role: "user", content: prompt },
    ],
    {
      temperature: 0.3,
      maxTokens: 512,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    }
  );

  const durationMs = Date.now() - start;

  if (!response) {
    return NextResponse.json({
      success: false,
      error: "LLM returned no response. Check that the service is running and the model is pulled.",
      durationMs,
    });
  }

  return NextResponse.json({
    success: true,
    response,
    durationMs,
    tokenEstimate: Math.round(response.length / 4), // rough estimate
  });
}
