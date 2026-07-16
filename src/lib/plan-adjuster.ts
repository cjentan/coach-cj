/**
 * LLM-powered plan adjustment.
 * Takes a user's natural-language prompt and the current plan + context,
 * sends it to the LLM for interpretation, then applies deterministic
 * guardrails before returning the adjusted plan.
 *
 * Mirrors the coach-notes.ts pattern: buildUserMessage → ask() → validate.
 * Uses jsonMode for structured output (Zod-validated).
 */
import { z } from "zod";
import { ask, isLlmConfigured } from "./llm";
import { formatDistance } from "./utils";

// ── Types ──────────────────────────────────────────────

export interface CurrentPlan {
  weekStart: string;
  targetVolumeMeters: number;
  targetElevationMeters: number;
  plannedSessions: Array<{
    dayOfWeek: number;
    type: string;
    description: string;
    targetDistance: number | null;
    targetElevation: number | null;
    targetDuration: number;
    facility: string | null;
  }>;
  adjustments: string[];
}

export interface PlanContext {
  goals: Array<{
    name: string;
    targetDate: string;
    distanceMeters: number;
    elevationGainMeters: number | null;
    priority: string;
  }>;
  trainingContext?: string;
  fatigueSeverity: string | null;
  recentVolumeByWeek: number[];
  adjustmentHistory?: Array<{
    timestamp: string;
    prompt: string;
    summary: string;
  }>;
}

export interface AdjustedSession {
  dayOfWeek: number;
  type: "rest" | "long_run" | "intervals" | "hill_repeats" | "easy" | "tempo";
  description: string;
  targetDistance: number | null;
  targetElevation: number | null;
  targetDuration: number;
  facility: string | null;
}

export interface AdjustedPlan {
  explanation: string;
  targetVolumeMeters: number;
  targetElevationMeters: number;
  plannedSessions: AdjustedSession[];
  adjustments: string[];
}

export interface AdjustResult {
  plan: AdjustedPlan;
  guardrailViolations: string[];
}

// ── Zod Schema ─────────────────────────────────────────

const AdjustedSessionSchema = z.object({
  dayOfWeek: z.number().min(0).max(6),
  type: z.enum(["rest", "long_run", "intervals", "hill_repeats", "easy", "tempo"]),
  description: z.string(),
  targetDistance: z.number().nullable(),
  targetElevation: z.number().nullable(),
  targetDuration: z.number().min(0),
  facility: z.string().nullable(),
});

const AdjustedPlanSchema = z.object({
  explanation: z.string(),
  targetVolumeMeters: z.number().min(0),
  targetElevationMeters: z.number().min(0),
  plannedSessions: z.array(AdjustedSessionSchema),
  adjustments: z.array(z.string()),
});

// ── System Prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert endurance sports coach specializing in:
- Ultra running, trail running, marathons, triathlon, cycling
- Training periodization, load progression, injury prevention
- The Performance Management Chart (PMC) model: CTL (fitness), ATL (fatigue), TSB (form)

Your task: adjust an athlete's existing weekly training plan based on their natural-language request.

Rules:
1. Consider the athlete's training context (where and when they typically train) when making recommendations.
2. Never eliminate all rest days — at least 1 rest day per week.
3. Volume increases are capped at +15% of the current plan's target volume. If the current plan has 0 volume (no baseline), use the athlete's recent average weekly volume as the reference instead.
4. If the athlete mentions illness (flu, sick, fever, unwell, down with), enforce at least 2 consecutive rest days starting from the affected date.
5. If the athlete mentions a race or event, ensure the day before includes rest or very easy effort.
6. Consider the athlete's training context (where and when they typically train) when making recommendations.
7. If the athlete wants to push harder, increase intensity/duration within safe limits rather than just piling on volume.
8. Provide a clear, specific explanation of every change you made.
9. Return ONLY valid JSON matching the schema. No markdown, no commentary outside the JSON.

