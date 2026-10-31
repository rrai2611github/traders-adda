import { FyersApiError, fyersHistory } from "@/lib/fyers/fyersClient";
import { INTRADAY_TIMEFRAMES, type IntradayTimeframe } from "@/lib/chart/intraday";
import type { Candle } from "@/lib/market/types";

const IST_MS = 19_800_000;
const DAY_MS = 86_400_000;
const DAY_SEC = 86_400;
/** Fyers caps daily-resolution history at about one year per request. */
const CHUNK_DAYS = 365;
const DAILY_TTL_MS = 5 * 60_000;
const INTRADAY_TTL_MS = 30_000;
/** Most NSE stocks trade in the EQ series; BE (trade-to-trade) and SM/ST (SME) are fallbacks. */
const SERIES = ["EQ", "BE", "SM", "ST"];

export interface FyersCandles {
  symbol: string;
  fyersSymbol: string;
  resolution: "D" | IntradayTimeframe;
  candles: Candle[];
}

const store = ((globalThis as {
  __fyersCandles?: { cache: Map<string, { at: number; ttl: number; value: Promise<FyersCandles> }>; series: Map<string, string> };
}).__fyersCandles ??= { cache: new Map(), series: new Map() });

/** Fyers stamps daily bars at IST midnight; re-stamp to 09:15 IST like the Yahoo candles. */
const sessionStamp = (ms: number) => Math.floor((ms + IST_MS) / DAY_MS) * DAY_MS - IST_MS + (9 * 60 + 15) * 60_000;

function toCandles(raw: unknown, daily: boolean): Candle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is number[] => Array.isArray(c) && c.length >= 5 && c.slice(0, 5).every(Number.isFinite))
    .map((c) => ({
      t: daily ? sessionStamp(c[0] * 1000) : c[0] * 1000,
      open: c[1], high: c[2], low: c[3], close: c[4],
      volume: Number.isFinite(c[5]) ? c[5] : 0,
    }))
    .filter((c) => c.close > 0 && c.high >= c.low);
}

/** Calls `fetchFor(fyersSymbol)` on the stock's NSE series, remembering which series worked. */
async function withSeries<T>(symbol: string, fetchFor: (fyersSymbol: string) => Promise<T | null>): Promise<{ fyersSymbol: string; value: T }> {
  const known = store.series.get(symbol);
  const order = known ? [known, ...SERIES.filter((s) => s !== known)] : SERIES;
  let lastError: unknown = null;
  for (const series of order) {
    const fyersSymbol = `NSE:${symbol}-${series}`;
    try {
      const value = await fetchFor(fyersSymbol);
      if (value == null) continue;
      store.series.set(symbol, series);
      return { fyersSymbol, value };
    } catch (error) {
      // Unknown symbol for this series: try the next one; anything else is a real failure.
      if (error instanceof FyersApiError && error.status < 500 && error.status !== 429) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error(`No Fyers history for ${symbol}`);
}

async function loadDaily(symbol: string, sessions: number): Promise<FyersCandles> {
  const chunks = Math.min(6, Math.ceil(sessions / 245) + 1);
  const now = Math.floor(Date.now() / 1000);
  const { fyersSymbol, value } = await withSeries(symbol, async (fyersSymbol) => {
    const byDay = new Map<number, Candle>();
    for (let i = 0; i < chunks; i++) {
      const to = now - i * CHUNK_DAYS * DAY_SEC;
      const part = toCandles(await fyersHistory(fyersSymbol, "D", to - (CHUNK_DAYS - 1) * DAY_SEC, to), true);
      if (!part.length) break;
      for (const c of part) byDay.set(c.t, c);
      if (byDay.size >= sessions) break;
    }
    return byDay.size ? [...byDay.values()].sort((a, b) => a.t - b.t).slice(-sessions) : null;
  });
  return { symbol, fyersSymbol, resolution: "D", candles: value };
}

async function loadIntraday(symbol: string, resolution: IntradayTimeframe): Promise<FyersCandles> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - INTRADAY_TIMEFRAMES[resolution].days * DAY_SEC;
  const { fyersSymbol, value } = await withSeries(symbol, async (fyersSymbol) => {
    const candles = toCandles(await fyersHistory(fyersSymbol, resolution, from, now), false).sort((a, b) => a.t - b.t);
    return candles.length ? candles : null;
  });
  return { symbol, fyersSymbol, resolution, candles: value };
}

function cached(key: string, ttl: number, load: () => Promise<FyersCandles>): Promise<FyersCandles> {
  const hit = store.cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = load();
  store.cache.set(key, { at: Date.now(), ttl, value });
  value.catch(() => {
    if (store.cache.get(key)?.value === value) store.cache.delete(key);
  });
  // Bound memory: drop expired entries once the cache grows.
  if (store.cache.size > 200) {
    for (const [k, v] of store.cache) if (Date.now() - v.at >= v.ttl) store.cache.delete(k);
  }
  return value;
}

/** Daily candles for one NSE stock from Fyers, cached for 5 minutes. */
export function getFyersDailyCandles(symbol: string, sessions: number): Promise<FyersCandles> {
  return cached(`${symbol}:D:${sessions}`, DAILY_TTL_MS, () => loadDaily(symbol, sessions));
}

/** Intraday candles (bar-open times) for one NSE stock from Fyers, cached for 30 seconds. */
export function getFyersIntradayCandles(symbol: string, resolution: IntradayTimeframe): Promise<FyersCandles> {
  return cached(`${symbol}:${resolution}`, INTRADAY_TTL_MS, () => loadIntraday(symbol, resolution));
}
