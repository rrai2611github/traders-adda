import { getMarketStatus } from "./marketHours";
import { getProvider } from "./providers";
import { DEFAULT_INDEX_SYMBOLS, isKnownSymbol } from "./universe";
import { getUniverseSnapshot } from "./universeSnapshot";
import { LIQUIDITY_FLOOR } from "../screen/metrics";
import type { Candle, MarketStatus, PricePoint, Quote } from "./types";

const MAX_SUBSCRIPTION_SYMBOLS = 60;

export interface MoversPayload {
  gainers: Quote[];
  losers: Quote[];
  mostActive: Quote[];
  breadth: { advancing: number; declining: number; unchanged: number };
  /** Liquid equities the ranking covered and when that snapshot completed; 0/null while loading. */
  coverage: { equities: number; asOf: number | null };
}

/**
 * Parses and validates a comma-separated `symbols` query parameter.
 * Unknown tickers are dropped rather than erroring so one bad entry in a saved
 * watchlist cannot break the whole stream.
 */
export function parseSymbols(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const symbol = part.trim().toUpperCase();
    if (symbol && isKnownSymbol(symbol)) seen.add(symbol);
    if (seen.size >= MAX_SUBSCRIPTION_SYMBOLS) break;
  }
  return [...seen];
}

export function getStatus(): MarketStatus {
  return getMarketStatus();
}

export function getDataSource(): { id: string; label: string; isRealtime: boolean } {
  const provider = getProvider();
  return {
    id: provider.id,
    label: provider.label,
    isRealtime: provider.isRealtime,
  };
}

export function getQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return Promise.resolve([]);
  return getProvider().getQuotes(symbols);
}

export function getIndexQuotes(): Promise<Quote[]> {
  return getProvider().getQuotes(DEFAULT_INDEX_SYMBOLS);
}

export function getIntradaySeries(symbol: string, maxPoints?: number): Promise<PricePoint[]> {
  return getProvider().getIntradaySeries(symbol, maxPoints);
}

export function getDailyCandles(symbol: string, maxCandles?: number): Promise<Candle[]> {
  return getProvider().getDailyCandles(symbol, maxCandles);
}

export function subscribe(
  symbols: string[],
  listener: (quotes: Quote[]) => void,
  onError: (error: unknown) => void,
) {
  return getProvider().subscribe(symbols, listener, onError);
}

let moversCache: { snapshotId: number; providerId: string; limit: number; payload: MoversPayload } | null = null;

/**
 * Ranks liquid equities (median traded value at the screen floor) by session
 * performance, from the shared universe snapshot rather than a fresh fetch.
 * Returns an empty ranking with zero coverage until the first sweep finishes.
 */
export async function getMovers(limit = 5): Promise<MoversPayload> {
  const state = getUniverseSnapshot();
  if (state.status === "failed") throw state.error;
  if (state.status === "warming") {
    return {
      gainers: [],
      losers: [],
      mostActive: [],
      breadth: { advancing: 0, declining: 0, unchanged: 0 },
      coverage: { equities: 0, asOf: null },
    };
  }

  const snapshot = state.snapshot;
  if (
    moversCache &&
    moversCache.snapshotId === snapshot.id &&
    moversCache.providerId === snapshot.providerId &&
    moversCache.limit === limit
  ) {
    return moversCache.payload;
  }

  const quotes = [...snapshot.quotes.values()].filter(
    (q) => (snapshot.turnoverCr.get(q.symbol) ?? 0) >= LIQUIDITY_FLOOR.turnoverCr,
  );
  const byChange = [...quotes].sort((a, b) => b.changePercent - a.changePercent);

  const payload: MoversPayload = {
    gainers: byChange.slice(0, limit),
    losers: byChange.slice(-limit).reverse(),
    mostActive: [...quotes].sort((a, b) => b.ltp * b.volume - a.ltp * a.volume).slice(0, limit),
    breadth: {
      advancing: quotes.filter((q) => q.change > 0).length,
      declining: quotes.filter((q) => q.change < 0).length,
      unchanged: quotes.filter((q) => q.change === 0).length,
    },
    coverage: { equities: quotes.length, asOf: snapshot.completedAt },
  };

  moversCache = { snapshotId: snapshot.id, providerId: snapshot.providerId, limit, payload };
  return payload;
}
