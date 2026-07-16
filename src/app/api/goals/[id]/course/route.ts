import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseActivityFile } from "@/lib/gpx-parser";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: goalId } = await params;

  // Verify goal ownership
  const goal = await prisma.raceGoal.findUnique({ where: { id: goalId } });
  if (!goal || goal.userId !== session.user.id) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const filename = file.name.toLowerCase();

  // Parse the file
  let profile: {
    distanceMeters: number;
    elevationGainMeters: number;
    maxElevation: number;
    minElevation: number;
    points: Array<{ lat: number | null; lon: number | null; ele: number | null; distance: number }>;
  } | null = null;

  if (filename.endsWith(".gpx") || filename.endsWith(".tcx")) {
    const text = await file.text();
    const parsed = parseActivityFile(text, file.name);
    if (parsed) {
      const points = parsed.trackPoints || [];
      const minEle = points.length > 0
        ? Math.min(...points.filter((p) => p.ele != null).map((p) => p.ele!))
        : 0;
      const maxEle = points.length > 0
        ? Math.max(...points.filter((p) => p.ele != null).map((p) => p.ele!))
        : 0;

      // Build simplified course points with cumulative distance
      let cumDistance = 0;
      const simplifiedPoints = points
        .filter((_, i) => i % Math.max(1, Math.floor(points.length / 200)) === 0) // max ~200 points
        .map((p, i, arr) => {
          if (i > 0 && p.lat != null && arr[i - 1].lat != null) {
            cumDistance += haversine(arr[i - 1].lat!, arr[i - 1].lon!, p.lat!, p.lon!);
          }
          return {
            lat: p.lat,
            lon: p.lon,
            ele: p.ele,
            distance: Math.round(cumDistance),
          };
        });

      profile = {
        distanceMeters: Math.round(parsed.distanceMeters || 0),
        elevationGainMeters: Math.round(parsed.elevationGainMeters || 0),
        maxElevation: Math.round(maxEle),
        minElevation: Math.round(minEle),
        points: simplifiedPoints,
      };
    }
  } else if (filename.endsWith(".fit")) {
    const { parseFitFile } = await import("@/lib/fit-parser");
    const buffer = await file.arrayBuffer();
    const activities = await parseFitFile(Buffer.from(buffer));
    const parsed = activities[0];
    if (parsed) {
      const points = parsed.trackPoints || [];
      const minEle = points.length > 0
        ? Math.min(...points.filter((p) => p.ele != null).map((p) => p.ele!))
        : 0;
      const maxEle = points.length > 0
        ? Math.max(...points.filter((p) => p.ele != null).map((p) => p.ele!))
        : 0;

      let cumDistance = 0;
      const simplifiedPoints = points
        .filter((_, i) => i % Math.max(1, Math.floor(points.length / 200)) === 0)
        .map((p, i, arr) => {
          if (i > 0 && p.lat != null && arr[i - 1].lat != null) {
            cumDistance += haversine(arr[i - 1].lat!, arr[i - 1].lon!, p.lat!, p.lon!);
          }
          return {
            lat: p.lat,
            lon: p.lon,
            ele: p.ele,
            distance: Math.round(cumDistance),
          };
        });

      profile = {
        distanceMeters: Math.round(parsed.distanceMeters || 0),
        elevationGainMeters: Math.round(parsed.elevationGainMeters || 0),
        maxElevation: Math.round(maxEle),
        minElevation: Math.round(minEle),
        points: simplifiedPoints,
      };
    }
  }

  if (!profile) {
    return NextResponse.json(
      { error: "Could not parse file. Supported formats: GPX, TCX, FIT." },
      { status: 400 }
    );
  }

  // Update the goal with course profile data — overwrite distance/elevation
  // with the actual course file data since it's the authoritative source
  await prisma.raceGoal.update({
    where: { id: goalId },
    data: {
      courseProfile: profile,
      distanceMeters: profile.distanceMeters,
      elevationGainMeters: profile.elevationGainMeters,
    },
  });

  return NextResponse.json({
    success: true,
    profile: {
      distanceMeters: profile.distanceMeters,
      elevationGainMeters: profile.elevationGainMeters,
      maxElevation: profile.maxElevation,
      minElevation: profile.minElevation,
      pointCount: profile.points.length,
    },
  });
}

// Quick haversine for course point distance computation
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
