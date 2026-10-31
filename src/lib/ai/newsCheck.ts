import type { Announcement } from "../market/announcements.ts";

/**
 * The daily news check: Claude reads each listed stock's recent NSE announcements and writes one short, plain-words note per stock, flagged
 * clear / watch / caution. It sees only the filings it is given and may not predict prices or give advice. One call a day for the whole list.
 */
export type NewsFlag = "clear" | "watch" | "caution";

export interface NewsNote {
  symbol: string;
  flag: NewsFlag;
  /** One sentence, at most ~160 characters, built only from the announcements. */
  note: string;
}

export const NEWS_MODEL = "claude-haiku-5-5";
/** Haiku 5.5 list prices (USD per million tokens, prompts up to 100,000 tokens): platform.claude.com pricing page. */
export const NEWS_PRICE = { inputPerMTok: 0.1, outputPerMTok: 0.5 } as const;
const MAX_SYMBOLS = 10;
const MAX_NOTE = 170;

export const NEWS_SYSTEM = `You are a careful analyst's assistant. For each stock you are given its recent exchange announcements (official filings). Write ONE short sentence per stock in plain words for a retail investor, using ONLY what the announcements say.
Rules:
- Never predict prices, never say buy or sell, never add facts that are not in the announcements.
- If there are no announcements, or they are routine, say "No new announcements" or "Routine filings only" and use flag "clear".
- flag "caution" for: fund raising or share issue/warrants to promoters, auditor resignation or qualified opinion, SEBI/exchange action or penalty, litigation or tax demand, promoter pledge or large promoter selling, senior management resignation, insolvency or default, trading suspension.
- flag "watch" for: results or a board meeting coming up or just announced (say the date if given), large order wins, acquisitions, mergers, demergers, dividends, splits or bonus (say the date if given), analyst call schedule changes.
- flag "clear" otherwise.
- Each note must be under 150 characters.
Reply with ONLY a JSON array, no other text: [{"symbol":"ABC","flag":"clear|watch|caution","note":"..."}] with one object per stock, in the order given.`;

export interface NewsInput {
  symbol: string;
  announcements: Announcement[];
}

/** The user message: each stock with its announcements, newest first. */
export function buildNewsPrompt(entries: ReadonlyArray<NewsInput>): string {
  return entries.slice(0, MAX_SYMBOLS).map((entry) => {
    const lines = entry.announcements.length
      ? entry.announcements.map((a) => `- ${a.at} · ${a.subject}${a.text ? ` · ${a.text}` : ""}`).join("\n")
      : "(no announcements in the last 14 days)";
    return `STOCK ${entry.symbol}\n${lines}`;
  }).join("\n\n");
}

const FLAGS: ReadonlyArray<NewsFlag> = ["clear", "watch", "caution"];

/** Reads the model's reply defensively: the first JSON array found, only known symbols and flags, notes trimmed. */
export function parseNewsReply(text: string, symbols: ReadonlyArray<string>): NewsNote[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(symbols);
  const seen = new Set<string>();
  const out: NewsNote[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { symbol, flag, note } = item as Record<string, unknown>;
    if (typeof symbol !== "string" || typeof note !== "string" || !allowed.has(symbol) || seen.has(symbol)) continue;
    const clean = note.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    seen.add(symbol);
    out.push({ symbol, flag: FLAGS.includes(flag as NewsFlag) ? (flag as NewsFlag) : "watch", note: clean.length > MAX_NOTE ? `${clean.slice(0, MAX_NOTE - 1)}…` : clean });
  }
  return out;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export const costUsd = (u: Usage) => (u.inputTokens * NEWS_PRICE.inputPerMTok + u.outputTokens * NEWS_PRICE.outputPerMTok) / 1_000_000;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One call to the Messages API. Throws on a non-OK reply so the caller can leave the section out. */
export async function askClaude(userText: string, apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<{ text: string; usage: Usage }> {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: NEWS_MODEL, max_tokens: 1200, system: NEWS_SYSTEM, messages: [{ role: "user", content: userText }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Claude API HTTP ${response.status}`);
  const body = (await response.json()) as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { text, usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 } };
}

export interface NewsCache {
  /** IST day the notes were written. */
  day: string;
  notes: Record<string, NewsNote>;
  /** Running totals for the current month, so the real cost is visible. */
  month: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export const emptyCache = (day: string, month: string): NewsCache => ({ day, notes: {}, month, calls: 0, inputTokens: 0, outputTokens: 0 });

export interface NewsDeps {
  apiKey: string | undefined;
  readCache(): NewsCache | null;
  writeCache(cache: NewsCache): void;
  announcementsFor(symbol: string): Promise<Announcement[]>;
  ask(userText: string, apiKey: string): Promise<{ text: string; usage: Usage }>;
  today: string;
  /** When true, only notes already written today are returned and nothing is fetched or paid for. */
  cacheOnly?: boolean;
}

export type NewsResult = { status: "off" | "failed"; notes: Record<string, NewsNote>; message: string } | { status: "ok"; notes: Record<string, NewsNote>; message: string; usage: Usage | null };

/**
 * Notes for these symbols, from today's cache where they exist; the rest come from one call to Claude. With no API key the check is simply off.
 * A failure (NSE or the API) never raises: the email goes out without the lines.
 */
export async function getNews(symbols: ReadonlyArray<string>, deps: NewsDeps): Promise<NewsResult> {
  const wanted = [...new Set(symbols)].slice(0, MAX_SYMBOLS);
  const month = deps.today.slice(0, 7);
  const saved = deps.readCache();
  let cache = saved && saved.day === deps.today ? saved : emptyCache(deps.today, month);
  if (saved && saved.month === month && saved.day !== deps.today) cache = { ...cache, month, calls: saved.calls, inputTokens: saved.inputTokens, outputTokens: saved.outputTokens };
  const have = Object.fromEntries(wanted.filter((s) => cache.notes[s]).map((s) => [s, cache.notes[s]]));
  const missing = wanted.filter((s) => !cache.notes[s]);
  if (!missing.length || deps.cacheOnly) return { status: "ok", notes: have, message: missing.length ? "Only today's saved notes are shown." : "From today's saved notes.", usage: null };
  if (!deps.apiKey) return { status: "off", notes: have, message: "The news check is off: no ANTHROPIC_API_KEY is set." };
  try {
    const entries = await Promise.all(missing.map(async (symbol) => ({ symbol, announcements: await deps.announcementsFor(symbol) })));
    const reply = await deps.ask(buildNewsPrompt(entries), deps.apiKey);
    const notes = parseNewsReply(reply.text, missing);
    const next: NewsCache = {
      ...cache,
      notes: { ...cache.notes, ...Object.fromEntries(notes.map((n) => [n.symbol, n])) },
      calls: cache.calls + 1,
      inputTokens: cache.inputTokens + reply.usage.inputTokens,
      outputTokens: cache.outputTokens + reply.usage.outputTokens,
    };
    deps.writeCache(next);
    return { status: "ok", notes: { ...have, ...Object.fromEntries(notes.map((n) => [n.symbol, n])) }, message: `Wrote ${notes.length} of ${missing.length} notes.`, usage: reply.usage };
  } catch (error) {
    return { status: "failed", notes: have, message: error instanceof Error ? error.message : String(error) };
  }
}
