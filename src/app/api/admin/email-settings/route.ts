import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getEmailConfig, createResend, EMAIL_KEYS } from "@/lib/email";

const SETTING_KEYS = [...EMAIL_KEYS, "reset_link_expiry_hours"];

const saveSchema = z.object({
  resend_api_key: z.string().optional(),
  email_from: z.string().optional(),
  reset_link_expiry_hours: z.string().optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await prisma.appSetting.findMany({
    where: { key: { in: SETTING_KEYS } },
  });

  const result: Record<string, string> = {};
  for (const k of SETTING_KEYS) {
    result[k] = settings.find((s) => s.key === k)?.value || "";
  }

  return NextResponse.json(result);
}

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
  }

  return NextResponse.json({ success: true });
}

const testSchema = z.object({
  to: z.string().email("Valid recipient email required"),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const config = await getEmailConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Resend not configured. Save an API key and from address first." },
      { status: 400 }
    );
  }

  try {
    const resend = createResend(config);
    await resend.emails.send({
      from: config.email_from,
      to: parsed.data.to,
      subject: "Coach — Test Email",
      text: "This is a test email from Coach. Your Resend configuration is working correctly.",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="font-size: 20px; margin-bottom: 12px;">✅ Test Email</h1>
          <p style="color: #555; line-height: 1.5;">
            This is a test email from <strong>Coach</strong>. Your Resend configuration is working correctly.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">
            Sent from your Coach application &bull; ${new Date().toISOString()}
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
