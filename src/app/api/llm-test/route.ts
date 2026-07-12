import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chat, isLlmConfigured } from "@/lib/llm";

async function getUserLlmConfig(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { llmApiKey: true, llmBaseUrl: true, llmModel: true, llmProvider: true },
  });
  return user;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userConfig = await getUserLlmConfig(session.user.id);

  return NextResponse.json({
    configured: isLlmConfigured(userConfig?.llmApiKey ?? undefined, userConfig?.llmProvider ?? undefined),
    provider: userConfig?.llmProvider || "",
    model: userConfig?.llmModel || "",
    baseUrl: userConfig?.llmBaseUrl || "",
    hasUserKey: !!userConfig?.llmApiKey,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { prompt } = await req.json();
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const userConfig = await getUserLlmConfig(session.user.id);

  if (!isLlmConfigured(userConfig?.llmApiKey ?? undefined, userConfig?.llmProvider ?? undefined)) {
    return NextResponse.json({
      success: false,
      error: "No API key configured. Go to Settings → API Credentials to set up your AI provider.",
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
      apiKey: userConfig?.llmApiKey ?? undefined,
      baseUrl: userConfig?.llmBaseUrl ?? undefined,
      model: userConfig?.llmModel ?? undefined,
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
