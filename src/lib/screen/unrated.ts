import type { Candle } from "../market/types.ts";

/** Sessions of daily history a stock needs before it is measured and rated. */
export const MIN_RATED_SESSIONS = 20;
const TURNOVER_SESSIONS = 50;

export interface ListingStats {
  sessions: number;
  listingOpen: number;
  lastClose: number;
  highSinceListing: number;
  lowSinceListing: number;
  /** Last close vs the first session's open, in percent. */
  changeFromListing: number;
  /** Last close below the high since listing, as a positive percent. */
  fromHigh: number;
}

export type UnratedReason =
  | { kind: "loading" }
  | { kind: "recent-listing"; sessions: number; remaining: number; stats: ListingStats | null }
  | { kind: "below-floor"; turnoverCr: number | null; sessions: number }
  | { kind: "no-data" };

export function listingStats(candles: ReadonlyArray<Candle>): ListingStats | null {
  if (!candles.length) return null;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const highSinceListing = Math.max(...candles.map((c) => c.high));
  const lowSinceListing = Math.min(...candles.map((c) => c.low));
  return {
    sessions: candles.length,
    listingOpen: first.open,
    lastClose: last.close,
    highSinceListing,
    lowSinceListing,
    changeFromListing: first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0,
    fromHigh: highSinceListing > 0 ? ((highSinceListing - last.close) / highSinceListing) * 100 : 0,
  };
}

/** Median daily traded value over the recent window, in rupees crore. */
export function medianTurnoverCr(candles: ReadonlyArray<Candle>): number | null {
  const values = candles.slice(-TURNOVER_SESSIONS).map((c) => (c.close * c.volume) / 1e7).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Descriptive price stats for stocks the scan does not rate (no RS, PA or trade plan). */
export interface BasicStats {
  /** Last close vs the 50/200-day simple average, in percent; null with too little history. */
  vs50: number | null;
  vs200: number | null;
  /** Last close below the 52-week (250-session) high, as a positive percent. */
  fromHigh: number | null;
  turnoverCr: number | null;
}

export function basicStats(candles: ReadonlyArray<Candle>): BasicStats | null {
  if (!candles.length) return null;
  const close = candles[candles.length - 1].close;
  const vsAverage = (n: number) => {
    if (candles.length < n) return null;
    const avg = candles.slice(-n).reduce((sum, c) => sum + c.close, 0) / n;
    return avg > 0 ? ((close - avg) / avg) * 100 : null;
  };
  const high = Math.max(...candles.slice(-250).map((c) => c.high));
  return {
    vs50: vsAverage(50),
    vs200: vsAverage(200),
    fromHigh: high > 0 ? ((high - close) / high) * 100 : null,
    turnoverCr: medianTurnoverCr(candles),
  };
}

/** Why a stock that exists on NSE has no rating in the current scan. */
export function unratedReason(
  symbol: string,
  scan: { insufficientHistory?: string[] } | null,
  candles: ReadonlyArray<Candle>,
): UnratedReason {
  if (!scan) return { kind: "loading" };
  const shortHistory = scan.insufficientHistory?.includes(symbol) ?? false;
  if (shortHistory || (candles.length > 0 && candles.length < MIN_RATED_SESSIONS)) {
    const sessions = candles.length;
    return { kind: "recent-listing", sessions, remaining: Math.max(0, MIN_RATED_SESSIONS - sessions), stats: listingStats(candles) };
  }
  if (candles.length) return { kind: "below-floor", turnoverCr: medianTurnoverCr(candles), sessions: candles.length };
  return { kind: "no-data" };
}
