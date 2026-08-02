// @vitest-environment jsdom
/**
 * Verifies that when the chat routes an "analyze this activity" request
 * through analyze-activity-in-chat and the backend succeeds, the assistant
 * message is shown WITH the "save to activity" prompt (pendingSave).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
      "loading": "Loading...",
      "title": "Coach",
      "placeholder": "Type your message...",
      "sendHint": "Press Enter to send",
      "analyze": "Analyze",
      "summarize": "Summarize",
      "saveAnalysisPrompt": "Save this analysis to {name}?",
      "saveToActivity": "Save to activity",
      "discard": "Discard",
      "quickActions.analyzeWorkout": "Analyze this activity",
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
import type { PageContext } from "@/lib/page-context";

function mockFetch(routes: Array<{ match: (url: string, body: any) => boolean; response: any }>) {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    let body: any = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) : {};
    } catch {
      /* ignore */
    }
    for (const r of routes) {
      if (r.match(u, body)) {
        const res = r.response;
        return {
          ok: !res.error,
          status: res.error ? 500 : 200,
          json: async () => res,
        } as Response;
      }
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

const pageContext: PageContext = { page: "activity-detail", activityId: "act-123" };

describe("CoachChat — save analysis prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch([
      {
        match: (u, b) => u.endsWith("/api/dashboard/coach") && b.action === "list-conversations",
        response: { conversations: [] },
      },
      {
        match: (u, b) => u.endsWith("/api/dashboard/coach") && b.action === "new-conversation",
        response: { conversationId: "conv-1" },
      },
      {
        match: (u, b) => u.endsWith("/api/dashboard/coach") && b.action === "analyze-activity-in-chat",
        response: {
          conversationId: "conv-1",
          activityId: "act-123",
          activityName: "Morning Run",
          analysis: "**Easy Run** — this session looked solid.",
        },
      },
    ]);
  });

  it("shows the save prompt after a successful activity analysis", async () => {
    render(<CoachChat variant="default" pageContext={pageContext} />);

    // Wait for initialization to finish (list-conversations resolves)
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Analyze this activity" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    // The assistant message with the analysis should appear...
    await waitFor(() => {
      expect(screen.getByText(/Easy Run/)).toBeInTheDocument();
    });

    // ...AND the save prompt should be attached to it.
    await waitFor(() => {
      expect(screen.getByText(/Morning Run/)).toBeInTheDocument();
    });
  });
});
