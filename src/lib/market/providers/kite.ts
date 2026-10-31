import type { MarketDataProvider, QuoteErrorListener, QuoteListener, Unsubscribe } from "./types";
import type { Candle, PricePoint, Quote } from "../types";
import { getInstrument } from "../universe";
import { parseKiteTimestamp } from "./kiteTime";

interface KiteInstrument {
  exchange: string;
  tradingsymbol: string;
  instrument_token: number;
}

interface KiteQuoteResponse {
  status: string;
  data?: Record<string, KiteQuoteData>;
}

interface KiteQuoteData {
  previous_close?: unknown;
  previousClose?: unknown;
  close_price?: unknown;
  close?: unknown;
  last_price?: unknown;
  lastTradePrice?: unknown;
  last_traded_price?: unknown;
  price?: unknown;
  ohlc?: { open?: unknown; high?: unknown; low?: unknown };
  open?: unknown;
  open_price?: unknown;
  high?: unknown;
  high_price?: unknown;
  low?: unknown;
  low_price?: unknown;
  volume?: unknown;
  total_traded_volume?: unknown;
  last_traded_time?: unknown;
  last_trade_time?: unknown;
  timestamp?: unknown;
}

interface KiteHistoricalResponse {
  status: string;
  data?: {
    candles?: Array<[string | number, number, number, number, number, number, number?]>;
  };
}

function getKiteConfig(): { apiKey?: string; accessToken?: string; baseUrl: string } {
  return {
    apiKey: process.env.KITE_API_KEY,
    accessToken: process.env.KITE_ACCESS_TOKEN,
    baseUrl: process.env.KITE_API_BASE_URL ?? "https://api.kite.trade",
  };
}

