import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getGarminClient,
  syncGarminActivities,
  syncGarminHealthData,
} from "@/lib/garmin";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await getGarminClient(session.user.id);
    if (!client) {
      return NextResponse.json(
        {
          error:
            "Garmin not connected. Connect your Garmin account in Settings first.",
        },
        { status: 400 }
      );
    }

    const { fromDate, toDate } = await req.json().catch(() => ({}));

    // UI sync = full historical import, optionally filtered by date range
    const [activitiesImported, healthDaysSynced] = await Promise.all([
      syncGarminActivities(client, session.user.id, true, undefined, fromDate, toDate),
      syncGarminHealthData(client, session.user.id),
    ]);

    return NextResponse.json({
      success: true,
      activitiesImported,
      healthDaysSynced,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Sync failed";
    console.error("[garmin-sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
