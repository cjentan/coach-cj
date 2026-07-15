/**
 * Garmin Connect API client wrapper.
 *
 * Authentication model: Garmin SSO (email + password) via the `@gooin/garmin-connect` npm package.
 * Passwords are NEVER stored — after login the OAuth 1.0a + 2.0 token pair is exported
 * and persisted in the database. Subsequent sessions are restored from stored tokens.
 *
 * Activity sync: fetches activity list from Garmin, downloads original FIT files,
 * and pipes them through the existing `parseFitFile()` + `buildRawJson()` pipeline.
 *
 * Health sync: pulls daily HR, sleep, body battery, stress, HRV, and steps
 * into the DailyHealth table for dashboard display and fatigue detection.
 */
import { GarminConnect, MFAManager } from "@gooin/garmin-connect";
import fs from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { parseFitFile } from "./fit-parser";
import { buildRawJson, ParsedFileActivity } from "./gpx-parser";
import { simplifyTrackPoints } from "./simplify-trackpoints";
import { generateActivityName } from "./activity-naming";
import { snapshotWeek } from "./metrics-snapshot";
import { classifyWorkoutType } from "./workout-classifier";

// ─── Local type shims ──────────────────────────────────────

interface GCActivity {
  activityId: number;
  activityName: string;
  description: unknown;
  startTimeLocal: string;
  startTimeGMT: string;
  distance: number;
  duration: number;
  movingDuration: number;
  elevationGain: number;
  activityType: { typeId: number; typeKey: string };
  eventType: { typeId: number; typeKey: string };
}

// ─── MFA Error ─────────────────────────────────────────────

/**
 * Thrown when Garmin requires an MFA code to complete login.
 * The caller should surface an MFA code input to the user.
 */
export class GarminMFARequiredError extends Error {
  constructor() {
    super("MFA code required");
    this.name = "GarminMFARequiredError";
  }
}

// ─── Exported Types ──────────────────────────────────────

export interface GarminSyncResult {
  activitiesImported: number;
  healthDaysSynced: number;
  errors: string[];
}

export interface DailyHealthInput {
  restingHeartRate?: number | null;
  minHeartRate?: number | null;
  maxHeartRate?: number | null;
  sleepSeconds?: number | null;
  deepSleepSeconds?: number | null;
  lightSleepSeconds?: number | null;
  remSleepSeconds?: number | null;
  awakeSeconds?: number | null;
  sleepScore?: number | null;
  sleepStartLocal?: string | null;
  sleepEndLocal?: string | null;
  bodyBatteryMin?: number | null;
  bodyBatteryMax?: number | null;
  avgStress?: number | null;
  maxStress?: number | null;
  hrvBalance?: number | null;
  hrvStatus?: string | null;
  overnightHrv?: number | null;
  steps?: number | null;
  stepGoal?: number | null;
  rawData?: any;
}

// ─── Client Factory ──────────────────────────────────────

/**
 * Restore a GarminConnect client from stored OAuth tokens.
 * Returns null if no valid session exists.
 * The password is not stored, so we pass a placeholder to the constructor
 * and then load the real OAuth tokens directly.
 */
export async function getGarminClient(
  userId: string
): Promise<any> {
  const session = await prisma.garminSession.findUnique({
    where: { userId },
  });
  if (!session) return null;

  try {
    // Constructor requires {username, password} — use placeholder, tokens override
    const client = new GarminConnect({
      username: "restore",
      password: "restore",
    });
    const oauth1 = session.oauth1Token as any;
    const oauth2 = session.oauth2Token as any;
    client.loadToken(oauth1, oauth2);

    // Verify the session is still valid
    await client.getUserProfile();
    return client;
  } catch {
    // Session expired — clean up so UI shows "Not connected"
    await prisma.garminSession.delete({ where: { userId } }).catch(() => {});
    return null;
  }
}

/**
 * Wait for a file to appear on disk (polling).
 * Returns true if the file appeared within `timeout` ms, false otherwise.
 */
