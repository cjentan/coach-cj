import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeekStart } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const weekStart = getWeekStart(now);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
  const sixWeeksAgo = new Date(now.getTime() - 42 * 86400000);

  const [recentLogs, olderLogs, bodyMetrics, weekLogs] = await Promise.all([
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: twoWeeksAgo } },
      orderBy: { startDate: "asc" },
      select: { startDate: true, tss: true, averageHr: true, distanceMeters: true },
    }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, startDate: { gte: sixWeeksAgo, lt: twoWeeksAgo } },
      orderBy: { startDate: "asc" },
      select: { startDate: true, tss: true, averageHr: true },
    }),
    prisma.bodyMetric.findMany({
      where: { userId: session.user.id },
      orderBy: { recordedAt: "desc" },
      take: 14,
      select: { recordedAt: true, restingHr: true, weightKg: true },
    }),
    prisma.trainingLog.count({
      where: { userId: session.user.id, startDate: { gte: weekStart } },
    }),
  ]);

  const signals: string[] = [];
  const recommendations: string[] = [];

  // 1. Recent volume check
  const recentWeeklyTss = recentLogs
    .filter((log) => log.startDate >= weekStart)
    .reduce((sum, log) => sum + (log.tss || 50), 0);

  if (recentWeeklyTss > 600) {
    signals.push("High training volume this week");
    recommendations.push("Your TSS load is high. Prioritize sleep and nutrition this week.");
  }

  // 2. HR trend
  const recentHrLogs = recentLogs.filter((log) => log.averageHr != null && log.averageHr > 0);
  const olderHrLogs = olderLogs.filter((log) => log.averageHr != null && log.averageHr > 0);

  if (recentHrLogs.length >= 3 && olderHrLogs.length >= 5) {
    const recentAvg = recentHrLogs.reduce((sum, log) => sum + (log.averageHr || 0), 0) / recentHrLogs.length;
    const olderAvg = olderHrLogs.reduce((sum, log) => sum + (log.averageHr || 0), 0) / olderHrLogs.length;
    const hrDrift = recentAvg - olderAvg;

    if (hrDrift > 6) {
      signals.push(`Exercise HR +${Math.round(hrDrift)} bpm above baseline`);
      recommendations.push("Your heart rate is elevated at similar efforts. This can indicate accumulating fatigue or insufficient recovery.");
    } else if (hrDrift > 3) {
      signals.push(`Exercise HR slightly elevated (+${Math.round(hrDrift)} bpm)`);
    }
  }

  // 3. Resting HR trend
  const restingHrValues = bodyMetrics.filter((m) => m.restingHr != null).slice(0, 7);
  if (restingHrValues.length >= 3) {
    const recentResting = restingHrValues.slice(0, 3).reduce((sum, m) => sum + (m.restingHr || 0), 0) / Math.min(3, restingHrValues.slice(0, 3).length);
    const olderResting = restingHrValues.length >= 6
      ? restingHrValues.slice(3, 6).reduce((sum, m) => sum + (m.restingHr || 0), 0) / 3
      : recentResting;
    const restingDrift = recentResting - olderResting;

    if (restingDrift > 5) {
      signals.push(`Resting HR +${Math.round(restingDrift)} bpm above baseline`);
      recommendations.push("Your resting heart rate is trending up — a key sign of autonomic stress. Consider a lighter training week.");
    }
  }

  // 4. Training consistency
  const availabilityCount = await prisma.trainingAvailability.count({ where: { userId: session.user.id } });
  const expectedSessions = Math.max(1, availabilityCount);
  const consistency = Math.round((weekLogs / expectedSessions) * 100);

  if (consistency < 50) {
    signals.push(`Low consistency (${consistency}% of planned sessions)`);
    recommendations.push(`You've completed ${weekLogs} of ~${expectedSessions} planned sessions this week. Consistency is the foundation of endurance training.`);
  }

  // 5. Weight stability
  const recentWeights = bodyMetrics.filter((m) => m.weightKg != null).slice(0, 7);
  if (recentWeights.length >= 3) {
    const recentW = recentWeights.slice(0, 3).reduce((sum, m) => sum + (m.weightKg || 0), 0) / 3;
    const olderW = recentWeights.length >= 6
      ? recentWeights.slice(3, 6).reduce((sum, m) => sum + (m.weightKg || 0), 0) / 3
      : recentW;
    const weightLoss = olderW - recentW;

    if (weightLoss > 1.5) {
      signals.push(`Rapid weight loss (${weightLoss.toFixed(1)} kg in recent days)`);
      recommendations.push("Unexplained rapid weight loss can signal under-fueling. Ensure adequate calorie intake, especially around long sessions.");
    }
  }

  // Overall status
  let severity: string;
  let summary: string;

  if (signals.length >= 3) {
    severity = "high";
    summary = "Multiple fatigue signals detected. Strongly consider reducing volume and prioritizing recovery this week.";
  } else if (signals.length === 2) {
    severity = "medium";
    summary = "Some fatigue signals present. Monitor how you feel and consider adding an extra rest day.";
  } else if (signals.length === 1) {
    severity = "low";
    summary = "One minor signal — likely within normal training fluctuations. Keep an eye on it.";
  } else {
    severity = "clear";
    summary = "No fatigue signals detected. You're managing your training load well.";
  }

  // If no specific recommendations, add general ones
  if (recommendations.length === 0 && weekLogs > 0) {
    recommendations.push("Training looks balanced. Keep up the consistency and focus on quality sessions.");
    if (weekLogs >= 4) {
      recommendations.push("Good training frequency. Ensure at least one full rest or active recovery day per week.");
    }
  }

  return NextResponse.json({
    severity,
    summary,
    signals,
    recommendations,
    consistency,
    weeklyTss: recentWeeklyTss,
    weekLogs,
  });
}
