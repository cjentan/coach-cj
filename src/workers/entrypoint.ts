/**
 * Background worker entrypoint.
 * Run with: node dist/workers/entrypoint.js (prod) or tsx src/workers/entrypoint.ts (dev)
 *
 * Starts the BullMQ workers that process:
 * 1. fatigue-monitor — runs daily fatigue detection for all users
 * 2. sunday-review — runs the weekly review + plan generator
 */
import { Queue, Worker, Job } from "bullmq";
import { getRedisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { computePMC } from "../lib/pmc";
import { detectFatigue } from "../lib/fatigue-detector";
import { generateWeeklyPlan } from "../lib/plan-generator";
import { getWeekStart, formatDistance, formatDuration } from "../lib/utils";
import { generateCoachNotes } from "../lib/coach-notes";
import { snapshotWeek } from "../lib/metrics-snapshot";

const connection = getRedisConnection();

// ─── Queues ─────────────────────────────────────────────
const fatigueQueue = new Queue("fatigue-monitor", { connection });
const sundayQueue = new Queue("sunday-review", { connection });

// ─── Fatigue Monitor Worker ─────────────────────────────
const fatigueWorker = new Worker(
  "fatigue-monitor",
  async () => {
    const users = await prisma.user.findMany({
      where: { trainingLogs: { some: {} } },
      include: { bodyMetrics: { orderBy: { recordedAt: "desc" }, take: 30 }, trainingLogs: { orderBy: { startDate: "desc" }, take: 90 } },
    });

    let alertsCreated = 0;

    for (const user of users) {
      const tssByDate: Record<string, number> = {};
      for (const log of user.trainingLogs) {
        const dateKey = log.startDate.toISOString().split("T")[0];
        tssByDate[dateKey] = (tssByDate[dateKey] || 0) + (log.tss || 50);
      }
      const pmcInput = Object.entries(tssByDate).map(([date, tss]) => ({ date, tss }));
      const pmcResults = computePMC(pmcInput);

      const dailyTss = Object.values(tssByDate);
      const restingHrHistory = user.bodyMetrics
        .filter((metric) => metric.restingHr)
        .map((metric) => ({ date: metric.recordedAt.toISOString().split("T")[0], value: metric.restingHr! }))
        .reverse();
      const weightHistory = user.bodyMetrics
        .map((metric) => ({ date: metric.recordedAt.toISOString().split("T")[0], weightKg: metric.weightKg }))
        .reverse();

      const result = detectFatigue({
        pmcResults,
        dailyTss: dailyTss.slice(-42),
        restingHrHistory,
        weightHistory,
        recentAvgHr: null,
        baselineAvgHr: null,
      });

      if (result.severity !== "low") {
        await prisma.fatigueAlert.create({
          data: {
            userId: user.id,
            severity: result.severity,
            signals: JSON.parse(JSON.stringify(result.signals)),
            recommendation: result.recommendation,
            recommendedRestDays: result.recommendedRestDays,
          },
        });
        alertsCreated++;
      }
    }

    return { usersChecked: users.length, alertsCreated };
  },
  { connection }
);

// ─── Sunday Review Worker ────────────────────────────────
const sundayWorker = new Worker(
  "sunday-review",
  async (job?: Job<{ userId?: string }>) => {
    const targetUserId = job?.data?.userId;
    const where = targetUserId
      ? { id: targetUserId, raceGoals: { some: { status: "active" as const } } }
      : { raceGoals: { some: { status: "active" as const } } };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        llmApiKey: true,
        llmBaseUrl: true,
        llmModel: true,
        llmProvider: true,
        raceGoals: { where: { status: "active" } },
        trainingAvailability: true,
        trainingFacilities: true,
        trainingLogs: { orderBy: { startDate: "desc" }, take: 100 },
        fatigueAlerts: { where: { acknowledged: false }, orderBy: { detectedAt: "desc" }, take: 1 },
      },
    });

    let plansCreated = 0;
    const weekStart = getWeekStart(new Date());
    weekStart.setDate(weekStart.getDate() + 7); // Next week's Monday

    for (const user of users) {
      // Aggregate weekly volumes (last 4 weeks)
      const now = Date.now();
      const weeklyVolumes: number[] = [];
      const weeklyElevations: number[] = [];
      const weeklyDurations: number[] = [];

      for (let w = 3; w >= 0; w--) {
        const start = new Date(now - (w + 1) * 7 * 86400000);
        const end = new Date(now - w * 7 * 86400000);
        const weekLogs = user.trainingLogs.filter(
          (entry) => entry.startDate >= start && entry.startDate < end
        );
        weeklyVolumes.push(weekLogs.reduce((s, logItem) => s + (logItem.distanceMeters || 0), 0));
        weeklyElevations.push(weekLogs.reduce((s, logItem) => s + (logItem.elevationGainMeters || 0), 0));
        weeklyDurations.push(weekLogs.reduce((s, logItem) => s + logItem.durationSeconds, 0));
      }

      const plan = generateWeeklyPlan({
        goals: user.raceGoals.map((g) => ({
          id: g.id,
          name: g.name,
          targetDate: g.targetDate,
          distanceMeters: g.distanceMeters,
          elevationGainMeters: g.elevationGainMeters,
          priority: g.priority,
        })),
        recentVolumeByWeek: weeklyVolumes,
        recentElevationByWeek: weeklyElevations,
        recentDurationByWeek: weeklyDurations,
        availability: user.trainingAvailability.map((a) => ({
          dayOfWeek: a.dayOfWeek,
          startTime: a.startTime,
          endTime: a.endTime,
          facilityIds: a.facilityIds,
        })),
        facilities: user.trainingFacilities.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          distanceMeters: f.distanceMeters,
          elevationGainMeters: f.elevationGainMeters,
        })),
        consistencyScore: 0.7,
        fatigueSeverity: user.fatigueAlerts[0]?.severity || null,
      });

      // ── LLM Coach Notes ──────────────────────────────────
      const weekLabels = [] as string[];
      for (let w = 3; w >= 0; w--) {
        const start = new Date(now - (w + 1) * 7 * 86400000);
        const end = new Date(now - w * 7 * 86400000);
        weekLabels.push(
          start.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        );
      }

      // Compute PMC for the user
      const tssByDate: Record<string, number> = {};
      for (const log of user.trainingLogs) {
        const dk = log.startDate.toISOString().split("T")[0];
        tssByDate[dk] = (tssByDate[dk] || 0) + (log.tss || 50);
      }
      const pmcInput = Object.entries(tssByDate).map(([date, tss]) => ({ date, tss }));
      const pmcResults = computePMC(pmcInput);
      const latestPmc = pmcResults[pmcResults.length - 1] || { ctl: 30, atl: 30, tsb: 0 };

      const coachNotes = await generateCoachNotes(
        {
          athleteName: user.name || "Athlete",
          goals: user.raceGoals.map((g) => ({
            name: g.name,
            targetDate: g.targetDate.toISOString().split("T")[0],
            distanceMeters: g.distanceMeters,
            elevationGainMeters: g.elevationGainMeters,
            priority: g.priority,
          })),
          recentWeeks: weekLabels.map((label, i) => ({
            label,
            volumeMeters: weeklyVolumes[i] || 0,
            elevationMeters: weeklyElevations[i] || 0,
            durationSeconds: weeklyDurations[i] || 0,
            activityCount: 0,
          })),
          currentWeek: {
            volumeMeters: weeklyVolumes[3] || 0,
            elevationMeters: weeklyElevations[3] || 0,
            durationSeconds: weeklyDurations[3] || 0,
            activityCount: 0,
          },
          pmc: {
          ctl: latestPmc.ctl,
          atl: latestPmc.atl,
          tsb: latestPmc.tsb,
          tsbTrend: latestPmc.tsb > (pmcResults[pmcResults.length - 8]?.tsb || latestPmc.tsb) ? "rising" : "falling",
        },
        fatigue: user.fatigueAlerts[0]
          ? { severity: user.fatigueAlerts[0].severity, signals: [] }
          : null,
        readinessScore: 50,
        volumeAdherence: plan.targetVolumeMeters > 0 ? Math.round((weeklyVolumes[3] / plan.targetVolumeMeters) * 100) : 0,
        elevationAdherence: plan.targetElevationMeters > 0 ? Math.round((weeklyElevations[3] / plan.targetElevationMeters) * 100) : 0,
        consistencyScore: 70,
        weeklyPlan: {
          targetVolumeMeters: plan.targetVolumeMeters,
          targetElevationMeters: plan.targetElevationMeters,
          plannedSessions: plan.plannedSessions.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            type: s.type,
            description: s.description,
            targetDistance: s.targetDistance,
            targetElevation: s.targetElevation,
          })),
          adjustments: plan.adjustments,
        },
        recentRemarks: user.trainingLogs
          .filter((entry) => entry.remarks)
          .slice(0, 10)
          .map((entry) => ({
            date: entry.startDate.toISOString().split("T")[0],
            activity: entry.name,
            remarks: entry.remarks!,
          })),
        facilities: user.trainingFacilities.map((f) => ({
          name: f.name,
          type: f.type,
          distanceMeters: f.distanceMeters,
          elevationGainMeters: f.elevationGainMeters,
          notes: f.notes,
        })),
      },
      {
        apiKey: user.llmApiKey ?? undefined,
        baseUrl: user.llmBaseUrl ?? undefined,
        model: user.llmModel ?? undefined,
        provider: user.llmProvider ?? undefined,
      }
    );

      await prisma.weeklyPlan.upsert({
        where: { userId_weekStartDate: { userId: user.id, weekStartDate: weekStart } },
        create: {
          userId: user.id,
          weekStartDate: weekStart,
          targetVolumeMeters: plan.targetVolumeMeters,
          targetElevationMeters: plan.targetElevationMeters,
          targetDurationSeconds: plan.targetDurationSeconds,
          plannedSessions: JSON.parse(JSON.stringify(plan.plannedSessions)),
          adjustments: plan.adjustments,
          trajectoryAssessment: plan.trajectoryAssessment,
          coachNotes,
        },
        update: {
          targetVolumeMeters: plan.targetVolumeMeters,
          targetElevationMeters: plan.targetElevationMeters,
          targetDurationSeconds: plan.targetDurationSeconds,
          plannedSessions: JSON.parse(JSON.stringify(plan.plannedSessions)),
          adjustments: plan.adjustments,
          trajectoryAssessment: plan.trajectoryAssessment,
          coachNotes,
          generatedAt: new Date(),
        },
      });

      plansCreated++;
    }

    return { usersChecked: users.length, plansCreated };
  },
  { connection }
);

