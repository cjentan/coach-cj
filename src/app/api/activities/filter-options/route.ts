import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [types, sources, subTypes] = await Promise.all([
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, mergedIntoId: null },
      distinct: ["type"],
      select: { type: true },
    }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, mergedIntoId: null },
      distinct: ["source"],
      select: { source: true },
    }),
    prisma.trainingLog.findMany({
      where: { userId: session.user.id, mergedIntoId: null, subType: { not: null } },
      distinct: ["subType"],
      select: { subType: true },
    }),
  ]);

  return NextResponse.json({
    types: types.map((t) => t.type).filter(Boolean),
    sources: sources.map((s) => s.source).filter(Boolean),
    subTypes: subTypes.map((s) => s.subType).filter(Boolean),
  });
}
