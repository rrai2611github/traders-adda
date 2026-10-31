/** Minimal Telegram Bot API client for personal alerts. The token never leaves the server. */

const MAX_MESSAGE = 4000;

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export function telegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Splits on blank lines so each message stays under Telegram's 4096-character limit. */
export function splitMessage(text: string, max = MAX_MESSAGE): string[] {
  const parts: string[] = [];
  let current = "";
  for (const block of text.split("\n\n")) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= max) current = next;
    else {
      if (current) parts.push(current);
      current = block.slice(0, max);
    }
  }
  if (current) parts.push(current);
  return parts;
}

export async function sendTelegram(text: string, config: TelegramConfig | null = telegramConfig()): Promise<number> {
  if (!config) throw new Error("Telegram is not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local.");
  const parts = splitMessage(text);
  for (const part of parts) {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text: part, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // Telegram always answers in JSON; an HTML page means a proxy or firewall answered instead.
      if (!response.headers.get("content-type")?.includes("json")) {
        throw new Error(`Could not reach Telegram: this network blocks api.telegram.org (HTTP ${response.status}). Run the app on a network that allows Telegram.`);
      }
      const body = (await response.json().catch(() => null)) as { description?: string } | null;
      throw new Error(`Telegram rejected the message (${response.status}${body?.description ? `: ${body.description}` : ""}).`);
    }
  }
  return parts.length;
}
