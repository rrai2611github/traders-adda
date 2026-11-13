import type { Candle } from "@/lib/market/types";
import type { DataHealth } from "@/lib/market/historyQuality";

/**
 * Stage 2 bases: a stock in an uptrend that has gone sideways under a recent high and is either still forming the base
 * or has just closed above it.
 *
 * - Trend (Stage 2): close above the 50-day average, the 50 above the 200, and the 200 higher than it was a month ago.
 * - Base high: the highest high of the last year, measured on the sessions BEFORE the latest one, so a stock that just
 *   cleared it can be told apart from one still under it.
 * - Base starts on the session that set that high. Base low is the lowest low since then. Depth = high / low - 1.
 * - Breakout: the latest close is above that high and the base had run for at least `minBreakoutSessions`.
 *
 * Each row also carries the breakout-day volume ratio. "Quality" means a breakout with volume behind it. Backtest
 * (scripts/backtest-stage2-bases.mjs, 2022-26, next-open entry, 0.25% costs): breakouts on volume under 1.5x lost
 * -0.28R per trade (-0.36R on the 50-day exit) and were the worst group in both halves; volume-confirmed breakouts
 * were about breakeven. A depth cap did not help (breakouts deeper than 35% did as well as shallower ones), so depth
 * is shown but does not filter or flag. Even the confirmed list has no proven edge: treat it as a watch list.
 */
export const STAGE2_BASE_RULES = {
  highSessions: 252,
  minSessions: 1,
  /** A breakout only counts after a base of at least four weeks. */
  minBreakoutSessions: 20,
  trendAverageShort: 50,
  trendAverageLong: 200,
  slopeLookbackSessions: 20,
  volumeAverageSessions: 50,
  /** Depth above this is highlighted as a deep recovery base. Information only; the backtest found no edge from capping it. */
  deepBasePercent: 35,
  /** Breakout-day volume that counts as confirmation. */
  confirmVolumeRatio: 1.5,
  /** Within this distance of the base high a forming base is "near the high". */
  nearPercent: 5,
  minPrice: 20,
  minVolume: 50_000,
} as const;

export interface Stage2BaseCore {
  kind: "breakout" | "forming";
  close: number;
  dayChangePercent: number | null;
  baseHigh: number;
  baseLow: number;
  /** High over low, minus one, as a percent. */
  depthPercent: number;
  /** Trading sessions from the session that set the base high to the latest session. */
  lengthSessions: number;
  /** Timestamp of the session that set the base high. */
  beganAt: number;
  /** Percent the close is below the base high (positive); for a breakout, how far above it (negative). */
  toHighPercent: number;
  /** Latest volume over its 50-session average. */
  volumeRatio: number;
  /** A breakout with volume behind it. Always false for a forming base, where the backtest found nothing that separates better from worse. */
  quality: boolean;
  /** The base is under 5 sessions old: a fresh pullback from a high, not yet a base. */
  fresh: boolean;
}

export interface Stage2BasePick extends Stage2BaseCore {
  symbol: string;
  name: string;
  rs: number | null;
  turnoverCr: number | null;
}

