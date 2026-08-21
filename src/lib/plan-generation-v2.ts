/**
 * Training-plan generation engine v2 — "phase-plan-first".
 *
 * Two passes:
 *  1. **Macro pass**: one small LLM call designs the phase plan (mileage per
 *     week, fitness objective, duration per phase). Validated, with a
 *     deterministic ramp as fallback.
 *  2. **Micro pass**: one LLM call per week, each given the training context,
 *     the current phase, and a digest of the previous week's plan.
 *
 * This runs *alongside* the original `approvePlanProposal` (v1); the Admin
 * toggle (`plan_generation_engine` AppSetting, see `plan-generation-engine.ts`)
 * chooses which one the coach route invokes. Same signature, same SSE event
 * contract, same phase-atomic save — the frontend can't tell them apart.
 *
 * All LLM calls run at `reasoning_effort: "low"` (thinking stays on at the
 * cheap tier) — the model's default high-effort thinking is what made the v1
 * per-phase mega-calls so slow.
 */

import { ask, resolveUserLlmConfig, isLlmConfigured } from "./llm";
import { prisma } from "./prisma";
import { gatherTrainingContext } from "./training-context";
import { executeCreateTrainingPhase } from "./ai-coach-tools";
import {
  buildContextSummary,
  sanitizeJsonText,
  derivePhaseStructure,
  getNextMondayStr,
  generatePhaseGoal,
  type ChatOptions,
  type ChatProgressEvent,
  type ToolCallEvent,
  type PhaseProgressEvent,
} from "./ai-coach";

type LlmConfig = Awaited<ReturnType<typeof resolveUserLlmConfig>>;
type TrainingContext = Awaited<ReturnType<typeof gatherTrainingContext>>;

interface PhasePlanPhase {
  name: string;
  weeks: number;
  weeklyVolumeKm: number[];
  objective: string;
}

const DAY_MS = 86400000;

/**
 * Build a training plan from an approved proposal using the two-pass engine.
 * Signature and return type mirror `approvePlanProposal` (v1) so the coach
 * route can dispatch between them transparently.
 */
export async function approvePlanProposalV2(
  conversationId: string,
  userId: string,
  options?: ChatOptions,
  locale = "en",
  proposalOverrides?: Record<string, unknown>
): Promise<
  | {
      success: true;
      response: string;
      phases: Array<{
        name: string;
        weekCount: number;
        sessionCount: number;
        workoutCount: number;
        restCount: number;
      }>;
    }
  | { error: string; code: string }
