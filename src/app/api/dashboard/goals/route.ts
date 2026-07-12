import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const goals = await prisma.raceGoal.findMany({
    where: { userId: session.user.id, status: "active" },
    orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
  });

  if (goals.length === 0) return NextResponse.json([]);

  // Get total volume since each goal was created (or last 90 days, whichever is shorter)
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

  const recentLogs = await prisma.trainingLog.findMany({
    where: { userId: session.user.id, startDate: { gte: ninetyDaysAgo } },
    select: { distanceMeters: true, elevationGainMeters: true, startDate: true },
    orderBy: { startDate: "asc" },
  });

  return NextResponse.json(
    goals.map((goal) => {
      const weeksUntil = Math.max(1, Math.ceil((goal.targetDate.getTime() - now.getTime()) / (7 * 86400000)));
      const weeksSinceCreate = Math.max(1, Math.ceil((now.getTime() - goal.createdAt.getTime()) / (7 * 86400000)));

      // Progress: total distance trained vs goal distance
      const totalDistance = recentLogs.reduce((sum, log) => sum + (log.distanceMeters || 0), 0);
      const totalElevation = recentLogs.reduce((sum, log) => sum + (log.elevationGainMeters || 0), 0);

      // Simple progress: what % of total training distance has been covered relative to goal distance
      // 70% of race distance is the typical peak training volume target
      const peakTarget = goal.distanceMeters * 0.7;
      const progress = Math.min(100, Math.round((totalDistance / peakTarget) * 100));

      const daysUntil = Math.max(0, Math.ceil((goal.targetDate.getTime() - now.getTime()) / 86400000));

      return {
        id: goal.id,
        name: goal.name,
        raceType: goal.raceType,
        targetDate: goal.targetDate,
        distanceMeters: goal.distanceMeters,
        elevationGainMeters: goal.elevationGainMeters,
        priority: goal.priority,
        progress,
        daysUntil,
        weeksUntil,
        totalDistance,
        totalElevation,
      };
    })
  );
}
