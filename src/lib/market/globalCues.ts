import type { CueGroup, CueQuote, IndexSessionInput } from "../screen/morningBrief";
import { previousSession } from "../screen/morningBrief";
import { getMarketStatus, istDateKey } from "./marketHours";
import { priorSessionClose } from "./priorClose";

/**
 * Overnight cue feed for the morning brief.
 *
 * This talks to Yahoo directly instead of going through `MarketDataProvider`
 * because the instruments are global indices, futures, yields and FX, none of
 * which exist in the NSE instrument master the provider maps against.
 */

interface CueDefinition {
  key: string;
  label: string;
  ticker: string;
  group: CueGroup;
  prefix?: string;
  suffix?: string;
  inverseTone?: boolean;
}

/** Instruments shown in the macro section. Keys match `BIAS_WEIGHTS` where they feed the opening call. */
export const CUE_DEFINITIONS: CueDefinition[] = [
  { key: "sp500", label: "S&P 500", ticker: "^GSPC", group: "us" },
  { key: "nasdaq", label: "Nasdaq", ticker: "^IXIC", group: "us" },
  { key: "spfut", label: "S&P 500 futures", ticker: "ES=F", group: "us" },
  { key: "nqfut", label: "Nasdaq futures", ticker: "NQ=F", group: "us" },
  { key: "dow", label: "Dow Jones", ticker: "^DJI", group: "us" },
  { key: "nikkei", label: "Nikkei 225", ticker: "^N225", group: "asia" },
  { key: "hangseng", label: "Hang Seng", ticker: "^HSI", group: "asia" },
  { key: "kospi", label: "Kospi", ticker: "^KS11", group: "asia" },
  { key: "shanghai", label: "Shanghai Composite", ticker: "000001.SS", group: "asia" },
  { key: "ftse", label: "FTSE 100", ticker: "^FTSE", group: "europe" },
  { key: "stoxxde", label: "DAX", ticker: "^GDAXI", group: "europe" },
  { key: "brent", label: "Brent crude", ticker: "BZ=F", group: "commodity", prefix: "$", suffix: "/bbl", inverseTone: true },
  { key: "gold", label: "Gold", ticker: "GC=F", group: "commodity", prefix: "$", suffix: "/oz" },
  { key: "ust10y", label: "US 10-year yield", ticker: "^TNX", group: "rates", suffix: "%", inverseTone: true },
  { key: "usdinr", label: "USD/INR", ticker: "USDINR=X", group: "currency", prefix: "₹", inverseTone: true },
  { key: "dxy", label: "Dollar index", ticker: "DX-Y.NYB", group: "currency", inverseTone: true },
  { key: "indiavix", label: "India VIX", ticker: "^INDIAVIX", group: "india", inverseTone: true },
];

/** Indices whose previous session drives the derived key levels. */
const LEVEL_INDICES = [
  { key: "nifty", label: "Nifty 50", ticker: "^NSEI" },
  { key: "banknifty", label: "Bank Nifty", ticker: "^NSEBANK" },
  { key: "sensex", label: "Sensex", ticker: "^BSESN" },
];

export interface MarketCues {
  cues: CueQuote[];
  sessions: IndexSessionInput[];
  unavailable: string[];
  generatedAt: number;
}

interface YahooChart {
  meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number };
  timestamp?: number[];
  indicators?: { quote?: Array<{ high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> };
}

const CACHE_TTL_MS = 5 * 60_000;
let cache: { at: number; value: MarketCues } | null = null;

async function fetchChart(ticker: string, range: string): Promise<YahooChart> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StockAnalysis/1.0)", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Yahoo request failed for ${ticker}: ${response.status}`);
  const payload = (await response.json()) as { chart?: { result?: YahooChart[] } };
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`No chart result for ${ticker}`);
  return result;
}

function toCue(definition: CueDefinition, chart: YahooChart): CueQuote | null {
  const meta = chart.meta ?? {};
  const candles = toCandles(chart);
  const price = Number(meta.regularMarketPrice ?? candles.at(-1)?.close);
  // Yahoo's `chartPreviousClose` is the close before the requested range, not
  // the prior session, so the prior candle is used whenever one exists.
  const previousClose = Number(priorSessionClose(candles, meta.regularMarketTime ? meta.regularMarketTime * 1000 : undefined) ?? meta.chartPreviousClose ?? meta.previousClose);
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose <= 0) return null;
  return {
    key: definition.key,
    label: definition.label,
    group: definition.group,
    prefix: definition.prefix,
    suffix: definition.suffix,
    inverseTone: definition.inverseTone,
    price: Number(price.toFixed(2)),
    previousClose: Number(previousClose.toFixed(2)),
    changePercent: Number((((price - previousClose) / previousClose) * 100).toFixed(2)),
    asOf: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
  };
}

function toCandles(chart: YahooChart): { t: number; high: number; low: number; close: number }[] {
  const series = chart.indicators?.quote?.[0];
  const timestamps = chart.timestamp ?? [];
  const candles: { t: number; high: number; low: number; close: number }[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const high = series?.high?.[i];
    const low = series?.low?.[i];
    const close = series?.close?.[i];
    if (typeof timestamps[i] !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number") continue;
    candles.push({ t: timestamps[i] * 1000, high, low, close });
  }
  return candles;
}

/**
 * Fetches every cue and index session. A dead ticker is reported in
 * `unavailable` rather than failing the brief, so one broken feed never hides
 * the rest of the overnight tape.
 */
export async function getMarketCues(now: number = Date.now()): Promise<MarketCues> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  const phase = getMarketStatus(now).phase;
  // Before the close, today's candle is still forming and must not set levels.
  const excludeDateKey = phase === "OPEN" || phase === "PRE_OPEN" ? istDateKey(now) : null;

  const [cueResults, levelResults] = await Promise.all([
    Promise.allSettled(CUE_DEFINITIONS.map(async (definition) => toCue(definition, await fetchChart(definition.ticker, "5d")))),
    Promise.allSettled(
      LEVEL_INDICES.map(async (index) =>
        previousSession(toCandles(await fetchChart(index.ticker, "1mo")), { key: index.key, label: index.label, excludeDateKey }),
      ),
    ),
  ]);

  const cues: CueQuote[] = [];
  const sessions: IndexSessionInput[] = [];
  const unavailable: string[] = [];

  cueResults.forEach((result, index) => {
    const value = result.status === "fulfilled" ? result.value : null;
    if (value) cues.push(value);
    else unavailable.push(CUE_DEFINITIONS[index].label);
  });
  levelResults.forEach((result, index) => {
    const value = result.status === "fulfilled" ? result.value : null;
    if (value) sessions.push(value);
    else unavailable.push(`${LEVEL_INDICES[index].label} levels`);
  });

  const value: MarketCues = { cues, sessions, unavailable, generatedAt: now };
  cache = { at: now, value };
  return value;
}
