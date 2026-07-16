/**
 * Background worker entrypoint.
 * Run with: node dist/workers/entrypoint.js (prod) or tsx src/workers/entrypoint.ts (dev)
 *
 * Starts the BullMQ workers that process:
 * 1. fatigue-monitor — runs daily fatigue detection for all users
 * 2. sunday-review — runs the weekly review + plan generator (uses ai-coach for LLM)
 * 3. garmin-sync — syncs activities + health from Garmin Connect
 * 4. coros-sync — syncs activities from COROS Training Hub
 */
import { Queue, Worker, Job } from "bullmq";
import { getRedisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { computePMC } from "../lib/pmc";
import { detectFatigue } from "../lib/fatigue-detector";
import { generateWeeklyPlan } from "../lib/plan-generator";
import { getWeekStart } from "../lib/utils";
import { analyze } from "../lib/ai-coach";
import { getGarminClient, syncGarminActivities, syncGarminHealthData } from "../lib/garmin";
import { getCorosClient, syncCorosActivities } from "../lib/coros";

const connection = getRedisConnection();

// ─── Queues ─────────────────────────────────────────────
const fatigueQueue = new Queue("fatigue-monitor", { connection });
const sundayQueue = new Queue("sunday-review", { connection });
const garminQueue = new Queue("garmin-sync", { connection });
const corosQueue = new Queue("coros-sync", { connection });

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
        raceGoals: { where: { status: "active" } },
        trainingLogs: { orderBy: { startDate: "desc" }, take: 100 },
        fatigueAlerts: { where: { acknowledged: false }, orderBy: { detectedAt: "desc" }, take: 1 },
      },
    });

    let plansCreated = 0;
    const weekStart = getWeekStart(new Date());
    weekStart.setDate(weekStart.getDate() + 7); // Next week's Monday

    for (const user of users) {
      // Aggregate weekly volumes (last 4 weeks) — needed for the rule-based plan generator
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

      // 1. Generate rule-based plan for next week
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
        consistencyScore: 0.7,
        fatigueSeverity: user.fatigueAlerts[0]?.severity || null,
      });

      // 2. Save plan to DB (needed before ai-coach can read it from context)
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
        },
        update: {
          targetVolumeMeters: plan.targetVolumeMeters,
          targetElevationMeters: plan.targetElevationMeters,
          targetDurationSeconds: plan.targetDurationSeconds,
          plannedSessions: JSON.parse(JSON.stringify(plan.plannedSessions)),
          adjustments: plan.adjustments,
          trajectoryAssessment: plan.trajectoryAssessment,
          generatedAt: new Date(),
        },
      });

      // 3. Unified AI Coach analysis — handles LLM call, conversation creation,
      //    structured suggestions, legacy notes persistence, and analysis report.
      //    Reads the plan from the DB via gatherTrainingContext().
      try {
        // Archive any active conversation so analyze() creates a fresh one
        await prisma.coachConversation.updateMany({
          where: { userId: user.id, status: "active" },
          data: { status: "archived" },
        }).catch(() => {});

        const result = await analyze(user.id);

        if ("analysis" in result) {
          // Copy analysis text to next week's plan's coachNotes
          await prisma.weeklyPlan.update({
            where: { userId_weekStartDate: { userId: user.id, weekStartDate: weekStart } },
            data: { coachNotes: result.analysis, generatedAt: new Date() },
          }).catch(() => {});

          console.log(`[sunday-review] User ${user.id}: analysis done (${result.analysis.length} chars, ${result.suggestions.length} suggestions)`);
        } else {
          console.log(`[sunday-review] User ${user.id}: AI coach unavailable (${result.code})`);
        }
      } catch (err) {
        console.error(`[sunday-review] User ${user.id}: AI coach error:`, (err as Error).message);
      }

      plansCreated++;
    }

    return { usersChecked: users.length, plansCreated };
  },
  { connection }
);

