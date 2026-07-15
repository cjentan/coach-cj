import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "7"), 1), 90);
  const since = new Date(Date.now() - days * 86_400_000);

  const healthData = await prisma.dailyHealth.findMany({
    where: {
      userId: session.user.id,
      date: { gte: since },
    },
    orderBy: { date: "desc" },
  });

  // Latest resting HR across the returned data
  const latestRestingHr =
    healthData.find((d) => d.restingHeartRate != null)?.restingHeartRate ?? null;

  // Latest HRV
  const latestHrv =
    healthData.find((d) => d.overnightHrv != null)?.overnightHrv ?? null;

  return NextResponse.json({
    healthData,
    latestRestingHr,
    latestHrv,
  });
}
