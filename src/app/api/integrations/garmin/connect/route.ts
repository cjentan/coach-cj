import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectGarmin, GarminMFARequiredError } from "@/lib/garmin";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { email, password, mfaCode } = await req.json();
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    await connectGarmin(session.user.id, email, password, mfaCode);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof GarminMFARequiredError) {
      return NextResponse.json(
        { mfaRequired: true, error: "MFA code required" },
        { status: 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to connect Garmin";
    console.error("[garmin-connect]", message);

    // Provide friendlier messages for common failures
    if (message.includes("429") || message.includes("too many")) {
      return NextResponse.json(
        { error: "Too many login attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }
    if (message.includes("401") || message.includes("credentials")) {
      return NextResponse.json(
        { error: "Invalid email or password. Please check your Garmin Connect credentials." },
        { status: 401 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
