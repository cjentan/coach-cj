import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCorosClient, syncCorosActivities } from "@/lib/coros";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await getCorosClient(session.user.id);
    if (!client) {
      return NextResponse.json(
        {
          error:
            "COROS not connected. Connect your COROS Training Hub account in Settings first.",
        },
        { status: 400 }
      );
    }

    const { fromDate, toDate } = await req.json().catch(() => ({}));

    const activitiesImported = await syncCorosActivities(
      client,
      session.user.id,
      true,
      fromDate,
      toDate
    );

    return NextResponse.json({
      success: true,
      activitiesImported,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Sync failed";
    console.error("[coros-sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
