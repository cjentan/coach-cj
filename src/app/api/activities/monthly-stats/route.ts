import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const now = new Date();
  // Window end: offset=0 → current month, offset=1 → last month, etc.
  const windowEndMonth = -offset;
  const windowStartMonth = windowEndMonth - 5;

  // Fetch data covering the 6-month window (plus a bit of buffer for edge cases)
  const startDate = new Date(now.getFullYear(), now.getMonth() + windowStartMonth, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + windowEndMonth + 1, 0, 23, 59, 59, 999);

  const logs = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      startDate: { gte: startDate, lte: endDate },
      mergedIntoId: null,
    },
    select: { startDate: true, distanceMeters: true, elevationGainMeters: true },
  });

  // Group by year-month key
  const byMonth: Record<string, { activityCount: number; totalDistance: number; totalElevation: number }> = {};
  for (const log of logs) {
    const key = `${log.startDate.getFullYear()}-${String(log.startDate.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { activityCount: 0, totalDistance: 0, totalElevation: 0 };
    byMonth[key].activityCount++;
    byMonth[key].totalDistance += log.distanceMeters || 0;
    byMonth[key].totalElevation += log.elevationGainMeters || 0;
  }

  // Build ordered array: 6 months (oldest first)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const m = windowStartMonth + (5 - i);
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const stats = byMonth[key] || { activityCount: 0, totalDistance: 0, totalElevation: 0 };
    months.push({
      key,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      ...stats,
    });
  }

  // Indicate whether you can go back further
  const canGoBack = offset < 120; // 10 years max

  return NextResponse.json({ months, canGoBack });
}
