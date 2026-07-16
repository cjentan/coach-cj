import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  analyze,
  chat,
  applySuggestion,
  listConversations,
  getConversation,
  startNewConversation,
  summarizeConversation,
  clearContext,
} from "@/lib/ai-coach";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { action } = body;
  if (!action || typeof action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const userId = session.user.id;

  switch (action) {
    case "analyze": {
      const result = await analyze(userId, body.conversationId as string | undefined);
      if ("error" in result) {
        const status =
          result.code === "NOT_CONFIGURED" ? 503
          : result.code === "LLM_FAILED" ? 502
          : 500;
        return NextResponse.json({ error: result.error, code: result.code }, { status });
      }
      return NextResponse.json(result);
    }

    case "chat": {
      const conversationId = body.conversationId as string | undefined;
      const message = body.message as string | undefined;

      if (!conversationId || !message) {
        return NextResponse.json({ error: "conversationId and message are required" }, { status: 400 });
      }

      const result = await chat(conversationId, userId, message);
      if ("error" in result) {
        const status = result.code === "NOT_FOUND" ? 404 : 503;
        return NextResponse.json({ error: result.error, code: result.code }, { status });
      }
      return NextResponse.json(result);
    }

    case "apply-suggestion": {
      const suggestionId = body.suggestionId as string | undefined;
      if (!suggestionId) {
        return NextResponse.json({ error: "suggestionId is required" }, { status: 400 });
      }

      const result = await applySuggestion(userId, suggestionId);
      if ("error" in result) {
        const status =
          result.code === "NOT_FOUND" ? 404
          : result.code === "NO_PLAN" ? 400
          : result.code === "ALREADY_PROCESSED" ? 409
          : 500;
        return NextResponse.json({ error: result.error, code: result.code }, { status });
      }
      return NextResponse.json(result);
    }

    case "list-conversations": {
      const result = await listConversations(userId);
      return NextResponse.json(result);
    }

    case "get-conversation": {
      const conversationId = body.conversationId as string | undefined;
      if (!conversationId) {
        return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
      }

      const result = await getConversation(conversationId, userId);
      if ("error" in result) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    case "new-conversation": {
      const result = await startNewConversation(userId);
      return NextResponse.json(result);
    }

    case "clear-context": {
      const result = await clearContext(userId);
      return NextResponse.json(result);
    }

    case "summarize": {
      const conversationId = body.conversationId as string | undefined;
      if (!conversationId) {
        return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
      }

      const result = await summarizeConversation(conversationId, userId);
      if ("error" in result) {
        const status = result.code === "NOT_FOUND" ? 404 : 503;
        return NextResponse.json({ error: result.error, code: result.code }, { status });
      }
      return NextResponse.json(result);
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }
}
