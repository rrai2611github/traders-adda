import nodemailer from "nodemailer";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for account email delivery.`);
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

export async function sendAccountEmail(to: string, subject: string, message: string, url: string): Promise<void> {
  const host = required("SMTP_HOST");
  const port = Number(process.env.SMTP_PORT ?? "465");
  if (!Number.isInteger(port) || port <= 0) throw new Error("SMTP_PORT must be a positive integer.");
  const user = required("SMTP_USER");
  const password = required("SMTP_APP_PASSWORD").replace(/\s+/g, "");
  const from = process.env.AUTH_EMAIL_FROM?.trim() || process.env.EMAIL_FROM?.trim() || user;
  const fromName = (process.env.EMAIL_FROM_NAME?.trim() || "Traders Adda").replace(/["\r\n]/g, "");
  const link = escapeHtml(url);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE !== "0",
    auth: { user, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  await transport.sendMail({
    from: `"${fromName}" <${from}>`,
    to,
    subject,
    text: `${message}\n\n${url}`,
    html: `<p>${escapeHtml(message)}</p><p><a href="${link}">Continue</a></p>`,
  });
}