> {
  const flowT0 = Date.now();
  console.log(`[plan-v2] approve start conv=${conversationId}`);

  // 1. Load conversation + config
  const conversation = await prisma.coachConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conversation || conversation.userId !== userId) {
    return { error: "Conversation not found.", code: "NOT_FOUND" };
  }

  const llmConfig = await resolveUserLlmConfig(userId);
  if (!isLlmConfigured(llmConfig.apiKey, llmConfig.provider)) {
    return { error: "AI coach is not configured.", code: "NOT_CONFIGURED" };
  }

  // 2. Gather fresh training context
  const ctx = await gatherTrainingContext(userId);
  const contextStr = buildContextSummary(ctx, locale);

  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: {
      contextSnapshot: {
        ...((conversation.contextSnapshot as Record<string, unknown>) || {}),
        summaryText: contextStr,
      },
      updatedAt: new Date(),
    },
  });

  console.log(
    `[plan-v2] context gathered in ${Date.now() - flowT0}ms (ctx=${contextStr.length}ch)`
  );

  const primaryGoal = ctx.goals[0];
  if (!primaryGoal) {
    return { error: "No race goal found. Set a goal before building a plan.", code: "NOT_FOUND" };
  }

  // 3. Determine phase structure + start date (mirrors v1)
  const overrides = proposalOverrides as
    | {
        proposedStartDate?: string;
        phases?: Array<{ name: string; weeks: number }>;
        peakVolume?: string;
      }
    | undefined;

  const phaseStructure = overrides?.phases?.length ? overrides.phases : derivePhaseStructure(ctx);

  const proposedStartDate = overrides?.proposedStartDate;
  const planStartDate = proposedStartDate || getNextMondayStr();
  const startDate = new Date(planStartDate);
  if (isNaN(startDate.getTime())) {
    return { error: "Invalid start date.", code: "PARSE_FAILED" };
  }

  // 4. Build shared athlete context (same block as v1's approvePlanProposal)
  const athleteContextParts: string[] = [
    `Goal: "${primaryGoal.name}" (${(primaryGoal.distanceMeters / 1000).toFixed(1)}K)`,
    `Goal ID: "${primaryGoal.id}"`,
    `Target date: ${primaryGoal.targetDate}`,
    `Plan start: ${planStartDate}`,
    `Current volume: ~${ctx.longTermVolumeKm} km/wk (12-week avg)`,
    `CTL: ${ctx.pmc.ctl}, ATL: ${ctx.pmc.atl}, TSB: ${ctx.pmc.tsb} (${ctx.pmc.tsbTrend})`,
  ];

  if (ctx.trainingContext) {
    athleteContextParts.push(`\n### Training Context\n${ctx.trainingContext}`);
  }

  if (ctx.recentWeeks.length > 0) {
    const weekLines = ctx.recentWeeks
      .map(
        (w) =>
          `  ${w.label}: ${(w.volumeMeters / 1000).toFixed(0)} km, ${w.elevationMeters.toFixed(0)}m vert, ${w.activityCount} activities`
      )
      .join("\n");
    athleteContextParts.push(`\n### Recent 4 Weeks\n${weekLines}`);
  }

  if (ctx.goals.length > 0) {
    const goalLines: string[] = [];
    for (const g of ctx.goals) {
      let line = `- ${g.name} (${(g.distanceMeters / 1000).toFixed(0)} km), target ${g.targetDate}`;
      if (g.elevationGainMeters && g.elevationGainMeters > 0) {
        line += `, ${g.elevationGainMeters.toFixed(0)}m vert`;
      }
      if (g.courseProfileSummary) {
        line += `, course: ${(g.courseProfileSummary.distanceMeters / 1000).toFixed(0)}km / ${g.courseProfileSummary.elevationGainMeters.toFixed(0)}m vert`;
      }
      if (g.bestPrevious) {
        line += ` — previous best: ${g.bestPrevious.pacePerKm} on ${g.bestPrevious.date}`;
      }
      goalLines.push(line);
    }
    athleteContextParts.push(`\n### Goals\n${goalLines.join("\n")}`);
  }

  if (ctx.fatigue) {
    athleteContextParts.push(
      `\n### Fatigue (${ctx.fatigue.severity})\n${ctx.fatigue.signals.join("\n")}`
    );
  }

  if (ctx.dailyHealth) {
    athleteContextParts.push(
      `\n### Health (7d avg)\nSleep: ${ctx.dailyHealth.sleepAvg} min, HRV: ${ctx.dailyHealth.hrvAvg} ms, Resting HR: ${ctx.dailyHealth.restingHrAvg} bpm`
    );
  }

  const goalContext = athleteContextParts.join("\n");

  const toolProgressCb = options?.onProgress
    ? (event: Record<string, unknown>) => {
        options.onProgress!(event as ChatProgressEvent);
      }
    : undefined;

  const savedPhases: Array<{
    name: string;
    phaseOrder: number;
    weekCount: number;
    sessionCount: number;
    workoutCount: number;
    restCount: number;
  }> = [];
  let anyFailure: string | null = null;

  // 5. Macro pass — LLM-designed phase plan, with deterministic fallback
  options?.onProgress?.({
    type: "status",
    message: `Planning ${phaseStructure.length} phases...`,
  });

  if (options?.signal?.aborted) {
    return { error: "Request was cancelled.", code: "ABORTED" };
  }

  const phasePlan = await planPhases({
    goalContext,
    phaseStructure,
    currentVolumeKm: ctx.longTermVolumeKm,
    llmConfig,
    signal: options?.signal,
  });

  const fallbackRamp = computeDeterministicRamp(ctx, primaryGoal, phaseStructure);

  // Map phase name → per-week km targets (LLM plan when valid, else fallback).
  const rampByPhase = new Map<string, number[]>();
  for (const ps of phaseStructure) {
    const planned = phasePlan?.find((p) => p.name === ps.name);
    if (
      planned &&
      planned.weeklyVolumeKm.length === ps.weeks &&
      planned.weeklyVolumeKm.every((v) => v > 0)
    ) {
      rampByPhase.set(ps.name, planned.weeklyVolumeKm);
    } else {
      rampByPhase.set(ps.name, fallbackRamp.get(ps.name) ?? []);
    }
  }

  options?.onProgress?.({
    type: "status",
    message: phasePlan
      ? `Phase plan ready: ${phasePlan.map((p) => `${p.name} (${p.weeks}w, up to ${p.weeklyVolumeKm[p.weeklyVolumeKm.length - 1]} km)`).join(", ")}`
      : `Phase plan set from athlete data: ${phaseStructure.map((p) => `${p.name} (${p.weeks}w)`).join(", ")}`,
  });

  console.log(
    `[plan-v2] macro pass done in ${Date.now() - flowT0}ms — source=${phasePlan ? "llm" : "deterministic-fallback"}`
  );

  // 6. Micro pass — one week per LLM call
  let currentStartDate = new Date(startDate);
  let prevWeekSummary: string | null = null;

  for (let i = 0; i < phaseStructure.length; i++) {
    const ps = phaseStructure[i];
    const phaseOrder = i + 1;

    if (options?.signal?.aborted) {
      return { error: "Request was cancelled.", code: "ABORTED" };
    }

    options?.onProgress?.({
      type: "status",
      message: `Designing ${ps.name} phase (${ps.weeks} week${ps.weeks > 1 ? "s" : ""})...`,
    });

    const ramp = rampByPhase.get(ps.name) ?? [];
    const phaseWeeks: Array<Record<string, unknown>> = [];
    let phaseFailed = false;

    for (let wi = 0; wi < ps.weeks; wi++) {
      if (options?.signal?.aborted) {
        return { error: "Request was cancelled.", code: "ABORTED" };
      }

      const weekStartStr = currentStartDate.toISOString().split("T")[0];
      const weekNumber = wi + 1;
      const expectedKm = ramp.length > wi ? ramp[wi] : Math.round(ctx.longTermVolumeKm || 20);

      options?.onProgress?.({
        type: "progress",
        phaseName: `${ps.name} Phase`,
        phaseOrder,
        weekCurrent: weekNumber,
        weekTotal: ps.weeks,
        weekStart: weekStartStr,
        message: `Designing week ${weekNumber} of ${ps.weeks} for ${ps.name} phase...`,
      });

      const weekT0 = Date.now();
      const weekData = await askForSingleWeek({
        goalContext,
        phaseName: ps.name,
        phaseOrder,
        phaseTotal: phaseStructure.length,
        phaseGoal: generatePhaseGoal(ps.name),
        weekNumber,
        weekStart: weekStartStr,
        expectedKm,
        prevWeekSummary,
        peakVolumeHint: overrides?.peakVolume,
        llmConfig,
        signal: options?.signal,
      });

      if (!weekData) {
        anyFailure = `Failed to generate week ${weekNumber} of ${ps.name} phase. Try again.`;
        phaseFailed = true;
        console.error(
          `[plan-v2] phase=${ps.name} week ${weekNumber}/${ps.weeks} FAILED after ${Date.now() - weekT0}ms — ${anyFailure}`
        );
        break;
      }
      console.log(
        `[plan-v2] phase=${ps.name} week ${weekNumber}/${ps.weeks} OK in ${Date.now() - weekT0}ms (${(weekData.sessions as unknown[] | undefined)?.length ?? "?"} sessions)`
      );

      // Force server-owned identity — the LLM can never drift the DB upsert key.
      weekData.weekStart = weekStartStr;
      weekData.weekNumber = weekNumber;
      phaseWeeks.push(weekData);

      prevWeekSummary = summarizeWeek(weekData);
      currentStartDate = new Date(currentStartDate.getTime() + 7 * DAY_MS);
    }

    if (phaseFailed) break;

    // 7. Save the phase atomically (same contract as v1).
    options?.onProgress?.({
      type: "tool_call",
      tool: "create_training_phase",
      phaseName: `${ps.name} Phase`,
    } as ToolCallEvent);

    const saveResult = await executeCreateTrainingPhase(
      userId,
      {
        phaseName: `${ps.name} Phase`,
        phaseGoal: generatePhaseGoal(ps.name),
        raceGoalId: primaryGoal.id,
        phaseOrder,
        weeks: phaseWeeks,
      },
      toolProgressCb
    );

    if (!saveResult.success) {
      anyFailure = saveResult.message;
      break;
    }

    options?.onProgress?.({
      type: "phase_complete",
      phaseName: `${ps.name} Phase`,
      phaseOrder,
      phaseGoal: generatePhaseGoal(ps.name),
      weekCount: (saveResult.data?.weekCount as number) || phaseWeeks.length,
      weeks: (saveResult.data?.weeks as string[]) || [],
      sessionCount: (saveResult.data?.sessionCount as number) || 0,
      workoutCount: (saveResult.data?.workoutCount as number) || 0,
      restCount: (saveResult.data?.restCount as number) || 0,
    } as PhaseProgressEvent);

    savedPhases.push({
      name: `${ps.name} Phase`,
      phaseOrder,
      weekCount: (saveResult.data?.weekCount as number) || phaseWeeks.length,
      sessionCount: (saveResult.data?.sessionCount as number) || 0,
      workoutCount: (saveResult.data?.workoutCount as number) || 0,
      restCount: (saveResult.data?.restCount as number) || 0,
    });
  }

  if (anyFailure) {
    console.error(`[plan-v2] FAILED after ${Date.now() - flowT0}ms: ${anyFailure}`);
    return { error: anyFailure, code: "TOOL_FAILED" };
  }

  // 8. Store messages in the conversation (same as v1)
  await prisma.coachMessage.create({
    data: {
      conversationId,
      role: "user",
      content: "Approved the plan proposal — building it now.",
    },
  });

  const phaseSummary = savedPhases
    .map((p) => `${p.name} (${p.weekCount}w, ${p.workoutCount} workouts + ${p.restCount} rest)`)
    .join(", ");
  const finalText = `Your training plan is ready! ${phaseSummary}`;

  console.log(`[plan-v2] SUCCESS in ${Date.now() - flowT0}ms — ${phaseSummary}`);

  await prisma.coachMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: finalText,
    },
  });

  await prisma.coachConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return {
    success: true,
    response: finalText,
    phases: savedPhases,
  };
}

