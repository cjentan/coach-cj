import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import fs from "fs";
import path from "path";

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "data", "backups");

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataFile = path.join(BACKUP_DIR, `${session.user.id}.tar.gz`);

  let contents: Buffer;
  let mtime: Date;
  try {
    const stat = fs.statSync(dataFile);
    contents = fs.readFileSync(dataFile);
    mtime = stat.mtime;
  } catch {
    return NextResponse.json({ error: "No backup available" }, { status: 404 });
  }

  const dateStr = mtime.toISOString().split("T")[0];

  return new NextResponse(new Uint8Array(contents), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": contents.length.toString(),
      "Content-Disposition": `attachment; filename="coach-backup-${dateStr}.tar.gz"`,
    },
  });
}
