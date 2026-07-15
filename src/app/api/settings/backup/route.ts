import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "data", "backups");

export const dynamic = "force-dynamic";

// ── GET: check backup status ────────────────────────────────────────────
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const dataFile = path.join(BACKUP_DIR, `${userId}.tar.gz`);
  const statusFile = path.join(BACKUP_DIR, `${userId}.status.json`);

  let status: string = "idle";
  let statusError: string | null = null;
  try {
    const raw = fs.readFileSync(statusFile, "utf-8");
    const parsed = JSON.parse(raw);
    status = parsed.status ?? "idle";
    statusError = parsed.error ?? null;
  } catch { /* first time */ }

  let size: number | null = null;
  let timestamp: string | null = null;
  try {
    const stat = fs.statSync(dataFile);
    size = stat.size;
    timestamp = stat.mtime.toISOString();
  } catch {
    if (status === "ready") status = "idle";
  }

  return NextResponse.json({
    available: status === "ready",
    running: status === "running",
    error: statusError,
    timestamp,
    size,
  });
}

// ── POST: trigger a background backup ──────────────────────────────────
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const statusFile = path.join(BACKUP_DIR, `${userId}.status.json`);

  try {
    const raw = fs.readFileSync(statusFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.status === "running") {
      return NextResponse.json({ status: "already_running" }, { status: 409 });
    }
  } catch { /* proceed */ }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(statusFile, JSON.stringify({ status: "running" }));

  performBackup(userId, statusFile).catch((err) => {
    console.error("Background backup failed:", err);
    try {
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        }),
      );
    } catch {}
  });

  return NextResponse.json({ status: "started" });
}

// ── Helpers ─────────────────────────────────────────────────────────────

function writeJson(dir: string, name: string, data: any) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), "utf-8");
}

