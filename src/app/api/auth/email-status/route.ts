import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [apiKey, fromAddr] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: "resend_api_key" } }),
    prisma.appSetting.findUnique({ where: { key: "email_from" } }),
  ]);

  const configured = !!(apiKey?.value && fromAddr?.value);

  return NextResponse.json({ configured });
}
