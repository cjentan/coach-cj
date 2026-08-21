/**
 * COROS Training Hub API client wrapper.
 *
 * Authentication model: email + password via the `@nyt87/crs-connect` npm package.
 * Passwords are NEVER stored — after login the access token is persisted in the
 * database. Subsequent sessions are restored from stored tokens.
 *
 * Activity sync: fetches activity list from COROS, downloads original FIT files,
 * and pipes them through the existing `parseFitFile()` + `buildRawJson()` pipeline.
 *
 * No health data equivalent exists for COROS via this API.
 */
import { CorosApi, Activity } from "@nyt87/crs-connect";
import fs from "fs";
import path from "path";
import { prisma } from "./prisma";
import { parseFitFile } from "./fit-parser";
import { buildRawJson, ParsedFileActivity, TrackPoint } from "./gpx-parser";
import { simplifyTrackPoints } from "./simplify-trackpoints";
import { generateActivityName } from "./activity-naming";
import { snapshotWeek } from "./metrics-snapshot";
import { classifyWorkoutType } from "./workout-classifier";
import { computePrecomputedTrackpointMetrics } from "./trackpoint-metrics";
import { getEffectiveMaxHr, getLatestRestingHr } from "./body-metrics";
import { parseClientDate } from "./utils";

// ─── Exported Types ──────────────────────────────────────

interface CorosSyncResult {
  activitiesImported: number;
  errors: string[];
}

// ─── Constants ───────────────────────────────────────────

const COROS_TOKEN_DIR_PREFIX = "/tmp/coros-";

// ─── Client Factory ──────────────────────────────────────

/**
 * Restore a CorosApi client from a stored access token.
 * Returns null if no valid session exists or the token is expired.
 */
export async function getCorosClient(
  userId: string
): Promise<CorosApi | null> {
  const session = await prisma.corosSession.findUnique({
    where: { userId },
  });
  if (!session || !session.accessToken) return null;

  try {
    // The library expects token on disk as {dir}/token.txt
    // Format: JSON string of { accessToken, userId }
    const tokenDir = COROS_TOKEN_DIR_PREFIX + userId;
    const tokenPath = path.join(tokenDir, "token.txt");

    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    fs.writeFileSync(tokenPath, session.accessToken, "utf-8");

    const client = new CorosApi({
      email: "restore",
      password: "restore",
    });
    client.loadTokenByFile(tokenDir);

    // Verify the session is still valid
    await client.getAccount();
    return client;
  } catch (err) {
    // Session expired or invalid — clean up DB and temp files
    console.error(
      `[coros] Session invalid for user ${userId}, removing:`,
      err instanceof Error ? err.message : err
    );
    await prisma.corosSession.delete({ where: { userId } }).catch(() => {});
    try {
      fs.rmSync(COROS_TOKEN_DIR_PREFIX + userId, { recursive: true, force: true });
    } catch {
      // Non-critical
    }
    return null;
  }
}

/**
 * Authenticate with COROS using email + password.
 *
 * The password is discarded after login; the access token is persisted in the DB.
 */
export async function connectCoros(
  userId: string,
  email: string,
  password: string
): Promise<void> {
  const client = new CorosApi({ email, password });
  await client.login();

  // Capture the display name from the login response
  const account = await client.getAccount();
  const displayName = account?.nickname || null;
  const corosUserId = account?.userId || null;

  // Export token to file, read it, store in DB
  const tokenDir = COROS_TOKEN_DIR_PREFIX + userId;
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true });
  }
  client.exportTokenToFile(tokenDir);
  const tokenPath = path.join(tokenDir, "token.txt");
  const tokenJson = fs.readFileSync(tokenPath, "utf-8");
  // Clean up temp files
  try {
    fs.rmSync(tokenDir, { recursive: true, force: true });
  } catch {
    // Non-critical
  }

  await prisma.corosSession.upsert({
    where: { userId },
    create: {
      userId,
      accessToken: tokenJson,
      displayName,
      corosUserId,
    },
    update: {
      accessToken: tokenJson,
      displayName,
      corosUserId,
    },
  });
}

/**
 * Disconnect COROS: remove session and all COROS-sourced data.
 */
export async function disconnectCoros(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.corosSession.delete({ where: { userId } }),
    prisma.trainingLog.deleteMany({
      where: { userId, source: "coros" },
    }),
  ]);
}

// ─── Activity Sync ───────────────────────────────────────

/**
 * Sync activities from COROS Training Hub.
 *
 * 1. Fetch activity list (paginated)
 * 2. For each new activity, download the original FIT/GPX/TCX file
 * 3. Parse and upsert into TrainingLog with source "coros"
 * 4. Update weekly snapshots
 */
