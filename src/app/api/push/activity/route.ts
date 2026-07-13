/**
 * Push API — accept GPX, TCX, or FIT files from remote clients.
 *
 * ## Authentication
 *   Authorization: Bearer <api_key>
 *
 * ## Request formats
 *
 * ### Raw body (recommended for scripts)
 *   curl -X POST https://coach.example.com/api/push/activity \
 *     -H "Authorization: Bearer coach_xxx" \
 *     -H "Content-Type: application/gpx+xml" \
 *     --data-binary @activity.gpx
 *
 * ### Multipart (works with web forms, -F in curl)
 *   curl -X POST https://coach.example.com/api/push/activity \
 *     -H "Authorization: Bearer coach_xxx" \
 *     -F "file=@activity.fit"
 *
 * ### Query string overrides (optional)
 *   ?name=Morning+Run&type=run&externalId=my-watch-123
 *   - name:     Override auto-detected activity name
 *   - type:     Override activity type (run|ride|swim|hike|walk|workout|other)
 *   - externalId: Override the deduplication key (default: hash of filename+date)
 */

import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { parseActivityFile, buildRawJson, ParsedFileActivity } from "@/lib/gpx-parser";
import { parseFitFile } from "@/lib/fit-parser";
import { generateActivityName } from "@/lib/activity-naming";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";
import { ActivityType } from "@prisma/client";

const VALID_TYPES: ActivityType[] = ["run", "ride", "swim", "hike", "walk", "workout", "other"];

