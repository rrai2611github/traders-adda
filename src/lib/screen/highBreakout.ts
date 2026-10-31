import type { Candle } from "@/lib/market/types";
import { HEALTHY_BREADTH_PERCENT } from "./breadth.ts";
import { ema } from "./oscillators.ts";

/**
 * Jaynesh Kasliwal's "stock near 5% of 52-week high" Chartink screen, with
 * the breakout rules his webinar leaves open made exact. Tested in
 * scripts/backtest-jk-breakout.mjs; this is the same rule set.
 */
export const HIGH_BREAKOUT_RULES = {
  highSessions: 252,
  nearHighFraction: 0.95,
  momentumSessions: 65,
  minPrice: 100,
  minVolume: 50_000,
  baseSessions: 20,
  minVolumeRatio: 1.5,
  volumeAverageSessions: 50,
  tightBasePercent: 15,
  stopPercent: 3,
} as const;

export interface HighBreakoutPick {
  symbol: string;
  name: string;
  close: number;
  /** Highest high of the 20 sessions before the breakout day. */
  baseHigh: number;
  baseRangePercent: number;
  tightBase: boolean;
  fromHighPercent: number;
  return65Percent: number;
  volumeRatio: number;
  ema21: number;
  rs: number | null;
}

export interface HighBreakoutSection {
  /** Liquid stocks passing his screen today. */
  screened: number;
  /** Confirmed breakouts, tight bases first, then by volume. */
  breakouts: HighBreakoutPick[];
  niftyReturn65Percent: number | null;
}

export type HighBreakoutMeasure =
  | { screened: false }
  | { screened: true; pick: Omit<HighBreakoutPick, "symbol" | "name" | "rs"> | null };

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 65-session Nifty return on completed candles, as a fraction. */
export function niftyReturn65(benchmark: ReadonlyArray<Candle> | null | undefined, lastT: number): number | null {
  if (!benchmark?.length) return null;
  const done = benchmark.filter((k) => k.t <= lastT + 12 * 3600e3 && k.close > 0);
  const i = done.length - 1;
  const n = HIGH_BREAKOUT_RULES.momentumSessions;
  return i >= n ? done[i].close / done[i - n].close - 1 : null;
}

/**
 * `candles` must be completed sessions only. `screened` is his Chartink
 * screen; `pick` is set only on a confirmed breakout: close above the
 * 20-session high, volume at least 1.5× the 50-session average and a
 * 65-session return above Nifty's.
 */
export function measureHighBreakout(candles: ReadonlyArray<Candle>, niftyReturn: number | null): HighBreakoutMeasure {
  const R = HIGH_BREAKOUT_RULES;
  const i = candles.length - 1;
  if (i < R.highSessions) return { screened: false };
  const L = candles[i];
  let high = 0;
  for (let k = i - R.highSessions + 1; k <= i; k++) high = Math.max(high, candles[k].high);
  const closes = candles.map((k) => k.close);
  const e20 = ema(closes, 20)[i];
  const e21 = ema(closes, 21)[i];
  const e50 = ema(closes, 50)[i];
  const ret65 = L.close / candles[i - R.momentumSessions].close - 1;
  const screened = e20 != null && e21 != null && e50 != null &&
    L.close >= R.nearHighFraction * high && ret65 > 0 && L.close > R.minPrice &&
    e20 > e50 && L.close > e21 && L.volume > R.minVolume;
  if (!screened) return { screened: false };

  let baseHigh = 0;
  let baseLow = Infinity;
  for (let k = i - R.baseSessions; k < i; k++) {
    baseHigh = Math.max(baseHigh, candles[k].high);
    baseLow = Math.min(baseLow, candles[k].low);
  }
  let avgVolume = 0;
  for (let k = i - R.volumeAverageSessions; k < i; k++) avgVolume += candles[k].volume / R.volumeAverageSessions;
  const volumeRatio = avgVolume > 0 ? L.volume / avgVolume : 0;
  const confirmed = L.close > baseHigh && volumeRatio >= R.minVolumeRatio && niftyReturn != null && ret65 > niftyReturn;
  if (!confirmed) return { screened: true, pick: null };
  const baseRangePercent = ((baseHigh - baseLow) / baseHigh) * 100;
  return {
    screened: true,
    pick: {
      close: L.close,
      baseHigh: round2(baseHigh),
      baseRangePercent: round2(baseRangePercent),
      tightBase: baseRangePercent <= R.tightBasePercent,
      fromHighPercent: round2((L.close / high - 1) * 100),
      return65Percent: round2(ret65 * 100),
      volumeRatio: round2(volumeRatio),
      ema21: round2(e21),
    },
  };
}

export const rankHighBreakouts = (a: HighBreakoutPick, b: HighBreakoutPick) =>
  Number(b.tightBase) - Number(a.tightBase) || b.volumeRatio - a.volumeRatio;

/** The list is shown only when breadth is healthy; breakouts in weak markets lost in the backtest. */
export const highBreakoutsVisible = (breadthPercent: number | null) =>
  breadthPercent != null && breadthPercent >= HEALTHY_BREADTH_PERCENT;
