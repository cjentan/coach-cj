import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const analysisSchema = z.object({
  analysisTrigger: z.enum(["activity_count", "daily", "weekly", "monthly", "every_n_days"]),
  analysisTriggerValue: z.number().int().min(1).max(90).default(3),
  reviewDayOfWeek: z.number().int().min(0).max(6).optional(),
  reviewTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reviewDayOfMonth: z.number().int().min(1).max(31).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { analysisTrigger: true, analysisTriggerValue: true, reviewDayOfWeek: true, reviewTime: true, reviewDayOfMonth: true },
  });

  const lastReport = await prisma.analysisReport.findFirst({
    where: { userId: session.user.id, reportType: "coach_notes" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return NextResponse.json({
    analysisTrigger: user?.analysisTrigger || "weekly",
    analysisTriggerValue: user?.analysisTriggerValue || 1,
    reviewDayOfWeek: user?.reviewDayOfWeek ?? 0,
    reviewTime: user?.reviewTime ?? "18:00",
    reviewDayOfMonth: user?.reviewDayOfMonth ?? 1,
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

  const data: Record<string, any> = {
    analysisTrigger: parsed.data.analysisTrigger,
    analysisTriggerValue: parsed.data.analysisTrigger === "activity_count" || parsed.data.analysisTrigger === "every_n_days" ? parsed.data.analysisTriggerValue : 1,
  };

  // Save review schedule fields when provided
  if (parsed.data.reviewDayOfWeek !== undefined) data.reviewDayOfWeek = parsed.data.reviewDayOfWeek;
  if (parsed.data.reviewTime !== undefined) data.reviewTime = parsed.data.reviewTime;
  if (parsed.data.reviewDayOfMonth !== undefined) data.reviewDayOfMonth = parsed.data.reviewDayOfMonth;

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  return NextResponse.json({ success: true });
}
