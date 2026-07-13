import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { downsample } from "@/lib/trackpoint-charts";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = parseInt(url.searchParams.get("limit") || "300");

  const where: Record<string, unknown> = {
    userId: session.user.id,
    mergedIntoId: null,
    rawJson: { not: Prisma.DbNull },
  };
  if (type && type !== "all") where.type = type;
  if (from) where.startDate = { ...(where.startDate as object || {}), gte: new Date(from) };
  if (to) where.startDate = { ...(where.startDate as object || {}), lte: new Date(to) };

  const logs = await prisma.trainingLog.findMany({
    where,
    orderBy: { startDate: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      type: true,
      subType: true,
      startDate: true,
      rawJson: true,
      distanceMeters: true,
    },
  });

  const activities = logs
    .map((log) => {
      const data = log.rawJson as { trackPoints?: Array<{ lat: number | null; lon: number | null }> } | null;
      const trackPoints = data?.trackPoints;
      if (!Array.isArray(trackPoints) || trackPoints.length < 3) return null;

      const valid = trackPoints.filter(
        (tp): tp is { lat: number; lon: number } => tp.lat != null && tp.lon != null
      );
      if (valid.length < 3) return null;

      const downsampled = downsample(valid, 200);

      return {
        id: log.id,
        name: log.name,
        type: log.type,
        startDate: log.startDate.toISOString(),
        coordinates: downsampled.map((tp) => [tp.lat, tp.lon] as [number, number]),
        distanceMeters: log.distanceMeters,
      };
    })
    .filter(Boolean);

  // Compute overall bounds for initial map view
  let bounds: {
    minLat: number; maxLat: number;
    minLng: number; maxLng: number;
  } | null = null;
  if (activities.length > 0) {
    const allCoords = activities.flatMap((a) => a!.coordinates);
    bounds = {
      minLat: Math.min(...allCoords.map((c) => c[0])),
      maxLat: Math.max(...allCoords.map((c) => c[0])),
      minLng: Math.min(...allCoords.map((c) => c[1])),
      maxLng: Math.max(...allCoords.map((c) => c[1])),
    };
  }

  return NextResponse.json({ activities, bounds });
}
