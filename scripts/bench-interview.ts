/**
 * Benchmark the plan-interview (`startInterview`) bottleneck, isolating its two
 * phases without mutating conversation state:
 *   1. Data gathering: gatherTrainingContext + buildContextSummary (DB reads).
 *   2. The proposal LLM call: the SAME system prompt startInterview builds,
 *      timed with the current behavior (no thinking control → DeepSeek default
 *      high-effort thinking) vs `thinking: "disabled"`.
 *
 * Run from repo root:
 *   USER_ID=962f701b-a2d2-445e-b52b-873cf9948ea8 npx tsx scripts/bench-interview.ts
 */

import { ask, resolveUserLlmConfig, isLlmConfigured } from "../src/lib/llm";
import { gatherTrainingContext } from "../src/lib/training-context";
import { buildContextSummary } from "../src/lib/ai-coach";

const USER_ID = process.env.USER_ID || "";

async function main(): Promise<void> {
  // 1. Data gathering
  let t0 = Date.now();
  const ctx = await gatherTrainingContext(USER_ID);
  const ctxMs = Date.now() - t0;
  const contextStr = buildContextSummary(ctx, "en");
  console.log(`[bench] gatherTrainingContext: ${ctxMs}ms (ctx=${contextStr.length}ch, goals=${ctx.goals.length}, recentWeeks=${ctx.recentWeeks.length})`);

  // 2. Replicate startInterview's proposal prompt (ai-coach.ts ~782-821)
  const nearestGoal = ctx.goals[0];
  if (!nearestGoal) {
    console.log("[bench] no goals — interview would hit the no-goal guard, no LLM call. Done.");
    return;
  }
  const nowDate = new Date();
  const raceTargetDate = new Date(nearestGoal.targetDate);
  const diffMs = raceTargetDate.getTime() - nowDate.getTime();
  const totalWeeks = Math.max(1, Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)));
  const avgVolumeKm = ctx.longTermVolumeKm;
  const distanceKm = nearestGoal.distanceMeters ? nearestGoal.distanceMeters / 1000 : 0;
  const raceGoalName = `${nearestGoal.name}${distanceKm > 0 ? ` (${distanceKm.toFixed(0)}K)` : ""}`;

  const defaultStartDate = new Date(nowDate);
  const dayOfWeek = defaultStartDate.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
  defaultStartDate.setDate(defaultStartDate.getDate() + daysUntilMonday);
  const defaultStartStr = defaultStartDate.toISOString().split("T")[0];

  const systemPrompt = `You are an expert endurance coach. Based on the athlete's training data below, design a personalized training plan proposal.

Output JSON only, matching this schema:
{
  "summary": "2-3 sentence intro for the athlete — concise, welcoming, tells them what you've designed. Your response must also include a proposed start date below.",
  "proposal": {
    "totalWeeks": number of weeks from now until the nearest race goal,
    "raceGoalName": "name of the nearest race goal",
    "raceDate": "YYYY-MM-DD of the race",
    "currentVolume": "string like '~45 km/wk'",
    "peakVolume": "string like '~80 km/wk'",
    "proposedStartDate": "YYYY-MM-DD — default to ${defaultStartStr}",
    "phases": [
      { "name": "Base", "weeks": number, "focus": "5-10 words", "peakVolume": "volume string" },
      { "name": "Build", "weeks": number, "focus": "5-10 words", "peakVolume": "volume string" },
      { "name": "Peak", "weeks": number, "focus": "5-10 words", "peakVolume": "volume string" },
      { "name": "Taper", "weeks": number, "focus": "5-10 words", "peakVolume": "volume string" }
    ],
    "adjustments": ["1-3 notable deviations from a generic plan"]
  }
}

PHASE LENGTH RULES — base decisions on actual fitness (CTL, recent volume):
- BASE: 25-50% of weeks depending on experience/volume. Minimum 2.
- BUILD: 30-40% of weeks. Minimum 2.
- PEAK: 2-4 weeks. Minimum 1.
- TAPER: Marathon 2-3w, Ultra 1-2w, <21K 1w. Minimum 1.
- The sum of all phase weeks must equal totalWeeks (${totalWeeks}).

VOLUME NOTES: Current weekly volume average ~${avgVolumeKm} km/wk. peakVolume for each phase set by the system.

## Current Training Context
${contextStr}`;

  const proposalPrompt = "Design a training plan proposal for this athlete following the schema above. Consider their actual fitness data and training history when determining phase lengths and volumes.";

  const cfg = await resolveUserLlmConfig(USER_ID);
  if (!isLlmConfigured(cfg.apiKey, cfg.provider)) {
    console.error("[bench] LLM not configured");
    process.exit(2);
  }

  // 3a. Current behavior: no thinking control (DeepSeek default = high-effort thinking)
  t0 = Date.now();
  const current = await ask(systemPrompt, proposalPrompt, {
    temperature: 0.2,
    maxTokens: 8192,
    jsonMode: true,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
  });
  const currentMs = Date.now() - t0;
  console.log(`[bench] proposal LLM — current (default thinking): ${currentMs}ms ok=${!!current} len=${current?.length ?? 0}`);

  // 3b. Proposed fix: thinking disabled
  t0 = Date.now();
  const fixed = await ask(systemPrompt, proposalPrompt, {
    temperature: 0.2,
    maxTokens: 8192,
    jsonMode: true,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    thinking: "disabled",
  });
  const fixedMs = Date.now() - t0;
  console.log(`[bench] proposal LLM — thinking=disabled: ${fixedMs}ms ok=${!!fixed} len=${fixed?.length ?? 0}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
