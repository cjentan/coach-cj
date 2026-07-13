import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseStravaCsv } from "@/lib/csv-parser";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const content = await file.text();
    const result = parseStravaCsv(content);

    if (result.activities.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        errors: result.errors,
        message: result.errors[0] || "No activities found in CSV",
      });
    }

    let imported = 0;
    let skipped = 0;
    const affectedWeeks = new Set<string>();

    for (const activity of result.activities) {
      try {
        await prisma.trainingLog.upsert({
          where: {
            userId_externalId_source: {
              userId: session.user.id,
              externalId: activity.externalId,
              source: "manual",
            },
          },
          create: { ...activity, userId: session.user.id },
          update: {
            type: activity.type,
            subType: activity.subType,
            name: activity.name,
            startDate: activity.startDate,
            durationSeconds: activity.durationSeconds,
            distanceMeters: activity.distanceMeters,
            elevationGainMeters: activity.elevationGainMeters,
            averageHr: activity.averageHr,
            maxHr: activity.maxHr,
            averagePower: activity.averagePower,
            calories: activity.calories,
            tss: activity.tss,
          },
        });
        affectedWeeks.add(getWeekStart(activity.startDate).toISOString());
        imported++;
      } catch {
        skipped++;
      }
    }

    // Snapshot all affected weeks
    for (const weekKey of Array.from(affectedWeeks)) {
      await snapshotWeek(session.user.id, new Date(weekKey)).catch(() => {});
    }

    return NextResponse.json({
      imported,
      skipped,
      totalRows: result.totalRows,
      errors: result.errors.slice(0, 10),
      message: `Imported ${imported} activities${skipped > 0 ? ` (${skipped} skipped)` : ""} from ${result.totalRows} CSV rows`,
    });
  } catch (err) {
    console.error("CSV ingestion error:", err);
    return NextResponse.json({ error: "Failed to process CSV file" }, { status: 500 });
  }
}
