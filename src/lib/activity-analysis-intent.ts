/**
 * Lightweight intent detection for the coach chat.
 *
 * Decides whether a chat message is a request to analyze a specific
 * activity (e.g. "Analyze this activity", "review my long run", "how was
 * my session?") so the chat can route it through the structured
 * activity-analysis flow and offer to save the result under the activity.
 *
 * General questions ("what pace should I run?", "review my training week")
 * should return false so they keep flowing through the normal chat path.
 */

const ANALYSIS_INTENT =
  /\b(analy[sz]e|analy[sz]is|review|assess|evaluate|break\s?down|feedback|critique|comment on|how'?s|how (was|were|did|is|are))\b/i;

const ACTIVITY_REF =
  /\b(activity|workout|session|run|running|ride|riding|bike|biking|swim|swimming|hike|hiking|race|tempo|interval|threshold|fartlek|long run|marathon|half\s?marathon|10k|5k|sprint|brick|recovery|hill repeats?)\b/i;

/**
 * Returns true when the message appears to ask the coach to analyze a
 * specific activity. Requires both an analysis-intent phrase and a
 * reference to an activity/workout.
 */
export function isActivityAnalysisRequest(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return ANALYSIS_INTENT.test(m) && ACTIVITY_REF.test(m);
}