function requireKiteConfig(): { apiKey: string; accessToken: string; baseUrl: string } {
  const config = getKiteConfig();
  if (!config.apiKey || !config.accessToken) {
    throw new Error("Kite provider requires KITE_API_KEY and KITE_ACCESS_TOKEN.");
  }
  return {
    apiKey: config.apiKey,
    accessToken: config.accessToken,
    baseUrl: config.baseUrl,
  };
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchKiteInstruments(): Promise<Map<string, KiteInstrument>> {
  const { accessToken, apiKey, baseUrl } = requireKiteConfig();
  const url = `${baseUrl}/instruments`;
  const response = await fetch(url, {
    headers: {
      "X-Kite-Version": "3",
      Authorization: `token ${apiKey}:${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kite instruments lookup failed: ${response.status}`);
  }

  const payload = (await response.json()) as KiteInstrument[] | { data?: KiteInstrument[] };
  const instruments = Array.isArray(payload) ? payload : payload.data ?? [];

  const map = new Map<string, KiteInstrument>();
  for (const instrument of instruments) {
    if (!instrument?.tradingsymbol) continue;
    const symbol = instrument.tradingsymbol.toUpperCase();
    if (!map.has(symbol)) {
      map.set(symbol, instrument);
    }
  }

  return map;
}

function findKiteInstrument(symbol: string, instruments: Map<string, KiteInstrument>) {
  const upper = symbol.toUpperCase();
  return instruments.get(upper) ?? Array.from(instruments.values()).find((instrument) => {
    const candidate = `${instrument.exchange}:${instrument.tradingsymbol}`;
    return candidate.toUpperCase() === upper || instrument.tradingsymbol.toUpperCase() === upper;
  });
}

function normalizeQuote(symbol: string, instrument: KiteInstrument, raw: KiteQuoteData | undefined): Quote | null {
  if (!raw) return null;

  const previousClose = asNumber(raw.previous_close ?? raw.previousClose ?? raw.close_price ?? raw.close, 0);
  const last = asNumber(raw.last_price ?? raw.lastTradePrice ?? raw.last_traded_price ?? raw.close ?? raw.price, previousClose);
  const open = asNumber(raw.ohlc?.open ?? raw.open ?? raw.open_price, last);
  const high = asNumber(raw.ohlc?.high ?? raw.high ?? raw.high_price, last);
  const low = asNumber(raw.ohlc?.low ?? raw.low ?? raw.low_price, last);
  const volume = asNumber(raw.volume ?? raw.total_traded_volume ?? 0, 0);
  const timestamp = parseKiteTimestamp(raw.last_trade_time ?? raw.last_traded_time ?? raw.timestamp);
  // An undated quote's age is unknown; it is skipped instead of stamped "now".
  if (timestamp == null) return null;

  const change = last - previousClose;
  const changePercent = previousClose === 0 ? 0 : (change / previousClose) * 100;
  const base = getInstrument(symbol) ?? {
    name: symbol,
    kind: "EQUITY" as const,
    symbol,
    sector: undefined,
  };

  return {
    symbol,
    name: base.name,
    kind: base.kind,
    sector: base.sector,
    ltp: Number(last.toFixed(2)),
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

// Kite allows about 3 historical and 1 quote request per second; a full
// universe sweep must queue behind these limits instead of failing with 429s.
const HISTORICAL_GAP_MS = 350;
const QUOTE_GAP_MS = 1_000;
const nextSlot = new Map<string, number>();

async function throttle(bucket: string, gapMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(bucket) ?? 0);
  nextSlot.set(bucket, slot + gapMs);
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

class KiteProvider implements MarketDataProvider {
  readonly id = "kite";
  readonly label = "Kite API";
  readonly isRealtime = true;

  private polling = new Map<string, ReturnType<typeof setInterval>>();

  private async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const instruments = await fetchKiteInstruments();
    const resolvedInstruments = symbols.map((symbol) => {
      const instrument = findKiteInstrument(symbol, instruments);
      if (!instrument) {
        throw new Error(`Kite instrument not found for: ${symbol}`);
      }
      return { symbol, instrument };
    });
    const identifiers = resolvedInstruments.map(({ instrument }) =>
      `i=${encodeURIComponent(`${instrument.exchange}:${instrument.tradingsymbol}`)}`,
    );

    const { apiKey, accessToken, baseUrl } = requireKiteConfig();
    await throttle("quote", QUOTE_GAP_MS);
    const response = await fetch(`${baseUrl}/quote?${identifiers.join("&")}`, {
      headers: {
        "X-Kite-Version": "3",
        Authorization: `token ${apiKey}:${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Kite quote fetch failed: ${response.status}`);
    }

    const payload = (await response.json()) as KiteQuoteResponse;
    if (payload.status !== "success") {
      throw new Error("Kite quote fetch returned an unsuccessful response.");
    }
    const rawData = payload.data ?? {};

    return resolvedInstruments.flatMap(({ symbol, instrument }) => {
      const identifier = `${instrument.exchange}:${instrument.tradingsymbol}`;
      const raw = rawData[identifier] ?? rawData[symbol.toUpperCase()] ?? rawData[instrument.instrument_token.toString()];
      if (!raw) throw new Error(`Kite quote response did not contain data for ${symbol}.`);
      const quote = normalizeQuote(symbol, instrument, raw);
      // Undated quotes are absent, so the symbol is reported unavailable.
      return quote ? [quote] : [];
    });
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    return this.fetchQuotes(symbols);
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
      this.polling.set(symbol, interval);
    });

    return () => {
      clearInterval(interval);
      normalized.forEach((symbol) => {
        if (this.polling.get(symbol) === interval) this.polling.delete(symbol);
      });
    };
  }

  async getIntradaySeries(symbol: string, maxPoints = 60): Promise<PricePoint[]> {
    const instruments = await fetchKiteInstruments();
    const instrument = findKiteInstrument(symbol, instruments);
    if (!instrument) {
      throw new Error(`Kite instrument not found for: ${symbol}`);
    }

    const { apiKey, accessToken, baseUrl } = requireKiteConfig();
    const end = Math.floor(Date.now() / 1000);
    const from = end - 60 * 60 * 24;
    await throttle("historical", HISTORICAL_GAP_MS);
    const response = await fetch(
      `${baseUrl}/instruments/historical/${instrument.instrument_token}/minute?from=${from}&to=${end}&continuous=1`,
      {
        headers: {
          "X-Kite-Version": "3",
          Authorization: `token ${apiKey}:${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(`Kite intraday fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as KiteHistoricalResponse;
    if (payload.status !== "success") {
      throw new Error("Kite intraday fetch returned an unsuccessful response.");
    }
    const candles = payload.data?.candles ?? [];
    const points: PricePoint[] = candles.flatMap((candlesEntry) => {
      const [timestamp, open, high, low, close] = candlesEntry;
      const parsed = parseKiteTimestamp(timestamp);
      const price = Number(close ?? open ?? high ?? low);
      return parsed != null && Number.isFinite(price) ? [{ t: parsed, p: Number(price.toFixed(2)) }] : [];
    });

    if (points.length === 0) return [];
    const step = Math.max(1, Math.ceil(points.length / Math.max(1, maxPoints)));
    const trimmed: PricePoint[] = [];
    for (let i = 0; i < points.length; i += step) trimmed.push(points[i]);
    if (trimmed.at(-1)?.t !== points.at(-1)?.t) trimmed.push(points[points.length - 1]);
    return trimmed;
  }

  async getDailyCandles(symbol: string, maxCandles = 80): Promise<Candle[]> {
    const instruments = await fetchKiteInstruments();
    const instrument = findKiteInstrument(symbol, instruments);
    if (!instrument) {
      throw new Error(`Kite instrument not found for: ${symbol}`);
    }

    const { apiKey, accessToken, baseUrl } = requireKiteConfig();
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - Math.max(maxCandles * 2, 180));
    const formatDate = (date: Date) => date.toISOString().slice(0, 10);
    await throttle("historical", HISTORICAL_GAP_MS);
    const response = await fetch(
      `${baseUrl}/instruments/historical/${instrument.instrument_token}/day?from=${formatDate(from)}&to=${formatDate(to)}&continuous=1`,
      {
        headers: {
          "X-Kite-Version": "3",
          Authorization: `token ${apiKey}:${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(`Kite daily candle fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as KiteHistoricalResponse;
    if (payload.status !== "success") {
      throw new Error("Kite daily candle fetch returned an unsuccessful response.");
    }
    const candles = payload.data?.candles ?? [];
    return candles
      .map((entry): Candle | null => {
        const [timestamp, open, high, low, close, volume] = entry;
        const parsed = parseKiteTimestamp(timestamp);
        if (parsed == null) return null;
        return {
          t: parsed,
          open: Number(Number(open).toFixed(2)),
          high: Number(Number(high).toFixed(2)),
          low: Number(Number(low).toFixed(2)),
          close: Number(Number(close).toFixed(2)),
          volume: asNumber(volume, 0),
        };
      })
      .filter((candle): candle is Candle => Boolean(candle))
      .slice(-Math.max(1, maxCandles));
  }
}

export const kiteProvider = new KiteProvider();
