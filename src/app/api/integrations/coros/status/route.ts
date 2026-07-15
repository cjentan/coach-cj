import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const corosSession = await prisma.corosSession.findUnique({
    where: { userId: session.user.id },
    select: {
      displayName: true,
      lastSyncAt: true,
      connectedAt: true,
      corosUserId: true,
    },
  });

  const corosActivityCount = await prisma.trainingLog.count({
    where: { userId: session.user.id, source: "coros" },
  });

  return NextResponse.json({
    connected: !!corosSession,
    displayName: corosSession?.displayName ?? null,
    corosUserId: corosSession?.corosUserId ?? null,
    lastSyncAt: corosSession?.lastSyncAt?.toISOString() ?? null,
    connectedAt: corosSession?.connectedAt?.toISOString() ?? null,
    corosActivityCount,
  });
}