export interface Stage2BasesPayload extends DataHealth {
  provisional?: boolean;
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  eligible: number;
  unavailable: string[];
  rows: Stage2BasePick[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function averageAt(candles: ReadonlyArray<Candle>, end: number, length: number): number | null {
  if (end - length + 1 < 0) return null;
  let sum = 0;
  for (let k = end - length + 1; k <= end; k++) sum += candles[k].close;
  return sum / length;
}

/** True when the latest session sits in a Stage 2 uptrend. */
export function inStage2Trend(candles: ReadonlyArray<Candle>): boolean {
  const R = STAGE2_BASE_RULES;
  const i = candles.length - 1;
  const short = averageAt(candles, i, R.trendAverageShort);
  const long = averageAt(candles, i, R.trendAverageLong);
  const longBefore = averageAt(candles, i - R.slopeLookbackSessions, R.trendAverageLong);
  if (short == null || long == null || longBefore == null) return false;
  return candles[i].close > short && short > long && long > longBefore;
}

/**
 * `candles` must be completed sessions only. Returns null when the stock is not in a Stage 2 trend, is too thin or
 * cheap, or has no base (it is at a new high, or the high was set before the latest session by less than `minSessions`).
 */
export function measureStage2Base(candles: ReadonlyArray<Candle>): Stage2BaseCore | null {
  const R = STAGE2_BASE_RULES;
  const i = candles.length - 1;
  if (i < R.highSessions) return null;
  const last = candles[i];
  if (last.close < R.minPrice || last.volume < R.minVolume) return null;
  if (!inStage2Trend(candles)) return null;

  // Highest high of the prior year, not counting the latest session. Ties go to the most recent.
  let baseHigh = -Infinity;
  let startAt = -1;
  for (let k = i - R.highSessions; k < i; k++) {
    if (candles[k].high >= baseHigh) { baseHigh = candles[k].high; startAt = k; }
  }
  if (startAt < 0) return null;
  const lengthSessions = i - startAt;
  if (lengthSessions < R.minSessions) return null;

  let baseLow = Infinity;
  for (let k = startAt; k <= i; k++) baseLow = Math.min(baseLow, candles[k].low);
  if (!(baseLow > 0)) return null;

  const isBreakout = last.close > baseHigh;
  if (isBreakout && lengthSessions < R.minBreakoutSessions) return null;

  let avgVolume = 0;
  for (let k = i - R.volumeAverageSessions; k < i; k++) avgVolume += candles[k].volume / R.volumeAverageSessions;
  const volumeRatio = avgVolume > 0 ? last.volume / avgVolume : 0;
  const prev = candles[i - 1]?.close;
  const depthPercent = (baseHigh / baseLow - 1) * 100;

  return {
    kind: isBreakout ? "breakout" : "forming",
    close: last.close,
    dayChangePercent: prev ? round2((last.close / prev - 1) * 100) : null,
    baseHigh: round2(baseHigh),
    baseLow: round2(baseLow),
    depthPercent: round2(depthPercent),
    lengthSessions,
    beganAt: candles[startAt].t,
    toHighPercent: round2((1 - last.close / baseHigh) * 100),
    volumeRatio: round2(volumeRatio),
    quality: isBreakout && volumeRatio >= R.confirmVolumeRatio,
    fresh: lengthSessions < 5,
  };
}

/** Breakouts first (smallest overshoot first), then forming bases nearest to their high. */
export function rankStage2Bases(a: Stage2BasePick, b: Stage2BasePick): number {
  if (a.kind !== b.kind) return a.kind === "breakout" ? -1 : 1;
  return a.kind === "breakout" ? b.toHighPercent - a.toHighPercent : a.toHighPercent - b.toHighPercent;
}

export interface BaseFilter {
  /** Maximum percent below the base high; null for any. */
  maxToHigh: number | null;
  minSessions: number | null;
  maxSessions: number | null;
  maxDepth: number | null;
}

export const NO_BASE_FILTER: BaseFilter = { maxToHigh: null, minSessions: null, maxSessions: null, maxDepth: null };

export function matchesBaseFilter(row: Stage2BasePick, filter: BaseFilter): boolean {
  if (filter.maxToHigh != null && row.toHighPercent > filter.maxToHigh) return false;
  if (filter.minSessions != null && row.lengthSessions < filter.minSessions) return false;
  if (filter.maxSessions != null && row.lengthSessions > filter.maxSessions) return false;
  if (filter.maxDepth != null && row.depthPercent > filter.maxDepth) return false;
  return true;
}

/** A bucket holds values from `min` up to, but not including, `max`. */
export interface Bucket { label: string; min: number; max: number }

export const DISTANCE_BUCKETS: Bucket[] = [
  { label: "under 1%", min: -Infinity, max: 1 },
  { label: "1–2%", min: 1, max: 2 },
  { label: "2–3%", min: 2, max: 3 },
  { label: "3–5%", min: 3, max: 5 },
  { label: "5–10%", min: 5, max: 10 },
  { label: "10%+", min: 10, max: Infinity },
];
export const LENGTH_BUCKETS: Bucket[] = [
  { label: "1–9", min: 1, max: 10 },
  { label: "10–19", min: 10, max: 20 },
  { label: "20–39", min: 20, max: 40 },
  { label: "40–59", min: 40, max: 60 },
  { label: "60–119", min: 60, max: 120 },
  { label: "120+", min: 120, max: Infinity },
];
export const DEPTH_BUCKETS: Bucket[] = [
  { label: "under 10%", min: -Infinity, max: 10 },
  { label: "10–20%", min: 10, max: 20 },
  { label: "20–30%", min: 20, max: 30 },
  { label: "30%+", min: 30, max: Infinity },
];

export function bucketCounts(values: number[], buckets: Bucket[]): number[] {
  return buckets.map((b) => values.filter((v) => v >= b.min && v < b.max).length);
}
