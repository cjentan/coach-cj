import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: activityId } = await params;

  // Load the activity
  const activity = await prisma.trainingLog.findUnique({
    where: { id: activityId },
  });

  if (!activity || activity.userId !== session.user.id) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  // Parse optional body overrides
  let body: { priority?: string; targetDate?: string; goalStatement?: string } = {};
  try {
    body = await request.json();
  } catch { /* no body — use defaults */ }

  // Build a sensible race type from the activity type
  let raceType = "other";
  if (activity.type === "run") {
    const distKm = (activity.distanceMeters || 0) / 1000;
    if (distKm >= 42.195) raceType = "marathon";
    else if (distKm > 30) raceType = "ultra";
    else raceType = "road_run";
  } else if (activity.type === "ride") {
    raceType = "cycling";
  } else if (activity.type === "swim") {
    raceType = "triathlon";
  }

  // Default target date: 12 weeks from the activity date
  const activityDate = new Date(activity.startDate);
  const defaultTarget = new Date(activityDate);
  defaultTarget.setDate(defaultTarget.getDate() + 84);

  const targetDate = body.targetDate
    ? new Date(body.targetDate as string)
    : defaultTarget;

  // Create the goal
  const goal = await prisma.raceGoal.create({
    data: {
      userId: session.user.id,
      name: activity.name,
      raceType,
      targetDate,
      distanceMeters: activity.distanceMeters || 0,
      elevationGainMeters: activity.elevationGainMeters ?? undefined,
      priority: (body.priority as "A" | "B" | "C") ?? "B",
      goalStatement: body.goalStatement ?? undefined,
    },
  });

  return NextResponse.json({
    success: true,
    goal: {
      id: goal.id,
      name: goal.name,
      distanceMeters: goal.distanceMeters,
      elevationGainMeters: goal.elevationGainMeters,
      targetDate: goal.targetDate.toISOString().split("T")[0],
      priority: goal.priority,
      raceType: goal.raceType,
    },
  });
}
