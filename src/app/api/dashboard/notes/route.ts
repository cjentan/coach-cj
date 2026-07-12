import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart } from "@/lib/utils";
import { generateCoachNotes } from "@/lib/coach-notes";
import { computePMC } from "@/lib/pmc";
import { computeReadiness } from "@/lib/metrics-snapshot";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Return the latest saved coach notes with timestamp
  const latest = await prisma.weeklyPlan.findFirst({
    where: { userId: session.user.id, coachNotes: { not: null } },
    orderBy: { generatedAt: "desc" },
    select: { coachNotes: true, generatedAt: true },
  });

  if (!latest) {
    return NextResponse.json({ coachNotes: null, generatedAt: null });
  }

  return NextResponse.json({
    coachNotes: latest.coachNotes,
    generatedAt: latest.generatedAt.toISOString(),
  });
}

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const weekStart = getWeekStart(now);

  // Collect data for coach notes
  const [logs, goals, bodyMetrics, facilities, availabilityCount] = await Promise.all([
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: new Date(now.getTime() - 90 * 86400000) }, mergedIntoId: null },
      orderBy: { startDate: "asc" },
      select: { startDate: true, name: true, type: true, distanceMeters: true, elevationGainMeters: true, durationSeconds: true, tss: true, remarks: true },
    }),
    prisma.raceGoal.findMany({ where: { userId: session.user.id, status: "active" } }),
    prisma.bodyMetric.findMany({ where: { userId: session.user.id }, orderBy: { recordedAt: "desc" }, take: 7 }),
    prisma.trainingFacility.findMany({ where: { userId: session.user.id } }),
    prisma.trainingAvailability.count({ where: { userId: session.user.id } }),
  ]);

  // PMC computation
  const tssByDate: Record<string, number> = {};
  for (const log of logs) {
    const dateKey = log.startDate.toISOString().split("T")[0];
    tssByDate[dateKey] = (tssByDate[dateKey] || 0) + (log.tss || 50);
  }
  const pmcInput = Object.entries(tssByDate).map(([date, tss]) => ({ date, tss }));
  const pmcResults = computePMC(pmcInput);
  const latestPmc = pmcResults[pmcResults.length - 1] || { ctl: 30, atl: 30, tsb: 0 };

  // Weekly aggregates for last 4 weeks
  const weeklyVolumes: number[] = [];
  for (let week = 3; week >= 0; week--) {
    const start = new Date(now.getTime() - (week + 1) * 7 * 86400000);
    const end = new Date(now.getTime() - week * 7 * 86400000);
    const wLogs = logs.filter((log) => log.startDate >= start && log.startDate < end);
    weeklyVolumes.push(wLogs.reduce((sum, log) => sum + (log.distanceMeters || 0), 0));
  }

  const weekLogs = logs.filter((log) => log.startDate >= weekStart);
  const weeklyVolume = weekLogs.reduce((sum, log) => sum + (log.distanceMeters || 0), 0);
  const weeklyDuration = weekLogs.reduce((sum, log) => sum + log.durationSeconds, 0);
  const weeklyElevation = weekLogs.reduce((sum, log) => sum + (log.elevationGainMeters || 0), 0);
  const weeklyTss = Math.round(weekLogs.reduce((sum, log) => sum + (log.tss || 50), 0));

  // Compute real readiness score using the same algorithm as the dashboard
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const readinessResult = computeReadiness({
    weekLogs,
    weekStart,
    weekEnd,
    goals,
    availabilityCount,
    weeklyVolume,
    weeklyTss,
  });

  // Compute TSB trend from PMC results
  let tsbTrend = "stable";
  if (pmcResults.length >= 2) {
    const prevTsb = pmcResults[pmcResults.length - 2].tsb;
    const currTsb = latestPmc.tsb;
    if (currTsb - prevTsb > 0.5) tsbTrend = "rising";
    else if (currTsb - prevTsb < -0.5) tsbTrend = "falling";
  }

  const weekLabels: string[] = [];
  for (let week = 3; week >= 0; week--) {
    const start = new Date(now.getTime() - (week + 1) * 7 * 86400000);
    weekLabels.push(start.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  }

  const recentRemarks = logs
    .filter((log) => log.remarks)
    .slice(-10)
    .map((log) => ({
      date: log.startDate.toISOString().split("T")[0],
      activity: log.name,
      remarks: log.remarks!,
    }));

  // Load user's LLM config for per-user API key support
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { llmApiKey: true, llmBaseUrl: true, llmModel: true, llmProvider: true },
  });

  const coachNotes = await generateCoachNotes(
    {
      athleteName: session.user.name || "Athlete",
      goals: goals.map((goal) => ({
        name: goal.name,
        targetDate: goal.targetDate.toISOString().split("T")[0],
        distanceMeters: goal.distanceMeters,
        elevationGainMeters: goal.elevationGainMeters,
        priority: goal.priority,
      })),
      recentWeeks: weekLabels.map((label, idx) => ({
        label,
        volumeMeters: weeklyVolumes[idx] || 0,
        elevationMeters: 0,
        durationSeconds: 0,
        activityCount: 0,
      })),
      currentWeek: {
        volumeMeters: weeklyVolume,
        elevationMeters: weeklyElevation,
        durationSeconds: weeklyDuration,
        activityCount: weekLogs.length,
      },
      pmc: {
        ctl: latestPmc.ctl,
        atl: latestPmc.atl,
        tsb: latestPmc.tsb,
        tsbTrend,
      },
      fatigue: null,
      readinessScore: readinessResult.readinessScore,
      volumeAdherence: readinessResult.volumeAdherence,
      elevationAdherence: 50,
      consistencyScore: readinessResult.consistency,
      weeklyPlan: null,
      recentRemarks,
      facilities: facilities.map((f) => ({
        name: f.name,
        type: f.type,
        distanceMeters: f.distanceMeters,
        elevationGainMeters: f.elevationGainMeters,
        notes: f.notes,
      })),
    },
    {
      apiKey: user?.llmApiKey ?? undefined,
      baseUrl: user?.llmBaseUrl ?? undefined,
      model: user?.llmModel ?? undefined,
      provider: user?.llmProvider ?? undefined,
    }
  );

  // Save to the current week's WeeklyPlan so it persists across page loads
  if (coachNotes) {
    await prisma.weeklyPlan.upsert({
      where: { userId_weekStartDate: { userId: session.user.id, weekStartDate: weekStart } },
      create: {
        userId: session.user.id,
        weekStartDate: weekStart,
        coachNotes,
        plannedSessions: [],
        adjustments: [],
      },
      update: {
        coachNotes,
        generatedAt: now,
      },
    });
  }

  return NextResponse.json({
    coachNotes: coachNotes || "LLM returned no response. Check that the model is running.",
    generatedAt: coachNotes ? now.toISOString() : null,
  });
}
