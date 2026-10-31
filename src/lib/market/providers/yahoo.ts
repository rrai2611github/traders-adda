import { getInstrument } from "../universe";
import type { Candle, PricePoint, Quote } from "../types";
import type { MarketDataProvider, QuoteErrorListener, QuoteListener, Unsubscribe } from "./types";
import { resolveTicker } from "./yahooTickers";
import { asNumber, buildCandlesFromChart, buildSeriesFromChart, type YahooChartResult } from "./yahooChart";

// Shared across every route so a universe sweep cannot flood Yahoo.
const MAX_CONCURRENT_REQUESTS = 12;
const RETRY_DELAYS_MS = [1000, 3000];
let activeRequests = 0;
const waiting: Array<() => void> = [];

async function withRequestSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  activeRequests += 1;
  try {
    return await run();
  } finally {
    activeRequests -= 1;
    waiting.shift()?.();
  }
}

class YahooHttpError extends Error {
  constructor(
    ticker: string,
    readonly status: number,
  ) {
    super(`Yahoo Finance request failed for ${ticker}: ${status}`);
  }
}

async function fetchChart(ticker: string, interval = "1m", range = "1d"): Promise<YahooChartResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includeAdjustedClose=true`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withRequestSlot(() => fetchChartOnce(url, ticker));
    } catch (error) {
      const retryable = error instanceof YahooHttpError && (error.status === 429 || error.status >= 500);
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

async function fetchChartOnce(url: string, ticker: string): Promise<YahooChartResult> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; StockAnalysis/1.0)",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new YahooHttpError(ticker, response.status);
  }

  const payload = (await response.json()) as {
    chart?: { result?: YahooChartResult[] };
  };

  const result = payload.chart?.result?.[0];
  if (!result) {
    throw new Error(`No chart result returned for ${ticker}`);
  }

  return result;
}

const IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
const MAX_PRICE_CANDLE_MISMATCH = 0.05;

/**
 * Builds a quote from a daily (interval=1d) chart: the day's OHLCV comes from
 * the session candle, the price and time from Yahoo's regular-market fields,
 * and the previous close from the prior session's candle.
 */
function buildQuoteFromDailyChart(symbol: string, chart: YahooChartResult): Quote | null {
  const candles = buildCandlesFromChart(chart, 10);
  const meta = chart.meta ?? {};
  const price = asNumber(meta.regularMarketPrice, candles.at(-1)?.close ?? 0);
  if (!(price > 0)) return null;

  // Without a provider time the quote age is unknown, so it is not used.
  const timestamp = meta.regularMarketTime ? meta.regularMarketTime * 1000 : candles.at(-1)?.t;
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  const sessionKey = IST_DATE.format(timestamp);
  const sessionIndex = candles.findLastIndex((c) => IST_DATE.format(c.t) === sessionKey);
  const session = sessionIndex >= 0 ? candles[sessionIndex] : null;
  // Yahoo occasionally reports a headline price that contradicts its own
  // session candle (e.g. an unapplied split). Neither can be trusted then, so
  // the symbol is left without a quote and surfaces as skipped.
  if (session && Math.abs(price - session.close) / session.close > MAX_PRICE_CANDLE_MISMATCH) return null;
  const priorIndex = sessionIndex >= 0 ? sessionIndex - 1 : candles.length - 1;
  const previousClose =
    priorIndex >= 0 ? candles[priorIndex].close : asNumber(meta.chartPreviousClose ?? meta.previousClose, price);

  const open = session?.open ?? price;
  const high = Math.max(asNumber(meta.regularMarketDayHigh, session?.high ?? price), price);
  const low = Math.min(asNumber(meta.regularMarketDayLow, session?.low ?? price) || price, price);
  const volume = asNumber(meta.regularMarketVolume, session?.volume ?? 0);
  const change = price - previousClose;
  const changePercent = previousClose === 0 ? 0 : (change / previousClose) * 100;

  const instrument = getInstrument(symbol);

  return {
    symbol,
    name: instrument?.name ?? symbol,
    kind: instrument?.kind ?? "EQUITY",
    sector: instrument?.sector,
    ltp: Number(price.toFixed(2)),
    previousClose: Number(previousClose.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    volume,
    timestamp,
  };
}
class YahooProvider implements MarketDataProvider {
  readonly id = "yahoo";
  readonly label = "Yahoo Finance";
  readonly isRealtime = true;

  private timers = new Map<string, ReturnType<typeof setInterval>>();

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];

    const settled = await Promise.allSettled(
      uniqueSymbols.map(async (symbol) => {
        const ticker = resolveTicker(symbol);
        const chart = await fetchChart(ticker, "1d", "5d");
        return buildQuoteFromDailyChart(symbol, chart);
      }),
    );

    // One dead ticker must not blank every quote; callers see missing symbols as absent quotes.
    const failure = settled.find((result) => result.status === "rejected");
    if (failure && settled.every((result) => result.status === "rejected")) {
      throw failure.reason;
    }

    return settled
      .map((result) => (result.status === "fulfilled" ? result.value : null))
      .filter((quote): quote is Quote => quote !== null);
  }

  subscribe(
    symbols: string[],
    listener: QuoteListener,
    onError: QuoteErrorListener,
  ): Unsubscribe {
    const normalized = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
    const tick = async () => {
      try {
        const quotes = await this.getQuotes(normalized);
        if (quotes.length > 0) listener(quotes);
      } catch (error) {
        onError(error);
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 5000);

    normalized.forEach((symbol) => {
      this.timers.set(symbol, interval);
    });

    return () => {
      clearInterval(interval);
      normalized.forEach((symbol) => {
        if (this.timers.get(symbol) === interval) {
          this.timers.delete(symbol);
        }
      });
    };
  }

  async getIntradaySeries(symbol: string, maxPoints = 60): Promise<PricePoint[]> {
    const resolved = resolveTicker(symbol);
    const chart = await fetchChart(resolved);
    return buildSeriesFromChart(chart, maxPoints);
  }

  /** Hourly candles (NSE bars start 09:15 IST), about a month of history. The forming hour is included. */
  async getHourlyCandles(symbol: string): Promise<Candle[]> {
    const chart = await fetchChart(resolveTicker(symbol), "1h", "1mo");
    return buildCandlesFromChart(chart, 400);
  }

  async getDailyCandles(symbol: string, maxCandles = 80): Promise<Candle[]> {
    const resolved = resolveTicker(symbol);
    // The 200-MA and the all-time-high check both need more than a year of
    // history, so widen the request when a deep window is asked for.
    const range = maxCandles > 1200 ? "10y" : maxCandles > 480 ? "5y" : maxCandles > 240 ? "2y" : "1y";
    const chart = await fetchChart(resolved, "1d", range);
    return buildCandlesFromChart(chart, maxCandles);
  }
}

export const yahooProvider = new YahooProvider();
