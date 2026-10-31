import type { Announcement } from "../market/announcements.ts";
import type { BacktestResult, Trade } from "../backtest/types.ts";
import { parseStringArray, type Usage } from "./claude.ts";

/**
 * The weekly trade review for the live strategy check (owner-only). The facts and the rule checks are plain code and always sent; when an
 * API key is set, Claude adds an "analyst read" that sorts each loss into a normal stop, a gap, or something the announcements explain.
 */
export interface ReviewFacts {
  weekStart: string;
  weekEnd: string;
  account: { value: number; profit: number; profitPercent: number; niftyPercent: number | null; sessions: number };
  closed: Array<Pick<Trade, "symbol" | "entryDay" | "entryPrice" | "exitDay" | "exitPrice" | "exitReason" | "holdDays" | "r" | "pnl">>;
  opened: Array<{ symbol: string; entryDay: string; entryPrice: number }>;
  held: Array<{ symbol: string; entryDay: string; gainPercent: number; stop: number; last: number; exitLevel: number | null; distanceToExitPercent: number | null }>;
  sinceStart: { closed: number; wins: number; avgR: number | null };
  checks: string[];
  /** Announcement subjects (newest first) for each stock that closed this week. */
  announcements: Record<string, string[]>;
}

const dayMs = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday of the week that contains `isoDay`. */
export function weekStartOf(isoDay: string): string {
  const d = Date.parse(`${isoDay}T00:00:00Z`);
  const weekday = new Date(d).getUTCDay();
  return iso(d - ((weekday + 6) % 7) * dayMs);
}

/** True when `lastDay` is a Friday, or no later session remains this week (a holiday Friday, say). */
export function isLastSessionOfWeek(lastDay: string, isTradingDay: (isoDay: string) => boolean): boolean {
  const d = Date.parse(`${lastDay}T00:00:00Z`);
  const weekday = new Date(d).getUTCDay();
  if (weekday === 5) return true;
  if (weekday === 6 || weekday === 0) return false;
  for (let k = 1; weekday + k <= 5; k += 1) if (isTradingDay(iso(d + k * dayMs))) return false;
  return true;
}

function maxConcurrent(trades: ReadonlyArray<{ entryDay: string; exitDay: string }>): number {
  let best = 0;
  for (const t of trades) {
    const n = trades.filter((o) => o.entryDay <= t.entryDay && o.exitDay > t.entryDay).length;
    if (n > best) best = n;
  }
  return best;
}

export function buildReviewFacts(
  result: BacktestResult,
  config: { capital: number; stopPercent: number; maxPositions?: number },
  announcements: Record<string, Announcement[]> = {},
): ReviewFacts {
  const weekEnd = result.data.lastDay;
  const weekStart = weekStartOf(weekEnd);
  const done = result.trades.filter((t) => t.exitReason !== "end");
  const closed = done.filter((t) => t.exitDay >= weekStart && t.exitDay <= weekEnd);
  const opened = [
    ...done.filter((t) => t.entryDay >= weekStart).map((t) => ({ symbol: t.symbol, entryDay: t.entryDay, entryPrice: t.entryPrice })),
    ...result.openPositions.filter((p) => p.entryDay >= weekStart).map((p) => ({ symbol: p.symbol, entryDay: p.entryDay, entryPrice: p.entryPrice })),
  ];
  const profit = result.markedValue - config.capital;
  const bench = result.equity.benchmark;
  const wins = done.filter((t) => t.pnl > 0).length;
  const checks: string[] = [];
  const limit = config.maxPositions ?? 10;
  const all = [...done, ...result.openPositions.map((p) => ({ entryDay: p.entryDay, exitDay: "9999-12-31" }))];
  const peak = maxConcurrent(all);
  if (peak > limit) checks.push(`More than ${limit} positions were held at once (${peak}).`);
  for (const t of closed) {
    const stopPrice = t.entryPrice * (1 - config.stopPercent / 100);
    if (t.exitReason === "stop" && t.exitPrice < stopPrice * 0.995) {
      checks.push(`${t.symbol} gapped through its stop: sold at ₹${t.exitPrice.toFixed(2)}, ${(((stopPrice - t.exitPrice) / stopPrice) * 100).toFixed(1)}% under the ${config.stopPercent}% stop level of ₹${stopPrice.toFixed(2)}.`);
    }
  }
  if (!checks.length) checks.push(`Rule checks clear: never more than ${limit} positions at once and no stop sold more than 0.5% below its level. (Limited checks: they cannot see your own orders.)`);
  return {
    weekStart,
    weekEnd,
    account: { value: result.markedValue, profit, profitPercent: (profit / config.capital) * 100, niftyPercent: bench.length > 1 ? (bench[bench.length - 1] / bench[0] - 1) * 100 : null, sessions: result.data.sessions },
    closed: closed.map((t) => ({ symbol: t.symbol, entryDay: t.entryDay, entryPrice: t.entryPrice, exitDay: t.exitDay, exitPrice: t.exitPrice, exitReason: t.exitReason, holdDays: t.holdDays, r: t.r, pnl: t.pnl })),
    opened,
    held: result.openPositions.map((p) => ({
      symbol: p.symbol, entryDay: p.entryDay, gainPercent: (p.last / (p.spent / p.quantity) - 1) * 100, stop: p.stop, last: p.last, exitLevel: p.exitLevel,
      distanceToExitPercent: p.exitLevel != null ? (p.last / p.exitLevel - 1) * 100 : null,
    })),
    sinceStart: { closed: done.length, wins, avgR: done.length ? done.reduce((a, t) => a + t.r, 0) / done.length : null },
    checks,
    announcements: Object.fromEntries(closed.map((t) => [t.symbol, (announcements[t.symbol] ?? []).slice(0, 5).map((a) => `${a.at.slice(0, 11)} ${a.subject}`)])),
  };
}

