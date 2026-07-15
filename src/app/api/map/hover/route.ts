import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * Return the approximate distance in meters between two lat/lng points
 * using the Haversine formula.
 */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface HoverBody {
  lat: number;
  lng: number;
  type?: string;
  from?: string;
  to?: string;
}

interface ActivityHit {
  id: string;
  name: string;
  type: string;
  startDate: string;
  distanceMeters: number | null;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: HoverBody = await req.json();
  const { lat, lng, type, from, to } = body;

  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const where: Record<string, unknown> = {
    userId: session.user.id,
    mergedIntoId: null,
    simplifiedTrackPoints: { not: Prisma.DbNull },
  };
  if (type && type !== "all") where.type = type;
  if (from) where.startDate = { ...(where.startDate as object || {}), gte: new Date(from) };
  if (to) where.startDate = { ...(where.startDate as object || {}), lte: new Date(to) };

  const candidates = await prisma.trainingLog.findMany({
    where,
    select: {
      id: true,
      name: true,
      type: true,
      startDate: true,
      distanceMeters: true,
      simplifiedTrackPoints: true,
    },
  });

  const THRESHOLD_M = 100;

  const hits: ActivityHit[] = [];

  for (const c of candidates) {
    const coords = c.simplifiedTrackPoints as [number, number][] | null;
    if (!Array.isArray(coords) || coords.length < 3) continue;

    for (const [clat, clng] of coords) {
      const d = haversineMeters(lat, lng, clat, clng);
      if (d <= THRESHOLD_M) {
        hits.push({
          id: c.id,
          name: c.name,
          type: c.type,
          startDate: c.startDate.toISOString(),
          distanceMeters: c.distanceMeters,
        });
        break;
      }
    }

    if (hits.length >= 20) break;
  }

  return NextResponse.json({ activities: hits });
}
