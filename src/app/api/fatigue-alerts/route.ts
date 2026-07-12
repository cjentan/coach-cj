import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const alerts = await prisma.fatigueAlert.findMany({
    where: { userId: session.user.id },
    orderBy: { detectedAt: "desc" },
    take: 20,
  });
  return NextResponse.json(alerts);
}
