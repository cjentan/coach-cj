import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Record<string, unknown> = { userId: session.user.id };
  if (type && type !== "all") where.type = type;
  if (from) where.startDate = { ...(where.startDate as object || {}), gte: new Date(from) };
  if (to) where.startDate = { ...(where.startDate as object || {}), lte: new Date(to) };

  const [logs, total] = await Promise.all([
    prisma.trainingLog.findMany({
      where,
      orderBy: { startDate: "desc" },
      take: Math.min(limit, 200),
      skip: offset,
    }),
    prisma.trainingLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, limit: Math.min(limit, 200), offset });
}
