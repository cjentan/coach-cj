import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      _count: {
        select: {
          trainingLogs: true,
          raceGoals: true,
          bodyMetrics: true,
          fatigueAlerts: true,
        },
      },
      bodyMetrics: { orderBy: { recordedAt: "desc" }, take: 1, select: { weightKg: true, recordedAt: true } },
      trainingLogs: { orderBy: { startDate: "desc" }, take: 1, select: { startDate: true, name: true } },
    },
  });

  const mapped = users.map((u) => {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt,
      trainingLogs: u._count.trainingLogs,
      raceGoals: u._count.raceGoals,
      bodyMetrics: u._count.bodyMetrics,
      fatigueAlerts: u._count.fatigueAlerts,
      latestWeight: u.bodyMetrics[0]?.weightKg || null,
      latestWeightDate: u.bodyMetrics[0]?.recordedAt || null,
      lastActivity: u.trainingLogs[0]?.startDate || null,
      lastActivityName: u.trainingLogs[0]?.name || null,
    };
  });

  return NextResponse.json({
    summary: {
      totalUsers: users.length,
      totalActivities: users.reduce((sum, u) => sum + u._count.trainingLogs, 0),
    },
    users: mapped,
  });
}

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, role } = await req.json();
  if (!userId || !["admin", "user"].includes(role)) {
    return NextResponse.json({ error: "userId and valid role required" }, { status: 400 });
  }

  // Prevent self-demotion
  if (userId === admin.id && role !== "admin") {
    return NextResponse.json({ error: "Cannot demote yourself" }, { status: 400 });
  }

  await prisma.user.update({ where: { id: userId }, data: { role } });
  return NextResponse.json({ success: true });
}