const inr = (v: number) => `₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
const sgn = (v: number) => `${v >= 0 ? "+" : "−"}${inr(v)}`;
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

/** The facts as plain lines; always sent. */
export function reviewLines(f: ReviewFacts): string[] {
  const why = (r: ReviewFacts["closed"][number]) => (r.exitReason === "stop" ? "hit its stop" : "closed under its 50-day average");
  const lines = [
    `Week ${f.weekStart} to ${f.weekEnd}: account ${inr(f.account.value)} (${sgn(f.account.profit)}, ${pct(f.account.profitPercent)} since the start${f.account.niftyPercent != null ? `; Nifty 50 ${pct(f.account.niftyPercent)}` : ""}).`,
    f.closed.length ? `Closed this week: ${f.closed.map((t) => `${t.symbol} ${why(t)} (${t.r >= 0 ? "+" : "−"}${Math.abs(t.r).toFixed(2)}R, ${sgn(t.pnl)}, ${t.holdDays} sessions)`).join("; ")}.` : "No trade closed this week.",
    f.opened.length ? `Bought this week: ${f.opened.map((t) => `${t.symbol} at ₹${t.entryPrice.toFixed(2)}`).join(", ")}.` : "No new buys this week.",
  ];
  if (f.held.length) {
    lines.push(`Held now (${f.held.length}): ${f.held.map((h) => `${h.symbol} ${pct(h.gainPercent)}${h.distanceToExitPercent != null ? `, ${h.distanceToExitPercent.toFixed(1)}% above its exit level${h.distanceToExitPercent < 3 ? " ⚠" : ""}` : ""}`).join("; ")}.`);
  } else lines.push("Nothing is held.");
  lines.push(`Since the start: ${f.sinceStart.closed} closed trades, ${f.sinceStart.wins} won${f.sinceStart.avgR != null ? `, average ${f.sinceStart.avgR >= 0 ? "+" : "−"}${Math.abs(f.sinceStart.avgR).toFixed(2)}R` : ""}. ${f.sinceStart.closed < 30 ? "Too few trades to judge the rules; the backtest needed about 30 a year." : "Compare with the backtest's about +1.0R a trade."}`);
  lines.push(...f.checks);
  return lines;
}

export const REVIEW_SYSTEM = `You are a trading-journal reviewer for a retail investor following fixed, tested rules (buy breakouts, 8% stop or 12%, exit when the stock closes under its 50-day average). You are given one week's facts as JSON, including recent exchange announcements for stocks that closed.
Write the "analyst read": 4 to 6 short lines in plain English using ONLY the facts.
- Sort each loss into: a normal stop (inside the rules), a gap through the stop, or something the announcements explain (name the announcement).
- Note any holding close to its exit level.
- Say one thing to watch next week, taken from the facts.
- Remind that one week proves nothing when fewer than 30 trades have closed.
- Never suggest changing the rules, the stop, or position sizes. Never predict prices. Never say buy or sell. Do not add facts.
- Each line under 220 characters, no emojis, no bullet characters.
Reply with ONLY a JSON array of strings.`;

export const buildReviewPrompt = (f: ReviewFacts) => JSON.stringify(f);
export const parseReview = (text: string) => parseStringArray(text, 6, 220);

export interface ReviewDeps {
  apiKey: string | undefined;
  ask(system: string, user: string, apiKey: string): Promise<{ text: string; usage: Usage }>;
  recordUsage(usage: Usage): void;
}

/** The analyst read, or null when there is no key, nothing to discuss, or the call fails. Never throws. */
export async function getAnalystRead(f: ReviewFacts, deps: ReviewDeps): Promise<string[] | null> {
  if (!deps.apiKey || (!f.closed.length && !f.held.length)) return null;
  try {
    const reply = await deps.ask(REVIEW_SYSTEM, buildReviewPrompt(f), deps.apiKey);
    deps.recordUsage(reply.usage);
    const lines = parseReview(reply.text);
    return lines.length >= 2 ? lines : null;
  } catch (error) {
    console.error("[weekly-review] analyst read skipped:", error instanceof Error ? error.message : error);
    return null;
  }
}

export function reviewSubject(f: ReviewFacts): string {
  return `Weekly review · live strategy check · ${pct(f.account.profitPercent)} · ${f.closed.length} closed · week to ${f.weekEnd}`;
}