export async function POST(req: Request) {
  // ── Auth ────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Missing Authorization header. Use: Bearer <api_key>" }, { status: 401 });
  }

  const userId = await verifyApiKey(token);
  if (!userId) {
    return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  }

  // ── Parse query overrides ───────────────────────────────
  const { searchParams } = new URL(req.url);
  const nameOverride = searchParams.get("name") || undefined;
  const typeOverride = searchParams.get("type") || undefined;
  const externalIdOverride = searchParams.get("externalId") || undefined;

  if (typeOverride && !VALID_TYPES.includes(typeOverride as ActivityType)) {
    return NextResponse.json({
      error: `Invalid type "${typeOverride}". Must be one of: ${VALID_TYPES.join(", ")}`,
    }, { status: 400 });
  }

  // ── Determine parsing strategy ──────────────────────────
  const contentType = req.headers.get("content-type") || "";

  try {
    let fileBuffer: Buffer;
    let fileName: string;
    let activities: ParsedFileActivity[] = [];

    if (contentType.includes("multipart/form-data")) {
      // ── Multipart form upload ──────────────────────────
      const formData = await req.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided. Send as raw body or multipart form field 'file'." }, { status: 400 });
      }

      fileName = file.name || "activity";
      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);

      activities = await parseBuffer(fileBuffer, fileName);
    } else {
      // ── Raw body upload ────────────────────────────────
      const arrayBuffer = await req.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);

      // Infer filename/type from Content-Type
      const inferredName = contentTypeToFilename(contentType);
      fileName = inferredName;
      activities = await parseBuffer(fileBuffer, inferredName);
    }

    if (activities.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Could not parse any activities from the file. Ensure it's a valid GPX, TCX, or FIT file.",
      }, { status: 422 });
    }

    // ── Upsert to database ───────────────────────────────
    const imported: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const affectedWeeks = new Set<string>();

    for (const activity of activities) {
      // Enrich name with area from reverse-geocode cache (best-effort)
      if (!nameOverride) {
        try {
          activity.name = await generateActivityName(
            activity.type,
            activity.subType,
            activity.startDate,
            activity.trackPoints,
          );
        } catch {
          // If geocoding fails, keep the parser-generated name
        }
      }

      // Apply overrides (takes precedence over auto-generated name)
      if (nameOverride) activity.name = nameOverride;
      if (typeOverride) activity.type = typeOverride as ActivityType;

      const rawJson = buildRawJson(activity, fileName);

      // Check for exact duplicate from same source before inserting.
      // A watch may retransmit the same activity with richer GPS data,
      // so we update the existing record in-place rather than rejecting.
      const existing = await findExistingDuplicateForPush(userId, activity, rawJson);

      let record: { id: string };

      if (existing) {
        record = { id: existing.id };
        updated.push({
          id: existing.id,
          name: activity.name,
          type: activity.type,
          startDate: activity.startDate.toISOString(),
          durationSeconds: activity.durationSeconds,
          distanceMeters: activity.distanceMeters,
          hasTrackPoints: activity.trackPoints.length > 0,
          trackPointCount: activity.trackPoints.length,
        });
      } else {
        const externalId =
          externalIdOverride ||
          `push-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}-${activity.startDate.toISOString()}-${Math.random().toString(36).slice(2, 8)}`;

        record = await prisma.trainingLog.upsert({
          where: {
            userId_externalId_source: {
              userId,
              externalId,
              source: "watch_push",
            },
          },
          create: {
            userId,
            externalId,
            source: "watch_push",
            type: activity.type,
            name: activity.name,
            description: activity.description,
            startDate: activity.startDate,
            durationSeconds: activity.durationSeconds,
            distanceMeters: activity.distanceMeters,
            elevationGainMeters: activity.elevationGainMeters,
            averageHr: activity.averageHr,
            maxHr: activity.maxHr,
            averagePower: activity.averagePower,
            normalizedPower: activity.normalizedPower,
            calories: activity.calories,
            tss: activity.tss,
            rawJson: rawJson as any,
          },
          update: {
            type: activity.type,
            name: activity.name,
            description: activity.description,
            startDate: activity.startDate,
            durationSeconds: activity.durationSeconds,
            distanceMeters: activity.distanceMeters,
            elevationGainMeters: activity.elevationGainMeters,
            averageHr: activity.averageHr,
            maxHr: activity.maxHr,
            averagePower: activity.averagePower,
            normalizedPower: activity.normalizedPower,
            calories: activity.calories,
            tss: activity.tss,
            rawJson: rawJson as any,
          },
        });

        imported.push({
          id: record.id,
          name: activity.name,
          type: activity.type,
          startDate: activity.startDate.toISOString(),
          durationSeconds: activity.durationSeconds,
          distanceMeters: activity.distanceMeters,
          hasTrackPoints: activity.trackPoints.length > 0,
          trackPointCount: activity.trackPoints.length,
        });
      }

      affectedWeeks.add(getWeekStart(activity.startDate).toISOString());
    }

    // ── Recompute weekly snapshots ────────────────────────
    for (const weekKey of Array.from(affectedWeeks)) {
      await snapshotWeek(userId, new Date(weekKey)).catch(() => {});
    }

    const totalNew = imported.length;
    const totalUpdated = updated.length;

    return NextResponse.json({
      success: true,
      message:
        totalNew > 0 && totalUpdated > 0
          ? `Imported ${totalNew} new activit${totalNew === 1 ? "y" : "ies"}, updated ${totalUpdated} duplicate${totalUpdated === 1 ? "" : "s"}`
          : totalUpdated > 0
            ? `Updated ${totalUpdated} existing duplicate${totalUpdated === 1 ? "" : "s"} (no new activities)`
            : `Imported ${totalNew} activit${totalNew === 1 ? "y" : "ies"}`,
      activities: imported,
      ...(updated.length > 0 ? { updated } : {}),
    });
  } catch (err) {
    console.error("Push API error:", err);
    return NextResponse.json({
      success: false,
      error: `Failed to process file: ${(err as Error).message}`,
    }, { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Check if the same activity was already pushed from this source.
 *
 * Matches on: same user + watch_push source + same type + start time
 * within 2 minutes + duration/distance within 5%. These are the same
 * criteria that the batch duplicate detector would score at ~100 pts.
 *
 * When a match is found, the existing record is updated with the new
 * data (the retransmission may carry richer GPS/HR data), and the
 * new row is never created — preventing silent duplicates at push time.
 */
async function findExistingDuplicateForPush(
  userId: string,
  activity: ParsedFileActivity,
  rawJson: Record<string, unknown>,
): Promise<{ id: string } | null> {
  const startWindow = new Date(activity.startDate.getTime() - 120_000);
  const endWindow = new Date(activity.startDate.getTime() + 120_000);

  const candidates = await prisma.trainingLog.findMany({
    where: {
      userId,
      source: "watch_push",
      type: activity.type,
      startDate: { gte: startWindow, lte: endWindow },
      mergedIntoId: null,
    },
    select: {
      id: true,
      durationSeconds: true,
      distanceMeters: true,
    },
  });

  for (const candidate of candidates) {
    // Duration must match within 5%
    const durRatio = activity.durationSeconds / Math.max(candidate.durationSeconds, 1);
    if (Math.abs(1 - durRatio) > 0.05) continue;

    // Distance must match within 5% if both activities have it
    if (
      activity.distanceMeters != null &&
      candidate.distanceMeters != null &&
      activity.distanceMeters > 0 &&
      candidate.distanceMeters > 0
    ) {
      const distRatio = activity.distanceMeters / candidate.distanceMeters;
      if (Math.abs(1 - distRatio) > 0.05) continue;
    }

    // Found a match — update the existing record with the latest data.
    // The retransmission may have more complete trackpoints.
    await prisma.trainingLog.update({
      where: { id: candidate.id },
      data: {
        name: activity.name,
        description: activity.description,
        startDate: activity.startDate,
        durationSeconds: activity.durationSeconds,
        distanceMeters: activity.distanceMeters,
        elevationGainMeters: activity.elevationGainMeters,
        averageHr: activity.averageHr,
        maxHr: activity.maxHr,
        averagePower: activity.averagePower,
        normalizedPower: activity.normalizedPower,
        calories: activity.calories,
        tss: activity.tss,
        rawJson: rawJson as any,
      },
    });

    return { id: candidate.id };
  }

  return null;
}

async function parseBuffer(buffer: Buffer, fileName: string): Promise<ParsedFileActivity[]> {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".fit")) {
    return parseFitFile(buffer);
  }

  // GPX / TCX — try text parsing
  const content = buffer.toString("utf-8");

  // Auto-detect: TCX files contain <TrainingCenterDatabase>
  if (content.includes("<TrainingCenterDatabase") || lower.endsWith(".tcx")) {
    const activity = parseActivityFile(content, fileName);
    return activity ? [activity] : [];
  }

  // GPX
  if (content.includes("<gpx") || lower.endsWith(".gpx") || lower.endsWith(".xml")) {
    const activity = parseActivityFile(content, fileName);
    return activity ? [activity] : [];
  }

  return [];
}

function contentTypeToFilename(contentType: string): string {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  switch (mime) {
    case "application/gpx+xml":
    case "application/gpx":
      return "activity.gpx";
    case "application/vnd.garmin.tcx+xml":
    case "application/tcx":
    case "application/tcx+xml":
      return "activity.tcx";
    case "application/xml":
    case "text/xml":
      return "activity.xml"; // auto-detected by content
    case "application/octet-stream":
    case "application/x-fit":
    case "application/fit":
      return "activity.fit";
    default:
      // Best guess from content type
      if (mime.includes("gpx")) return "activity.gpx";
      if (mime.includes("tcx")) return "activity.tcx";
      if (mime.includes("fit")) return "activity.fit";
      if (mime.includes("xml")) return "activity.xml";
      return "activity.bin";
  }
}
