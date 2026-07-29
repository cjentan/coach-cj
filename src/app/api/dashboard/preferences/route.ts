import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface DashboardPrefs {
  timeframeDays: number;
  pmcMetrics: string[];
  trendMetrics: string[];
  volumePeriod: "week" | "month";
}

const DEFAULTS: DashboardPrefs = {
  timeframeDays: 30,
  pmcMetrics: ["ctl", "tsb"],
  trendMetrics: ["readinessScore", "weeklyVolumeMeters"],
  volumePeriod: "week",
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { dashboardPrefs: true },
  });

  const prefs = (user?.dashboardPrefs as DashboardPrefs | null) ?? DEFAULTS;
  return NextResponse.json(prefs);
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Partial<DashboardPrefs>;

  // Validate shape
  const allowedKeys: (keyof DashboardPrefs)[] = [
    "timeframeDays",
    "pmcMetrics",
    "trendMetrics",
    "volumePeriod",
  ];
  for (const key of Object.keys(body)) {
    if (!allowedKeys.includes(key as keyof DashboardPrefs)) {
      return NextResponse.json({ error: `Unknown key: ${key}` }, { status: 400 });
    }
  }

  // Type-level validation
  if (body.timeframeDays !== undefined && ![7, 30, 90, 180, 365, 730].includes(body.timeframeDays)) {
    return NextResponse.json({ error: "Invalid timeframeDays" }, { status: 400 });
  }
  if (body.volumePeriod !== undefined && !["week", "month"].includes(body.volumePeriod)) {
    return NextResponse.json({ error: "Invalid volumePeriod" }, { status: 400 });
  }
  if (body.pmcMetrics !== undefined && !Array.isArray(body.pmcMetrics)) {
    return NextResponse.json({ error: "pmcMetrics must be an array" }, { status: 400 });
  }
  if (body.trendMetrics !== undefined && !Array.isArray(body.trendMetrics)) {
    return NextResponse.json({ error: "trendMetrics must be an array" }, { status: 400 });
  }

  // Merge with existing prefs so we never lose fields the client didn't send
  const existing = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { dashboardPrefs: true },
  });
  const merged: DashboardPrefs = {
    ...DEFAULTS,
    ...(existing?.dashboardPrefs as Partial<DashboardPrefs> | null),
    ...body,
  };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { dashboardPrefs: merged as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({ success: true });
}
