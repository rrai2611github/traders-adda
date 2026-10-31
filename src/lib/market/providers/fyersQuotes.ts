import type { Quote } from "../types";

/**
 * Pure helpers for Fyers' /data/quotes payload: symbol mapping and normalising a quote.
 * Kept free of network and app imports so they can be unit-tested directly.
 */

/** App index symbols to Fyers index symbols. Anything not listed falls back to Yahoo. */
export const FYERS_INDEX_SYMBOLS: Record<string, string> = {
  NIFTY50: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  NIFTYIT: "NSE:NIFTYIT-INDEX",
  NIFTYMIDCAP: "NSE:NIFTYMIDCAP100-INDEX",
  INDIAVIX: "NSE:INDIAVIX-INDEX",
};

/** Cash-segment series a stock can trade in; EQ first. */
export const FYERS_SERIES = ["EQ", "BE", "SM", "ST"] as const;

export const toFyersSymbol = (symbol: string, series: string = "EQ"): string =>
  FYERS_INDEX_SYMBOLS[symbol] ?? `NSE:${symbol}-${series}`;

/** The app symbol for a Fyers symbol such as NSE:SBIN-EQ or NSE:NIFTYBANK-INDEX. */
export function fromFyersSymbol(fyersSymbol: string): string {
  const index = Object.entries(FYERS_INDEX_SYMBOLS).find(([, value]) => value === fyersSymbol);
  if (index) return index[0];
  return fyersSymbol.replace(/^[A-Z]+:/, "").replace(/-(EQ|BE|SM|ST)$/, "");
}

export interface FyersQuoteRow {
  n?: string;
  s?: string;
  v?: Record<string, unknown>;
}

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const IST_MS = 19_800_000;

/**
 * Fyers' quote `tt` is normally the trading date at 00:00 UTC, not a trade time (every symbol shows the same value),
 * so it cannot show how fresh a price is. A quote dated today is stamped with the moment it was fetched, which is when
 * Fyers handed over its latest price; one dated an earlier day is stamped with that day's 15:30 IST close. A `tt` that
 * does carry a time of day is used as the trade time (an IST-shifted one is corrected; a future one is clamped to now).
 */
export function tradeTime(tt: number | null, now: number): number {
  if (tt == null || tt <= 1e9) return now;
  const ms = tt < 1e12 ? tt * 1000 : tt;
  if (ms % 86_400_000 === 0) {
    const day = new Date(ms).toISOString().slice(0, 10);
    const today = new Date(now + IST_MS).toISOString().slice(0, 10);
    return day >= today ? now : Date.parse(`${day}T10:00:00Z`);
  }
  if (ms <= now + 60_000) return ms;
  return Math.abs(ms - IST_MS - now) < 10 * 60_000 ? ms - IST_MS : now;
}

export interface QuoteBase {
  name: string;
  kind: Quote["kind"];
  sector?: string;
}

/**
 * Returns null for an errored row, a missing price, or a non-positive previous close, so the caller
 * can fall back to another source instead of showing a made-up quote. `now` stamps a row without a trade time.
 */
export function normalizeFyersQuote(symbol: string, base: QuoteBase, row: FyersQuoteRow, now: number): Quote | null {
  if (row.s !== "ok" || !row.v) return null;
  const v = row.v;
  const ltp = num(v.lp);
  const previousClose = num(v.prev_close_price);
  if (ltp == null || ltp <= 0 || previousClose == null || previousClose <= 0) return null;
  const timestamp = tradeTime(num(v.tt), now);
  const change = num(v.ch) ?? ltp - previousClose;
  const changePercent = num(v.chp) ?? (change / previousClose) * 100;
  const round = (x: number) => Number(x.toFixed(2));
  return {
    symbol,
    name: base.name,
    kind: base.kind,
    sector: base.sector,
    ltp: round(ltp),
    previousClose: round(previousClose),
    change: round(change),
    changePercent: round(changePercent),
    open: round(num(v.open_price) || ltp),
    high: round(num(v.high_price) || ltp),
    low: round(num(v.low_price) || ltp),
    volume: Math.max(0, num(v.volume) ?? 0),
    timestamp,
  };
}
