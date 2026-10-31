import { FyersApiError, FyersAuthError, fyersConnected, fyersQuotes } from "../../fyers/fyersClient";
import { getMarketStatus } from "../marketHours";
import type { Candle, PricePoint, Quote } from "../types";
import { getInstrument } from "../universe";
import { FYERS_INDEX_SYMBOLS, FYERS_SERIES, fromFyersSymbol, normalizeFyersQuote, toFyersSymbol, type FyersQuoteRow } from "./fyersQuotes";
import type { MarketDataProvider, QuoteErrorListener, QuoteListener, Unsubscribe } from "./types";
import { yahooProvider } from "./yahoo";

/**
 * Live NSE quotes from Fyers, with Yahoo behind it.
 *
 * - Quotes come from Fyers (last price, day OHLC, volume, trade time) while today's Fyers login is active.
 * - Daily history and sparklines stay on Yahoo: pulling 2,300 stocks' history through Fyers' rate limit
 *   (120 requests a minute here) would take about 20 minutes, and the history is already cached.
 * - Without a login, or for any symbol Fyers cannot quote, the Yahoo quote is used instead, so the app
 *   keeps working and never blanks a stock. `stats` shows which source served what.
 * - Read-only: no order is ever placed.
 */

const MAX_PER_CALL = 50;
/** A quote fetched this recently is reused, so several tabs or sweeps cannot multiply requests. */
const CACHE_MS = 2_000;
const POLL_LIVE_MS = 3_000;
const POLL_CLOSED_MS = 30_000;

interface FyersStats {
  fyersQuotes: number;
  yahooFallbackQuotes: number;
  lastFyersAt: number | null;
  /** Age in ms of the freshest trade time among the last Fyers quotes, an upper bound on feed latency. */
  freshestQuoteAgeMs: number | null;
  lastError: string | null;
}

const store = ((globalThis as { __fyersProvider?: { series: Map<string, string>; cache: Map<string, { at: number; quote: Quote }>; stats: FyersStats } }).__fyersProvider ??= {
  series: new Map(),
  cache: new Map(),
  stats: { fyersQuotes: 0, yahooFallbackQuotes: 0, lastFyersAt: null, freshestQuoteAgeMs: null, lastError: null },
});

export const fyersFeedStats = (): FyersStats => ({ ...store.stats });

/** One Fyers call for up to 50 symbols; returns the rows, or [] when the whole call is rejected as invalid symbols. */
async function callQuotes(fyersSymbols: string[]): Promise<FyersQuoteRow[]> {
  try {
    return (await fyersQuotes(fyersSymbols)) as FyersQuoteRow[];
  } catch (error) {
    // -300 is "invalid symbol": every symbol in the call was unknown, which is an answer, not a failure.
    if (error instanceof FyersApiError && (error.code === -300 || error.code === -99)) return [];
    throw error;
  }
}

/** Quotes `symbols` on Fyers, trying the other cash series for symbols that are not in EQ. Missing symbols are simply absent. */
async function quoteFromFyers(symbols: string[], now: number): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  let pending = [...new Set(symbols)];
  const tried = new Map<string, number>(); // symbol -> index of the series attempted
  for (let pass = 0; pass < FYERS_SERIES.length && pending.length; pass++) {
    const next: string[] = [];
    for (let i = 0; i < pending.length; i += MAX_PER_CALL) {
      const batch = pending.slice(i, i + MAX_PER_CALL);
      const asked = batch.map((symbol) => {
        const known = store.series.get(symbol);
        const series = pass === 0 && known ? known : FYERS_SERIES[pass];
        tried.set(symbol, pass);
        return { symbol, fyersSymbol: toFyersSymbol(symbol, series), series };
      });
      const rows = await callQuotes(asked.map((a) => a.fyersSymbol));
      const byName = new Map(rows.map((row) => [row.n ?? "", row]));
      for (const a of asked) {
        const instrument = getInstrument(a.symbol);
        const quote = instrument ? normalizeFyersQuote(a.symbol, { name: instrument.name, kind: instrument.kind, sector: instrument.sector }, byName.get(a.fyersSymbol) ?? {}, now) : null;
        if (quote) {
          out.set(a.symbol, quote);
          if (!(a.symbol in FYERS_INDEX_SYMBOLS)) store.series.set(a.symbol, a.series);
        } else if (!(a.symbol in FYERS_INDEX_SYMBOLS)) next.push(a.symbol);
      }
    }
    pending = next;
  }
  return out;
}

