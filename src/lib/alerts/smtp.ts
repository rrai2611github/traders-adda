import { emailProviderConfig, sendEmailViaProvider, verifyEmailProvider, type EmailAttachment } from "../emailProvider.ts";
import { emailFailureDetail, recordEmailActivity, type EmailActivitySource } from "./emailActivity.ts";

export type { EmailAttachment } from "../emailProvider.ts";

export interface EmailConfig {
  from: string;
  fromName: string;
  to: string;
}

/** EMAIL_TO may list several comma-separated addresses; a repeated one would otherwise get duplicate mail. */
function uniqueRecipients(value: string | undefined): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const address of (value ?? "").split(",")) {
    const trimmed = address.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
  }
  return kept.join(",");
}

export function emailConfig(): EmailConfig | null {
  const provider = emailProviderConfig();
  const to = uniqueRecipients(process.env.EMAIL_TO);
  if (!provider || !to) return null;
  return { from: provider.from, fromName: provider.fromName, to };
}

export async function verifyEmailConnection(): Promise<void> {
  const config = emailConfig();
  if (!config) throw new Error("Email is not configured: set RESEND_API_KEY, EMAIL_FROM, and EMAIL_TO.");
  await verifyEmailProvider();
}

export async function sendEmail(
  subject: string,
  html: string,
  text: string,
  attachments: EmailAttachment[] = [],
  /** Overrides EMAIL_TO for a one-off test send. */
  to?: string,
  source: EmailActivitySource = "other",
): Promise<string> {
  const activity = { source, subject, test: subject.startsWith("[TEST]") };
  try {
    const config = emailConfig();
    if (!config) throw new Error("Email is not configured: set RESEND_API_KEY, EMAIL_FROM, and EMAIL_TO.");
    const messageId = await sendEmailViaProvider({
      from: config.from,
      to: to ?? config.to,
      subject,
      html,
      text,
      attachments,
    });
    recordEmailActivity({
      ...activity, status: "accepted",
      detail: `Resend accepted the request as ${messageId}. Inbox delivery is not confirmed.`,
    });
    console.log(`[email] Resend accepted "${subject}" from ${config.from} to ${to ?? config.to}: ${messageId}`);
    return messageId;
  } catch (error) {
    recordEmailActivity({ ...activity, status: "failed", detail: emailFailureDetail(error) });
    throw error;
  }
}
