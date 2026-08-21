import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateGpxXml, TrackPoint } from "@/lib/gpx-parser";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log = await prisma.trainingLog.findUnique({
    where: { id: params.id, userId: session.user.id },
  });
  if (!log) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rawJson = log.rawJson as Record<string, unknown> | null;
  const trackPoints = (rawJson?.trackPoints as TrackPoint[]) || [];

  if (trackPoints.length === 0) {
    return NextResponse.json(
      { error: "No track point data available for this activity" },
      { status: 404 }
    );
  }

  const gpxXml = generateGpxXml(
    trackPoints,
    log.name || `Activity ${params.id}`,
    log.startDate?.toISOString?.() || null
  );

  // Build a safe filename from the activity name
  const safeName = (log.name || `activity-${params.id}`)
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .substring(0, 100);

  const filename = `${safeName}.gpx`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(gpxXml);

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": bytes.length.toString(),
    },
  });
}
