/**
 * Cross-component communication events for the coach chat panel.
 *
 * The Training Plan page and FloatingCoachButton share no direct parent-child
 * relationship — both are children of [locale]/layout.tsx.  We use window
 * CustomEvents for decoupled cross-component signalling.
 */

export const COACH_CHAT_EVENTS = {
  /** Dispatch to open the floating coach-chat panel. Detail: { startInterview?: boolean } */
  OPEN: "coachChat:open",
  /** Dispatch to signal that the training plan was created / cleared / changed. */
  PLAN_UPDATED: "trainingPlan:updated",
} as const;

/**
 * Open the floating coach-chat panel, optionally starting the plan interview.
 */
export function openCoachChat(startInterview = false): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COACH_CHAT_EVENTS.OPEN, {
      detail: { startInterview },
    }),
  );
}

/**
 * Dispatch a plan-updated event so pages listening on this event (e.g. the
 * Training Plan page) can auto-refresh their data.
 */
export function notifyPlanUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COACH_CHAT_EVENTS.PLAN_UPDATED));
}
