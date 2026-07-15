import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { disconnectGarmin } from "@/lib/garmin";

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await disconnectGarmin(session.user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to disconnect Garmin";
    console.error("[garmin-disconnect]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
