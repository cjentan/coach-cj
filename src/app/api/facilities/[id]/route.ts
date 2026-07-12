import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getOwned(req: Request, params: { id: string }) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const item = await prisma.trainingFacility.findUnique({ where: { id: params.id, userId: session.user.id } });
  if (!item) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { session, item };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const result = await getOwned(req, params);
  if ("error" in result) return result.error;
  return NextResponse.json(result.item);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const result = await getOwned(req, params);
  if ("error" in result) return result.error;
  const body = await req.json();
  const updated = await prisma.trainingFacility.update({ where: { id: params.id }, data: body });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const result = await getOwned(req, params);
  if ("error" in result) return result.error;
  await prisma.trainingFacility.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
