import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { detectDuplicates, persistDuplicateGroups } from "@/lib/duplicate-detector";

/**
 * POST /api/duplicates/detect
 *
 * Run duplicate detection for the current user's activities.
 * Returns detected groups without persisting them unless ?persist=true.
 *
 * Query params:
 *   persist=true  — also save the groups to the database
 *   dryRun=true   — (default) just return results, don't save
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const persist = searchParams.get("persist") === "true";

  try {
    const result = await detectDuplicates(session.user.id);

    let persistedCount = 0;
    if (persist && result.groups.length > 0) {
      persistedCount = await persistDuplicateGroups(session.user.id, result.groups);
    }

    return NextResponse.json({
      ...result,
      persisted: persistedCount,
      message: persist
        ? `Found ${result.groups.length} duplicate group(s), saved ${persistedCount}`
        : `Found ${result.groups.length} potential duplicate group(s) (dry run)`,
    });
  } catch (err) {
    console.error("Duplicate detection error:", err);
    return NextResponse.json({
      error: `Detection failed: ${(err as Error).message}`,
    }, { status: 500 });
  }
}
