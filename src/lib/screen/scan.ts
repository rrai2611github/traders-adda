import type { Candle } from "@/lib/market/types";
import type { UniverseSnapshot } from "@/lib/market/universeSnapshot";
import { EQUITIES } from "@/lib/market/universe";
import { rsAmong } from "./rsScale";
import {
  assignRsRatings,
  computeMetrics,
  performanceScore,
  performanceScoreAt,
  rankToRs,
  type StockMetrics,
} from "./metrics";

export interface UniverseScan {
  snapshotId: number;
  providerId: string;
  metrics: StockMetrics[];
  /** Daily candles the metrics were measured on, placeholder bars removed. */
  candlesBySymbol: Map<string, Candle[]>;
  /** Daily candles exactly as the provider returned them. */
  rawCandlesBySymbol: Map<string, Candle[]>;
  /** Symbols with too few daily candles to measure (typically new listings). */
  insufficientHistory: string[];
  /** Weighted performance score per measured symbol (the RS input). */
  returns: Map<string, number | null>;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a breakout's own-day RS can be looked up. */
const RS_LOOKBACK_SESSIONS = 420;

export function istDayNumber(timestamp: number): number {
  return Math.floor((timestamp + IST_OFFSET_MS) / DAY_MS);
}

let cache: UniverseScan | null = null;

const isPlaceholder = (candles: Candle[], i: number) => {
  const c = candles[i];
  return (
    i > 0 &&
    c.volume === 0 &&
    c.open === c.close &&
    c.high === c.close &&
    c.low === c.close &&
    c.close === candles[i - 1].close
  );
};

/**
 * Exchange holidays the provider filled with placeholder bars: zero volume at
 * the prior close, for (nearly) every stock that day. Each one would otherwise
 * count as a session in base ages, halves and poke windows. A single stock's
 * zero-volume bar on a real trading day is kept, since that session happened.
 */
export function placeholderDays(histories: Map<string, Candle[]>): Set<number> {
  const seen = new Map<number, { bars: number; placeholders: number }>();
  for (const candles of histories.values()) {
    for (let i = 0; i < candles.length; i += 1) {
      const day = istDayNumber(candles[i].t);
      const tally = seen.get(day) ?? { bars: 0, placeholders: 0 };
      tally.bars += 1;
      if (isPlaceholder(candles, i)) tally.placeholders += 1;
      seen.set(day, tally);
    }
  }
  const days = new Set<number>();
  for (const [day, { bars, placeholders }] of seen) {
    if (bars >= 50 && placeholders / bars >= 0.95) days.add(day);
  }
  return days;
}

/**
 * Measures the whole universe once per snapshot, shared by every route that
 * needs screens, stages or breakouts so they can never disagree.
 */
export function scanUniverse(snapshot: UniverseSnapshot): UniverseScan {
  if (cache && cache.snapshotId === snapshot.id && cache.providerId === snapshot.providerId) return cache;

  const instrumentBySymbol = new Map(EQUITIES.map((e) => [e.symbol, e]));
  const metrics: StockMetrics[] = [];
  const returns = new Map<string, number | null>();
  const insufficientHistory: string[] = [];
  const histories = new Map<string, Candle[]>();
  const holidays = placeholderDays(snapshot.histories);
  for (const [symbol, candles] of snapshot.histories) {
    histories.set(symbol, holidays.size ? candles.filter((c) => !holidays.has(istDayNumber(c.t))) : candles);
  }

  for (const [symbol, candles] of histories) {
    if (!candles.length) {
      insufficientHistory.push(symbol);
      continue;
    }
    const quote = snapshot.quotes.get(symbol);
    const measured = computeMetrics({
      symbol,
      candles,
      price: quote?.ltp,
      changePercent: quote?.changePercent,
      marketCapCr: instrumentBySymbol.get(symbol)?.marketCapCr,
      tradable: instrumentBySymbol.get(symbol)?.series !== "BE",
    });
    if (!measured) {
      insufficientHistory.push(symbol);
      continue;
    }
    metrics.push(measured);
    returns.set(symbol, performanceScore(candles));
  }

  assignRsRatings(metrics, returns);
  assignEntryRs(metrics, histories);

  cache = {
    snapshotId: snapshot.id,
    providerId: snapshot.providerId,
    metrics,
    candlesBySymbol: histories,
    rawCandlesBySymbol: snapshot.histories,
    insufficientHistory: insufficientHistory.sort(),
    returns,
  };
  return cache;
}

/**
 * RS as it stood on each breakout day, ranked against the tradable universe
 * of that day, so a breakout is screened on the strength it actually had.
 * The floor is today's, since market caps are not kept historically.
 */
function assignEntryRs(metrics: StockMetrics[], histories: Map<string, Candle[]>): void {
  const tradable = metrics.filter((m) => m.passesFloor);
  // Stocks only the screens list: rated on each breakout day against that day's tradable scale, without moving it.
  const screenOnly = metrics.filter((m) => m.passesScreenFloor && !m.passesFloor);
  const wantedDays = new Set<number>();
  for (const m of [...tradable, ...screenOnly]) {
    for (const { episode } of m.episodes) wantedDays.add(istDayNumber(episode.timestamp));
  }
  if (!wantedDays.size) return;

  const indexOf = (m: StockMetrics) => {
    const candles = histories.get(m.symbol) ?? [];
    const map = new Map<number, number>();
    for (let i = Math.max(0, candles.length - RS_LOOKBACK_SESSIONS); i < candles.length; i += 1) {
      map.set(istDayNumber(candles[i].t), i);
    }
    return { symbol: m.symbol, candles, map };
  };
  const indexByDay = tradable.map(indexOf);
  const screenOnlyIndex = new Map(screenOnly.map((m) => [m.symbol, indexOf(m)]));

  const rsByDay = new Map<number, Map<string, number>>();
  for (const day of wantedDays) {
    const symbols: string[] = [];
    const scores: number[] = [];
    for (const { symbol, candles, map } of indexByDay) {
      const at = map.get(day);
      if (at == null) continue;
      const score = performanceScoreAt(candles, at);
      if (score == null) continue;
      symbols.push(symbol);
      scores.push(score);
    }
    const ratings = rankToRs(scores);
    const byDay = new Map(symbols.map((symbol, i) => [symbol, ratings[i]]));
    const sortedScale = [...scores].sort((a, b) => a - b);
    for (const [symbol, { candles, map }] of screenOnlyIndex) {
      const at = map.get(day);
      const score = at == null ? null : performanceScoreAt(candles, at);
      if (score != null) byDay.set(symbol, rsAmong(sortedScale, score));
    }
    rsByDay.set(day, byDay);
  }

  for (const m of [...tradable, ...screenOnly]) {
    for (const item of m.episodes) {
      item.entry.rs = rsByDay.get(istDayNumber(item.episode.timestamp))?.get(m.symbol) ?? null;
    }
  }
}
