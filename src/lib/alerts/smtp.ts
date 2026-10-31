import nodemailer from "nodemailer";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  fromName: string;
  to: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid?: string;
  contentDisposition?: "inline" | "attachment";
}

/**
 * The brand shown as the sender name. The address beside it must be one the
 * SMTP account is allowed to send as: Gmail silently rewrites the From header
 * back to SMTP_USER for any address that is not a verified alias, and mail
 * from a domain you do not control fails SPF/DKIM and lands in spam.
 */
const DEFAULT_FROM_NAME = "Traders Adda";

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
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? "465");
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_APP_PASSWORD?.replace(/\s+/g, "");
  const from = process.env.EMAIL_FROM?.trim() || user;
  // Quotes and newlines would break out of the header's quoted string.
  const fromName = (process.env.EMAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME).replace(/["\r\n]/g, "");
  const to = uniqueRecipients(process.env.EMAIL_TO);
  if (!host || !Number.isInteger(port) || port <= 0 || !user || !password || !from || !to) return null;
  return { host, port, secure: process.env.SMTP_SECURE !== "0", user, password, from, fromName, to };
}

function transporter(config: EmailConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

export async function verifyEmailConnection(): Promise<void> {
  const config = emailConfig();
  if (!config) throw new Error("Email is not configured: set the SMTP and EMAIL values in .env.local.");
  await transporter(config).verify();
}

export async function sendEmail(
  subject: string,
  html: string,
  text: string,
  attachments: EmailAttachment[] = [],
  /** Overrides EMAIL_TO for a one-off test send. */
  to?: string,
): Promise<string> {
  const config = emailConfig();
  if (!config) throw new Error("Email is not configured: set the SMTP and EMAIL values in .env.local.");
  const result = await transporter(config).sendMail({
    from: `"${config.fromName}" <${config.from}>`,
    to: to ?? config.to,
    subject,
    html,
    text,
    attachments,
  });
  if (!result.messageId) throw new Error("SMTP accepted the request but returned no message id.");
  console.log(`[email] sent "${subject}" from ${config.from} to ${result.accepted.length} recipient(s): ${result.accepted.join(", ")}` +
    (result.rejected.length ? ` | rejected: ${result.rejected.join(", ")}` : ""));
  return result.messageId;
}