// ─── Scheduler (simple in-process cron-like scheduling) ──
async function scheduleRecurring() {
  // Fatigue check daily at 6am
  setInterval(async () => {
    await fatigueQueue.add("check", {});
  }, 24 * 60 * 60 * 1000);

  // Per-user weekly review scheduler — checks every 10 minutes
  const processedReviews = new Set<string>(); // userId:weekStart to prevent duplicates

  setInterval(async () => {
    try {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const users = await prisma.user.findMany({
        where: { raceGoals: { some: { status: "active" } } },
        select: { id: true, reviewDayOfWeek: true, reviewTime: true },
      });

      for (const user of users) {
        if (user.reviewDayOfWeek !== dayOfWeek) continue;

        // Check if current time is within 10 min after the user's review time
        const [h, m] = user.reviewTime.split(":").map(Number);
        const reviewMinutes = h * 60 + m;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (nowMinutes < reviewMinutes || nowMinutes >= reviewMinutes + 10) continue;

        // Prevent duplicate runs this week
        const weekStart = getWeekStart(now);
        weekStart.setDate(weekStart.getDate() + 7); // next Monday
        const key = `${user.id}:${weekStart.toISOString().split("T")[0]}`;
        if (processedReviews.has(key)) continue;

        const existing = await prisma.weeklyPlan.findUnique({
          where: { userId_weekStartDate: { userId: user.id, weekStartDate: weekStart } },
        });
        if (existing) continue; // already generated

        await sundayQueue.add("review", { userId: user.id });
        processedReviews.add(key);
      }
    } catch (err) {
      console.error("Review scheduler error:", (err as Error).message);
    }
  }, 10 * 60 * 1000);

  console.log("⚡ Workers started: fatigue-monitor, sunday-review");
  console.log("   Fatigue check: daily at 6am");
  console.log("   Weekly review: per-user schedule, checked every 10min");
}

scheduleRecurring().catch(console.error);
