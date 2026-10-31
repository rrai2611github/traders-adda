import type { GiftNiftyQuote } from "../screen/marketOutlook";

/**
 * GIFT Nifty (NSE IX) front-month futures.
 *
 * There is no official free feed, so this reads TradingView's public scanner endpoint for
 * `NSEIX:NIFTY1!`. It is unofficial and can disappear or change without notice: any failure
 * returns null and the pre-open email says GIFT Nifty is unavailable instead of guessing.
 */

const SCAN_URL = "https://scanner.tradingview.com/global/scan";
const SYMBOL = "NSEIX:NIFTY1!";
const CACHE_TTL_MS = 2 * 60_000;
let cache: { at: number; value: GiftNiftyQuote | null } | null = null;

/** Parses the scanner payload; exported for tests. */
export function parseGiftScan(payload: unknown, now: number): GiftNiftyQuote | null {
  const row = (payload as { data?: Array<{ s?: string; d?: unknown[] }> } | null)?.data?.find((r) => r.s === SYMBOL);
  const [name, , close, change, changeAbs] = row?.d ?? [];
  if (!row || name !== "NIFTY1!") return null;
  const price = Number(close);
  const changePercent = Number(change);
  const changePoints = Number(changeAbs);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(changePercent) || !Number.isFinite(changePoints)) return null;
  return {
    price: Number(price.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    changePoints: Number(changePoints.toFixed(2)),
    asOf: now,
    source: "TradingView (NSE IX GIFT Nifty futures)",
  };
}

export async function getGiftNifty(now: number = Date.now()): Promise<GiftNiftyQuote | null> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  let value: GiftNiftyQuote | null = null;
  try {
    const response = await fetch(SCAN_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (compatible; StockAnalysis/1.0)", Origin: "https://www.tradingview.com" },
      body: JSON.stringify({ symbols: { tickers: [SYMBOL] }, columns: ["name", "description", "close", "change", "change_abs"] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) value = parseGiftScan(await response.json(), now);
    else console.error(`[gift] TradingView scanner returned ${response.status}`);
  } catch (error) {
    console.error("[gift] GIFT Nifty unavailable:", error instanceof Error ? error.message : error);
  }
  cache = { at: now, value };
  return value;
}
