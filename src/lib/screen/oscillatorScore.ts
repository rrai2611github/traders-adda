import type { Candle } from "@/lib/market/types";
import { getActiveSession, istDateKey, type ActiveSession } from "../market/marketHours.ts";
import { adx, ema, macd, rsi, stochastic } from "./oscillators.ts";
import { tradeLevels, type TradeLevels } from "./tradeLevels.ts";

export type Vote = 1 | 0 | -1;

export const OSCILLATOR_DEFS = [
  { key: "rsi", label: "RSI (14)", rule: "Bullish 50–80 and rising · bearish below 50 and falling" },
  { key: "stoch", label: "Stochastic (14,3,3)", rule: "Bullish %K above %D and below 80 · bearish %K below %D and above 20" },
  { key: "stochRsi", label: "Stochastic RSI (14,14,3,3)", rule: "Bullish K above D and below 80 · bearish K below D and above 20" },
  { key: "willR", label: "Williams %R (14)", rule: "Bullish above −50 and rising · bearish below −50 and falling" },
  { key: "cci", label: "CCI (20)", rule: "Bullish above 0 and rising · bearish below 0 and falling" },
  { key: "macd", label: "MACD vs signal (12,26,9)", rule: "Bullish MACD above signal · bearish below" },
  { key: "macdZero", label: "MACD vs zero line", rule: "Bullish MACD above 0 · bearish below 0" },
  { key: "adx", label: "ADX / DMI (14)", rule: "Bullish ADX ≥ 20 with +DI above −DI · bearish ADX ≥ 20 with −DI above +DI" },
  { key: "ao", label: "Awesome Oscillator (5,34)", rule: "Bullish above 0 and rising · bearish below 0 and falling" },
  { key: "mom", label: "Momentum (10)", rule: "Bullish above 0 and rising · bearish below 0 and falling" },
  { key: "roc", label: "Rate of change (12)", rule: "Bullish above 0 · bearish below 0" },
  { key: "uo", label: "Ultimate Oscillator (7,14,28)", rule: "Bullish above 50 and rising · bearish below 50 and falling" },
  { key: "mfi", label: "Money Flow Index (14)", rule: "Bullish 50–80 and rising · bearish below 50 and falling" },
  { key: "bbp", label: "Elder Bull/Bear Power (13)", rule: "Bullish above 0 and rising · bearish below 0 and falling" },
  { key: "cmf", label: "Chaikin Money Flow (20)", rule: "Bullish above +0.05 · bearish below −0.05" },
] as const;

export const OSCILLATOR_COUNT = OSCILLATOR_DEFS.length;
export const SCORE_BANDS = { strong: 11, bullish: 8, neutral: 5 } as const;
const MIN_SESSIONS = 60;

export type ScoreVerdict = "strong" | "bullish" | "neutral" | "bearish";

export interface OscillatorScore {
  /** Average of the last SCORE_SMOOTH_SESSIONS daily scores (1 decimal); drives bands, filters and jumps. */
  score: number;
  /** Bullish votes on the last completed candle alone. */
  todayScore: number;
  /** Daily scores of the smoothing window, oldest first. */
  dailyScores: number[];
  /** Vote counts below are for the last completed candle. */
  bullish: number;
  neutral: number;
  bearish: number;
  verdict: ScoreVerdict;
  /** Same order as OSCILLATOR_DEFS; values rounded for display. */
  values: number[];
  votes: Vote[];
  candleTimestamp: number;
  levels: TradeLevels | null;
  /** Average score rose into the strong band (≥11) within the last SCORE_JUMP_SESSIONS sessions and stayed there. */
  freshJump: boolean;
  jumpTimestamp: number | null;
  /** Average score SCORE_JUMP_SESSIONS sessions ago, for context. */
  scoreBefore: number | null;
}

export function scoreVerdict(score: number): ScoreVerdict {
  return score >= SCORE_BANDS.strong ? "strong"
    : score >= SCORE_BANDS.bullish ? "bullish"
    : score >= SCORE_BANDS.neutral ? "neutral" : "bearish";
}

type Series = (number | null)[];

const sma = (xs: Series, n: number): Series => xs.map((_, i) => {
  if (i < n - 1) return null;
  let s = 0;
  for (let j = i - n + 1; j <= i; j++) {
    if (xs[j] == null) return null;
    s += xs[j]!;
  }
  return s / n;
});

