/**
 * Page context detection — shared between frontend and backend.
 *
 * The floating coach button reads the current URL to determine what
 * page the user is on, then passes this context to the AI Coach API.
 * The backend enriches the LLM prompt with page-specific data.
 */

export type PageType =
  | "dashboard"
  | "training-plan"
  | "activity-detail"
  | "activity-list"
  | "goal-detail"
  | "goal-list"
  | "body-metrics"
  | "availability"
  | "home"
  | "unknown";

export interface PageContext {
  page: PageType;
  activityId?: string;
  goalId?: string;
}

/**
 * Parse a pathname (already locale-stripped, e.g. "/activities/abc123")
 * into a PageContext. Returns null for paths where the coach chat
 * should not appear (settings, auth pages, onboarding, admin, etc.).
 */
export function detectPageContext(pathname: string): PageContext | null {
  // Normalise: strip trailing slash
  const p = pathname.endsWith("/") && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;

  // Paths where the chat button is hidden
  const hiddenPrefixes = [
    "/settings",
    "/auth",
    "/onboarding",
    "/admin",
    "/llm-test",
  ];
  if (hiddenPrefixes.some((prefix) => p.startsWith(prefix))) {
    return null;
  }

  // Home / landing page
  if (p === "" || p === "/") {
    return { page: "home" };
  }

  // Dashboard
  if (p === "/dashboard") {
    return { page: "dashboard" };
  }

  // Training Plan
  if (p === "/training-plan") {
    return { page: "training-plan" };
  }

  // Activities
  if (p === "/activities") {
    return { page: "activity-list" };
  }
  const activityMatch = p.match(/^\/activities\/([^/]+)$/);
  if (activityMatch) {
    return { page: "activity-detail", activityId: activityMatch[1] };
  }

  // Goals
  if (p === "/goals") {
    return { page: "goal-list" };
  }
  const goalMatch = p.match(/^\/goals\/([^/]+)$/);
  if (goalMatch) {
    return { page: "goal-detail", goalId: goalMatch[1] };
  }

  // Other recognised pages
  if (p === "/body-metrics") {
    return { page: "body-metrics" };
  }
  if (p === "/availability") {
    return { page: "availability" };
  }

  // Default: show the button but no specific page context
  return { page: "unknown" };
}
