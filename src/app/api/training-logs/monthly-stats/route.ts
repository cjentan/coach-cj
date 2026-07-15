import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // Single query: fetch all activities from the last 12 months
  const logs = await prisma.trainingLog.findMany({
    where: {
      userId: session.user.id,
      startDate: { gte: twelveMonthsAgo },
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

  // Build ordered array: last 12 months (oldest first)
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const stats = byMonth[key] || { activityCount: 0, totalDistance: 0, totalElevation: 0 };
    months.push({
      key,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      ...stats,
    });
  }

  return NextResponse.json({ months });
}
