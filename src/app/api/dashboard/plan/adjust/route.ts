import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adjustPlan } from "@/lib/plan-adjuster";
import { getWeekStart } from "@/lib/utils";
import { resolveUserLlmConfig } from "@/lib/llm";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { prompt: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const prompt = body.prompt.trim();
  const now = new Date();
  const weekStart = getWeekStart(now);
  weekStart.setDate(weekStart.getDate() + 7); // next Monday

  // Fetch current plan
  const existingPlan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStartDate: { userId: session.user.id, weekStartDate: weekStart } },
  });

  if (!existingPlan || !existingPlan.plannedSessions) {
    return NextResponse.json(
      { error: "No plan exists for next week. Generate a plan first." },
      { status: 404 }
    );
  }

  const currentPlan = {
    weekStart: existingPlan.weekStartDate.toISOString(),
    targetVolumeMeters: existingPlan.targetVolumeMeters || 0,
    targetElevationMeters: existingPlan.targetElevationMeters || 0,
    plannedSessions: existingPlan.plannedSessions as Array<{
      dayOfWeek: number;
      type: string;
      description: string;
      targetDistance: number | null;
      targetElevation: number | null;
      targetDuration: number;
      facility: string | null;
    }>,
    adjustments: existingPlan.adjustments || [],
  };

  // Fetch context
  const [goals, trainingLogs, fatigueAlert, userCtx] = await Promise.all([
    prisma.raceGoal.findMany({ where: { userId: session.user.id, status: "active" } }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: new Date(now.getTime() - 28 * 86400000) }, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: { startDate: true, distanceMeters: true },
    }),
    prisma.fatigueAlert.findFirst({
      where: { userId: session.user.id, acknowledged: false },
      orderBy: { detectedAt: "desc" },
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { trainingContext: true } }),
  ]);

  // Weekly volumes for last 4 weeks
  const weeklyVolumes: number[] = [];
  for (let week = 3; week >= 0; week--) {
    const start = new Date(now.getTime() - (week + 1) * 7 * 86400000);
    const end = new Date(now.getTime() - week * 7 * 86400000);
    const wLogs = trainingLogs.filter((log) => log.startDate >= start && log.startDate < end);
    weeklyVolumes.push(wLogs.reduce((sum, log) => sum + (log.distanceMeters || 0), 0));
  }

  // Extract adjustment history
  const adjustmentHistory = (existingPlan.adjustmentHistory as Array<{
    timestamp: string;
    prompt: string;
    summary: string;
  }> | null) || [];

  // Load user's LLM config (falls back to server-default DeepSeek key)
  const llmCfg = await resolveUserLlmConfig(session.user.id);

  const result = await adjustPlan(
    currentPlan,
    prompt,
    {
      goals: goals.map((g) => ({
        name: g.name,
        targetDate: g.targetDate.toISOString().split("T")[0],
        distanceMeters: g.distanceMeters,
        elevationGainMeters: g.elevationGainMeters,
        priority: g.priority,
      })),
      trainingContext: userCtx?.trainingContext ?? undefined,
      fatigueSeverity: fatigueAlert?.severity || null,
      recentVolumeByWeek: weeklyVolumes,
      adjustmentHistory,
    },
    {
      apiKey: llmCfg.apiKey,
      baseUrl: llmCfg.baseUrl,
      model: llmCfg.model,
      provider: llmCfg.provider,
    }
  );

  if (!result) {
    return NextResponse.json(
      { error: "Plan adjustment failed. The AI coach may not be configured or is unavailable." },
      { status: 503 }
    );
  }

  // Build adjustment summary
  const summary =
    result.plan.explanation.length > 120
      ? result.plan.explanation.slice(0, 120) + "..."
      : result.plan.explanation;

  // Prepend user adjustment marker to adjustments array
  const updatedAdjustments = [
    `🔄 User adjustment: "${prompt.length > 80 ? prompt.slice(0, 80) + "..." : prompt}" — ${summary}`,
    ...result.plan.adjustments,
  ];

  // Save adjusted plan
  await prisma.weeklyPlan.upsert({
    where: { userId_weekStartDate: { userId: session.user.id, weekStartDate: weekStart } },
    create: {
      userId: session.user.id,
      weekStartDate: weekStart,
      targetVolumeMeters: result.plan.targetVolumeMeters,
      targetElevationMeters: result.plan.targetElevationMeters,
      targetDurationSeconds: result.plan.plannedSessions.reduce(
        (sum, s) => sum + s.targetDuration,
        0
      ),
      plannedSessions: JSON.parse(JSON.stringify(result.plan.plannedSessions)),
      adjustments: updatedAdjustments,
      trajectoryAssessment: existingPlan.trajectoryAssessment,
      overridesExisting: true,
      adjustmentHistory: [
        ...adjustmentHistory,
        {
          timestamp: now.toISOString(),
          prompt,
          summary,
        },
      ],
    },
    update: {
      targetVolumeMeters: result.plan.targetVolumeMeters,
      targetElevationMeters: result.plan.targetElevationMeters,
      targetDurationSeconds: result.plan.plannedSessions.reduce(
        (sum, s) => sum + s.targetDuration,
        0
      ),
      plannedSessions: JSON.parse(JSON.stringify(result.plan.plannedSessions)),
      adjustments: updatedAdjustments,
      overridesExisting: true,
      generatedAt: new Date(),
      adjustmentHistory: [
        ...adjustmentHistory,
        {
          timestamp: now.toISOString(),
          prompt,
          summary,
        },
      ],
    },
  });

  const targetDuration = result.plan.plannedSessions.reduce(
    (sum, s) => sum + s.targetDuration,
    0
  );

  return NextResponse.json({
    weekStart: weekStart.toISOString(),
    targetVolumeMeters: result.plan.targetVolumeMeters,
    targetElevationMeters: result.plan.targetElevationMeters,
    targetDurationSeconds: targetDuration,
    plannedSessions: result.plan.plannedSessions,
    adjustments: updatedAdjustments,
    trajectoryAssessment: existingPlan.trajectoryAssessment,
    explanation: result.plan.explanation,
    guardrailViolations: result.guardrailViolations,
    fromCache: false,
    overridesExisting: true,
  });
}