Output schema:
{
  "explanation": "string — human-readable summary of what changed and why",
  "targetVolumeMeters": number,
  "targetElevationMeters": number,
  "plannedSessions": [
    {
      "dayOfWeek": 0-6 (0=Sunday),
      "type": "rest" | "long_run" | "intervals" | "hill_repeats" | "easy" | "tempo",
      "description": "string — specific workout description",
      "targetDistance": number | null,
      "targetElevation": number | null,
      "targetDuration": number (seconds),
      "facility": "string | null"
    }
  ],
  "adjustments": ["string array — new adjustment notes"]
}`;

// ── Prompt Builder ─────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildUserMessage(
  currentPlan: CurrentPlan,
  userPrompt: string,
  context: PlanContext
): string {
  let msg = "";

  // Current plan
  msg += "## Current Plan\n";
  msg += `### Targets\n`;
  msg += `Volume: ${formatDistance(currentPlan.targetVolumeMeters)}, Elevation: ${formatDistance(currentPlan.targetElevationMeters)}\n\n`;

  msg += "### Sessions\n";
  const sortedSessions = [...currentPlan.plannedSessions].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek
  );
  for (const s of sortedSessions) {
    const dist = s.targetDistance ? formatDistance(s.targetDistance) : "—";
    const vert = s.targetElevation ? formatDistance(s.targetElevation) : "—";
    const facility = s.facility ? `, ${s.facility}` : "";
    msg += `${DAY_NAMES[s.dayOfWeek]}: ${s.description}, ${dist}, ${vert} D+${facility}\n`;
  }

  if (currentPlan.adjustments.length > 0) {
    msg += "\n### Current Adjustments\n";
    for (const a of currentPlan.adjustments) {
      msg += `- ${a}\n`;
    }
  }

  // Adjustment history
  if (context.adjustmentHistory && context.adjustmentHistory.length > 0) {
    msg += "\n### Previous Adjustments This Week\n";
    for (const h of context.adjustmentHistory) {
      msg += `- ${h.timestamp}: "${h.prompt}" → ${h.summary}\n`;
    }
  }

  // Athlete's request
  msg += "\n## Athlete's Request\n";
  msg += `"${userPrompt}"\n`;

  // Context
  msg += "\n## Context\n";

  if (context.goals.length > 0) {
    msg += "### Race Goals\n";
    for (const g of context.goals) {
      msg += `- ${g.name}: ${formatDistance(g.distanceMeters)}${g.elevationGainMeters ? `, ${formatDistance(g.elevationGainMeters)} D+` : ""}, ${g.targetDate}, priority ${g.priority}\n`;
    }
  }

  if (context.trainingContext) {
    msg += "\n### Training Context\n";
    msg += `${context.trainingContext}\n`;
  }

  msg += `\n### Status\n`;
  msg += `Fatigue: ${context.fatigueSeverity || "low"}\n`;

  if (context.recentVolumeByWeek.length > 0) {
    const recent = context.recentVolumeByWeek;
    msg += `Recent volume: ${recent.map((v) => formatDistance(v)).join(" → ")}\n`;
  }

  msg += `\nAdjust the plan based on the athlete's request. Return ONLY the JSON.`;

  return msg;
}

// ── Guardrails ─────────────────────────────────────────

function applyGuardrails(
  adjusted: AdjustedPlan,
  currentPlan: CurrentPlan,
  userPrompt: string,
  context: PlanContext
): string[] {
  const violations: string[] = [];

  // 1. Volume ceiling: ≤ current * 1.15 (or use recent volume as baseline if plan is 0)
  const volumeBaseline = currentPlan.targetVolumeMeters > 0
    ? currentPlan.targetVolumeMeters
    : context.recentVolumeByWeek.length > 0
      ? context.recentVolumeByWeek.reduce((a, b) => a + b, 0) / context.recentVolumeByWeek.length
      : 0;

  if (volumeBaseline > 0) {
    const maxVolume = volumeBaseline * 1.15;
    if (adjusted.targetVolumeMeters > maxVolume) {
      violations.push(
        `Volume ${formatDistance(adjusted.targetVolumeMeters)} exceeds +15% cap (max ${formatDistance(maxVolume)})`
      );
    }
  }

  // 2. At least 1 rest day
  const restDays = adjusted.plannedSessions.filter((s) => s.type === "rest").length;
  if (restDays < 1) {
    violations.push("Plan must include at least 1 rest day");
  }

  // 3. Complete week: exactly 7 sessions
  if (adjusted.plannedSessions.length !== 7) {
    violations.push(
      `Plan must have exactly 7 sessions (got ${adjusted.plannedSessions.length})`
    );
  }

  // 4. Illness detection: force ≥ 2 consecutive rest days
  const illnessPattern = /\b(flu|sick|fever|ill|unwell|down with|covid|infection)\b/i;
  if (illnessPattern.test(userPrompt)) {
    // Find the longest run of consecutive rest days
    let maxConsecutive = 0;
    let current = 0;
    // Check circularly since week wraps
    const days = [...adjusted.plannedSessions].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const restFlags = days.map((s) => s.type === "rest");
    for (let i = 0; i < restFlags.length * 2; i++) {
      if (restFlags[i % 7]) {
        current++;
        maxConsecutive = Math.max(maxConsecutive, current);
      } else {
        current = 0;
      }
    }
    maxConsecutive = Math.min(maxConsecutive, 7); // cap at 7
    if (maxConsecutive < 2) {
      violations.push(
        `Illness detected in prompt — plan needs at least 2 consecutive rest days (found ${maxConsecutive})`
      );
    }
  }

  return violations;
}

