/**
 * Generates AI coaching analysis using the configured LLM.
 * Takes the same data the rule-based engine produces and generates
 * natural-language insights about training trajectory, fatigue, and recommendations.
 */
import { ask, isLlmConfigured } from "./llm";
import { formatDistance, formatDuration } from "./utils";

export interface CoachNotesInput {
  athleteName: string;
  goals: Array<{
    name: string;
    targetDate: string;
    distanceMeters: number;
    elevationGainMeters: number | null;
    priority: string;
    goalStatement?: string | null;
  }>;
  recentWeeks: Array<{
    label: string;
    volumeMeters: number;
    elevationMeters: number;
    durationSeconds: number;
    activityCount: number;
  }>;
  currentWeek: {
    volumeMeters: number;
    elevationMeters: number;
    durationSeconds: number;
    activityCount: number;
  };
  pmc: {
    ctl: number;
    atl: number;
    tsb: number;
    tsbTrend: string; // "rising" | "falling" | "stable"
  };
  fatigue: {
    severity: string;
    signals: Array<{ signal: string; value: number; threshold: number }>;
  } | null;
  readinessScore: number;
  volumeAdherence: number; // 0-100
  elevationAdherence: number; // 0-100
  consistencyScore: number; // 0-100
  weeklyPlan: {
    targetVolumeMeters: number;
    targetElevationMeters: number;
    plannedSessions: Array<{
      dayOfWeek: number;
      type: string;
      description: string;
      targetDistance: number | null;
      targetElevation: number | null;
    }>;
    adjustments: string[];
  } | null;
  recentRemarks?: Array<{ date: string; activity: string; remarks: string }>;
  facilities?: Array<{ name: string; type: string; distanceMeters: number | null; elevationGainMeters: number | null; notes: string | null }>;
  dailyHealth?: {
    sleepAvg: number;
    hrvAvg: number;
    bodyBatteryAvg: number;
    stressAvg: number;
    restingHrAvg: number;
    sleepScoreAvg: number | null;
    hrvStatus: string | null;
  };
}

const SYSTEM_PROMPT = `You are an expert endurance sports coach with deep knowledge of:
- Ultra running, trail running, marathons, triathlon, cycling
- The Performance Management Chart (PMC) model: CTL (fitness), ATL (fatigue), TSB (form)
- Periodization, training load progression, injury prevention
- Fatigue detection from HRV, resting HR, training monotony, TSB trends

Your role: analyze the athlete's training data and produce a concise, actionable coaching note.

Rules:
- Write in second person ("You...") directly to the athlete
- Be specific — reference exact numbers when relevant
- If things are going well, say so with genuine encouragement
- If there are concerns, be direct but constructive — always suggest what to change
- Keep it to 3-4 paragraphs max
- No fluff, no generic advice — every sentence should be data-grounded
- Mention the race goal by name when relevant
- If fatigue is elevated, make rest/recovery the primary message
- If the athlete's remarks mention tiredness, poor sleep, pain, or how they felt during specific portions of a session, reference those observations and connect them to the data
- Consider recovery quality indicated by HRV, sleep duration, body battery, and stress levels alongside training data — poor recovery metrics may warrant lighter training even if TSB looks fine
- When recommending sessions at specific facilities, incorporate the facility's characteristics (distance, elevation, surface type, any notes about the venue). For example, if Gunung Pulai is noted as a 4.5km tarmac climb with 550m gain, recommend it specifically for hill repeat workouts.

Structure your response:
1. Overall assessment (1-2 sentences)
2. What's working well (1-2 sentences)
3. What needs attention (1-2 sentences, grounded in the data)
4. Concrete recommendation for the coming week`;

