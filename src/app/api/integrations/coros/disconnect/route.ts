import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { disconnectCoros } from "@/lib/coros";

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await disconnectCoros(session.user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to disconnect COROS";
    console.error("[coros-disconnect]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
