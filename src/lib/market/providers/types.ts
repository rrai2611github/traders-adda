import type { Candle, PricePoint, Quote } from "../types";

export type QuoteListener = (quotes: Quote[]) => void;
export type QuoteErrorListener = (error: unknown) => void;
export type Unsubscribe = () => void;

/**
 * Contract every market data source must implement.
 *
 * Swapping vendors (Kite, Upstox, Finnhub, Polygon…) means writing one adapter
 * against this interface — no UI, API route or hook needs to change.
 */
export interface MarketDataProvider {
  /** Stable identifier surfaced to the UI, e.g. `mock` or `kite`. */
  readonly id: string;
  /** Where daily history is cached on disk when it differs from `id` (a provider that borrows another's history). */
  readonly historyCacheId?: string;
  /** Human-readable attribution shown in the data-source footer. */
  readonly label: string;
  /** False for delayed or simulated feeds, which the UI must disclose. */
  readonly isRealtime: boolean;

  /** Point-in-time snapshot, used by REST endpoints and SSE priming. */
  getQuotes(symbols: string[]): Promise<Quote[]>;

  /**
   * Streams updates for `symbols`. Implementations should emit only when a
   * price actually changes, report polling failures, and be safe to call
   * concurrently.
   */
  subscribe(
    symbols: string[],
    listener: QuoteListener,
    onError: QuoteErrorListener,
  ): Unsubscribe;

  /** Recent intraday points for sparklines, oldest first. */
  getIntradaySeries(symbol: string, maxPoints?: number): Promise<PricePoint[]>;

  /** Recent daily OHLCV candles for setup charts, oldest first. */
  getDailyCandles(symbol: string, maxCandles?: number): Promise<Candle[]>;
}
