import { Resend } from "resend";
import { prisma } from "./prisma";

export const EMAIL_KEYS = ["resend_api_key", "email_from"] as const;

export interface EmailConfig {
  resend_api_key: string;
  email_from: string;
}

export async function getEmailConfig(): Promise<EmailConfig | null> {
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: [...EMAIL_KEYS] } },
  });

  const cfg: Record<string, string> = {};
  for (const k of EMAIL_KEYS) {
    cfg[k] = settings.find((s) => s.key === k)?.value || "";
  }

  if (!cfg.resend_api_key || !cfg.email_from) return null;
  return cfg as unknown as EmailConfig;
}

export function createResend(config: EmailConfig) {
  return new Resend(config.resend_api_key);
}