// ── Main Function ──────────────────────────────────────

export async function adjustPlan(
  currentPlan: CurrentPlan,
  userPrompt: string,
  context: PlanContext,
  llmConfig?: { apiKey?: string; baseUrl?: string; model?: string; provider?: string }
): Promise<AdjustResult | null> {
  if (!isLlmConfigured(llmConfig?.apiKey, llmConfig?.provider)) {
    console.log("LLM not configured — cannot adjust plan");
    return null;
  }

  console.log(`Adjusting plan with ${llmConfig?.model || "unknown"}...`);

  const userMessage = buildUserMessage(currentPlan, userPrompt, context);

  const llmOpts = {
    temperature: 0.3 as const,
    maxTokens: 2048,
    jsonMode: true as const,
    apiKey: llmConfig?.apiKey,
    baseUrl: llmConfig?.baseUrl,
    model: llmConfig?.model,
  };

  const retryOpts = {
    temperature: 0.2 as const,
    maxTokens: 2048,
    jsonMode: true as const,
    apiKey: llmConfig?.apiKey,
    baseUrl: llmConfig?.baseUrl,
    model: llmConfig?.model,
  };

  // First attempt
  let result = await ask(SYSTEM_PROMPT, userMessage, llmOpts);

  if (!result) {
    console.log("LLM returned no response — plan adjust failed");
    return null;
  }

  // Parse and validate
  let parsed: AdjustedPlan;
  try {
    const raw = JSON.parse(result);
    parsed = AdjustedPlanSchema.parse(raw);
  } catch (err) {
    console.error("Failed to parse LLM response:", (err as Error).message);

    // Retry once with error context
    const retryMessage = `${userMessage}\n\n[SYSTEM NOTE: Your previous response was invalid JSON or did not match the required schema. Error: ${(err as Error).message}. Please return ONLY valid JSON matching the schema exactly.]`;

    result = await ask(SYSTEM_PROMPT, retryMessage, retryOpts);

    if (!result) {
      console.log("LLM retry also failed");
      return null;
    }

    try {
      parsed = AdjustedPlanSchema.parse(JSON.parse(result));
    } catch (retryErr) {
      console.error("LLM retry parse also failed:", (retryErr as Error).message);
      return null;
    }
  }

  // Apply guardrails
  const guardrailViolations = applyGuardrails(parsed, currentPlan, userPrompt, context);

  if (guardrailViolations.length > 0) {
    console.log("Guardrail violations:", guardrailViolations);

    // Retry once with guardrail feedback
    const violationMsg = guardrailViolations.map((v) => `- ${v}`).join("\n");
    const retryMessage = `${userMessage}\n\n[SYSTEM NOTE: Your adjusted plan failed safety checks:\n${violationMsg}\n\nPlease fix these issues and return a valid JSON plan.]`;

    result = await ask(SYSTEM_PROMPT, retryMessage, retryOpts);

    if (result) {
      try {
        parsed = AdjustedPlanSchema.parse(JSON.parse(result));
        // Re-check guardrails on retry
        const retryViolations = applyGuardrails(parsed, currentPlan, userPrompt, context);
        if (retryViolations.length > 0) {
          console.log("Guardrail violations persist after retry:", retryViolations);
          return { plan: parsed, guardrailViolations: retryViolations };
        }
        return { plan: parsed, guardrailViolations: [] };
      } catch {
        console.log("Retry parse also failed after guardrail feedback");
      }
    }

    // Return with violations so caller can decide
    return { plan: parsed, guardrailViolations };
  }

  console.log(
    `Plan adjusted: ${parsed.explanation.slice(0, 100)}... (${parsed.plannedSessions.length} sessions)`
  );

  return { plan: parsed, guardrailViolations: [] };
}
