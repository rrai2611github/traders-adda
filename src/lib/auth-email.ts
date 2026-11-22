import { sendEmailViaProvider } from "@/lib/emailProvider";

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
  const link = escapeHtml(url);
  await sendEmailViaProvider({
    to,
    subject,
    text: `${message}\n\n${url}`,
    html: `<p>${escapeHtml(message)}</p><p><a href="${link}">Continue</a></p>`,
    from: process.env.AUTH_EMAIL_FROM?.trim(),
  });
}
