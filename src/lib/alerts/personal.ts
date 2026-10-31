import { emailConfig, sendEmail } from "./smtp";

/**
 * Alerts meant for the owner only (paper-trading fills and stops, the Fyers login reminder).
 * They go by email to PERSONAL_ALERT_EMAIL, never to the customer list in EMAIL_TO, and are skipped
 * when that address or the SMTP settings are missing. Telegram is not used (blocked on the office laptop).
 */

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function ownerAlertAddress(): string | null {
  const address = process.env.PERSONAL_ALERT_EMAIL?.trim();
  return address && address.includes("@") && emailConfig() ? address : null;
}

/** Sends one email to the owner. Returns false when alerts are not configured or sending fails; never throws. */
export async function notifyOwner(subject: string, lines: string[]): Promise<boolean> {
  const to = ownerAlertAddress();
  if (!to || !lines.length) return false;
  const html = `<div style="font:14px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:560px">${lines.map((line) => `<p style="margin:0 0 12px 0;white-space:pre-line">${esc(line)}</p>`).join("")}</div>`;
  try {
    await sendEmail(subject, html, lines.join("\n\n"), [], to);
    return true;
  } catch (error) {
    console.error("[alerts] owner email failed:", error instanceof Error ? error.message : error);
    return false;
  }
}
