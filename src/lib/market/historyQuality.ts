import { istDateKey } from "./marketHours.ts";
import type { Candle } from "./types.ts";

export interface HistoryTruncation {
  symbol: string;
  invalidBars: number;
  /** IST session of the latest impossible OHLC bar; only later sessions are used. */
  lastInvalidSession: string;
  keptSessions: number;
}

export interface HistoryExclusion {
  symbol: string;
  reason: string;
}

export interface SnapshotDataQuality {
  /** Histories shortened to the clean sessions after their latest impossible OHLC bar. */
  truncated: HistoryTruncation[];
  /** Histories that could not be used at all. */
  excluded: HistoryExclusion[];
  /** Expired cached histories reused because their refresh failed. */
  historyFallback: string[];
}

/** A failed universe refresh newer than the snapshot still being served. */
export interface RefreshFailure {
  at: number;
  message: string;
}

/** Data-health fields shared by universe-based API payloads. */
export interface DataHealth {
  dataQuality?: SnapshotDataQuality;
  refreshFailure?: RefreshFailure | null;
}

export type HistoryCheck =
  | { ok: true; candles: Candle[]; truncation: Omit<HistoryTruncation, "symbol"> | null }
  | { ok: false; reason: string };

export function emptyDataQuality(): SnapshotDataQuality {
  return { truncated: [], excluded: [], historyFallback: [] };
}

function impossibleOhlc(c: Candle): boolean {
  return Math.min(c.open, c.high, c.low, c.close) <= 0 ||
    c.high < Math.max(c.open, c.close, c.low) ||
    c.low > Math.min(c.open, c.close);
}

/** Largest move from the previous close that a repaired bar may show: NSE circuit limits stop a stock moving more than 20% in a day. */
const REPAIR_MAX_MOVE = 0.25;

/**
 * A bar whose high or low contradicts its own open and close (a feed glitch) but whose prices are all plausible next to the previous
 * close is repaired: the high and low are stretched to cover all four prices. Null when it cannot be trusted: a non-positive price, no
 * previous close to compare with, or a price far from the previous close.
 */
function repairedBar(c: Candle, previousClose: number | null): Candle | null {
  const prices = [c.open, c.high, c.low, c.close];
  if (previousClose == null || !(previousClose > 0) || prices.some((p) => !(p > 0))) return null;
  if (prices.some((p) => p < previousClose * (1 - REPAIR_MAX_MOVE) || p > previousClose * (1 + REPAIR_MAX_MOVE))) return null;
  return { ...c, high: Math.max(...prices), low: Math.min(...prices) };
}

/**
 * Structural faults (non-numeric, negative volume, future, duplicate or
 * unordered sessions) make a history unusable. An impossible OHLC bar that can
 * be trusted is repaired in place (see repairedBar). One that cannot keeps only
 * the sessions after the latest such bar, so no calculation spans it.
 */
export function checkDailyHistory(candles: Candle[], now: number): HistoryCheck {
  const today = istDateKey(now);
  let previous = "";
  let invalidBars = 0;
  let lastInvalid = -1;
  let repairs: Candle[] | null = null;
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    if (![c.t, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) {
      return { ok: false, reason: "Non-numeric daily candle values." };
    }
    if (c.volume < 0) return { ok: false, reason: "Negative daily volume." };
    const day = istDateKey(c.t);
    if (day > today) return { ok: false, reason: `Future-dated daily candle (${day}).` };
    if (day <= previous) return { ok: false, reason: `Duplicate or unordered daily session (${day}).` };
    previous = day;
    if (impossibleOhlc(c)) {
      const fixed = repairedBar(c, (repairs ?? candles)[i - 1]?.close ?? null);
      if (fixed) {
        repairs ??= candles.slice();
        repairs[i] = fixed;
      } else {
        invalidBars += 1;
        lastInvalid = i;
      }
    }
  }
  const usable = repairs ?? candles;
  if (lastInvalid < 0) return { ok: true, candles: usable, truncation: null };
  const kept = usable.slice(lastInvalid + 1);
  const lastInvalidSession = istDateKey(candles[lastInvalid].t);
  if (!kept.length) {
    return { ok: false, reason: `No valid daily candles after impossible OHLC on ${lastInvalidSession}.` };
  }
  return { ok: true, candles: kept, truncation: { invalidBars, lastInvalidSession, keptSessions: kept.length } };
}

const CONSENSUS_MIN_HISTORIES = 20;
const CONSENSUS_SHARE = 0.5;
const CONSENSUS_RECENT_BARS = 10;

/**
 * The latest session before a quote's session that most freshly downloaded
 * histories contain. It needs no holiday calendar, and returns null when too
 * few fresh histories exist to tell.
 */
export function previousSessionConsensus(freshHistories: Iterable<Candle[]>): (quoteSession: string) => string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const candles of freshHistories) {
    total += 1;
    for (const c of candles.slice(-CONSENSUS_RECENT_BARS)) {
      const day = istDateKey(c.t);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  const days = [...counts]
    .filter(([, count]) => total >= CONSENSUS_MIN_HISTORIES && count >= total * CONSENSUS_SHARE)
    .map(([day]) => day)
    .sort();
  return (quoteSession) => days.filter((day) => day < quoteSession).at(-1) ?? null;
}

/**
 * Whether an expired fallback history can take a quote's session without a
 * hidden missing session in between. Replacing its own last session is safe;
 * appending is safe only when the consensus previous session is present.
 */
export function fallbackContinuityIssue(
  candles: Candle[],
  quoteTimestamp: number,
  expectedPrevious: (quoteSession: string) => string | null,
): string | null {
  const last = candles.at(-1);
  if (!last) return "No daily history.";
  const lastSession = istDateKey(last.t);
  const quoteSession = istDateKey(quoteTimestamp);
  if (quoteSession <= lastSession) return null;
  const expected = expectedPrevious(quoteSession);
  if (expected == null) {
    return `History refresh failed; continuity from ${lastSession} to ${quoteSession} cannot be verified.`;
  }
  return lastSession >= expected ? null : `History refresh failed; stale history ends ${lastSession}, missing ${expected}.`;
}
