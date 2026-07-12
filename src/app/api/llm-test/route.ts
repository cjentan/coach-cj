import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { chat, isLlmConfigured, getLlmProvider, getLlmModel } from "@/lib/llm";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    configured: isLlmConfigured(),
    provider: getLlmProvider(),
    model: getLlmModel(),
    baseUrl: process.env.LLM_BASE_URL || "http://ollama:11434/v1",
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { prompt } = await req.json();
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
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
    { temperature: 0.3, maxTokens: 512 }
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
