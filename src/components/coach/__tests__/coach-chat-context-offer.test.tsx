// @vitest-environment jsdom
/**
 * Verifies the "build your training context" offer card:
 * - appears after the plan interview when the athlete has no saved context,
 * - Skip dismisses it without sending a message,
 * - Start dismisses it and kicks off the context-building Q&A through chat-stream,
 * - it also appears alongside the ask-for-goal message when no goal exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "test-user-id" } }, status: "authenticated" }),
}));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({
  default: () => () => ({}),
}));
vi.mock("@/components/coach/plan-proposal-card", () => ({
  default: () => <div data-testid="proposal-card" />,
}));
vi.mock("@/components/coach/training-plan-summary-card", () => ({
  default: () => <div data-testid="plan-summary" />,
}));
vi.mock("next-intl", () => {
  const t = (key: string, values?: Record<string, string | number>) => {
    const known: Record<string, string> = {
      loading: "Loading...",
      title: "Coach",
      placeholder: "Type your message...",
      sendHint: "Press Enter to send",
      analyze: "Analyze",
      summarize: "Summarize",
      contextOfferTitle: "Build your training context",
      contextOfferDescription: "Tell me where and when you train, your equipment, and any constraints — I'll use it to make your plan more personal. You can skip this.",
      contextOfferStart: "Start",
      contextOfferSkip: "Skip",
      contextOfferTrigger:
        "I'd like to build my training context. Please ask me a few questions about my training environment, schedule, equipment, and preferences.",
    };
    let val = known[key] ?? key;
    if (values) {
      for (const [k, v] of Object.entries(values)) {
        val = val.replace(`{${k}}`, String(v));
      }
    }
    return val;
  };
  return {
    useTranslations: () => t,
    useLocale: () => "en",
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

import CoachChat from "@/components/coach/coach-chat";

/**
 * Mirrors the real wiring in floating-coach-button.tsx: the pendingAction prop
 * is cleared via onPendingActionHandled once the auto-start effect fires. A no-op
 * handler would leave pendingAction === "start-interview", and when the effect
 * re-runs as interviewStarting flips back to false it would restart the interview,
 * wiping messages and showContextOffer.
 */
function InterviewHarness() {
  const [pending, setPending] = useState<"start-interview" | null>("start-interview");
  return <CoachChat variant="default" pendingAction={pending} onPendingActionHandled={() => setPending(null)} />;
}

/** A fetch Response that streams a single SSE "complete" event. */
function sseResponse(payload: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(payload)}\n\n`));
      controller.close();
    },
  });
  return { ok: true, status: 200, json: async () => ({}), body } as unknown as Response;
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function mockFetch(routes: Array<{ match: (url: string, body: Record<string, unknown>) => boolean; response: Response }>) {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    let body: Record<string, unknown> = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) : {};
    } catch {
      /* ignore */
    }
    for (const r of routes) {
      if (r.match(u, body)) return r.response;
    }
    return jsonResponse({});
  }) as unknown as typeof fetch;
}

function chatStreamCalls(): Array<Record<string, unknown>> {
  const calls = (global.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
  return calls
    .filter(([, init]) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return body.action === "chat-stream";
    })
    .map(([, init]) => JSON.parse(String(init?.body ?? "{}")));
}

const interviewRoutes = {
  list: {
    match: (u: string, b: Record<string, unknown>) => u.endsWith("/api/dashboard/coach") && b.action === "list-conversations",
    response: jsonResponse({ conversations: [] }),
  },
  newConv: {
    match: (u: string, b: Record<string, unknown>) => u.endsWith("/api/dashboard/coach") && b.action === "new-conversation",
    response: jsonResponse({ conversationId: "conv-1" }),
  },
  chatStream: {
    match: (u: string, b: Record<string, unknown>) => u.endsWith("/api/dashboard/coach") && b.action === "chat-stream",
    response: sseResponse({ response: "Sure, let's get started.", suggestions: [] }),
  },
};

describe("CoachChat — training-context offer", () => {
  const trigger =
    "I'd like to build my training context. Please ask me a few questions about my training environment, schedule, equipment, and preferences.";

  function renderInterview(routes: Array<{ match: (u: string, b: Record<string, unknown>) => boolean; response: Response }>) {
    mockFetch(routes);
    return render(<InterviewHarness />);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the offer card after the interview when needsContext is true", async () => {
    renderInterview([
      interviewRoutes.list,
      interviewRoutes.newConv,
      interviewRoutes.chatStream,
      {
        match: (u, b) => u.endsWith("/api/dashboard/coach") && b.action === "start-interview",
        response: sseResponse({
          conversationId: "conv-1",
          response: "Here's your plan proposal.",
          proposal: null,
          needsGoal: false,
          needsContext: true,
        }),
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Build your training context")).toBeInTheDocument();
    });
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Skip")).toBeInTheDocument();
  });

  it("hides the offer card when Skip is clicked and sends no chat message", async () => {
    renderInterview([
      interviewRoutes.list,
      interviewRoutes.newConv,
      interviewRoutes.chatStream,
      {
        match: (u, b) => u.endsWith("/api/dashboard/coach") && b.action === "start-interview",
        response: sseResponse({
          conversationId: "conv-1",
          response: "Here's your plan proposal.",
          proposal: null,
          needsGoal: false,
          needsContext: true,
        }),
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Build your training context")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Skip"));

    await waitFor(() => {
      expect(screen.queryByText("Build your training context")).not.toBeInTheDocument();
    });
    expect(chatStreamCalls().length).toBe(0);
  });

  it("dismisses the offer and sends the context-building trigger via chat-stream when Start is clicked", async () => {
    renderInterview([
      interviewRoutes.list,
      interviewRoutes.newConv,
      interviewRoutes.chatStream,
      {
        match: (u, b) => u.endsWith("/api/dashboard/coach") && b.action === "start-interview",
        response: sseResponse({
          conversationId: "conv-1",
          response: "Here's your plan proposal.",
          proposal: null,
          needsGoal: false,
          needsContext: true,
        }),
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Build your training context")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Start"));

    await waitFor(() => {
      expect(screen.queryByText("Build your training context")).not.toBeInTheDocument();
    });

    const calls = chatStreamCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].message).toBe(trigger);
  });

  it("shows the offer card alongside the ask-for-goal message when no goal exists either", async () => {
    renderInterview([
      interviewRoutes.list,
      interviewRoutes.newConv,
      interviewRoutes.chatStream,
      {
        match: (u, b) => u.endsWith("/api/dashboard/coach") && b.action === "start-interview",
        response: sseResponse({
          conversationId: "conv-1",
          response: "Tell me about your goal race.",
          proposal: null,
          needsGoal: true,
          needsContext: true,
        }),
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Tell me about your goal race.")).toBeInTheDocument();
    });
    expect(screen.getByText("Build your training context")).toBeInTheDocument();
  });
});