export class FyersProvider implements MarketDataProvider {
  /** "yahoo" while no Fyers login is active, so every Yahoo-specific disclosure (delay caveats) stays accurate. */
  get id() { return fyersConnected().connected ? "fyers" : "yahoo"; }
  /** Daily history is Yahoo's, so its on-disk cache is reused instead of re-downloaded. */
  readonly historyCacheId = "yahoo";
  get label() { return fyersConnected().connected ? "Fyers live quotes · Yahoo history" : "Yahoo Finance (Fyers not connected today)"; }
  /** Same claim as before for the Yahoo fallback, so paper fills do not stop just because Fyers is not logged in. */
  get isRealtime() { return fyersConnected().connected || yahooProvider.isRealtime; }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const now = Date.now();
    const result = new Map<string, Quote>();
    const stale: string[] = [];
    for (const symbol of wanted) {
      const hit = store.cache.get(symbol);
      if (hit && now - hit.at < CACHE_MS) result.set(symbol, hit.quote);
      else stale.push(symbol);
    }
    if (stale.length && fyersConnected().connected) {
      try {
        const fresh = await quoteFromFyers(stale, now);
        for (const [symbol, quote] of fresh) {
          result.set(symbol, quote);
          store.cache.set(symbol, { at: now, quote });
        }
        if (fresh.size) {
          const newest = Math.max(...[...fresh.values()].map((q) => q.timestamp));
          Object.assign(store.stats, { lastFyersAt: now, fyersQuotes: store.stats.fyersQuotes + fresh.size, freshestQuoteAgeMs: Math.max(0, now - newest), lastError: null });
        }
      } catch (error) {
        // Not logged in any more, rate-limited or a network failure: serve Yahoo for this call.
        store.stats.lastError = error instanceof Error ? error.message : String(error);
        if (!(error instanceof FyersAuthError) && !(error instanceof FyersApiError)) console.error("[fyers] quotes failed, using Yahoo:", error);
      }
    }
    const missing = wanted.filter((symbol) => !result.has(symbol));
    if (missing.length) {
      const fallback = await yahooProvider.getQuotes(missing);
      for (const quote of fallback) result.set(quote.symbol, quote);
      store.stats.yahooFallbackQuotes += fallback.length;
    }
    return wanted.flatMap((symbol) => result.get(symbol) ?? []);
  }

  subscribe(symbols: string[], listener: QuoteListener, onError: QuoteErrorListener): Unsubscribe {
    const normalized = [...new Set(symbols.map((s) => s.toUpperCase()))];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const quotes = await this.getQuotes(normalized);
        if (!stopped && quotes.length) listener(quotes);
      } catch (error) {
        if (!stopped) onError(error);
      } finally {
        if (!stopped) timer = setTimeout(tick, getMarketStatus().isLive && fyersConnected().connected ? POLL_LIVE_MS : POLL_CLOSED_MS);
      }
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }

  getIntradaySeries(symbol: string, maxPoints?: number): Promise<PricePoint[]> {
    return yahooProvider.getIntradaySeries(symbol, maxPoints);
  }

  getDailyCandles(symbol: string, maxCandles?: number): Promise<Candle[]> {
    return yahooProvider.getDailyCandles(symbol, maxCandles);
  }
}

export const fyersProvider = new FyersProvider();
export { fromFyersSymbol };