// ── Macro pass ────────────────────────────────────────────

/**
 * One small LLM call that designs the per-phase ramp. Returns null on any
 * failure so the caller falls back to the deterministic ramp.
 */
async function planPhases(args: {
  goalContext: string;
  phaseStructure: Array<{ name: string; weeks: number }>;
  currentVolumeKm: number;
  llmConfig: LlmConfig;
  signal?: AbortSignal;
}): Promise<PhasePlanPhase[] | null> {
  const { goalContext, phaseStructure, currentVolumeKm, llmConfig, signal } = args;

  const structureLines = phaseStructure
    .map((p) => `- ${p.name}: ${p.weeks} week${p.weeks > 1 ? "s" : ""}`)
    .join("\n");

  const systemPrompt = `You are an expert endurance coach. Design the phase structure of a training plan for the athlete below.

Output ONLY valid JSON (no markdown, no code fences): a single object with a "phases" array. Example:
{
  "phases": [
    { "name": "Base", "weeks": 4, "weeklyVolumeKm": [24, 26, 28, 30], "objective": "Build aerobic foundation and endurance base" }
  ]
}

${goalContext}

## Approved phase structure (names and weeks are fixed — match them exactly)
${structureLines}

Rules:
- One entry per phase; "name" and "weeks" MUST match the approved structure exactly.
- "weeklyVolumeKm" is an array of exactly "weeks" numbers — the target km for each week, in order.
- The ramp should progress sensibly across the whole plan toward the race goal, with cutback weeks at ~80% of the surrounding trend. Values must be positive.
- "objective": 5-10 word fitness objective for the phase.
- Base the volumes on the athlete's current volume (~${currentVolumeKm} km/wk), the race distance, and the target date above.`;

  const t0 = Date.now();
  const raw = await ask(
    systemPrompt,
    "Generate the phase plan JSON now. Output ONLY the JSON object. No other text.",
    {
      temperature: 0.2,
      maxTokens: 4096,
      jsonMode: true,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
      signal,
      thinking: "disabled",
    }
  );

  if (!raw) {
    console.error(
      `[plan-v2] macro pass FAILED in ${Date.now() - t0}ms (LLM returned null) — falling back to deterministic ramp`
    );
    return null;
  }

  try {
    const parsed = JSON.parse(sanitizeJsonText(raw));
    const phases = parsed.phases as PhasePlanPhase[] | undefined;
    const valid = validatePhasePlan(phases, phaseStructure);
    console.log(
      `[plan-v2] macro pass ${valid ? "OK" : "INVALID"} in ${Date.now() - t0}ms (${raw.length}ch, ${phases?.length ?? 0} phases)`
    );
    return valid ? phases : null;
  } catch {
    console.error(
      `[plan-v2] macro pass PARSE_FAILED in ${Date.now() - t0}ms (${raw.length}ch) — falling back to deterministic ramp`
    );
    return null;
  }
}