function buildUserMessage(input: CoachNotesInput): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let msg = `## Athlete: ${input.athleteName}\n\n`;

  // Goals
  msg += "### Race Goals\n";
  for (const g of input.goals) {
    msg += `- ${g.name}: ${formatDistance(g.distanceMeters)}, ${g.elevationGainMeters ? formatDistance(g.elevationGainMeters) + " D+" : "flat"}, target ${g.targetDate}, priority ${g.priority}`;
    if (g.goalStatement) msg += `\n  Goal statement: "${g.goalStatement}"`;
    msg += "\n";
  }

  // Facilities
  if (input.facilities && input.facilities.length > 0) {
    msg += `\n### Available Training Facilities\n`;
    for (const f of input.facilities) {
      const dist = f.distanceMeters ? `, ${formatDistance(f.distanceMeters)}` : "";
      const elev = f.elevationGainMeters ? `, ${formatDistance(f.elevationGainMeters)} D+` : "";
      msg += `- ${f.name} (${f.type}${dist}${elev})`;
      if (f.notes) msg += ` — ${f.notes}`;
      msg += `\n`;
    }
  }

  // PMC stats
  msg += `\n### Current Fitness\n`;
  msg += `- CTL (Fitness): ${input.pmc.ctl}\n`;
  msg += `- ATL (Fatigue): ${input.pmc.atl}\n`;
  msg += `- TSB (Form): ${input.pmc.tsb} (${input.pmc.tsbTrend})\n`;
  msg += `- Readiness Score: ${input.readinessScore}/100\n`;

  // Weekly history
  msg += `\n### Last 4 Weeks\n`;
  for (const w of input.recentWeeks) {
    msg += `- ${w.label}: ${formatDistance(w.volumeMeters)}, ${formatDistance(w.elevationMeters)} D+, ${formatDuration(w.durationSeconds)}, ${w.activityCount} activities\n`;
  }

  // Current week
  msg += `\n### This Week\n`;
  msg += `- Volume: ${formatDistance(input.currentWeek.volumeMeters)} (${input.volumeAdherence}% of target)\n`;
  msg += `- Elevation: ${formatDistance(input.currentWeek.elevationMeters)} (${input.elevationAdherence}% of target)\n`;
  msg += `- Duration: ${formatDuration(input.currentWeek.durationSeconds)}\n`;
  msg += `- Activities: ${input.currentWeek.activityCount}\n`;
  msg += `- Consistency: ${input.consistencyScore}%\n`;

  // Fatigue
  if (input.fatigue) {
    msg += `\n### Fatigue Status: ${input.fatigue.severity.toUpperCase()}\n`;
    for (const s of input.fatigue.signals) {
      msg += `- ${s.signal}: ${s.value} (threshold: ${s.threshold})\n`;
    }
  } else {
    msg += `\n### Fatigue Status: LOW (no signals)\n`;
  }

  // Health metrics
  if (input.dailyHealth) {
    msg += `\n### Recent Health Metrics (7-day avg)\n`;
    msg += `- Sleep: ${input.dailyHealth.sleepScoreAvg != null ? `${input.dailyHealth.sleepScoreAvg}/100` : "N/A"} (${formatDuration(Math.round(input.dailyHealth.sleepAvg * 60))})\n`;
    msg += `- HRV: ${input.dailyHealth.hrvAvg}ms${input.dailyHealth.hrvStatus ? ` (${input.dailyHealth.hrvStatus})` : ""}\n`;
    msg += `- Body Battery: ${input.dailyHealth.bodyBatteryAvg}\n`;
    msg += `- Stress: ${input.dailyHealth.stressAvg}\n`;
    msg += `- Resting HR: ${input.dailyHealth.restingHrAvg} bpm\n`;
  }

  // Weekly plan
  if (input.weeklyPlan) {
    msg += `\n### Generated Plan for Next Week\n`;
    msg += `- Target volume: ${formatDistance(input.weeklyPlan.targetVolumeMeters)}\n`;
    msg += `- Target elevation: ${formatDistance(input.weeklyPlan.targetElevationMeters)}\n`;
    const sessions = input.weeklyPlan.plannedSessions.filter((s) => s.type !== "rest");
    msg += `- Scheduled sessions:\n`;
    for (const s of sessions) {
      const dist = s.targetDistance ? formatDistance(s.targetDistance) : "—";
      const vert = s.targetElevation ? formatDistance(s.targetElevation) : "—";
      msg += `  ${dayNames[s.dayOfWeek]} ● ${s.description}: ${dist}, ${vert} D+\n`;
    }
    if (input.weeklyPlan.adjustments.length > 0) {
      msg += `- Adjustments from last week:\n`;
      for (const a of input.weeklyPlan.adjustments) {
        msg += `  ${a}\n`;
      }
    }
  }

  // Recent remarks
  if (input.recentRemarks && input.recentRemarks.length > 0) {
    msg += `\n### Athlete's Recent Remarks\n`;
    msg += `The athlete has provided subjective feedback on recent sessions. Consider these in your analysis — they may indicate fatigue, motivation, or physical issues not visible in the metrics:\n`;
    for (const r of input.recentRemarks) {
      msg += `- ${r.date}: "${r.remarks}" [${r.activity}]\n`;
    }
  }

  msg += `\nWrite a coaching note for ${input.athleteName} based on this data.`;

  return msg;
}

export async function generateCoachNotes(
  input: CoachNotesInput,
  llmConfig?: { apiKey?: string; baseUrl?: string; model?: string; provider?: string }
): Promise<string | null> {
  if (!isLlmConfigured(llmConfig?.apiKey, llmConfig?.provider)) {
    console.log("LLM not configured — skipping AI coach notes");
    return null;
  }

  console.log(`Generating coach notes with ${llmConfig?.model || "unknown"}...`);
  const userMessage = buildUserMessage(input);

  const result = await ask(SYSTEM_PROMPT, userMessage, {
    temperature: 0.4,
    maxTokens: 800,
    apiKey: llmConfig?.apiKey,
    baseUrl: llmConfig?.baseUrl,
    model: llmConfig?.model,
  });

  if (result) {
    console.log(`Coach notes generated (${result.length} chars)`);
  } else {
    console.log("LLM returned no response — coach notes skipped");
  }

  return result;
}
