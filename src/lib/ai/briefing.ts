import { parseStringArray, type Usage } from "./claude.ts";

/**
 * "Today at a glance": four or five plain lines at the top of the pre-open email. Always present: written by Claude from a small block of
 * facts when an API key is set, otherwise built by plain code from the same facts. Claude only rephrases facts it is given.
 */
export interface BriefingPick {
  symbol: string;
  /** The single status the app shows, e.g. "Paper trade", "Buy now", "Wait". */
  status: string;
  /** Percent under (negative) or past (positive) the breakout level. */
  ext: number | null;
  resultsInDays: number | null;
  /** The news check's one-liner when it flagged watch or caution. */
  news: string | null;
}

export interface BriefingFacts {
  date: string;
  outlook: { label: string; score: number; conviction: string } | null;
  giftGapPercent: number | null;
  breadth50: number | null;
  nifty: { above: boolean; percent: number } | null;
  /** The setup check (breadth only) lets real buys happen today. */
  setupAllowed: boolean;
  /** The setup check's own explanation. */
  setupReason: string;
  /** Stocks just through, or just under, their breakout level on the tested screens. */
  candidates: BriefingPick[];
  /** Strong stocks to wait on (extended or not yet buyable), names only. */
  waiting: string[];
}

export const BRIEFING_MAX_LINES = 5;
const MAX_LENGTH = 190;
const MAX_CALLS_PER_DAY = 6;

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

/** The same four-to-five lines, written by plain code; used when no key is set or the AI call fails. */
export function briefingFallback(f: BriefingFacts): string[] {
  const lines: string[] = [];
  if (f.outlook) lines.push(`Outlook: ${f.outlook.label.toLowerCase()}, ${f.outlook.conviction.toLowerCase()} conviction${f.giftGapPercent != null ? `; GIFT Nifty is ${signed(f.giftGapPercent)} against the last close` : ""}.`);
  lines.push(`Setup check ${f.setupAllowed ? "passed" : "not passed"}: ${f.setupReason}.`);
  if (f.candidates.length) {
    lines.push(`On the tested setup: ${f.candidates.slice(0, 5).map((p) => `${p.symbol} (${p.status})`).join(", ")}${f.candidates.length > 5 ? ` and ${f.candidates.length - 5} more` : ""}.`);
  } else lines.push("No stock is under its breakout level or just through it on the tested screens.");
  const soon = f.candidates.filter((p) => p.resultsInDays != null && p.resultsInDays <= 5);
  const flagged = f.candidates.filter((p) => p.news);
  if (soon.length) lines.push(`Results within 5 days: ${soon.map((p) => `${p.symbol} (${p.resultsInDays === 0 ? "today" : `${p.resultsInDays}d`})`).join(", ")}. Wait until they are out.`);
  else if (flagged.length) lines.push(`News to read first: ${flagged.slice(0, 3).map((p) => `${p.symbol}: ${p.news}`).join(" ")}`);
  lines.push(f.setupAllowed ? "Real buys are allowed for the stocks marked Buy now or Buy on breakout; place the stop first." : "Paper trade only today. Use the time to watch the list and read the announcements.");
  return lines.slice(0, BRIEFING_MAX_LINES).map((l) => (l.length > MAX_LENGTH ? `${l.slice(0, MAX_LENGTH - 1)}…` : l));
}

export const BRIEFING_SYSTEM = `You write the "Today at a glance" block for a retail investor's pre-open email in India. You are given a small JSON of facts. Write 4 or 5 short lines in plain English using ONLY those facts.
Rules:
- Line 1 states whether the setup check passed and why, in plain words.
- Then the market outlook, then which stocks are on the tested setup and their status, then anything to read first (results within 5 days, news flags), then one line on what to do today.
- Use the status words exactly as given (for example "Paper trade", "Buy now", "Wait"). Never say buy or sell on your own, never predict prices, never add facts.
- Each line under 170 characters, no emojis, no bullet characters.
Reply with ONLY a JSON array of strings, nothing else.`;

export function buildBriefingPrompt(f: BriefingFacts): string {
  return JSON.stringify(f);
}

export function parseBriefing(text: string): string[] {
  return parseStringArray(text, BRIEFING_MAX_LINES, MAX_LENGTH);
}

export interface BriefingCache {
  day: string;
  key: string;
  lines: string[];
  calls: number;
}

export interface BriefingDeps {
  apiKey: string | undefined;
  today: string;
  readCache(): BriefingCache | null;
  writeCache(cache: BriefingCache): void;
  ask(system: string, user: string, apiKey: string): Promise<{ text: string; usage: Usage }>;
  recordUsage(usage: Usage): void;
}

export interface BriefingResult {
  lines: string[];
  /** The lines were written by Claude (otherwise by plain code). */
  ai: boolean;
}

/** Same facts, same day: the saved lines. A changed fact (for example the GIFT gap) asks again, at most six times a day. Never throws. */
export async function getBriefing(facts: BriefingFacts, deps: BriefingDeps): Promise<BriefingResult> {
  const fallback = (): BriefingResult => ({ lines: briefingFallback(facts), ai: false });
  if (!deps.apiKey) return fallback();
  const key = buildBriefingPrompt(facts);
  const saved = deps.readCache();
  const today = saved && saved.day === deps.today ? saved : null;
  if (today && today.key === key && today.lines.length) return { lines: today.lines, ai: true };
  if (today && today.calls >= MAX_CALLS_PER_DAY) return today.lines.length ? { lines: today.lines, ai: true } : fallback();
  try {
    const reply = await deps.ask(BRIEFING_SYSTEM, key, deps.apiKey);
    deps.recordUsage(reply.usage);
    const lines = parseBriefing(reply.text);
    if (lines.length < 3) return fallback();
    deps.writeCache({ day: deps.today, key, lines, calls: (today?.calls ?? 0) + 1 });
    return { lines, ai: true };
  } catch (error) {
    console.error("[briefing] using the plain-code version:", error instanceof Error ? error.message : error);
    return fallback();
  }
}