function validatePhasePlan(
  phases: PhasePlanPhase[] | undefined,
  structure: Array<{ name: string; weeks: number }>
): phases is PhasePlanPhase[] {
  if (!Array.isArray(phases) || phases.length !== structure.length) return false;
  const byName = new Map(phases.map((p) => [p.name, p]));
  for (const ps of structure) {
    const p = byName.get(ps.name);
    if (!p) return false;
    if (!Array.isArray(p.weeklyVolumeKm) || p.weeklyVolumeKm.length !== ps.weeks) return false;
    if (!p.weeklyVolumeKm.every((v) => typeof v === "number" && v > 0)) return false;
  }
  // Taper volume must not exceed peak volume.
  const taper = phases.find((p) => p.name === "Taper");
  const peak = phases.find((p) => p.name === "Peak");
  if (taper && peak) {
    const taperMax = Math.max(...taper.weeklyVolumeKm);
    const peakMax = Math.max(...peak.weeklyVolumeKm);
    if (taperMax > peakMax) return false;
  }
  return true;
}

// ── Deterministic fallback ramp ───────────────────────────

/**
 * Same formula as v1's startInterview (effectiveStartKm / effectivePeakKm),
 * distributed per week via linear interpolation across each phase.
 */
function computeDeterministicRamp(
  ctx: TrainingContext,
  primaryGoal: { distanceMeters: number },
  phaseStructure: Array<{ name: string; weeks: number }>
): Map<string, number[]> {
  const distanceKm = primaryGoal.distanceMeters ? primaryGoal.distanceMeters / 1000 : 0;
  const minimumVolumeKm = distanceKm > 0 ? Math.max(20, Math.round(distanceKm * 0.5)) : 20;
  const effectiveStartKm = Math.max(ctx.longTermVolumeKm, minimumVolumeKm);
  const peakMultiplier =
    distanceKm < 21 ? 1.5 : distanceKm < 42 ? 1.6 : distanceKm < 80 ? 1.7 : 2.0;
  const effectivePeakKm = Math.round(effectiveStartKm * peakMultiplier);
  const midKm = Math.round(effectiveStartKm + (effectivePeakKm - effectiveStartKm) * 0.6);

  const phaseVolumeStart: Record<string, number> = {
    Base: effectiveStartKm,
    Build: effectiveStartKm,
    Peak: midKm,
    Taper: effectivePeakKm,
  };
  const phaseVolumeEnd: Record<string, number> = {
    Base: effectiveStartKm,
    Build: midKm,
    Peak: effectivePeakKm,
    Taper: Math.round(effectivePeakKm * 0.5),
  };

  const ramp = new Map<string, number[]>();
  for (const ps of phaseStructure) {
    const start = phaseVolumeStart[ps.name] ?? effectiveStartKm;
    const end = phaseVolumeEnd[ps.name] ?? effectiveStartKm;
    const weeks = Math.max(1, ps.weeks);
    const vals: number[] = [];
    for (let wi = 0; wi < weeks; wi++) {
      const t = weeks === 1 ? 0 : wi / (weeks - 1);
      vals.push(Math.max(1, Math.round(start + (end - start) * t)));
    }
    ramp.set(ps.name, vals);
  }
  return ramp;
}

