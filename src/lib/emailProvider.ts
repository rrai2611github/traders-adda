export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid?: string;
  contentDisposition?: "inline" | "attachment";
}

interface EmailProviderConfig {
  apiKey: string;
  from: string;
  fromName: string;
  replyTo?: string;
}

interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  from?: string;
}

export function emailProviderConfig(fromAddress?: string): EmailProviderConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = fromAddress?.trim() || process.env.EMAIL_FROM?.trim();
  const fromName = (process.env.EMAIL_FROM_NAME?.trim() || "Traders Adda").replace(/["\r\n]/g, "");
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from, fromName, ...(replyTo ? { replyTo } : {}) };
}

function providerError(status: number): Error & { code: string } {
  return Object.assign(new Error(`Resend request failed with HTTP ${status}.`), {
    code: `RESEND_HTTP_${status}`,
  });
}

function emailFrom(config: EmailProviderConfig): string {
  return `${config.fromName} <${config.from}>`;
}

export async function sendEmailViaProvider(input: SendEmailInput): Promise<string> {
  const config = emailProviderConfig(input.from);
  if (!config) throw new Error("Email is not configured: set RESEND_API_KEY and EMAIL_FROM.");

  const to = (Array.isArray(input.to) ? input.to : input.to.split(","))
    .map((address) => address.trim())
    .filter(Boolean);
  if (!to.length) throw new Error("Email requires at least one recipient.");

  const attachments = input.attachments?.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content.toString("base64"),
    content_type: attachment.contentType,
    ...(attachment.cid ? { content_id: attachment.cid } : {}),
    ...(attachment.contentDisposition ? { content_disposition: attachment.contentDisposition } : {}),
  }));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom(config),
      to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw providerError(response.status);

  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) {
    throw new Error("Resend accepted the request without returning an email ID.");
  }
  return result.id;
}

export async function verifyEmailProvider(): Promise<void> {
  const config = emailProviderConfig();
  if (!config) throw new Error("Email is not configured: set RESEND_API_KEY and EMAIL_FROM.");

  const response = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw providerError(response.status);
}
