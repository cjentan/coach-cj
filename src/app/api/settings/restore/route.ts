import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";

function uuid() {
  return crypto.randomUUID();
}

function buildIdMap(ids: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const oldId of ids) {
    map.set(oldId, uuid());
  }
  return map;
}

// Read a JSON file from the temp dir, return [] if missing
function readJson(dir: string, name: string): any[] {
  try {
    const raw = fs.readFileSync(path.join(dir, name), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Read a single JSON object, return null if missing
function readJsonSingle(dir: string, name: string): any {
  try {
    const raw = fs.readFileSync(path.join(dir, name), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function extractTarGz(buf: Buffer, destDir: string): Promise<void> {
  const tmpFile = path.join(destDir, "archive.tar.gz");
  fs.writeFileSync(tmpFile, buf);
  return new Promise((resolve, reject) => {
    execFile("tar", ["-xzf", tmpFile, "-C", destDir], { timeout: 300_000 }, (err) => {
      if (err) reject(err);
      else {
        try { fs.unlinkSync(tmpFile); } catch {}
        resolve();
      }
    });
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // ── 1. Extract tar.gz to temp directory ──────────────────────────────
  const tmpRoot = path.join(os.tmpdir(), "coach-restore");
  const tmpDir = path.join(tmpRoot, userId);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  let buf: Buffer;
  try {
    buf = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Unable to read backup file" }, { status: 400 });
  }

  try {
    await extractTarGz(buf, tmpDir);
  } catch {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return NextResponse.json({ error: "Invalid backup file: not a valid tar.gz archive" }, { status: 400 });
  }

  // ── 2. Read all data files ───────────────────────────────────────────
  const settings = readJsonSingle(tmpDir, "settings.json");
  const activities = readJson(tmpDir, "activities.json");
  const goals = readJson(tmpDir, "goals.json");
  const duplicateGroups = readJson(tmpDir, "duplicate_groups.json");
  const bodyMetrics = readJson(tmpDir, "body_metrics.json");
  const weeklyAssessments = readJson(tmpDir, "weekly_assessments.json");
  const weeklyPlans = readJson(tmpDir, "weekly_plans.json");
  const fatigueAlerts = readJson(tmpDir, "fatigue_alerts.json");
  const dailyHealth = readJson(tmpDir, "daily_health.json");
  const analysisReports = readJson(tmpDir, "analysis_reports.json");
  const apiKeys = readJson(tmpDir, "api_keys.json");
  const garminSession = readJsonSingle(tmpDir, "garmin_session.json");

  if (!settings) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return NextResponse.json({ error: "Invalid backup: missing settings.json" }, { status: 400 });
  }

  // ── 3. Read per-activity GPS data ────────────────────────────────────
  const activityDataDir = path.join(tmpDir, "activity_data");
  const rawJsonMap = new Map<string, any>();
  try {
    const files = fs.readdirSync(activityDataDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const activityId = file.replace(/\.json$/, "");
        const raw = fs.readFileSync(path.join(activityDataDir, file), "utf-8");
        rawJsonMap.set(activityId, JSON.parse(raw));
      }
    }
  } catch {
    // activity_data dir missing — fine, GPS data is optional
  }

  const counts: Record<string, number> = {};

  try {
    await prisma.$transaction(async (tx) => {
      // ── 4. Update user settings ─────────────────────────────────────
      if (settings?.user?.settings) {
        const s = settings.user.settings;
        await tx.user.update({
          where: { id: userId },
          data: {
            reviewDayOfWeek: s.reviewDayOfWeek ?? 0,
            reviewTime: s.reviewTime ?? "18:00",
            reviewDayOfMonth: s.reviewDayOfMonth ?? 1,
            analysisTrigger: s.analysisTrigger ?? "weekly",
            analysisTriggerValue: s.analysisTriggerValue ?? 1,
            trainingContext: s.trainingContext ?? null,
            llmProvider: s.llmProvider ?? null,
            llmBaseUrl: s.llmBaseUrl ?? null,
            llmModel: s.llmModel ?? null,
            llmApiKey: s.llmApiKey ?? null,
          },
        });
      }

      // ── 5. Clear existing user data ────────────────────────────────
      await tx.trainingLog.deleteMany({ where: { userId } });
      await tx.duplicateGroup.deleteMany({ where: { userId } });
      await tx.raceGoal.deleteMany({ where: { userId } });
      await tx.bodyMetric.deleteMany({ where: { userId } });
      await tx.weeklyAssessment.deleteMany({ where: { userId } });
      await tx.weeklyPlan.deleteMany({ where: { userId } });
      await tx.fatigueAlert.deleteMany({ where: { userId } });
      await tx.dailyHealth.deleteMany({ where: { userId } });
      await tx.analysisReport.deleteMany({ where: { userId } });
      await tx.apiKey.deleteMany({ where: { userId } });
      await tx.garminSession.deleteMany({ where: { userId } });

      // ── 6. Build ID maps for entities with foreign keys ──────────
      const duplicateGroupIdMap = buildIdMap(duplicateGroups.map((g: any) => g.id));
      const trainingLogIdMap = buildIdMap(activities.map((l: any) => l.id));

      // ── 7. Import DuplicateGroups ───────────────────────────────
      if (duplicateGroups.length > 0) {
        await tx.duplicateGroup.createMany({
          data: duplicateGroups.map((g: any) => ({
            id: duplicateGroupIdMap.get(g.id)!,
            userId,
            status: g.status,
            resolution: g.resolution ?? null,
            keptActivityId: g.keptActivityId ? (trainingLogIdMap.get(g.keptActivityId) ?? g.keptActivityId) : null,
            mergedAt: g.mergedAt ? new Date(g.mergedAt) : null,
            createdAt: new Date(g.createdAt),
          })),
        });
        counts.duplicateGroups = duplicateGroups.length;
      }

      // ── 9. Import TrainingLogs ───────────────────────────────────
      if (activities.length > 0) {
        await tx.trainingLog.createMany({
          data: activities.map((l: any) => ({
            id: trainingLogIdMap.get(l.id)!,
            userId,
            externalId: l.externalId ?? null,
            source: l.source,
            type: l.type,
            subType: l.subType ?? null,
            name: l.name,
            description: l.description ?? null,
            remarks: l.remarks ?? null,
            startDate: new Date(l.startDate),
            durationSeconds: l.durationSeconds,
            distanceMeters: l.distanceMeters ?? null,
            elevationGainMeters: l.elevationGainMeters ?? null,
            averageHr: l.averageHr ?? null,
            maxHr: l.maxHr ?? null,
            averagePower: l.averagePower ?? null,
            normalizedPower: l.normalizedPower ?? null,
            calories: l.calories ?? null,
            tss: l.tss ?? null,
            workoutType: l.workoutType ?? null,
            rawJson: rawJsonMap.get(l.id) ?? undefined,
            duplicateGroupId: l.duplicateGroupId ? (duplicateGroupIdMap.get(l.duplicateGroupId) ?? null) : null,
            duplicateStatus: l.duplicateStatus ?? null,
            mergedIntoId: l.mergedIntoId ? (trainingLogIdMap.get(l.mergedIntoId) ?? null) : null,
          })),
        });
        counts.trainingLogs = activities.length;
      }

      // ── 10. Import RaceGoals ─────────────────────────────────────
      if (goals.length > 0) {
        await tx.raceGoal.createMany({
          data: goals.map((g: any) => ({
            id: uuid(), userId,
            name: g.name, raceType: g.raceType,
            targetDate: new Date(g.targetDate), distanceMeters: g.distanceMeters,
            elevationGainMeters: g.elevationGainMeters ?? null,
            targetTimeSeconds: g.targetTimeSeconds ?? null,
            priority: g.priority, status: g.status,
            notes: g.notes ?? null, goalStatement: g.goalStatement ?? null,
            createdAt: new Date(g.createdAt), updatedAt: new Date(g.updatedAt),
          })),
        });
        counts.raceGoals = goals.length;
      }

      // ── 12. Import BodyMetrics ───────────────────────────────────
      if (bodyMetrics.length > 0) {
        await tx.bodyMetric.createMany({
          data: bodyMetrics.map((m: any) => ({
            id: uuid(), userId,
            recordedAt: new Date(m.recordedAt), weightKg: m.weightKg,
            heightCm: m.heightCm ?? null, restingHr: m.restingHr ?? null,
            notes: m.notes ?? null, createdAt: new Date(m.createdAt),
          })),
        });
        counts.bodyMetrics = bodyMetrics.length;
      }

      // ── 13. Import WeeklyAssessments ─────────────────────────────
      if (weeklyAssessments.length > 0) {
        await tx.weeklyAssessment.createMany({
          data: weeklyAssessments.map((a: any) => ({
            id: uuid(), userId,
            weekStartDate: new Date(a.weekStartDate),
            acuteTrainingLoad: a.acuteTrainingLoad ?? null,
            chronicTrainingLoad: a.chronicTrainingLoad ?? null,
            tsb: a.tsb ?? null, readinessScore: a.readinessScore ?? null,
            fitnessScore: a.fitnessScore ?? null, fatigueScore: a.fatigueScore ?? null,
            formScore: a.formScore ?? null,
            weeklyVolumeMeters: a.weeklyVolumeMeters ?? null,
            weeklyElevationMeters: a.weeklyElevationMeters ?? null,
            weeklyDurationSeconds: a.weeklyDurationSeconds ?? null,
            goalProgressPct: a.goalProgressPct ?? undefined,
            recommendations: a.recommendations ?? [],
            rawData: a.rawData ?? undefined,
            createdAt: new Date(a.createdAt),
          })),
        });
        counts.weeklyAssessments = weeklyAssessments.length;
      }

      // ── 15. Import WeeklyPlans ───────────────────────────────────
      if (weeklyPlans.length > 0) {
        await tx.weeklyPlan.createMany({
          data: weeklyPlans.map((p: any) => ({
            id: uuid(), userId,
            weekStartDate: new Date(p.weekStartDate),
            generatedAt: new Date(p.generatedAt),
            targetVolumeMeters: p.targetVolumeMeters ?? null,
            targetElevationMeters: p.targetElevationMeters ?? null,
            targetDurationSeconds: p.targetDurationSeconds ?? null,
            plannedSessions: p.plannedSessions,
            adjustments: p.adjustments ?? [],
            trajectoryAssessment: p.trajectoryAssessment ?? null,
            coachNotes: p.coachNotes ?? null,
            overridesExisting: p.overridesExisting ?? false,
            adjustmentHistory: p.adjustmentHistory ?? undefined,
            createdAt: new Date(p.createdAt),
          })),
        });
        counts.weeklyPlans = weeklyPlans.length;
      }

      // ── 16. Import FatigueAlerts ─────────────────────────────────
      if (fatigueAlerts.length > 0) {
        await tx.fatigueAlert.createMany({
          data: fatigueAlerts.map((a: any) => ({
            id: uuid(), userId,
            detectedAt: new Date(a.detectedAt),
            severity: a.severity,
            signals: a.signals ?? [],
            recommendation: a.recommendation,
            recommendedRestDays: a.recommendedRestDays ?? 0,
            acknowledged: a.acknowledged ?? false,
            createdAt: new Date(a.createdAt),
          })),
        });
        counts.fatigueAlerts = fatigueAlerts.length;
      }

      // ── 17. Import DailyHealth ───────────────────────────────────
      if (dailyHealth.length > 0) {
        await tx.dailyHealth.createMany({
          data: dailyHealth.map((h: any) => ({
            id: uuid(), userId,
            date: new Date(h.date),
            restingHeartRate: h.restingHeartRate ?? null,
            minHeartRate: h.minHeartRate ?? null,
            maxHeartRate: h.maxHeartRate ?? null,
            sleepSeconds: h.sleepSeconds ?? null,
            deepSleepSeconds: h.deepSleepSeconds ?? null,
            lightSleepSeconds: h.lightSleepSeconds ?? null,
            remSleepSeconds: h.remSleepSeconds ?? null,
            awakeSeconds: h.awakeSeconds ?? null,
            sleepScore: h.sleepScore ?? null,
            sleepStartLocal: h.sleepStartLocal ?? null,
            sleepEndLocal: h.sleepEndLocal ?? null,
            bodyBatteryMin: h.bodyBatteryMin ?? null,
            bodyBatteryMax: h.bodyBatteryMax ?? null,
            avgStress: h.avgStress ?? null,
            maxStress: h.maxStress ?? null,
            hrvBalance: h.hrvBalance ?? null,
            hrvStatus: h.hrvStatus ?? null,
            overnightHrv: h.overnightHrv ?? null,
            steps: h.steps ?? null,
            stepGoal: h.stepGoal ?? null,
            rawData: h.rawData ?? undefined,
          })),
        });
        counts.dailyHealth = dailyHealth.length;
      }

      // ── 18. Import AnalysisReports ───────────────────────────────
      if (analysisReports.length > 0) {
        await tx.analysisReport.createMany({
          data: analysisReports.map((r: any) => ({
            id: uuid(), userId,
            reportType: r.reportType,
            triggeredBy: r.triggeredBy,
            inputSnapshot: r.inputSnapshot ?? undefined,
            outputContent: r.outputContent ?? null,
            reasoning: r.reasoning ?? undefined,
            metrics: r.metrics ?? undefined,
            createdAt: new Date(r.createdAt),
          })),
        });
        counts.analysisReports = analysisReports.length;
      }

      // ── 19. Import ApiKeys ────────────────────────────────────────
      if (apiKeys.length > 0) {
        await tx.apiKey.createMany({
          data: apiKeys.map((k: any) => ({
            id: uuid(), userId,
            name: k.name,
            keyHash: k.keyHash,
            keyPrefix: k.keyPrefix,
            lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt) : null,
            createdAt: new Date(k.createdAt),
          })),
        });
        counts.apiKeys = apiKeys.length;
      }

      // ── 20. Import GarminSession ─────────────────────────────────
      if (garminSession) {
        await tx.garminSession.create({
          data: {
            id: uuid(), userId,
            oauth1Token: garminSession.oauth1Token,
            oauth2Token: garminSession.oauth2Token,
            displayName: garminSession.displayName ?? null,
            garminUserId: garminSession.garminUserId ?? null,
            lastSyncAt: garminSession.lastSyncAt ? new Date(garminSession.lastSyncAt) : null,
            lastHealthSyncAt: garminSession.lastHealthSyncAt ? new Date(garminSession.lastHealthSyncAt) : null,
            connectedAt: new Date(garminSession.connectedAt),
            createdAt: new Date(garminSession.createdAt),
            updatedAt: new Date(garminSession.updatedAt),
          },
        });
        counts.garminSession = 1;
      }
    });

    return NextResponse.json({ success: true, counts });
  } catch (error) {
    console.error("Restore failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error during restore";
    return NextResponse.json({ error: `Restore failed: ${message}` }, { status: 500 });
  } finally {
    // Always clean up temp directory
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
