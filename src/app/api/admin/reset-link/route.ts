import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getEmailConfig, createResend } from "@/lib/email";

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const token = randomBytes(32).toString("hex");

  // Read expiry from settings, default to 4 hours
  const expirySetting = await prisma.appSetting.findUnique({
    where: { key: "reset_link_expiry_hours" },
  });
  const expiryHours = parseInt(expirySetting?.value || "4", 10);
  const expiry = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: { resetToken: token, resetTokenExpiry: expiry },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL}/auth/reset-password?token=${token}`;

  // Attempt to send email if Resend is configured
  let emailStatus: { sent: boolean; error?: string } = { sent: false };

  const emailConfig = await getEmailConfig();
  if (emailConfig) {
    try {
      const resend = createResend(emailConfig);
      await resend.emails.send({
        from: emailConfig.email_from,
        to: user.email,
        subject: "Coach — Password Reset",
        text: `You requested a password reset. Click this link to reset your password: ${resetUrl}\n\nThis link expires in ${expiryHours} hours.\n\nIf you did not request this, you can safely ignore this email.`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h1 style="font-size: 20px; margin-bottom: 8px;">Password Reset</h1>
            <p style="color: #555; line-height: 1.5;">
              A password reset was requested for your <strong>Coach</strong> account.
            </p>
            <a href="${resetUrl}"
               style="display: inline-block; margin: 20px 0; padding: 12px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
              Reset Password
            </a>
            <p style="color: #999; font-size: 13px;">
              This link expires in <strong>${expiryHours} hour${expiryHours !== 1 ? "s" : ""}</strong>.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="color: #999; font-size: 12px;">
              If you did not request this password reset, you can safely ignore this email.
            </p>
          </div>
        `,
      });
      emailStatus = { sent: true };
    } catch (err) {
      emailStatus = {
        sent: false,
        error: err instanceof Error ? err.message : "Failed to send email",
      };
    }
  }

  return NextResponse.json({
    resetUrl,
    expiresAt: expiry,
    email: emailStatus,
  });
}