function cci(candles: Candle[], n = 20): Series {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const avg = sma(tp, n);
  return tp.map((v, i) => {
    if (avg[i] == null) return null;
    let dev = 0;
    for (let j = i - n + 1; j <= i; j++) dev += Math.abs(tp[j] - avg[i]!);
    dev /= n;
    return dev > 0 ? (v - avg[i]!) / (0.015 * dev) : 0;
  });
}

function williamsR(candles: Candle[], n = 14): Series {
  return candles.map((c, i) => {
    if (i < n - 1) return null;
    const win = candles.slice(i - n + 1, i + 1);
    const hi = Math.max(...win.map((x) => x.high));
    const lo = Math.min(...win.map((x) => x.low));
    return hi > lo ? ((hi - c.close) / (hi - lo)) * -100 : -50;
  });
}

function stochRsi(closes: number[], n = 14, smooth = 3, d = 3) {
  const r = rsi(closes, n);
  const raw: Series = r.map((v, i) => {
    if (v == null || i < n - 1) return null;
    const win = r.slice(i - n + 1, i + 1);
    if (win.some((x) => x == null)) return null;
    const hi = Math.max(...(win as number[]));
    const lo = Math.min(...(win as number[]));
    return hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50;
  });
  const k = sma(raw, smooth);
  return { k, d: sma(k, d) };
}

function ultimate(candles: Candle[]): Series {
  const bp: number[] = [];
  const tr: number[] = [];
  candles.forEach((c, i) => {
    const prev = i > 0 ? candles[i - 1].close : c.close;
    bp.push(c.close - Math.min(c.low, prev));
    tr.push(Math.max(c.high, prev) - Math.min(c.low, prev));
  });
  const avg = (i: number, n: number) => {
    let b = 0;
    let t = 0;
    for (let j = i - n + 1; j <= i; j++) { b += bp[j]; t += tr[j]; }
    return t > 0 ? b / t : 0.5;
  };
  return candles.map((_, i) => (i < 28 ? null : (100 * (4 * avg(i, 7) + 2 * avg(i, 14) + avg(i, 28))) / 7));
}

function mfi(candles: Candle[], n = 14): Series {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  return candles.map((_, i) => {
    if (i < n) return null;
    let pos = 0;
    let neg = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const flow = tp[j] * candles[j].volume;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    return neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
  });
}

function cmf(candles: Candle[], n = 20): Series {
  return candles.map((_, i) => {
    if (i < n - 1) return null;
    let flow = 0;
    let vol = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const c = candles[j];
      const range = c.high - c.low;
      flow += range > 0 ? (((c.close - c.low) - (c.high - c.close)) / range) * c.volume : 0;
      vol += c.volume;
    }
    return vol > 0 ? flow / vol : null;
  });
}
/** Bullish/bearish vote for a value that must hold a side of `mid` and move that way. */
const directional = (s: Series, i: number, mid: number, cap = Infinity): Vote | null => {
  const now = s[i];
  const prev = s[i - 1];
  if (now == null || prev == null) return null;
  if (now > mid && now < cap && now > prev) return 1;
  if (now < mid && now < prev) return -1;
  return 0;
};
const crossing = (k: Series, d: Series, i: number): Vote | null => {
  if (k[i] == null || d[i] == null) return null;
  if (k[i]! > d[i]! && k[i]! < 80) return 1;
  if (k[i]! < d[i]! && k[i]! > 20) return -1;
  return 0;
};
const side = (v: number | null, up: number, down: number): Vote | null =>
  v == null ? null : v > up ? 1 : v < down ? -1 : 0;

/** Sessions over which a rise to a strong score counts as fresh. */
export const SCORE_JUMP_SESSIONS = 3;
/** Daily scores averaged so a single-day spike can't make a stock "strong". */
export const SCORE_SMOOTH_SESSIONS = 3;

