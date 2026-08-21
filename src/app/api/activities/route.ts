import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseClientDate } from "@/lib/utils";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const subType = url.searchParams.get("subType");
  const source = url.searchParams.get("source");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const tzOffset = parseInt(url.searchParams.get("tzOffset") || "0");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Record<string, unknown> = {
    userId: session.user.id,
    // Exclude activities that have been merged into another (duplicate resolution)
    mergedIntoId: null,
  };
  if (type && type !== "all") where.type = type;
  if (subType && subType !== "all") where.subType = subType;
  if (source && source !== "all") where.source = source;
  if (from)
    where.startDate = {
      ...((where.startDate as object) || {}),
      gte: parseClientDate(from, tzOffset),
    };
  if (to) {
    const endDate = parseClientDate(to, tzOffset);
    endDate.setUTCDate(endDate.getUTCDate() + 1); // exclusive next-day boundary in UTC
    where.startDate = { ...((where.startDate as object) || {}), lt: endDate };
  }

  const [logs, total] = await Promise.all([
    prisma.trainingLog.findMany({
      where,
      orderBy: { startDate: "desc" },
      take: Math.min(limit, 200),
      skip: offset,
      select: {
        id: true,
        type: true,
        subType: true,
        name: true,
        startDate: true,
        distanceMeters: true,
        elevationGainMeters: true,
        durationSeconds: true,
        averageHr: true,
        tss: true,
        remarks: true,
        source: true,
      },
    }),
    prisma.trainingLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, limit: Math.min(limit, 200), offset });
}
