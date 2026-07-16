import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_LOCALES = ["en", "zh-CN", "zh-TW"];

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { locale } = await req.json();
  if (!VALID_LOCALES.includes(locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { locale },
  });

  return NextResponse.json({ success: true });
}
