import { istDateKey } from "./marketHours.ts";
import type { Candle, Quote } from "./types.ts";

/**
 * Folds the latest quote into a daily history as that session's candle.
 *
 * The quote replaces the candle for its own IST session (or is appended as a
 * new session). Quotes older than the history's last session, or dated in the
 * future, are ignored, so they can never rewrite a completed day. A same-day
 * quote may extend that session's high, low and cumulative volume but never
 * shrinks them: an earlier quote cannot erase trading the history recorded.
 */
export const MAX_QUOTE_CLOCK_SKEW_MS = 5 * 60_000;

export function mergeQuoteIntoCandles(candles: Candle[], quote: Quote | undefined, now: number = Date.now()): Candle[] {
  if (!quote || !(quote.ltp > 0) || !Number.isFinite(quote.timestamp)) return candles;
  if (quote.timestamp > now + MAX_QUOTE_CLOCK_SKEW_MS) return candles;

  const sessionKey = istDateKey(quote.timestamp);
  const last = candles.at(-1);
  const lastKey = last ? istDateKey(last.t) : null;
  if (lastKey && lastKey > sessionKey) return candles;

  const sameSession = lastKey === sessionKey ? last : undefined;
  const open = quote.open > 0 ? quote.open : sameSession?.open ?? quote.ltp;
  const known = sameSession && sameSession.high > 0 && sameSession.low > 0 ? sameSession : undefined;
  const bar: Candle = {
    t: sameSession?.t ?? Date.parse(`${sessionKey}T09:15:00+05:30`),
    open,
    high: Math.max(quote.high > 0 ? quote.high : quote.ltp, quote.ltp, open, known?.high ?? 0),
    low: Math.min(quote.low > 0 ? quote.low : quote.ltp, quote.ltp, open, known?.low ?? Infinity),
    close: quote.ltp,
    volume: Math.max(quote.volume > 0 ? quote.volume : 0, sameSession?.volume ?? 0),
  };

  return sameSession ? [...candles.slice(0, -1), bar] : [...candles, bar];
}

/** Median daily traded value, in rupees crore, over the most recent sessions. */
export function medianTurnoverCr(candles: Candle[], sessions = 50): number | null {
  const values = candles
    .slice(-sessions)
    .map((c) => (c.close * c.volume) / 1e7)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}