// ── Micro pass ────────────────────────────────────────────

/**
 * One LLM call that generates a single week's sessions. Returns the raw week
 * object (weekStart/weekNumber are forced server-side by the caller), or null
 * if both attempts fail.
 */
async function askForSingleWeek(args: {
  goalContext: string;
  phaseName: string;
  phaseOrder: number;
  phaseTotal: number;
  phaseGoal: string;
  weekNumber: number;
  weekStart: string;
  expectedKm: number;
  prevWeekSummary: string | null;
  peakVolumeHint?: string;
  llmConfig: LlmConfig;
  signal?: AbortSignal;
}): Promise<Record<string, unknown> | null> {
  const {
    goalContext,
    phaseName,
    phaseOrder,
    phaseTotal,
    phaseGoal,
    weekNumber,
    weekStart,
    expectedKm,
    prevWeekSummary,
    peakVolumeHint,
    llmConfig,
    signal,
  } = args;

  const systemPrompt = `You are a training-plan designer. Output ONLY valid JSON (no markdown, no code fences).

Generate a SINGLE week of daily sessions for the **${phaseName}** phase (phase ${phaseOrder} of ${phaseTotal}) of a training plan.

${goalContext}

## This Week's Requirements
- Phase: ${phaseName}
- Phase focus: ${phaseGoal}
- Week number: ${weekNumber}
- Week start: ${weekStart} (Monday — do NOT compute or adjust this date)
- Target weekly volume: ~${expectedKm} km
${prevWeekSummary ? `- Previous week's plan:\n${prevWeekSummary}` : "- This is week 1 — no previous week."}
${peakVolumeHint ? `- Target peak weekly volume: ${peakVolumeHint}` : ""}

Output a JSON object with exactly these fields:
{
  "weekNumber": ${weekNumber},
  "weekStart": "${weekStart}",
  "targetVolumeMeters": number (weekly volume in meters, ~${Math.round(expectedKm * 1000)}),
  "targetElevationMeters": number (optional),
  "coachNotes": "string — rationale for this week",
  "sessions": [
    {
      "dayOfWeek": 0-6 (0=Sun, 1=Mon ... 6=Sat),
      "type": "run" | "ride" | "swim" | "rest" | "workout" | "hike" | "other",
      "description": "Full workout details — pace zones, effort levels, duration, terrain cues, specific intervals",
      "targetDistance": number (meters, 0 for rest),
      "targetDuration": integer (seconds),
      "targetElevation": number (optional, meters)
    }
    // 7 sessions per week, one per day
  ]
}

Design rules:
- Include exactly one session per day (dayOfWeek 0-6, each used exactly once).
- Volume should land near the target (~${expectedKm} km total).
- Build on the previous week: progress sensibly, avoid repeating the same hard session back-to-back, include recovery after a big week.
- Include specific pace zones, effort levels, and terrain cues in descriptions.
- Rest days: type "rest", targetDistance 0, targetDuration 0.
- Include quality sessions appropriate for the ${phaseName} phase (${phaseGoal}).
- CRITICAL: Use the athlete's Training Context (terrain, schedule, constraints), Goals, Health, and Fatigue data above to tailor every session — do NOT generate generic workouts.
- Past days (before today) should still be included — the system skips them automatically.`;

  const run = async (
    prompt: string,
    temperature: number
  ): Promise<{ week: Record<string, unknown> | null; violation: string }> => {
    const t0 = Date.now();
    const raw = await ask(systemPrompt, prompt, {
      temperature,
      maxTokens: 4096,
      jsonMode: true,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
      signal,
      thinking: "disabled",
    });
    if (!raw) {
      console.error(
        `[plan-v2] week ${weekNumber}/${phaseName} LLM call FAILED (null) in ${Date.now() - t0}ms`
      );
      return { week: null, violation: "The LLM returned no response." };
    }
    const parsed = parseSingleWeek(raw);
    const ok = !parsed.violation && parsed.week;
    console.log(
      `[plan-v2] week ${weekNumber}/${phaseName} LLM call ${ok ? "OK" : "INVALID"} in ${Date.now() - t0}ms (${raw.length}ch)${parsed.violation ? ` — ${parsed.violation}` : ""}`
    );
    if (parsed.violation && parsed.week) {
      console.log(
        `[plan-v2] week ${weekNumber}/${phaseName} violating week: ${JSON.stringify(parsed.week).slice(0, 900)}`
      );
    }
    return parsed;
  };

  const first = await run(
    "Generate the week JSON now. Output ONLY the JSON object. No other text.",
    0.3
  );
  if (first.week && !first.violation) return first.week;

  const retry = await run(
    `Your previous response was rejected: ${first.violation}\nOutput ONLY a JSON object with exactly the fields above, fixing that problem. No other text.`,
    0.2
  );
  if (retry.week && !retry.violation) return retry.week;

  // Second attempt still failed. If the JSON parsed but only violated terrain
  // constraints, apply a deterministic repair so the plan survives. Malformed
  // JSON after both attempts still fails (nothing to repair).
  if (retry.week) {
    const repaired = repairWeekTerrain(retry.week);
    console.warn(
      `[plan-v2] week ${weekNumber}/${phaseName} terrain constraint violated after retry — applying deterministic repair.`
    );
    return repaired;
  }
  return null;
}

/**
 * Tolerant single-week parser: accepts a bare week object or a `{ weeks: [...] }`
 * wrapper; validates that `sessions` is a non-empty array with unique dayOfWeek
 * in 0-6, AND that the week respects the athlete's terrain/schedule constraints.
 *
 * Returns `{ week, violation }`: `week` is null on any problem (so the caller can
 * retry), and `violation` explains why — fed back into the retry prompt so the
 * model can fix the specific issue rather than guessing.
 */
function parseSingleWeek(raw: string): { week: Record<string, unknown> | null; violation: string } {
  const fail = (violation: string) => ({ week: null, violation });
  try {
    const parsed = JSON.parse(sanitizeJsonText(raw)) as Record<string, unknown>;
    // Tolerate a { weeks: [...] } wrapper around a single week.
    let week: unknown = parsed;
    if (parsed && Array.isArray(parsed.weeks)) {
      week = parsed.weeks[0] ?? parsed;
    }
    if (typeof week !== "object" || week === null) {
      return fail("The response wasn't valid JSON.");
    }
    const w = week as Record<string, unknown>;
    const sessions = w.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return fail("The response was missing a valid sessions array.");
    }
    const seen = new Set<number>();
    for (const s of sessions) {
      if (typeof s !== "object" || s === null) {
        return fail("The response contained a malformed session.");
      }
      const dow = (s as { dayOfWeek?: unknown }).dayOfWeek;
      if (typeof dow !== "number" || dow < 0 || dow > 6 || seen.has(dow)) {
        return fail(
          "The response had duplicate or out-of-range dayOfWeek values (need 0-6, each exactly once)."
        );
      }
      seen.add(dow);
    }
    const violation = checkTerrainConstraints(
      sessions as Array<{ dayOfWeek: number; type?: string; description?: string }>
    );
    // Terrain violations keep the parsed week so the caller can apply a
    // deterministic repair after the LLM fails to fix it itself.
    if (violation) return { week: w, violation };
    return { week: w, violation: "" };
  } catch {
    return fail("The response wasn't valid JSON.");
  }
}

/**
 * Terrain/schedule guard. The athlete's Training Context forbids trail running
 * on weekdays, so reject any week that schedules a trail run Mon-Thu, or a
 * non-Rollercoaster trail run on Friday. Trail runs on Sat/Sun pass through.
 */
function checkTerrainConstraints(
  sessions: Array<{ dayOfWeek: number; type?: string; description?: string }>
): string | null {
  const TRAIL_RE = /\b(trail|Eko Flora|Rollercoaster|Gunung Pulai|Sireh Park)\b/i;
  const ROLLERCOASTER_RE = /\brollercoaster\b/i;
  const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const s of sessions) {
    if (s.type !== "run") continue;
    const desc = s.description ?? "";
    if (!TRAIL_RE.test(desc)) continue;
    const dow = s.dayOfWeek;
    const snippet = desc.slice(0, 100);
    if (dow >= 1 && dow <= 4) {
      return `The ${DOW_LABEL[dow]} run was scheduled on trail terrain, but the athlete's Training Context forbids trail running on weekdays. Move trail sessions to Sat/Sun. Offending session: "${snippet}"`;
    }
    if (dow === 5 && !ROLLERCOASTER_RE.test(desc)) {
      return `The Friday run was scheduled on trail terrain, but the only weekday trail exception is the Friday-night Rollercoaster run. Move it to the weekend or make it a road run. Offending session: "${snippet}"`;
    }
  }
  return null;
}

