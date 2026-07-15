import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const garminSession = await prisma.garminSession.findUnique({
    where: { userId: session.user.id },
    select: {
      displayName: true,
      lastSyncAt: true,
      lastHealthSyncAt: true,
      connectedAt: true,
    },
  });

  const garminActivityCount = await prisma.trainingLog.count({
    where: { userId: session.user.id, source: "garmin" },
  });

  return NextResponse.json({
    connected: !!garminSession,
    displayName: garminSession?.displayName ?? null,
    lastSyncAt: garminSession?.lastSyncAt?.toISOString() ?? null,
    lastHealthSyncAt: garminSession?.lastHealthSyncAt?.toISOString() ?? null,
    connectedAt: garminSession?.connectedAt?.toISOString() ?? null,
    garminActivityCount,
  });
}
