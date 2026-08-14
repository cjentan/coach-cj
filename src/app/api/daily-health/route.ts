import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { localDateStr } from "@/lib/utils";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const tzOffset = parseInt(searchParams.get("tzOffset") || "0", 10) || 0;
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "7"), 1), 90);
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.dailyHealth.findMany({
    where: {
      userId: session.user.id,
      date: { gte: since },
    },
    orderBy: { date: "desc" },
  });

  // dailyHealth.date is stored at UTC midnight; the client labels it
  // "Today"/"Yesterday", so return it in the user's local calendar date.
  const healthData = rows.map((d) => ({ ...d, date: localDateStr(d.date, tzOffset) }));

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
