import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const analysisSchema = z.object({
  analysisTrigger: z.enum(["activity_count", "daily", "weekly", "monthly"]),
  analysisTriggerValue: z.number().int().min(1).max(20).default(3),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { analysisTrigger: true, analysisTriggerValue: true },
  });

  const lastReport = await prisma.analysisReport.findFirst({
    where: { userId: session.user.id, reportType: "coach_notes" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return NextResponse.json({
    analysisTrigger: user?.analysisTrigger || "weekly",
    analysisTriggerValue: user?.analysisTriggerValue || 1,
    lastAnalysisAt: lastReport?.createdAt?.toISOString() || null,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = analysisSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      analysisTrigger: parsed.data.analysisTrigger,
      analysisTriggerValue: parsed.data.analysisTrigger === "activity_count" ? parsed.data.analysisTriggerValue : 1,
    },
  });

  return NextResponse.json({ success: true });
}
