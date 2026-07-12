import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeTrackSimilarity, RoutePoint, simplifyTrack } from "@/lib/route-matching";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the current log with trackpoint data
  const log = await prisma.trainingLog.findUnique({
    where: { id: params.id, userId: session.user.id },
    select: {
      id: true,
      distanceMeters: true,
      rawJson: true,
    },
  });
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rawJson = log.rawJson as Record<string, unknown> | null;
  const trackPoints = rawJson?.trackPoints as RoutePoint[] | undefined;
  if (!trackPoints || trackPoints.length < 5) {
    return NextResponse.json({ matches: [], reason: "No GPS data in this activity" });
  }

  const currentDist = log.distanceMeters || 0;
  const distMin = currentDist * 0.7;
  const distMax = currentDist * 1.3;

  // Pre-filter: activities with similar distance, with GPS data, excluding self and merged duplicates
  const candidates = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      id: { not: params.id },
      mergedIntoId: null,
      distanceMeters: { gte: distMin, lte: distMax },
      rawJson: { not: Prisma.DbNull },
    },
    orderBy: { startDate: "desc" },
    take: 30,
    select: {
      id: true,
      name: true,
      startDate: true,
      durationSeconds: true,
      distanceMeters: true,
      elevationGainMeters: true,
      averageHr: true,
      maxHr: true,
      tss: true,
      rawJson: true,
    },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ matches: [] });
  }

  const currentTrack = simplifyTrack(trackPoints as RoutePoint[], 60);

  // Score each candidate
  interface Scored {
    id: string; name: string; startDate: string;
    durationSeconds: number; distanceMeters: number | null;
    elevationGainMeters: number | null; averageHr: number | null;
    maxHr: number | null; tss: number | null;
    similarity: number;
  }

  const scored: Scored[] = [];

  for (const c of candidates) {
    const cRaw = c.rawJson as Record<string, unknown> | null;
    const cPoints = cRaw?.trackPoints as RoutePoint[] | undefined;
    if (!cPoints || cPoints.length < 5) continue;

    const similarity = computeTrackSimilarity(currentTrack, cPoints as RoutePoint[], 60);
    if (similarity >= 55) {
      scored.push({
        id: c.id,
        name: c.name,
        startDate: c.startDate.toISOString(),
        durationSeconds: c.durationSeconds,
        distanceMeters: c.distanceMeters,
        elevationGainMeters: c.elevationGainMeters,
        averageHr: c.averageHr,
        maxHr: c.maxHr,
        tss: c.tss,
        similarity,
      });
    }
  }

  // Sort by similarity descending, then by date descending
  scored.sort((a, b) => b.similarity - a.similarity || b.startDate.localeCompare(a.startDate));
  const top = scored.slice(0, 10);

  return NextResponse.json({ matches: top });
}
