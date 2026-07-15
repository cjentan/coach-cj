import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.garminSession.update({
      where: { userId: session.user.id },
      data: {
        lastSyncAt: null,
        lastHealthSyncAt: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reset sync state";
    console.error("[garmin-reset-sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