async function tarCzF(outputFile: string, sourceDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("tar", ["-czf", outputFile, "-C", sourceDir, "."], { timeout: 300_000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Load rawJson for activity IDs in small batches to stay within NAPI bridge limits.
async function loadRawJsonBatched(ids: string[], batchSize = 5): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, raw_json AS "rawJson" FROM training_logs
       WHERE id = ANY($1::text[])`,
      batch,
    );
    for (const row of rows) {
      map.set(row.id, row.rawJson);
    }
  }
  return map;
}

// ── Background backup logic ─────────────────────────────────────────────
async function performBackup(userId: string, statusFile: string) {
  // Per-user temp directory to prevent cross-contamination
  const tmpRoot = path.join(os.tmpdir(), "coach-backup");
  const tmpDir = path.join(tmpRoot, userId);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, "activity_data"), { recursive: true });

  const dataFile = path.join(BACKUP_DIR, `${userId}.tar.gz`);

  // ── 1. Fetch all data ──────────────────────────────────────────────────
  const [
    user,
    logs,
    duplicateGroups,
    raceGoals,
    trainingFacilities,
    bodyMetrics,
    trainingAvailability,
    weeklyAssessments,
    weeklyPlans,
    fatigueAlerts,
    dailyHealth,
    analysisReports,
    apiKeys,
    garminSession,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        reviewDayOfWeek: true,
        reviewTime: true,
        analysisTrigger: true,
        analysisTriggerValue: true,
        llmProvider: true,
        llmBaseUrl: true,
        llmModel: true,
        llmApiKey: true,
      },
    }),
    // Load activities WITHOUT rawJson (GPS trackpoints are handled separately)
    prisma.$queryRawUnsafe(
      `SELECT id, user_id AS "userId", external_id AS "externalId",
              source, type, "subType", name,
              description, remarks, start_date AS "startDate",
              duration_seconds AS "durationSeconds",
              distance_meters AS "distanceMeters",
              elevation_gain_meters AS "elevationGainMeters",
              average_hr AS "averageHr", max_hr AS "maxHr",
              average_power AS "averagePower",
              normalized_power AS "normalizedPower",
              calories, tss, workout_type AS "workoutType",
              duplicate_group_id AS "duplicateGroupId",
              duplicate_status AS "duplicateStatus",
              merged_into_id AS "mergedIntoId", created_at AS "createdAt"
       FROM training_logs WHERE user_id = $1 ORDER BY start_date ASC`,
      userId,
    ),
    prisma.duplicateGroup.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.raceGoal.findMany({ where: { userId }, orderBy: { targetDate: "asc" } }),
    prisma.trainingFacility.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.bodyMetric.findMany({ where: { userId }, orderBy: { recordedAt: "asc" } }),
    prisma.trainingAvailability.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } }),
    prisma.weeklyAssessment.findMany({ where: { userId }, orderBy: { weekStartDate: "asc" } }),
    prisma.weeklyPlan.findMany({ where: { userId }, orderBy: { weekStartDate: "asc" } }),
    prisma.fatigueAlert.findMany({ where: { userId }, orderBy: { detectedAt: "asc" } }),
    prisma.dailyHealth.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    prisma.analysisReport.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.garminSession.findUnique({ where: { userId } }),
  ]);

  if (!user) throw new Error("User not found");

  // ── 2. Load facility associations ─────────────────────────────────────
  const facilityRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT training_log_id AS "trainingLogId",
            facility_id AS "facilityId"
     FROM training_log_facilities tlf
     WHERE EXISTS (
       SELECT 1 FROM training_logs WHERE id = tlf.training_log_id AND user_id = $1
     )`,
    userId,
  );
  const logFacilities = new Map<string, string[]>();
  for (const row of facilityRows) {
    if (!logFacilities.has(row.trainingLogId)) logFacilities.set(row.trainingLogId, []);
    logFacilities.get(row.trainingLogId)!.push(row.facilityId);
  }

  // ── 3. Write settings.json ────────────────────────────────────────────
  writeJson(tmpDir, "settings.json", {
    version: 1,
    exportedAt: new Date().toISOString(),
    user: {
      name: user.name,
      email: user.email,
      settings: {
        reviewDayOfWeek: user.reviewDayOfWeek,
        reviewTime: user.reviewTime,
        analysisTrigger: user.analysisTrigger,
        analysisTriggerValue: user.analysisTriggerValue,
        llmProvider: user.llmProvider,
        llmBaseUrl: user.llmBaseUrl,
        llmModel: user.llmModel,
        llmApiKey: user.llmApiKey,
      },
    },
  });

  // ── 4. Write activities.json (all activities without rawJson) ─────────
  const activities = (logs as any[]).map((l: any) => ({
    id: l.id,
    externalId: l.externalId,
    source: l.source,
    type: l.type,
    subType: l.subType,
    name: l.name,
    description: l.description,
    remarks: l.remarks,
    startDate: l.startDate instanceof Date ? l.startDate.toISOString() : l.startDate,
    durationSeconds: l.durationSeconds,
    distanceMeters: l.distanceMeters,
    elevationGainMeters: l.elevationGainMeters,
    averageHr: l.averageHr,
    maxHr: l.maxHr,
    averagePower: l.averagePower,
    normalizedPower: l.normalizedPower,
    calories: l.calories,
    tss: l.tss,
    workoutType: l.workoutType,
    duplicateGroupId: l.duplicateGroupId,
    duplicateStatus: l.duplicateStatus,
    mergedIntoId: l.mergedIntoId,
    facilityIds: logFacilities.get(l.id) ?? [],
  }));
  writeJson(tmpDir, "activities.json", activities);

  // ── 5. Write per-activity GPS data files ──────────────────────────────
  const activityIds = (logs as any[]).map((l: any) => l.id);
  if (activityIds.length > 0) {
    const rawJsonMap = await loadRawJsonBatched(activityIds);
    rawJsonMap.forEach((rawJson, id) => {
      if (rawJson != null) {
        writeJson(path.join(tmpDir, "activity_data"), `${id}.json`, rawJson);
      }
    });
  }

  // ── 6. Write other data files ─────────────────────────────────────────
  writeJson(tmpDir, "goals.json", raceGoals.map((g) => ({
    id: g.id,
    name: g.name,
    raceType: g.raceType,
    targetDate: g.targetDate.toISOString(),
    distanceMeters: g.distanceMeters,
    elevationGainMeters: g.elevationGainMeters,
    targetTimeSeconds: g.targetTimeSeconds,
    priority: g.priority,
    status: g.status,
    notes: g.notes,
    goalStatement: g.goalStatement,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  })));

  writeJson(tmpDir, "duplicate_groups.json", duplicateGroups.map((g) => ({
    id: g.id,
    status: g.status,
    resolution: g.resolution,
    keptActivityId: g.keptActivityId,
    mergedAt: g.mergedAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
  })));

  writeJson(tmpDir, "facilities.json", trainingFacilities.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    distanceMeters: f.distanceMeters,
    elevationGainMeters: f.elevationGainMeters,
    surface: f.surface,
    notes: f.notes,
    createdAt: f.createdAt.toISOString(),
  })));

  writeJson(tmpDir, "body_metrics.json", bodyMetrics.map((m) => ({
    id: m.id,
    recordedAt: m.recordedAt.toISOString(),
    weightKg: m.weightKg,
    heightCm: m.heightCm,
    restingHr: m.restingHr,
    notes: m.notes,
    createdAt: m.createdAt.toISOString(),
  })));

  writeJson(tmpDir, "schedule.json", trainingAvailability.map((a) => ({
    id: a.id,
    dayOfWeek: a.dayOfWeek,
    startTime: a.startTime,
    endTime: a.endTime,
    facilityIds: a.facilityIds,
    notes: a.notes,
    effectiveFrom: a.effectiveFrom.toISOString(),
    createdAt: a.createdAt.toISOString(),
  })));

  writeJson(tmpDir, "weekly_assessments.json", weeklyAssessments.map((a) => ({
    id: a.id,
    weekStartDate: a.weekStartDate.toISOString(),
    acuteTrainingLoad: a.acuteTrainingLoad,
    chronicTrainingLoad: a.chronicTrainingLoad,
    tsb: a.tsb,
    readinessScore: a.readinessScore,
    fitnessScore: a.fitnessScore,
    fatigueScore: a.fatigueScore,
    formScore: a.formScore,
    weeklyVolumeMeters: a.weeklyVolumeMeters,
    weeklyElevationMeters: a.weeklyElevationMeters,
    weeklyDurationSeconds: a.weeklyDurationSeconds,
    goalProgressPct: a.goalProgressPct,
    recommendations: a.recommendations,
    rawData: a.rawData,
    createdAt: a.createdAt.toISOString(),
  })));

  writeJson(tmpDir, "weekly_plans.json", weeklyPlans.map((p) => ({
    id: p.id,
    weekStartDate: p.weekStartDate.toISOString(),
    generatedAt: p.generatedAt.toISOString(),
    targetVolumeMeters: p.targetVolumeMeters,
    targetElevationMeters: p.targetElevationMeters,
    targetDurationSeconds: p.targetDurationSeconds,
    plannedSessions: p.plannedSessions,
    adjustments: p.adjustments,
    trajectoryAssessment: p.trajectoryAssessment,
    coachNotes: p.coachNotes,
    overridesExisting: p.overridesExisting,
    adjustmentHistory: p.adjustmentHistory,
    createdAt: p.createdAt.toISOString(),
  })));

  writeJson(tmpDir, "fatigue_alerts.json", fatigueAlerts.map((a) => ({
    id: a.id,
    detectedAt: a.detectedAt.toISOString(),
    severity: a.severity,
    signals: a.signals,
    recommendation: a.recommendation,
    recommendedRestDays: a.recommendedRestDays,
    acknowledged: a.acknowledged,
    createdAt: a.createdAt.toISOString(),
  })));

  writeJson(tmpDir, "daily_health.json", dailyHealth.map((h) => ({
    id: h.id,
    date: h.date.toISOString(),
    restingHeartRate: h.restingHeartRate,
    minHeartRate: h.minHeartRate,
    maxHeartRate: h.maxHeartRate,
    sleepSeconds: h.sleepSeconds,
    deepSleepSeconds: h.deepSleepSeconds,
    lightSleepSeconds: h.lightSleepSeconds,
    remSleepSeconds: h.remSleepSeconds,
    awakeSeconds: h.awakeSeconds,
    sleepScore: h.sleepScore,
    sleepStartLocal: h.sleepStartLocal,
    sleepEndLocal: h.sleepEndLocal,
    bodyBatteryMin: h.bodyBatteryMin,
    bodyBatteryMax: h.bodyBatteryMax,
    avgStress: h.avgStress,
    maxStress: h.maxStress,
    hrvBalance: h.hrvBalance,
    hrvStatus: h.hrvStatus,
    overnightHrv: h.overnightHrv,
    steps: h.steps,
    stepGoal: h.stepGoal,
    rawData: h.rawData,
  })));

  writeJson(tmpDir, "analysis_reports.json", analysisReports.map((r) => ({
    id: r.id,
    reportType: r.reportType,
    triggeredBy: r.triggeredBy,
    inputSnapshot: r.inputSnapshot,
    outputContent: r.outputContent,
    reasoning: r.reasoning,
    metrics: r.metrics,
    createdAt: r.createdAt.toISOString(),
  })));

  writeJson(tmpDir, "api_keys.json", apiKeys.map((k) => ({
    id: k.id,
    name: k.name,
    keyHash: k.keyHash,
    keyPrefix: k.keyPrefix,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  })));

  if (garminSession) {
    writeJson(tmpDir, "garmin_session.json", {
      id: garminSession.id,
      oauth1Token: garminSession.oauth1Token,
      oauth2Token: garminSession.oauth2Token,
      displayName: garminSession.displayName,
      garminUserId: garminSession.garminUserId,
      lastSyncAt: garminSession.lastSyncAt?.toISOString() ?? null,
      lastHealthSyncAt: garminSession.lastHealthSyncAt?.toISOString() ?? null,
      connectedAt: garminSession.connectedAt.toISOString(),
      createdAt: garminSession.createdAt.toISOString(),
      updatedAt: garminSession.updatedAt.toISOString(),
    });
  }

  // ── 7. Package into tar.gz ────────────────────────────────────────────
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  await tarCzF(dataFile, tmpDir);

  // ── 8. Clean up temp directory ────────────────────────────────────────
  fs.rmSync(tmpDir, { recursive: true, force: true });

  fs.writeFileSync(statusFile, JSON.stringify({ status: "ready" }));
}
