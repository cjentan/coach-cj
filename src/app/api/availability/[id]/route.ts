import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getOwned(id: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const item = await prisma.trainingAvailability.findUnique({ where: { id, userId: session.user.id } });
  if (!item) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { item };
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const result = await getOwned(params.id);
  if ("error" in result) return result.error;
  await prisma.trainingAvailability.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
