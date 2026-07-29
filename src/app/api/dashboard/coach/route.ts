import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  analyze,
  chat,
  startInterview,
  approvePlanProposal,
  applySuggestion,
  listConversations,
  getConversation,
  startNewConversation,
  summarizeConversation,
  clearContext,
  analyzeActivity,
} from "@/lib/ai-coach";
import { type PageContext } from "@/lib/page-context";

// Allow up to 2 minutes for LLM-powered actions (start-interview, approve-plan, etc.)
// which can take 10-25+ seconds per LLM call and may retry on parse failure.
export const maxDuration = 120;

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
  const locale = (body.locale as string) || session.user.locale || "en";

  switch (action) {
    case "analyze": {
      const result = await analyze(
        userId,
        body.conversationId as string | undefined,
        body.pageContext as PageContext | undefined,
        locale,
      );
      if ("error" in result) {
        const status =
          result.code === "NOT_CONFIGURED" ? 503
          : result.code === "LLM_FAILED" ? 502
          : 500;
        return NextResponse.json({ error: result.error, code: result.code }, { status });
      }
      return NextResponse.json(result);
    }

    case "start-interview": {
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: string, data: unknown) => {
            try {
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(encoder.encode(payload));
            } catch { /* stream may have closed */ }
          };

          try {
            const result = await startInterview(userId, {
              onProgress: (event) => {
                sendEvent(event.type, event);
              },
              signal: request.signal,
            }, locale);

            if ("error" in result) {
              sendEvent("error", { error: result.error, code: result.code });
            } else {
              sendEvent("complete", {
                conversationId: result.conversationId,
                response: result.response,
                proposal: result.proposal,
                needsGoal: result.needsGoal,
              });
            }
          } catch (err) {
            sendEvent("error", { error: (err as Error).message || "Unexpected error" });
          }

          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    case "chat": {
      const conversationId = body.conversationId as string | undefined;
      const message = body.message as string | undefined;

      if (!conversationId || !message) {
        return NextResponse.json({ error: "conversationId and message are required" }, { status: 400 });
      }

      const result = await chat(
        conversationId, userId, message,
        undefined,
        body.pageContext as PageContext | undefined,
        locale,
      );
      if ("error" in result) {
        const status = result.code === "NOT_FOUND" ? 404 : 503;
        return NextResponse.json({ error: result.error, code: result.code }, { status });
      }
      return NextResponse.json(result);
    }

    case "chat-stream": {
      const conversationId = body.conversationId as string | undefined;
      const message = body.message as string | undefined;

      if (!conversationId || !message) {
        return NextResponse.json({ error: "conversationId and message are required" }, { status: 400 });
      }

      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: string, data: unknown) => {
            try {
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(encoder.encode(payload));
            } catch {
              // Stream may have closed
            }
          };

          try {
            const result = await chat(
              conversationId!, userId, message!,
              {
                onProgress: (event) => {
                  sendEvent(event.type, event);
                },
                signal: request.signal,
              },
              body.pageContext as PageContext | undefined,
              locale,
            );

            if ("error" in result) {
              sendEvent("error", { error: result.error, code: result.code });
            } else {
              sendEvent("complete", {
                response: result.response,
                suggestions: result.suggestions,
                ...(result && "proposal" in result ? { proposal: result.proposal } : {}),
              });
            }
          } catch (err) {
            sendEvent("error", { error: (err as Error).message || "Unexpected error" });
          }

          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    case "approve-plan": {
      const conversationId = body.conversationId as string | undefined;
      const proposalOverrides = body.proposalOverrides as Record<string, unknown> | undefined;

      if (!conversationId) {
        return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
      }

      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: string, data: unknown) => {
            try {
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(encoder.encode(payload));
            } catch {
              // Stream may have closed
            }
          };

          try {
            const result = await approvePlanProposal(
              conversationId!, userId!,
              {
                onProgress: (event) => {
                  sendEvent(event.type, event);
                },
                signal: request.signal,
              },
              locale,
              proposalOverrides,
            );

            if ("error" in result) {
              sendEvent("error", { error: result.error, code: result.code });
            } else {
              sendEvent("complete", {
                success: true,
                response: result.response,
                phases: result.phases,
              });
            }
          } catch (err) {
            sendEvent("error", { error: (err as Error).message || "Unexpected error" });
          }

          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
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

      const result = await summarizeConversation(conversationId, userId, locale);
      if ("error" in result) {
        const status = result.code === "NOT_FOUND" ? 404 : 503;
        return NextResponse.json({ error: result.error, code: result.code }, { status });
      }
      return NextResponse.json(result);
    }

    case "analyze-activity": {
      const activityId = body.activityId as string | undefined;
      if (!activityId) {
        return NextResponse.json({ error: "activityId is required" }, { status: 400 });
      }

      const activityResult = await analyzeActivity(userId, activityId, locale);
      if ("error" in activityResult) {
        const status =
          activityResult.code === "NOT_FOUND" ? 404
          : activityResult.code === "NOT_CONFIGURED" ? 503
          : 500;
        return NextResponse.json({ error: activityResult.error, code: activityResult.code }, { status });
      }
      return NextResponse.json(activityResult);
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }
}
