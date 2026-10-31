import type { Candle } from "../market/types.ts";
import { adx } from "../screen/oscillators.ts";

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period];
    return i + 1 >= period ? sum / period : null;
  });
}

/** Bollinger Bands on a simple average with population standard deviation. */
export function bollinger(values: number[], period = 20, width = 2): { mid: Series; upper: Series; lower: Series } {
  const mid = sma(values, period);
  const upper: Series = [];
  const lower: Series = [];
  values.forEach((_, i) => {
    const m = mid[i];
    if (m == null) { upper.push(null); lower.push(null); return; }
    let s = 0;
    for (let k = i - period + 1; k <= i; k += 1) s += (values[k] - m) ** 2;
    const sd = Math.sqrt(s / period);
    upper.push(m + width * sd);
    lower.push(m - width * sd);
  });
  return { mid, upper, lower };
}

/**
 * Supertrend on Wilder's ATR: bands at hl2 ± multiplier × ATR that only
 * tighten while the trend holds; the trend flips when the close crosses the
 * active band. `up` holds the line while the trend is up, `down` while down.
 */
export function supertrend(candles: Candle[], period = 10, multiplier = 3): { up: Series; down: Series; trend: (1 | -1 | null)[] } {
  const n = candles.length;
  const atr = adx(candles, period).atr;
  const up: Series = new Array(n).fill(null);
  const down: Series = new Array(n).fill(null);
  const trend: (1 | -1 | null)[] = new Array(n).fill(null);
  let upper = 0;
  let lower = 0;
  let dir: 1 | -1 = 1;
  let started = false;
  for (let i = 0; i < n; i += 1) {
    const a = atr[i];
    if (a == null) continue;
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + multiplier * a;
    const basicLower = hl2 - multiplier * a;
    const prevClose = candles[i - 1]?.close ?? c.close;
    if (!started) {
      upper = basicUpper;
      lower = basicLower;
      dir = c.close >= hl2 ? 1 : -1;
      started = true;
    } else {
      upper = basicUpper < upper || prevClose > upper ? basicUpper : upper;
      lower = basicLower > lower || prevClose < lower ? basicLower : lower;
      if (dir === 1 && c.close < lower) dir = -1;
      else if (dir === -1 && c.close > upper) dir = 1;
    }
    trend[i] = dir;
    if (dir === 1) up[i] = lower;
    else down[i] = upper;
  }
  return { up, down, trend };
}

/**
 * Ichimoku (9, 26, 52). Spans A and B are returned already shifted forward
 * by `displacement` bars, so index i holds the cloud drawn at bar i; the
 * extra future bars are in `futureA`/`futureB`.
 */
export function ichimoku(candles: Candle[], conversion = 9, base = 26, spanB = 52, displacement = 26) {
  const n = candles.length;
  const mid = (period: number) => candles.map((_, i) => {
    if (i < period - 1) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - period + 1; k <= i; k += 1) {
      hi = Math.max(hi, candles[k].high);
      lo = Math.min(lo, candles[k].low);
    }
    return (hi + lo) / 2;
  });
  const tenkan = mid(conversion);
  const kijun = mid(base);
  const rawB = mid(spanB);
  const rawA: Series = tenkan.map((t, i) => (t != null && kijun[i] != null ? (t + kijun[i]!) / 2 : null));
  const shift = (s: Series): Series => Array.from({ length: n + displacement }, (_, i) => (i - displacement >= 0 ? s[i - displacement] ?? null : null));
  const spanA = shift(rawA);
  const spanBShifted = shift(rawB);
  return {
    tenkan,
    kijun,
    spanA: spanA.slice(0, n),
    spanB: spanBShifted.slice(0, n),
    futureA: spanA.slice(n),
    futureB: spanBShifted.slice(n),
  };
}

export interface PivotLevels { p: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number }

/** Classic floor pivots from one completed bar (e.g. last week or last month). */
export function classicPivots(bar: Pick<Candle, "high" | "low" | "close">): PivotLevels {
  const p = (bar.high + bar.low + bar.close) / 3;
  const range = bar.high - bar.low;
  return {
    p,
    r1: 2 * p - bar.low,
    s1: 2 * p - bar.high,
    r2: p + range,
    s2: p - range,
    r3: bar.high + 2 * (p - bar.low),
    s3: bar.low - 2 * (bar.high - p),
  };
}