async function waitForFile(
  filePath: string,
  timeout: number,
  signal?: AbortSignal
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (signal?.aborted) return false;
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

/**
 * Authenticate with Garmin SSO using email + password.
 *
 * The password is discarded after login; OAuth tokens are persisted.
 *
 * If the user's account has MFA enabled, the first call (without mfaCode)
 * will throw GarminMFARequiredError. The caller should surface an MFA input
 * and retry with the code from the user.
 *
 * When mfaCode IS provided, the library's file-based MFA manager is used:
 *  1. login() starts with a sessionId — it will reach the MFA checkpoint,
 *     create a session file on disk, and begin polling it every second.
 *  2. We wait for the file to appear, then submit the code via
 *     MFAManager.submitMFACode(), which writes the code into the file.
 *  3. login()'s poll finds the code and completes the MFA flow.
 */
export async function connectGarmin(
  userId: string,
  email: string,
  password: string,
  mfaCode?: string
): Promise<any> {
  const client = new GarminConnect({
    username: email,
    password,
    mfa: { type: "file", dir: "/tmp" },
  });

  if (mfaCode) {
    // ── Two-step MFA flow ──────────────────────────────
    const sessionId = `garmin-mfa-${userId}`;
    const abort = new AbortController();

    const loginPromise = client.login(email, password, sessionId);
    // If login fails (wrong password, network), abort the file wait early
    loginPromise.catch(() => abort.abort());

    const filePath = path.join("/tmp", `${sessionId}.json`);
    const fileAppeared = await waitForFile(filePath, 20000, abort.signal);

    if (fileAppeared) {
      const mfaManager = MFAManager.getInstance();
      await mfaManager.submitMFACode(sessionId, mfaCode);
    }

    await loginPromise;
  } else {
    // ── First attempt — detect if MFA is needed ───────
    try {
      await client.login();
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("MFA") ||
          err.message.includes("mfa") ||
          err.message.includes("验证码"))
      ) {
        throw new GarminMFARequiredError();
      }
      throw err;
    }
  }

  // ── Persist OAuth tokens ─────────────────────────────
  const tokens = client.exportToken();
  const profile = await client.getUserProfile();

  await prisma.garminSession.upsert({
    where: { userId },
    create: {
      userId,
      oauth1Token: tokens.oauth1 as any,
      oauth2Token: tokens.oauth2 as any,
      displayName: profile.displayName,
      garminUserId: profile.id,
    },
    update: {
      oauth1Token: tokens.oauth1 as any,
      oauth2Token: tokens.oauth2 as any,
      displayName: profile.displayName,
      garminUserId: profile.id,
    },
  });

  return client;
}

/**
 * Disconnect Garmin: remove session tokens and all Garmin-sourced data.
 */
export async function disconnectGarmin(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.garminSession.delete({ where: { userId } }),
    prisma.dailyHealth.deleteMany({ where: { userId } }),
    prisma.trainingLog.deleteMany({
      where: { userId, source: "garmin" },
    }),
  ]);
}

// ─── Activity Sync ───────────────────────────────────────

/**
 * Sync activities from Garmin Connect.
 *
 * Two modes:
 *  - full sync (fullSync=true): pages through ALL activities from Garmin,
 *    downloading every one that hasn't been imported before. Use for "Sync Now".
 *  - incremental sync (fullSync=false, lookbackDays=N): only looks at activities
 *    since the last sync, up to `lookbackDays` ago as a fallback. Use for the
 *    background worker.
 *
 * 1. Fetch activity list (paginated)
 * 2. For each new activity, download the original FIT ZIP
 * 3. Extract FIT from ZIP and parse with existing fit-parser.ts
 * 4. Upsert into TrainingLog with source "garmin"
 * 5. Update weekly snapshots
 */
