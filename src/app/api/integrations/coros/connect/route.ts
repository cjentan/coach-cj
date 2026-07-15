import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectCoros } from "@/lib/coros";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    await connectCoros(session.user.id, email, password);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to connect COROS";

    console.error("[coros-connect]", message);

    if (message.includes("429") || message.includes("too many")) {
      return NextResponse.json(
        { error: "Too many login attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }
    if (message.includes("1030") || message.includes("LoginError") || message.includes("credentials")) {
      return NextResponse.json(
        { error: "Invalid email or password. Please check your COROS Training Hub credentials." },
        { status: 401 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