// ─── Garmin Sync Worker ─────────────────────────────────
const garminWorker = new Worker(
  "garmin-sync",
  async () => {
    const users = await prisma.garminSession.findMany({
      select: { userId: true },
    });

    let activitiesImported = 0;
    let healthDaysSynced = 0;
    let errors = 0;

    for (const { userId } of users) {
      try {
        const client = await getGarminClient(userId);
        if (!client) {
          console.log(`[garmin-sync] User ${userId}: no valid session, skipping`);
          continue;
        }

        const [a, h] = await Promise.all([
          syncGarminActivities(client, userId, false, 90).catch((e) => {
            console.error(`[garmin-sync] activities error for ${userId}:`, e.message);
            return 0;
          }),
          syncGarminHealthData(client, userId).catch((e) => {
            console.error(`[garmin-sync] health error for ${userId}:`, e.message);
            return 0;
          }),
        ]);

        activitiesImported += a;
        healthDaysSynced += h;
        console.log(`[garmin-sync] User ${userId}: ${a} activities, ${h} health days`);
      } catch (err) {
        errors++;
        console.error(`[garmin-sync] User ${userId}:`, (err as Error).message);
      }
    }

    return { usersChecked: users.length, activitiesImported, healthDaysSynced, errors };
  },
  { connection }
);

// ─── COROS Sync Worker ─────────────────────────────────
const corosWorker = new Worker(
  "coros-sync",
  async () => {
    const users = await prisma.corosSession.findMany({
      select: { userId: true },
    });

    let activitiesImported = 0;
    let errors = 0;

    for (const { userId } of users) {
      try {
        const client = await getCorosClient(userId);
        if (!client) {
          console.log(`[coros-sync] User ${userId}: no valid session, skipping`);
          continue;
        }

        const a = await syncCorosActivities(client, userId, false).catch(
          (e) => {
            console.error(`[coros-sync] activities error for ${userId}:`, e.message);
            return 0;
          }
        );

        activitiesImported += a;
        console.log(`[coros-sync] User ${userId}: ${a} activities`);
      } catch (err) {
        errors++;
        console.error(`[coros-sync] User ${userId}:`, (err as Error).message);
      }
    }

    return { usersChecked: users.length, activitiesImported, errors };
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

      const users = await prisma.user.findMany({
        where: { raceGoals: { some: { status: "active" } } },
        select: { id: true, reviewDayOfWeek: true, reviewTime: true, reviewDayOfMonth: true, analysisTrigger: true, analysisTriggerValue: true },
      });

      for (const user of users) {
        const trigger = user.analysisTrigger || "weekly";

        // Weekly: check review day and time
        if (trigger === "weekly") {
          if (user.reviewDayOfWeek !== dayOfWeek) continue;
          const [h, m] = user.reviewTime.split(":").map(Number);
          const reviewMinutes = h * 60 + m;
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          if (nowMinutes < reviewMinutes || nowMinutes >= reviewMinutes + 10) continue;
        }
        // Daily: run every day at the user's review time
        else if (trigger === "daily") {
          const [h, m] = user.reviewTime.split(":").map(Number);
          const reviewMinutes = h * 60 + m;
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          if (nowMinutes < reviewMinutes || nowMinutes >= reviewMinutes + 10) continue;
        }
        // Monthly: run on the configured day of the month at the user's review time
        else if (trigger === "monthly") {
          const dayOfMonth = user.reviewDayOfMonth || 1;
          if (now.getDate() !== dayOfMonth) continue;
          const [h, m] = user.reviewTime.split(":").map(Number);
          const reviewMinutes = h * 60 + m;
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          if (nowMinutes < reviewMinutes || nowMinutes >= reviewMinutes + 10) continue;
        }
        // activity_count: skip — handled at activity creation time
        else if (trigger === "activity_count") {
          continue;
        }
        // every_n_days: check if N days have passed since last analysis
        else if (trigger === "every_n_days") {
          const key = `${user.id}:every_n_days`;
          if (processedReviews.has(key)) continue;

          const daysBetween = user.analysisTriggerValue || 7;
          const lastReport = await prisma.analysisReport.findFirst({
            where: { userId: user.id, reportType: "coach_notes" },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          if (lastReport) {
            const daysSince = (now.getTime() - lastReport.createdAt.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince < daysBetween) continue;
          }

          await sundayQueue.add("review", { userId: user.id });
          processedReviews.add(key);
          continue;
        }

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

  // Garmin sync every 4 hours
  setInterval(async () => {
    await garminQueue.add("sync", {});
  }, 4 * 60 * 60 * 1000);

  // COROS sync every 4 hours
  setInterval(async () => {
    await corosQueue.add("sync", {});
  }, 4 * 60 * 60 * 1000);

  console.log("⚡ Workers started: fatigue-monitor, sunday-review, garmin-sync, coros-sync");
  console.log("   Fatigue check: daily at 6am");
  console.log("   Weekly review: per-user schedule, checked every 10min");
  console.log("   Garmin sync: every 4 hours");
  console.log("   COROS sync: every 4 hours");
}

scheduleRecurring().catch(console.error);