export async function syncGarminActivities(
  client: any,
  userId: string,
  fullSync?: boolean,
  lookbackDays?: number,
  fromDate?: string | null,
  toDate?: string | null
): Promise<number> {
  const session = await prisma.garminSession.findUnique({
    where: { userId },
  });

  // ── Fetch ALL activities (no upper limit on pages) ─────────
  const activities: GCActivity[] = [];
  let start = 0;
  const limit = 50;

  for (let attempt = 0; attempt < 200; attempt++) {
    const batch = await client.getActivities(start, limit);
    activities.push(...batch);
    if (batch.length < limit) break;
    start += limit;
  }

  // ── Filter to relevant activities ───────────────────────────
  let newActivities: GCActivity[];
  if (fullSync) {
    // Full sync with optional date range
    newActivities = activities;
    if (fromDate) {
      const from = new Date(fromDate).getTime();
      newActivities = newActivities.filter(
        (a) => new Date(a.startTimeGMT).getTime() >= from
      );
    }
    if (toDate) {
      const to = new Date(toDate).getTime();
      newActivities = newActivities.filter(
        (a) => new Date(a.startTimeGMT).getTime() <= to
      );
    }
  } else {
    // Incremental sync: only activities since lastSyncAt (or lookback window)
    const window = lookbackDays ?? 90;
    const since = session?.lastSyncAt || new Date(Date.now() - window * 86_400_000);
    const cutoff = since.getTime();
    newActivities = activities.filter(
      (a) => new Date(a.startTimeGMT).getTime() > cutoff
    );
  }

  if (newActivities.length === 0) return 0;

  // Temp directory for downloaded FIT files
  const tmpDir = `/tmp/garmin-${userId}`;
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const AdmZip = require("adm-zip");
  let imported = 0;

  for (const garminActivity of newActivities) {
    const externalId = String(garminActivity.activityId);

    try {
      // Skip if already imported
      const existing = await prisma.trainingLog.findUnique({
        where: {
          userId_externalId_source: {
            userId,
            externalId,
            source: "garmin",
          },
        },
        select: { id: true },
      });
      if (existing) continue;

      // Download original activity as ZIP
      await client.downloadOriginalActivityData(
        { activityId: garminActivity.activityId },
        tmpDir,
        "zip" as any
      );

      const zipPath = path.join(tmpDir, `${garminActivity.activityId}.zip`);
      if (!fs.existsSync(zipPath)) continue;

      // Extract FIT from ZIP
      let parsedActivities: ParsedFileActivity[];
      try {
        const zip = new AdmZip(fs.readFileSync(zipPath));
        const fitEntry = zip
          .getEntries()
          .find(
            (e: any) =>
              !e.isDirectory &&
              (e.entryName.toLowerCase().endsWith(".fit") ||
                e.entryName.toLowerCase().endsWith(".fit.gz"))
          );

        if (!fitEntry) {
          // Try GPX or TCX fallback
          const gpxEntry = zip
            .getEntries()
            .find(
              (e: any) =>
                !e.isDirectory &&
                (e.entryName.toLowerCase().endsWith(".gpx") ||
                  e.entryName.toLowerCase().endsWith(".tcx"))
            );
          if (!gpxEntry) continue;
          // For GPX/TCX we'll skip for now — FIT is the rich format
          continue;
        }

        const fitBuffer: Buffer =
          fitEntry.entryName.toLowerCase().endsWith(".gz")
            ? require("zlib").gunzipSync(fitEntry.getData())
            : fitEntry.getData();

        parsedActivities = await parseFitFile(fitBuffer);
      } finally {
        // Cleanup downloaded ZIP
        try {
          fs.rmSync(zipPath, { force: true });
        } catch {
          // Non-critical
        }
      }

      // Upsert each parsed activity (usually 1, but multisport can be multiple)
      const hasMultiple = parsedActivities.length > 1;
      for (let i = 0; i < parsedActivities.length; i++) {
        const parsed = parsedActivities[i];
        const activityExternalId = hasMultiple
          ? `${externalId}-${i}`
          : externalId;

        // Enrich name with reverse-geocoded area
        const name = await generateActivityName(
          parsed.type,
          parsed.subType,
          parsed.startDate,
          parsed.trackPoints,
          undefined,
          parsed.localTimestamp ?? undefined
        );

        const rawJson = buildRawJson(
          parsed,
          `garmin-${garminActivity.activityId}.fit`
        );
        const simplified = simplifyTrackPoints(parsed.trackPoints, 500);

        // Classify workout type
        const workoutType = classifyWorkoutType({
          type: parsed.type,
          subType: parsed.subType,
          durationSeconds: parsed.durationSeconds,
          distanceMeters: parsed.distanceMeters,
          averageHr: parsed.averageHr,
          maxHr: parsed.maxHr,
          averagePower: parsed.averagePower,
          normalizedPower: parsed.normalizedPower,
          trackPoints: parsed.trackPoints,
        });

        await prisma.trainingLog.upsert({
          where: {
            userId_externalId_source: {
              userId,
              externalId: activityExternalId,
              source: "garmin",
            },
          },
          create: {
            userId,
            externalId: activityExternalId,
            source: "garmin",
            name,
            type: parsed.type,
            subType: parsed.subType,
            startDate: parsed.startDate,
            durationSeconds: parsed.durationSeconds,
            distanceMeters: parsed.distanceMeters,
            elevationGainMeters: parsed.elevationGainMeters,
            averageHr: parsed.averageHr,
            maxHr: parsed.maxHr,
            averagePower: parsed.averagePower,
            normalizedPower: parsed.normalizedPower,
            calories: parsed.calories,
            tss: parsed.tss,
            description:
              parsed.description ||
              `Imported from Garmin Connect (${garminActivity.activityName})`,
            rawJson: rawJson as any,
            simplifiedTrackPoints: simplified.coords as any,
            trackMinLat: simplified.bbox?.minLat ?? null,
            trackMaxLat: simplified.bbox?.maxLat ?? null,
            trackMinLng: simplified.bbox?.minLng ?? null,
            trackMaxLng: simplified.bbox?.maxLng ?? null,
            workoutType: workoutType || undefined,
          },
          update: {
            name,
            durationSeconds: parsed.durationSeconds,
            distanceMeters: parsed.distanceMeters,
            elevationGainMeters: parsed.elevationGainMeters,
            averageHr: parsed.averageHr,
            maxHr: parsed.maxHr,
            averagePower: parsed.averagePower,
            normalizedPower: parsed.normalizedPower,
            calories: parsed.calories,
            tss: parsed.tss,
            rawJson: rawJson as any,
            simplifiedTrackPoints: simplified.coords as any,
            trackMinLat: simplified.bbox?.minLat ?? null,
            trackMaxLat: simplified.bbox?.maxLat ?? null,
            trackMinLng: simplified.bbox?.minLng ?? null,
            trackMaxLng: simplified.bbox?.maxLng ?? null,
            workoutType: workoutType || undefined,
          },
        });

        imported++;

        // Snapshot the affected week
        await snapshotWeek(userId, parsed.startDate).catch(() => {});
      }
    } catch (err) {
      console.error(
        `[garmin] Failed to import activity ${externalId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Update last sync timestamp
  await prisma.garminSession.update({
    where: { userId },
    data: { lastSyncAt: new Date() },
  });

  return imported;
}

// ─── Health Data Sync ────────────────────────────────────

/**
 * Sync daily health data for recent days.
 * Fetches HR, sleep, body battery, stress, HRV, and steps.
 */
export async function syncGarminHealthData(
  client: any,
  userId: string
): Promise<number> {
  const session = await prisma.garminSession.findUnique({
    where: { userId },
  });

  const since = session?.lastHealthSyncAt
    ? new Date(session.lastHealthSyncAt)
    : new Date(Date.now() - 14 * 86_400_000);

  // Build list of days to sync
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const daysToSync: Date[] = [];
  const cursor = new Date(since);
  while (cursor <= today) {
    daysToSync.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  let synced = 0;

  for (const date of daysToSync) {
    try {
      const snapshot = await fetchDailyHealth(client, date);
      if (!snapshot) continue;

      const normalizedDate = new Date(date);
      normalizedDate.setUTCHours(0, 0, 0, 0);

      await prisma.dailyHealth.upsert({
        where: {
          userId_date: { userId, date: normalizedDate },
        },
        create: {
          userId,
          date: normalizedDate,
          ...snapshot,
        },
        update: snapshot,
      });

      synced++;
    } catch (err) {
      console.error(
        `[garmin] Health sync error for ${date.toISOString().split("T")[0]}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  await prisma.garminSession.update({
    where: { userId },
    data: { lastHealthSyncAt: new Date() },
  });

  return synced;
}

/**
 * Fetch all health metrics for a single date from Garmin.
 * Returns null if no data is available.
 */
async function fetchDailyHealth(
  client: any,
  date: Date
): Promise<DailyHealthInput | null> {
  const dateStr = date.toISOString().split("T")[0];
  const rawData: Record<string, any> = {};

  // Helper: call any Garmin API path via the authenticated client
  async function fetchWellness(path: string): Promise<unknown> {
    return client.get(`https://connectapi.garmin.com${path}`);
  }

  // 1. Heart Rate
  let restingHeartRate: number | null = null;
  let minHeartRate: number | null = null;
  let maxHeartRate: number | null = null;
  try {
    const hr = await client.getHeartRate(date);
    if (hr) {
      restingHeartRate = hr.restingHeartRate ?? null;
      minHeartRate = hr.minHeartRate ?? null;
      maxHeartRate = hr.maxHeartRate ?? null;
      rawData.heartRate = hr;
    }
  } catch {
    // No HR data for this date
  }

  // 2. Sleep Data
  let sleepSeconds: number | null = null;
  let deepSleepSeconds: number | null = null;
  let lightSleepSeconds: number | null = null;
  let remSleepSeconds: number | null = null;
  let awakeSeconds: number | null = null;
  let sleepScore: number | null = null;
  let sleepStartLocal: string | null = null;
  let sleepEndLocal: string | null = null;
  let overnightHrv: number | null = null;
  let hrvStatus: string | null = null;
  try {
    const sleep = await client.getSleepData(date);
    const dto = sleep.dailySleepDTO;
    if (dto) {
      sleepSeconds = dto.sleepTimeSeconds ?? null;
      deepSleepSeconds = dto.deepSleepSeconds ?? null;
      lightSleepSeconds = dto.lightSleepSeconds ?? null;
      remSleepSeconds = dto.remSleepSeconds ?? null;
      awakeSeconds = dto.awakeSleepSeconds ?? null;
      sleepScore = dto.sleepScores?.overall?.value ?? null;

      // Garmin's sleep data includes HRV info at the top level
      overnightHrv = sleep.avgOvernightHrv ?? null;
      hrvStatus = sleep.hrvStatus ?? null;

      // Local sleep times
      if (dto.sleepStartTimestampLocal) {
        const d = new Date(dto.sleepStartTimestampLocal);
        sleepStartLocal = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      }
      if (dto.sleepEndTimestampLocal) {
        const d = new Date(dto.sleepEndTimestampLocal);
        sleepEndLocal = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      }
    }
    rawData.sleep = sleep;
  } catch {
    // No sleep data
  }

  // 3. Body Battery (native method — takes a range, use same date for start/end)
  let bodyBatteryMin: number | null = null;
  let bodyBatteryMax: number | null = null;
  try {
    const bb = await client.getBodyBattery(dateStr, dateStr);
    if (bb && bb.length > 0) {
      bodyBatteryMin = bb[0].values.lowBodyBattery ?? null;
      bodyBatteryMax = bb[0].values.highBodyBattery ?? null;
    }
    rawData.bodyBattery = bb;
  } catch {
    // No body battery data
  }

  // 4. Stress Data (no native method — use generic GET)
  let avgStress: number | null = null;
  let maxStress: number | null = null;
  try {
    const stress = (await fetchWellness(
      `/wellness-service/wellness/dailyStress/${dateStr}`
    )) as any;
    if (stress?.stressValues?.length) {
      const values = (stress.stressValues as Array<{ stressLevel: number }>).map(
        (v) => v.stressLevel
      );
      avgStress = Math.round(
        values.reduce((a: number, b: number) => a + b, 0) / values.length
      );
      maxStress = Math.max(...values);
    }
    rawData.stress = stress;
  } catch {
    // No stress data
  }

  // 5. HRV Data (native method — fallback if sleep data didn't have it)
  if (!overnightHrv) {
    try {
      const hrv = await client.getHRVData(date);
      if (hrv?.hrvSummary) {
        overnightHrv = hrv.hrvSummary.lastNightAvg ?? null;
        hrvStatus = hrvStatus ?? hrv.hrvSummary.status ?? null;
        rawData.hrv = hrv;
      }
    } catch {
      // No HRV data
    }
  }

  // 6. Steps
  let steps: number | null = null;
  let stepGoal: number | null = null;
  try {
    const stepResult = await client.getSteps(date);
    if (typeof stepResult === "number") {
      steps = stepResult;
    } else if (stepResult && typeof stepResult === "object") {
      steps = stepResult.totalSteps ?? null;
      stepGoal = stepResult.stepGoal ?? null;
    }
    rawData.steps = stepResult;
  } catch {
    // No step data
  }

  // Skip if we got nothing at all
  const hasData =
    restingHeartRate !== null ||
    sleepSeconds !== null ||
    bodyBatteryMin !== null ||
    steps !== null ||
    avgStress !== null;
  if (!hasData) return null;

  return {
    restingHeartRate,
    minHeartRate,
    maxHeartRate,
    sleepSeconds,
    deepSleepSeconds,
    lightSleepSeconds,
    remSleepSeconds,
    awakeSeconds,
    sleepScore,
    sleepStartLocal,
    sleepEndLocal,
    bodyBatteryMin,
    bodyBatteryMax,
    avgStress,
    maxStress,
    hrvBalance: overnightHrv,
    hrvStatus,
    overnightHrv,
    steps,
    stepGoal,
    rawData: rawData as any,
  };
}