export async function syncCorosActivities(
  client: CorosApi,
  userId: string,
  fullSync?: boolean,
  fromDate?: string | null,
  toDate?: string | null,
  tzOffset?: number,
): Promise<{ count: number; newActivityIds: string[] }> {
  // Karvonen zones need the user's resting HR and max HR; fetch once per sync.
  const restHr = await getLatestRestingHr(userId);
  const maxHr = await getEffectiveMaxHr(userId);

  // ── Fetch ALL activities (paginated) ────────────────────
  const activities: Activity[] = [];
  let page = 1;
  const size = 50;

  for (let attempt = 0; attempt < 200; attempt++) {
    const batch = await client.getActivitiesList({
      page,
      size,
      ...(fromDate ? { from: parseClientDate(fromDate, tzOffset) } : {}),
      ...(toDate ? { to: parseClientDate(toDate, tzOffset) } : {}),
    });
    const dataList = batch.dataList || [];
    activities.push(...dataList);
    const totalPage = batch.totalPage || 1;
    if (page >= totalPage || dataList.length < size) break;
    page++;
  }

  if (activities.length === 0) return { count: 0, newActivityIds: [] };

  // ── Filter to new activities ────────────────────────────
  let newActivities = activities;

  // Date filter on the server side may not work reliably in all cases,
  // so apply a client-side filter as well when incremental. Cutoff is the
  // newest activity already imported for this source — first import pulls
  // everything, later syncs fetch only what's newer than the newest known
  // activity (see syncGarminActivities for the same rationale).
  if (!fullSync) {
    const latest = await prisma.trainingLog.findFirst({
      where: { userId, source: "coros" },
      orderBy: { startDate: "desc" },
      select: { startDate: true },
    });
    const cutoff = latest?.startDate.getTime() ?? -Infinity;
    newActivities = activities.filter((a) => {
      // COROS startTime is in seconds for some endpoints, ms for others
      // Convert to ms if it looks like seconds (< 1e12)
      const startMs =
        a.startTime < 1_000_000_000_000
          ? a.startTime * 1000
          : a.startTime;
      return startMs > cutoff;
    });
  }

  if (newActivities.length === 0) return { count: 0, newActivityIds: [] };

  // ── Download & Process ──────────────────────────────────
  let imported = 0;
  const newActivityIds: string[] = [];

  for (const corosActivity of newActivities) {
    const externalId = corosActivity.labelId;

    try {
      // Skip if already imported
      const existing = await prisma.trainingLog.findUnique({
        where: {
          userId_externalId_source: {
            userId,
            externalId,
            source: "coros",
          },
        },
        select: { id: true },
      });
      if (existing) continue;

      // Get download URL for the FIT file
      const downloadResult = await client.getActivityDownloadFile({
        activityId: externalId,
        fileType: "fit",
      });

      // downloadResult.fileUrl is the download URL — fetch the raw file
      let fileUrl: string;
      if (typeof downloadResult === "string") {
        fileUrl = downloadResult;
      } else if (typeof downloadResult === "object" && downloadResult !== null) {
        fileUrl = (downloadResult as any).fileUrl || (downloadResult as any).data?.fileUrl || "";
      } else {
        fileUrl = "";
      }

      if (!fileUrl) continue;

      const response = await fetch(fileUrl);
      if (!response.ok) continue;

      let fileBuffer: Buffer | null = Buffer.from(await response.arrayBuffer());

      // Parse the FIT file
      let parsedActivities: ParsedFileActivity[] | null = null;
      try {
        parsedActivities = await parseFitFile(fileBuffer);
      } catch {
        // FIT parse failed — skip this activity
        console.error(
          `[coros] Failed to parse FIT for activity ${externalId}`
        );
        fileBuffer = null;
        if (global.gc) global.gc();
        continue;
      }

      if (!parsedActivities || parsedActivities.length === 0) {
        fileBuffer = null;
        if (global.gc) global.gc();
        continue;
      }

      // Upsert each parsed activity
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

        const rawJson = buildRawJson(parsed, `coros-${externalId}.fit`);
        const simplifiedTrackPoints = simplifyTrackPoints(parsed.trackPoints, 500);

        // Precompute trackpoint metrics while the trackpoints are in memory,
        // so dashboard chart routes never have to load the rawJson blobs.
        // Zone math anchors to the user-level max HR, not this activity's
        // observed max, so every activity's zones mean the same thing.
        const tpMetrics = computePrecomputedTrackpointMetrics(
          rawJson.trackPoints as TrackPoint[] | undefined,
          maxHr,
          restHr,
        );

        // Classify workout type
        const workoutType = classifyWorkoutType({
          type: parsed.type,
          subType: parsed.subType,
          durationSeconds: parsed.durationSeconds,
          distanceMeters: parsed.distanceMeters,
          averageHr: parsed.averageHr,
          maxHr,
          restHr,
          averagePower: parsed.averagePower,
          normalizedPower: parsed.normalizedPower,
          trackPoints: parsed.trackPoints,
        });

        const created = await prisma.trainingLog.upsert({
          where: {
            userId_externalId_source: {
              userId,
              externalId: activityExternalId,
              source: "coros",
            },
          },
          create: {
            userId,
            externalId: activityExternalId,
            source: "coros",
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
              `Imported from COROS Training Hub`,
            rawJson: rawJson as any,
            simplifiedTrackPoints: simplifiedTrackPoints as any,
            workoutType: workoutType || undefined,
            analysisStatus: "pending",
            ...tpMetrics,
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
            simplifiedTrackPoints: simplifiedTrackPoints as any,
            workoutType: workoutType || undefined,
            ...tpMetrics,
          },
        });

        newActivityIds.push(created.id);
        imported++;

        // Snapshot the affected week
        await snapshotWeek(userId, parsed.startDate).catch(() => {});
      }

      // Free the file buffer + parsed data and force GC before the next
      // activity, so memory doesn't accumulate during large syncs.
      fileBuffer = null;
      parsedActivities = [];
      if (global.gc) global.gc();
    } catch (err) {
      console.error(
        `[coros] Failed to import activity ${externalId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Update last sync timestamp
  await prisma.corosSession.update({
    where: { userId },
    data: { lastSyncAt: new Date() },
  });

  return { count: imported, newActivityIds };
}
