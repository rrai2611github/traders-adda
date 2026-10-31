import type { Candle } from "@/lib/market/types";
import type { DataHealth } from "@/lib/market/historyQuality";
import { ema, rsi } from "./oscillators.ts";

/**
 * "Bottomed out": a stock that fell hard, stopped making new lows, printed a
 * higher low and has reclaimed its 20 EMA. Tested in scripts/backtest-bottom.mjs;
 * this is the same rule set. The deep tier (50%+ off the high) is the only one
 * that held up there (about +0.1R after costs over 2024-26); the early tier
 * (35-50% off) lost and is shown as watch-only.
 */
export const BOTTOMED_OUT_RULES = {
  highSessions: 252,
  lowSessions: 120,
  minDrawdownPercent: 35,
  deepDrawdownPercent: 50,
  /** The low must be at least this many sessions old (the selling has stopped) but not older than maxLowAge. */
  minLowAge: 8,
  maxLowAge: 60,
  minOffLowPercent: 8,
  maxOffLowPercent: 50,
  higherLowSessions: 5,
  higherLowMarginPercent: 2,
  minPrice: 20,
  minVolume: 50_000,
  volumeAverageSessions: 50,
  /** The tested exit: fixed stop and target from the close, 40 sessions. */
  stopPercent: 8,
  targetPercent: 16,
  divergenceRsiGap: 3,
} as const;

export type BottomTier = "deep" | "early";

export interface BottomedOutPick {
  symbol: string;
  name: string;
  tier: BottomTier;
  close: number;
  /** Percent below the 52-week high (positive). */
  fromHighPercent: number;
  /** Lowest low of the last 120 sessions, and how many sessions ago it was set. */
  lowPrice: number;
  lowAgeSessions: number;
  offLowPercent: number;
  /** Lowest low of the last 5 sessions: it sits above `lowPrice`, which is the "higher low". */
  higherLow: number;
  ema20: number;
  ema50: number | null;
  aboveEma50: boolean;
  volumeRatio: number;
  rsi14: number | null;
  /** RSI's floor over the last 10 sessions is above the RSI printed at the price low. */
  rsiDivergence: boolean;
  /** Tested exit: stop 8% under the close, target 16% over it. */
  stop: number;
  target: number;
  /** The close the screen was built on, kept when `close` is replaced by the latest price in emails. */
  signalClose?: number;
  rs: number | null;
  turnoverCr: number | null;
}

export type BottomedOutCore = Omit<BottomedOutPick, "symbol" | "name" | "rs" | "turnoverCr">;

export interface BottomedOutPayload extends DataHealth {
  /** True when today's forming candle was used (market open); results can change before the close. */
  provisional?: boolean;
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  eligible: number;
  /** Liquid stocks 35%+ off their 52-week high, before the base rules. */
  drawdowns: number;
  unavailable: string[];
  rows: BottomedOutPick[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * `candles` must be completed sessions only. Returns null unless every base
 * rule passes on the last candle.
 */
export function measureBottomedOut(candles: ReadonlyArray<Candle>): BottomedOutCore | null {
  const R = BOTTOMED_OUT_RULES;
  const i = candles.length - 1;
  if (i < R.highSessions) return null;
  const L = candles[i];
  if (L.close < R.minPrice || L.volume < R.minVolume) return null;

  let high = 0;
  for (let k = i - R.highSessions + 1; k <= i; k++) high = Math.max(high, candles[k].high);
  const fromHighPercent = (1 - L.close / high) * 100;
  if (fromHighPercent < R.minDrawdownPercent) return null;

  let low = Infinity;
  let lowAt = -1;
  for (let k = i - R.lowSessions + 1; k <= i; k++) {
    if (candles[k].low < low) { low = candles[k].low; lowAt = k; }
  }
  const lowAge = i - lowAt;
  if (lowAge < R.minLowAge || lowAge > R.maxLowAge) return null;
  const offLowPercent = (L.close / low - 1) * 100;
  if (offLowPercent < R.minOffLowPercent || offLowPercent > R.maxOffLowPercent) return null;

  let higherLow = Infinity;
  for (let k = i - R.higherLowSessions + 1; k <= i; k++) higherLow = Math.min(higherLow, candles[k].low);
  if (higherLow <= low * (1 + R.higherLowMarginPercent / 100)) return null;

  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20)[i];
  if (e20 == null || L.close <= e20) return null;
  const e50 = ema(closes, 50)[i];
  const rsiSeries = rsi(closes, 14);

  let avgVolume = 0;
  for (let k = i - R.volumeAverageSessions; k < i; k++) avgVolume += candles[k].volume / R.volumeAverageSessions;
  const volumeRatio = avgVolume > 0 ? L.volume / avgVolume : 0;

  let rsiFloor = Infinity;
  for (let k = i - 9; k <= i; k++) rsiFloor = Math.min(rsiFloor, rsiSeries[k] ?? Infinity);
  const rsiAtLow = rsiSeries[lowAt];
  const rsiDivergence = rsiAtLow != null && Number.isFinite(rsiFloor) && rsiFloor > rsiAtLow + R.divergenceRsiGap;


  const aboveEma50 = e50 != null && L.close > e50;
  return {
    tier: fromHighPercent >= R.deepDrawdownPercent ? "deep" : "early",
    close: L.close,
    fromHighPercent: round2(fromHighPercent),
    lowPrice: round2(low),
    lowAgeSessions: lowAge,
    offLowPercent: round2(offLowPercent),
    higherLow: round2(higherLow),
    ema20: round2(e20),
    ema50: e50 == null ? null : round2(e50),
    aboveEma50,
    volumeRatio: round2(volumeRatio),
    rsi14: rsiSeries[i] == null ? null : round2(rsiSeries[i]!),
    rsiDivergence,
    stop: round2(L.close * (1 - R.stopPercent / 100)),
    target: round2(L.close * (1 + R.targetPercent / 100)),
  };
}

/**
 * Deep tier first, then the smaller bounce off the low (the earlier entry). Volume, EMA50 and RSI divergence are
 * shown as context only: none of them improved the backtest consistently.
 */
export const rankBottomedOut = (a: BottomedOutPick, b: BottomedOutPick) =>
  Number(b.tier === "deep") - Number(a.tier === "deep") || a.offLowPercent - b.offLowPercent;
