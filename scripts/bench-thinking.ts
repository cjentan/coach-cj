/**
 * Compare DeepSeek thinking modes on the same JSON-generation task, measuring
 * TRUE wall-clock time (including response body download — the [llm] log's
 * "OK in Xms" only captures time-to-headers, which under-reports badly).
 *
 * Run: npx tsx scripts/bench-thinking.ts
 */

import { ask, resolveUserLlmConfig, isLlmConfigured } from "../src/lib/llm";

const SYSTEM = `You are a training-plan designer. Output ONLY valid JSON (no markdown, no code fences).

Generate a SINGLE week of daily sessions for the **Base** phase of a training plan for an ultra-trail runner.

Athlete context:
- Goal: "100km Ultra Trail Marathon" (100.0K), target 2027-01-06, 22 weeks out
- Current volume: ~78 km/wk, CTL 97.7, ATL 61.9, TSB 35.8
- Trains on road in neighbourhood + trainer on MyWhoosh weekdays; trail running strictly weekends; long runs Wednesday evenings
- Recent 4 weeks: 118.9, 32.2, 56.2, 49.0 km
- Fatigue: none. Health: sleep 396min, HRV 29ms, RHR 52bpm

## This Week
- Week number: 1, target ~24 km, week start 2026-08-10

Output a JSON object with exactly: "weekNumber", "weekStart", "targetVolumeMeters", "targetElevationMeters", "coachNotes", "sessions" (7 sessions, one per day, dayOfWeek 0-6 each exactly once, type run/ride/swim/rest/workout/hike/other, description with pace zones and terrain cues, targetDistance meters, targetDuration seconds, targetElevation optional).`;

async function timeIt(label: string, thinking: "low" | "disabled"): Promise<void> {
  const cfg = await resolveUserLlmConfig(process.env.USER_ID || "x");
  if (!isLlmConfigured(cfg.apiKey, cfg.provider)) {
    console.error("LLM not configured");
    process.exit(2);
  }
  const t0 = Date.now();
  const raw = await ask(SYSTEM, "Generate the week JSON now. Output ONLY the JSON object. No other text.", {
    temperature: 0.3,
    maxTokens: 4096,
    jsonMode: true,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    thinking,
  });
  const dur = Date.now() - t0;
  console.log(`[think] ${label}: ${dur}ms  content=${raw?.length ?? 0}ch  ok=${!!raw}`);
}

async function main(): Promise<void> {
  await timeIt("thinking=low      (current v2)", "low");
  await timeIt("thinking=disabled (candidate)", "disabled");
}

main().catch((e) => { console.error(e); process.exit(1); });