/** 15-oscillator vote on completed daily candles; score = bullish votes out of 15. */
export function scoreOscillators(
  candles: Candle[],
  session: Pick<ActiveSession, "dateKey" | "progress"> = getActiveSession(),
): OscillatorScore | null {
  const done = candles.filter((c) => {
    const day = istDateKey(c.t);
    return day < session.dateKey || (day === session.dateKey && session.progress === 1);
  });
  if (done.length < MIN_SESSIONS) return null;
  const i = done.length - 1;
  const closes = done.map((c) => c.close);
  const median = done.map((c) => (c.high + c.low) / 2);

  const r = rsi(closes);
  const st = stochastic(done);
  const sr = stochRsi(closes);
  const wr = williamsR(done);
  const cc = cci(done);
  const m = macd(closes);
  const dmi = adx(done);
  const s5 = sma(median, 5);
  const s34 = sma(median, 34);
  const ao: Series = median.map((_, j) => (s5[j] != null && s34[j] != null ? s5[j]! - s34[j]! : null));
  const mom: Series = closes.map((c, j) => (j >= 10 ? c - closes[j - 10] : null));
  const roc: Series = closes.map((c, j) => (j >= 12 ? (c / closes[j - 12] - 1) * 100 : null));
  const macdGap: Series = m.line.map((v, j) => (v != null && m.signal[j] != null ? v - m.signal[j]! : null));
  const uo = ultimate(done);
  const mf = mfi(done);
  const e13 = ema(closes, 13);
  const bbp: Series = done.map((c, j) => (e13[j] != null ? c.high + c.low - 2 * e13[j]! : null));
  const cm = cmf(done);

  const entriesAt = (j: number): [number | null, Vote | null][] => [
    [r[j], directional(r, j, 50, 80)],
    [st.k[j], crossing(st.k, st.d, j)],
    [sr.k[j], crossing(sr.k, sr.d, j)],
    [wr[j], directional(wr, j, -50)],
    [cc[j], directional(cc, j, 0)],
    [macdGap[j], side(macdGap[j], 0, 0)],
    [m.line[j], side(m.line[j], 0, 0)],
    [dmi.adx[j], dmi.adx[j] == null ? null : dmi.adx[j]! < 20 ? 0 : dmi.plusDi[j]! > dmi.minusDi[j]! ? 1 : -1],
    [ao[j], directional(ao, j, 0)],
    [mom[j], directional(mom, j, 0)],
    [roc[j], side(roc[j], 0, 0)],
    [uo[j], directional(uo, j, 50)],
    [mf[j], directional(mf, j, 50, 80)],
    [bbp[j], directional(bbp, j, 0)],
    [cm[j], side(cm[j], 0.05, -0.05)],
  ];
  const valid = (entries: [number | null, Vote | null][]) =>
    entries.every(([v, vote]) => v != null && vote != null && Number.isFinite(v));
  const scoreAt = (j: number): number | null => {
    const entries = entriesAt(j);
    return valid(entries) ? entries.filter(([, vote]) => vote === 1).length : null;
  };

  const daily = new Map<number, number | null>();
  const dailyAt = (j: number) => {
    if (!daily.has(j)) daily.set(j, j < 1 ? null : scoreAt(j));
    return daily.get(j)!;
  };
  const windowAt = (j: number): number[] | null => {
    const w: number[] = [];
    for (let k = j - SCORE_SMOOTH_SESSIONS + 1; k <= j; k++) {
      const s = dailyAt(k);
      if (s == null) return null;
      w.push(s);
    }
    return w;
  };
  const averageAt = (j: number): number | null => {
    const w = windowAt(j);
    return w == null ? null : Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 10) / 10;
  };

  const entries = entriesAt(i);
  const dailyScores = windowAt(i);
  const score = averageAt(i);
  if (!valid(entries) || dailyScores == null || score == null) return null;
  const votes = entries.map(([, vote]) => vote as Vote);
  const bullish = votes.filter((v) => v === 1).length;
  const bearish = votes.filter((v) => v === -1).length;

  // Latest session in the window where the average score crossed up into the strong band.
  let jumpIndex: number | null = null;
  if (score >= SCORE_BANDS.strong) {
    for (let j = i; j > i - SCORE_JUMP_SESSIONS; j--) {
      const now = averageAt(j);
      const before = averageAt(j - 1);
      if (now == null || before == null || now < SCORE_BANDS.strong) break;
      if (before < SCORE_BANDS.strong) { jumpIndex = j; break; }
    }
  }
  const previous = averageAt(i - SCORE_JUMP_SESSIONS);

  return {
    score,
    todayScore: bullish,
    dailyScores,
    bullish,
    neutral: OSCILLATOR_COUNT - bullish - bearish,
    bearish,
    verdict: scoreVerdict(score),
    values: entries.map(([v]) => Math.round((v as number) * 100) / 100),
    votes,
    candleTimestamp: done[i].t,
    levels: dmi.atr[i] != null ? tradeLevels(done, dmi.atr[i]!) : null,
    freshJump: jumpIndex != null,
    jumpTimestamp: jumpIndex != null ? done[jumpIndex].t : null,
    scoreBefore: previous,
  };
}
