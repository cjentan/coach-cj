import { NextResponse } from "next/server";
import { z } from "zod";
import { ActivitySubType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";
import { classifyWorkoutType } from "@/lib/workout-classifier";

const manualSchema = z.object({
  name: z.string().min(1, "Activity name is required"),
  type: z.enum(["run", "ride", "swim", "hike", "walk", "workout", "other"]),
  subType: z.string().nullable().optional(),
  startDate: z.string().transform((s) => new Date(s)),
  durationSeconds: z.number().int().positive(),
  distanceMeters: z.number().positive().nullable().optional(),
  elevationGainMeters: z.number().positive().nullable().optional(),
  averageHr: z.number().positive().nullable().optional(),
  maxHr: z.number().positive().nullable().optional(),
  description: z.string().nullable().optional(),
  calories: z.number().positive().nullable().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = manualSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const data = parsed.data;

    // Simple TSS estimate
    const hours = data.durationSeconds / 3600;
    const tss = data.averageHr && data.maxHr
      ? Math.round((data.durationSeconds * (data.averageHr / data.maxHr) * (data.averageHr / data.maxHr)) / 36)
      : Math.round(hours * 50);

    const activity = await prisma.trainingLog.create({
      data: {
        userId: session.user.id,
        externalId: `manual-${Date.now()}`,
        source: "manual",
        type: data.type,
        subType: (data.subType as ActivitySubType) || null,
        name: data.name,
        description: data.description || null,
        startDate: data.startDate,
        durationSeconds: data.durationSeconds,
        distanceMeters: data.distanceMeters || null,
        elevationGainMeters: data.elevationGainMeters || null,
        averageHr: data.averageHr || null,
        maxHr: data.maxHr || null,
        calories: data.calories || null,
        tss,
      },
    });

    // Classify workout type from available data
    const workoutType = classifyWorkoutType({
      type: data.type,
      subType: data.subType,
      durationSeconds: data.durationSeconds,
      distanceMeters: data.distanceMeters,
      averageHr: data.averageHr,
      maxHr: data.maxHr,
    });
    if (workoutType) {
      await prisma.trainingLog.update({
        where: { id: activity.id },
        data: { workoutType },
      }).catch(() => {});
    }

    // Snapshot the affected week so trends stay current
    await snapshotWeek(session.user.id, getWeekStart(data.startDate)).catch(() => {});

    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    console.error("Manual entry error:", err);
    return NextResponse.json({ error: "Failed to create activity" }, { status: 500 });
  }
}
