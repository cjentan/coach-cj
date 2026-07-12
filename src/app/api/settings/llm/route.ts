import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isLlmConfigured, PROVIDER_BASE_URLS } from "@/lib/llm";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { llmApiKey: true, llmBaseUrl: true, llmModel: true, llmProvider: true },
  });

  return NextResponse.json({
    hasUserKey: !!user?.llmApiKey,
    llmProvider: user?.llmProvider || "",
    llmBaseUrl: user?.llmBaseUrl || "",
    llmModel: user?.llmModel || "",
    configured: isLlmConfigured(user?.llmApiKey ?? undefined, user?.llmProvider ?? undefined),
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    llmApiKey?: string;
    llmBaseUrl?: string;
    llmModel?: string;
    llmProvider?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data: Record<string, string> = {};

  if (body.llmApiKey !== undefined) {
    data.llmApiKey = body.llmApiKey;
  }
  if (body.llmModel !== undefined) {
    data.llmModel = body.llmModel;
  }
  if (body.llmProvider !== undefined) {
    data.llmProvider = body.llmProvider;
    // Auto-populate base URL from provider if not explicitly provided
    if (!body.llmBaseUrl && PROVIDER_BASE_URLS[body.llmProvider]) {
      data.llmBaseUrl = PROVIDER_BASE_URLS[body.llmProvider];
    } else if (body.llmBaseUrl !== undefined) {
      // Use the provided base URL
      data.llmBaseUrl = body.llmBaseUrl;
    }
  } else if (body.llmBaseUrl !== undefined) {
    data.llmBaseUrl = body.llmBaseUrl;
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  return NextResponse.json({ success: true });
}
