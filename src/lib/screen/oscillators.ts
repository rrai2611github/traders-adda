import type { Candle } from "@/lib/market/types";
import { getActiveSession, istDateKey, type ActiveSession } from "../market/marketHours.ts";
import type { StockMetrics } from "./metrics";

export const MOMENTUM_RULES = {
  minSessions: 120,
  minRs: 70,
  rsiPeriod: 14,
  continuationRsi: [50, 70],
  pullbackRsi: [40, 60],
  maxStochK: 90,
  pullbackStochBelow: 25,
  minAdx: 20,
  minWeeklyRsi: 50,
  signalSessions: 3,
  maxAboveEma21Percent: 8,
} as const;

export type MomentumSetup = "continuation" | "pullback";

export interface MomentumResult {
  setup: MomentumSetup;
  /** A trigger (MACD or stochastic cross) happened in the last few completed sessions. */
  fresh: boolean;
  signalTimestamp: number | null;
  lastCompletedCandleTimestamp: number;
  rsi: number;
  weeklyRsi: number;
  macd: number;
  macdSignal: number;
  macdHistPercent: number;
  stochK: number;
  stochD: number;
  adx: number;
  plusDi: number;
  minusDi: number;
  aboveEma21Percent: number;
  atr: number;
}

/** Exponential moving average seeded with the simple average of the first `period` values. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line: (number | null)[] = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const start = line.findIndex((v) => v != null);
  const sig: (number | null)[] = new Array(closes.length).fill(null);
  if (start >= 0) {
    const tail = ema(line.slice(start) as number[], signal);
    tail.forEach((v, i) => { sig[start + i] = v; });
  }
  return { line, signal: sig };
}

/** Slow stochastic: %K is the `smooth`-period SMA of raw %K, %D the `dPeriod` SMA of %K. */
export function stochastic(candles: Candle[], period = 14, smooth = 3, dPeriod = 3) {
  const raw: (number | null)[] = candles.map((_, i) => {
    if (i < period - 1) return null;
    const win = candles.slice(i - period + 1, i + 1);
    const hi = Math.max(...win.map((c) => c.high));
    const lo = Math.min(...win.map((c) => c.low));
    return hi > lo ? ((candles[i].close - lo) / (hi - lo)) * 100 : 50;
  });
  const sma = (xs: (number | null)[], n: number) => xs.map((_, i) => {
    if (i < n - 1) return null;
    const win = xs.slice(i - n + 1, i + 1);
    return win.every((v) => v != null) ? (win as number[]).reduce((s, v) => s + v, 0) / n : null;
  });
  const k = sma(raw, smooth);
  return { k, d: sma(k, dPeriod) };
}

const trueRange = (c: Candle, prev: Candle | undefined) =>
  prev ? Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)) : c.high - c.low;

/** ATR becomes available after `period` changes; it does not require ADX's longer warmup. */
export function wilderAtr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let value = 0;
  for (let i = 1; i <= period; i++) value += trueRange(candles[i], candles[i - 1]);
  value /= period;
  out[period] = value;
  for (let i = period + 1; i < candles.length; i++) {
    value = (value * (period - 1) + trueRange(candles[i], candles[i - 1])) / period;
    out[i] = value;
  }
  return out;
}

/** Wilder's ADX with +DI/−DI, and ATR on the same smoothing. */
export function adx(candles: Candle[], period = 14) {
  const n = candles.length;
  const adxOut: (number | null)[] = new Array(n).fill(null);
  const plus: (number | null)[] = new Array(n).fill(null);
  const minus: (number | null)[] = new Array(n).fill(null);
  const atrOut: (number | null)[] = new Array(n).fill(null);
  if (n <= period * 2) return { adx: adxOut, plusDi: plus, minusDi: minus, atr: atrOut };
  let tr = 0;
  let pdm = 0;
  let mdm = 0;
  const dx: number[] = [];
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    const p = up > down && up > 0 ? up : 0;
    const m = down > up && down > 0 ? down : 0;
    const t = trueRange(candles[i], candles[i - 1]);
    if (i <= period) {
      tr += t; pdm += p; mdm += m;
      if (i < period) continue;
    } else {
      tr = tr - tr / period + t;
      pdm = pdm - pdm / period + p;
      mdm = mdm - mdm / period + m;
    }
    const pdi = tr > 0 ? (pdm / tr) * 100 : 0;
    const mdi = tr > 0 ? (mdm / tr) * 100 : 0;
    plus[i] = pdi;
    minus[i] = mdi;
    atrOut[i] = tr / period;
    dx.push(pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0);
    if (dx.length === period) adxOut[i] = dx.reduce((s, v) => s + v, 0) / period;
    else if (dx.length > period) adxOut[i] = (adxOut[i - 1]! * (period - 1) + dx[dx.length - 1]) / period;
  }
  return { adx: adxOut, plusDi: plus, minusDi: minus, atr: atrOut };
}

