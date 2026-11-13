import type { Candle } from "../market/types.ts";
import { getMarketStatus, istDateKey } from "../market/marketHours.ts";

const HOUR_MS = 60 * 60_000;
const MAX_BAR_AGE_MS = 75 * 60_000;
const FETCH_CONCURRENCY = 4;
const EVENT_LIMIT = 10;

export type IntradayEventKind = "prior-high-cross" | "prior-low-break" | "vwap-reclaim" | "vwap-loss";

export interface IntradayDevelopment {
  symbol: string;
  kind: IntradayEventKind;
  eventAt: number;
  close: number;
  level: number;
  eventKey: string;
}

export interface IntradayDevelopmentSummary {
  status: "available" | "partial" | "unavailable";
  events: IntradayDevelopment[];
  checked: number;
  stale: number;
  unavailable: number;
  reason?: string;
}

export interface IntradayCandidate {
  symbol: string;
  dailyCandles: ReadonlyArray<Candle>;
}

const validCandle = (candle: Candle) =>
  Number.isFinite(candle.t) &&
  Number.isFinite(candle.open) &&
  Number.isFinite(candle.high) &&
  Number.isFinite(candle.low) &&
  Number.isFinite(candle.close) &&
  Number.isFinite(candle.volume) &&
  candle.low > 0 &&
  candle.high >= candle.low &&
  candle.volume >= 0;

function priorSessionCandle(candles: ReadonlyArray<Candle>, sessionDate: string): Candle | null {
  return candles
    .filter((candle) => validCandle(candle) && istDateKey(candle.t) < sessionDate)
    .sort((a, b) => a.t - b.t)
    .at(-1) ?? null;
}

function completedSessionBars(candles: ReadonlyArray<Candle>, sessionDate: string, now: number): Candle[] {
  const sessionOpen = Date.parse(`${sessionDate}T09:15:00+05:30`);
  return candles
    .filter((candle) =>
      validCandle(candle) &&
      istDateKey(candle.t) === sessionDate &&
      candle.t >= sessionOpen &&
      candle.t + HOUR_MS <= now,
    )
    .sort((a, b) => a.t - b.t);
}

function averagePrice(candle: Candle): number {
  return (candle.high + candle.low + candle.close) / 3;
}

export function detectHourlyDevelopments(
  symbol: string,
  hourlyCandles: ReadonlyArray<Candle>,
  dailyCandles: ReadonlyArray<Candle>,
  now: number,
): { events: IntradayDevelopment[]; stale: boolean; available: boolean } {
  const sessionDate = istDateKey(now);
  const prior = priorSessionCandle(dailyCandles, sessionDate);
  const bars = completedSessionBars(hourlyCandles, sessionDate, now);
  const latest = bars.at(-1);
  if (!latest || now - (latest.t + HOUR_MS) > MAX_BAR_AGE_MS) return { events: [], stale: true, available: false };
  if (!prior || bars.length < 2) return { events: [], stale: false, available: false };

  const previous = bars[bars.length - 2];
  const events: IntradayDevelopment[] = [];
  const add = (kind: IntradayEventKind, level: number) => events.push({
    symbol,
    kind,
    eventAt: latest.t + HOUR_MS,
    close: latest.close,
    level,
    eventKey: `${sessionDate}:${symbol}:${kind}:${latest.t + HOUR_MS}`,
  });

  if (previous.close <= prior.high && latest.close > prior.high) add("prior-high-cross", prior.high);
  if (previous.close >= prior.low && latest.close < prior.low) add("prior-low-break", prior.low);

  let cumulativeValue = 0;
  let cumulativeVolume = 0;
  let previousVwap: number | null = null;
  for (const bar of bars) {
    if (bar.volume > 0) {
      cumulativeValue += averagePrice(bar) * bar.volume;
      cumulativeVolume += bar.volume;
    }
    if (bar === previous && cumulativeVolume > 0) previousVwap = cumulativeValue / cumulativeVolume;
  }
  const currentVwap = cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : null;
  if (previousVwap != null && currentVwap != null) {
    if (previous.close <= previousVwap && latest.close > currentVwap) add("vwap-reclaim", currentVwap);
    if (previous.close >= previousVwap && latest.close < currentVwap) add("vwap-loss", currentVwap);
  }

  return { events, stale: false, available: true };
}

const EVENT_PRIORITY: Record<IntradayEventKind, number> = {
  "prior-high-cross": 0,
  "prior-low-break": 1,
  "vwap-reclaim": 2,
  "vwap-loss": 3,
};

/**
 * Checks only the current Buy ready/watch candidates. Yahoo provides hourly,
 * not five-minute, candles here; incomplete or old bars never create events.
 */
export async function collectHourlyDevelopments(
  candidates: ReadonlyArray<IntradayCandidate>,
  now: number,
  fetchHourly: (symbol: string) => Promise<ReadonlyArray<Candle>>,
): Promise<IntradayDevelopmentSummary> {
  if (!getMarketStatus(now).isLive) {
    return { status: "unavailable", events: [], checked: 0, stale: 0, unavailable: candidates.length, reason: "Market is closed; no current intraday check." };
  }
  if (!candidates.length) {
    return { status: "unavailable", events: [], checked: 0, stale: 0, unavailable: 0, reason: "No Buy ready or watch candidates to check." };
  }

  let next = 0;
  let checked = 0;
  let stale = 0;
  let unavailable = 0;
  const events: IntradayDevelopment[] = [];
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, candidates.length) }, async () => {
    while (next < candidates.length) {
      const candidate = candidates[next];
      next += 1;
      try {
        const hourly = await fetchHourly(candidate.symbol);
        const result = detectHourlyDevelopments(candidate.symbol, hourly, candidate.dailyCandles, now);
        if (result.stale) stale += 1;
        else if (result.available) checked += 1;
        else unavailable += 1;
        events.push(...result.events);
      } catch (error) {
        unavailable += 1;
        console.error(`[email] ${candidate.symbol} hourly intraday check unavailable:`, error);
      }
    }
  }));

  const status = checked === 0 ? "unavailable" : stale + unavailable > 0 ? "partial" : "available";
  return {
    status,
    events: events.sort((a, b) => EVENT_PRIORITY[a.kind] - EVENT_PRIORITY[b.kind] || a.symbol.localeCompare(b.symbol)).slice(0, EVENT_LIMIT),
    checked,
    stale,
    unavailable,
    ...(checked === 0 ? { reason: "No candidate had a fresh completed hourly bar plus the required daily reference and same-session history." } : {}),
  };
}

export function withoutPreviouslySentEvents(
  summary: IntradayDevelopmentSummary,
  sentKeys: ReadonlySet<string>,
): { summary: IntradayDevelopmentSummary; eventKeys: string[] } {
  const events = summary.events.filter((event) => !sentKeys.has(event.eventKey));
  return {
    summary: { ...summary, events },
    eventKeys: events.map((event) => event.eventKey),
  };
}
