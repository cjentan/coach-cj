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
    const affectedWeeks = new Set<string>();

    for (const activity of activities) {
      // Apply overrides
      if (nameOverride) activity.name = nameOverride;
      if (typeOverride) activity.type = typeOverride as ActivityType;

      const externalId =
        externalIdOverride ||
        `push-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}-${activity.startDate.toISOString()}-${Math.random().toString(36).slice(2, 8)}`;

      const rawJson = buildRawJson(activity, fileName);

      const record = await prisma.trainingLog.upsert({
        where: {
          userId_externalId_source: {
            userId,
            externalId,
            source: "manual",
          },
        },
        create: {
          userId,
          externalId,
          source: "manual",
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

      affectedWeeks.add(getWeekStart(activity.startDate).toISOString());

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

    // ── Recompute weekly snapshots ────────────────────────
    for (const weekKey of Array.from(affectedWeeks)) {
      await snapshotWeek(userId, new Date(weekKey)).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: `Imported ${imported.length} activit${imported.length === 1 ? "y" : "ies"}`,
      activities: imported,
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
