import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseActivityFile, buildRawJson, ParsedFileActivity } from "@/lib/gpx-parser";
import { parseFitFile } from "@/lib/fit-parser";
import { generateActivityName } from "@/lib/activity-naming";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const results: { filename: string; status: string; error?: string }[] = [];
    let imported = 0;
    const affectedWeeks = new Set<string>();

    for (const file of files) {
      try {
        const lower = file.name.toLowerCase();
        let activities: ParsedFileActivity[] = [];

        // ── FIT files (binary) ──────────────────────────
        if (lower.endsWith(".fit")) {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          activities = await parseFitFile(buffer);

          if (activities.length === 0) {
            results.push({ filename: file.name, status: "skipped", error: "No sessions or records found in FIT file" });
            continue;
          }
        } else {
          // ── GPX / TCX files (XML text) ────────────────
          const content = await file.text();
          const activity = parseActivityFile(content, file.name);

          if (!activity) {
            results.push({ filename: file.name, status: "skipped", error: "Unsupported format — use .gpx, .tcx, or .fit files" });
            continue;
          }
          activities = [activity];
        }

        // Upsert all parsed activities
        for (const activity of activities) {
          // Enrich name with area from reverse-geocode cache when GPS data is available
          try {
            activity.name = await generateActivityName(
              activity.type,
              activity.subType,
              activity.startDate,
              activity.trackPoints,
            );
          } catch {
            // Keep parser-generated name if geocoding fails
          }

          const externalId = `${lower.endsWith(".fit") ? "fit" : "gpx"}-${file.name.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          const rawJson = buildRawJson(activity, file.name);

          await prisma.trainingLog.upsert({
            where: {
              userId_externalId_source: {
                userId: session.user.id,
                externalId,
                source: "manual",
              },
            },
            create: {
              name: activity.name,
              type: activity.type,
              subType: activity.subType,
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
              description: activity.description,
              externalId,
              userId: session.user.id,
              source: "manual",
              rawJson: rawJson as any,
            },
            update: {
              name: activity.name,
              type: activity.type,
              subType: activity.subType,
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
              description: activity.description,
              rawJson: rawJson as any,
            },
          });
        }

        for (const a of activities) {
          affectedWeeks.add(getWeekStart(a.startDate).toISOString());
        }
        imported += activities.length;
        results.push({ filename: file.name, status: "imported" });
      } catch (err) {
        results.push({ filename: file.name, status: "error", error: (err as Error).message });
      }
    }

    // Snapshot all affected weeks
    for (const weekKey of Array.from(affectedWeeks)) {
      await snapshotWeek(session.user.id, new Date(weekKey)).catch(() => {});
    }

    const successCount = results.filter((r) => r.status === "imported").length;
    const errorCount = results.filter((r) => r.status === "error").length;
    const skippedCount = results.filter((r) => r.status === "skipped").length;

    return NextResponse.json({
      imported: successCount,
      skipped: skippedCount,
      errors: errorCount,
      results,
      message: `Imported ${imported} activities from ${successCount} files${skippedCount > 0 ? `, ${skippedCount} skipped` : ""}${errorCount > 0 ? `, ${errorCount} failed` : ""}`,
    });
  } catch (err) {
    console.error("File ingestion error:", err);
    return NextResponse.json({ error: "Failed to process files" }, { status: 500 });
  }
}