/** Last close of each IST calendar week (Monday-based), oldest first. */
export function weeklyCloses(candles: Candle[]): number[] {
  const out: number[] = [];
  let lastWeek: number | null = null;
  for (const c of candles) {
    const day = Math.floor((c.t + 19_800_000) / 86_400_000);
    const week = Math.floor((day + 3) / 7); // 1970-01-01 was a Thursday
    if (week === lastWeek) out[out.length - 1] = c.close;
    else { out.push(c.close); lastWeek = week; }
  }
  return out;
}

const crossedUp = (a: (number | null)[], b: (number | null)[], i: number) =>
  a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i]! > b[i]! && a[i - 1]! <= b[i - 1]!;

/**
 * Trend-aligned oscillator screen on completed daily candles: a momentum
 * continuation (RSI 50–70, MACD above signal and zero) or a pullback turn
 * (stochastic crossing up from oversold), both needing ADX ≥ 20 with +DI > −DI
 * and weekly RSI ≥ 50.
 */
export function measureMomentumOscillator(
  candles: Candle[],
  metrics: Pick<StockMetrics, "passesFloor" | "rs" | "vs50" | "vs200">,
  session: Pick<ActiveSession, "dateKey" | "progress"> = getActiveSession(),
): MomentumResult | null {
  const rules = MOMENTUM_RULES;
  if (!metrics.passesFloor || metrics.rs == null || metrics.rs < rules.minRs ||
      metrics.vs50 == null || metrics.vs50 < 0 || metrics.vs200 == null || metrics.vs200 < 0) return null;

  const done = candles.filter((c) => {
    const day = istDateKey(c.t);
    return day < session.dateKey || (day === session.dateKey && session.progress === 1);
  });
  if (done.length < rules.minSessions) return null;
  const i = done.length - 1;
  const last = done[i];
  const closes = done.map((c) => c.close);

  const r = rsi(closes, rules.rsiPeriod);
  const m = macd(closes);
  const st = stochastic(done);
  const dmi = adx(done);
  const e21 = ema(closes, 21);
  const wr = rsi(weeklyCloses(done), rules.rsiPeriod);
  const weeklyRsi = wr[wr.length - 1];
  const values = [r[i], m.line[i], m.signal[i], st.k[i], st.d[i], dmi.adx[i], dmi.plusDi[i], dmi.minusDi[i], dmi.atr[i], e21[i], weeklyRsi];
  if (values.some((v) => v == null || !Number.isFinite(v))) return null;
  const [rsiNow, macdNow, sigNow, kNow, dNow, adxNow, pdi, mdi, atr, ema21] = values as number[];

  if (adxNow < rules.minAdx || pdi <= mdi || weeklyRsi! < rules.minWeeklyRsi) return null;
  const aboveEma21Percent = ((last.close - ema21) / ema21) * 100;
  if (aboveEma21Percent > rules.maxAboveEma21Percent) return null;

  const recent = Array.from({ length: rules.signalSessions }, (_, j) => i - j).filter((j) => j > 0);
  const macdCross = recent.find((j) => crossedUp(m.line, m.signal, j));
  const stochCross = recent.find((j) => crossedUp(st.k, st.d, j) && st.k[j - 1]! < rules.pullbackStochBelow);

  let setup: MomentumSetup | null = null;
  let signalIndex: number | undefined;
  if (rsiNow >= rules.continuationRsi[0] && rsiNow <= rules.continuationRsi[1] &&
      macdNow > sigNow && macdNow > 0 && kNow < rules.maxStochK) {
    setup = "continuation";
    signalIndex = macdCross;
  } else if (stochCross != null && kNow > dNow &&
      rsiNow >= rules.pullbackRsi[0] && rsiNow <= rules.pullbackRsi[1]) {
    setup = "pullback";
    signalIndex = stochCross;
  }
  if (!setup) return null;

  return {
    setup,
    fresh: signalIndex != null,
    signalTimestamp: signalIndex != null ? done[signalIndex].t : null,
    lastCompletedCandleTimestamp: last.t,
    rsi: rsiNow,
    weeklyRsi: weeklyRsi!,
    macd: macdNow,
    macdSignal: sigNow,
    macdHistPercent: ((macdNow - sigNow) / last.close) * 100,
    stochK: kNow,
    stochD: dNow,
    adx: adxNow,
    plusDi: pdi,
    minusDi: mdi,
    aboveEma21Percent,
    atr,
  };
}
