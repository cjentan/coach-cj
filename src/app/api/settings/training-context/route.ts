import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { trainingContext: true },
  });

  return NextResponse.json({
    trainingContext: user?.trainingContext || "",
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const trainingContext = typeof body.trainingContext === "string" ? body.trainingContext : "";

  await prisma.user.update({
    where: { id: session.user.id },
    data: { trainingContext },
  });

  return NextResponse.json({ success: true });
}