/**
 * Last-resort repair for a week whose sessions still violate the terrain guard
 * after the LLM's retry. Keeps the plan generation alive instead of failing the
 * whole phase:
 *  1. Swap the offending weekday trail run with a non-trail weekend run (so the
 *     trail session lands on Sat/Sun where it's allowed, and the weekday gets the
 *     weekend's road/recovery run).
 *  2. If no clean weekend run exists to swap, rewrite the offending description
 *     from trail wording to road wording.
 */
function repairWeekTerrain(week: Record<string, unknown>): Record<string, unknown> {
  const TRAIL_RE = /\b(trail|Eko Flora|Rollercoaster|Gunung Pulai|Sireh Park)\b/i;
  const ROLLERCOASTER_RE = /\brollercoaster\b/i;
  const sessions = (week.sessions as Array<Record<string, unknown>>) ?? [];

  const isOffender = (s: Record<string, unknown>): boolean => {
    if (s.type !== "run") return false;
    const dow = s.dayOfWeek as number;
    const desc = String(s.description ?? "");
    if (!TRAIL_RE.test(desc)) return false;
    return (dow >= 1 && dow <= 4) || (dow === 5 && !ROLLERCOASTER_RE.test(desc));
  };

  const out = sessions.map((s) => ({ ...s }));
  const offenderIdx = out.findIndex(isOffender);
  if (offenderIdx === -1) return week;

  // Prefer to swap with a weekend (Sat/Sun) run that is NOT itself a trail run,
  // so the weekday slot gets a road/recovery run and the trail session moves to
  // the weekend where it's allowed.
  const weekendIdx = out.findIndex(
    (s, i) =>
      i !== offenderIdx &&
      s.type === "run" &&
      (s.dayOfWeek === 6 || s.dayOfWeek === 0) &&
      !TRAIL_RE.test(String(s.description ?? ""))
  );

  if (weekendIdx !== -1) {
    const offenderDow = out[offenderIdx].dayOfWeek;
    out[offenderIdx].dayOfWeek = out[weekendIdx].dayOfWeek;
    out[weekendIdx].dayOfWeek = offenderDow;
    return { ...week, sessions: out };
  }

  // No safe weekend swap — neutralize the trail wording to road on the weekday.
  out[offenderIdx].description = String(out[offenderIdx].description ?? "")
    .replace(/\b(Eko Flora|Gunung Pulai|Sireh Park|Rollercoaster)\b/gi, "neighbourhood streets")
    .replace(/\btrails?\b/gi, "roads");
  return { ...week, sessions: out };
}

/** Compact digest of a generated week's sessions, fed to the next week's call. */
function summarizeWeek(week: Record<string, unknown>): string {
  const sessions = (week.sessions as Array<Record<string, unknown>> | undefined) ?? [];
  if (sessions.length === 0) return "No sessions recorded.";
  const lines = sessions.map((s) => {
    const dist = typeof s.targetDistance === "number" ? `${Math.round(s.targetDistance)}m` : "";
    const desc = typeof s.description === "string" ? s.description.slice(0, 140) : "";
    return `  day ${s.dayOfWeek}: ${s.type}${dist ? `, ${dist}` : ""} — ${desc}`;
  });
  return lines.join("\n");
}
