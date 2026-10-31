import type { Candle } from "../market/types.ts";
import { ema } from "./oscillators.ts";
import { riskFlags } from "./riskFlags.ts";
import { PA_CALIBRATION } from "./priceActionCalibration.ts";

/**
 * Price Action Rating, 0–100 (idea from Scanner Pro's rating; the formula is ours).
 * Five components on daily candles, deductions for fragile price action, then a
 * fixed calibration so 85+ is roughly the top 5% of liquid stocks. It describes
 * the quality of the trend, not a buy signal or a win probability.
 */
export const PA_COMPONENTS = [
  { key: "trend", label: "Trend", max: 20, desc: "Close vs the 200 EMA, and the order and spread of the 20/50/200 EMAs" },
  { key: "momentum", label: "Momentum", max: 20, desc: "1M/3M/6M/1Y return blend, raw and per unit of volatility" },
  { key: "leadership", label: "Leadership", max: 15, desc: "Place in the 52-week range; distance below the 20-day, 6-month, 52-week and 3-year highs" },
  { key: "volume", label: "Volume", max: 5, desc: "Volume contracting (10-day vs 60-day average) while the trend is up" },
  { key: "stability", label: "Stability", max: 40, desc: "Contained volatility (ATR as % of price) and orderly opens (few 2%+ gaps)" },
] as const;

export type PaComponentKey = (typeof PA_COMPONENTS)[number]["key"];

export const PA_RULES = {
  minSessions: 200,
  illiquidBelowCr: 1,
  thinBelowCr: 5,
  thinMaxPenalty: 12,
  gapFadePenalty: 6,
  climaxPenalty: 8,
  gapPercent: 2,
  /** Grade cut-offs: D below 35, C 35+, B 50+, A 70+, A+ 85+. */
  bands: [35, 50, 70, 85] as const,
} as const;

export type PaGrade = "A+" | "A" | "B" | "C" | "D";

/** Underlying stats the score is built from, for a plain-English "why" narrative. */
export interface PaStats {
  atrPercent: number;
  gapCount20: number;
  fromHigh52: number;
  fromLow52: number;
  /** 0 at the 52-week low, 1 at the 52-week high. */
  rangePosition: number;
  aboveEma200: boolean;
  emaStackBullish: boolean;
}

export interface PriceActionRating {
  status: "rated" | "illiquid" | "insufficient";
  /** Calibrated 0–100; null unless rated. */
  score: number | null;
  /** Sum of component points after deductions, before calibration. */
  raw: number | null;
  grade: PaGrade | null;
  label: string;
  components: { key: PaComponentKey; label: string; max: number; points: number }[];
  deductions: { label: string; points: number }[];
  /** null unless rated — the raw numbers `components` were scored from. */
  stats: PaStats | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The PA score and grade shown next to RS; display only, never used for ranking. */
export interface PaBrief {
  score: number;
  grade: PaGrade;
}

export function paBrief(rating: PriceActionRating | null | undefined): PaBrief | null {
  return rating?.status === "rated" && rating.score != null && rating.grade
    ? { score: Math.round(rating.score), grade: rating.grade }
    : null;
}

export const paText = (pa: PaBrief | null | undefined) => (pa ? `${pa.score} ${pa.grade}` : "—");
/** 0 at `from`, 1 at `to`, linear and clamped; works for falling ranges too. */
const scale = (x: number, from: number, to: number) => clamp01((x - from) / (to - from));
const round1 = (x: number) => Math.round(x * 10) / 10;

export function calibrate(raw: number, knots: ReadonlyArray<readonly [number, number]> = PA_CALIBRATION): number {
  if (raw <= knots[0][0]) return knots[0][1];
  for (let k = 1; k < knots.length; k += 1) {
    const [x1, y1] = knots[k];
    if (raw <= x1) {
      const [x0, y0] = knots[k - 1];
      return x1 === x0 ? y1 : y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return knots[knots.length - 1][1];
}

export function paGrade(score: number): PaGrade {
  const [c, b, a, aPlus] = PA_RULES.bands;
  return score >= aPlus ? "A+" : score >= a ? "A" : score >= b ? "B" : score >= c ? "C" : "D";
}

const GRADE_LABEL: Record<PaGrade, string> = { "A+": "Strong trend", A: "Healthy trend", B: "Neutral", C: "Weak", D: "Poor" };

const unrated = (status: "illiquid" | "insufficient", label: string): PriceActionRating => ({
  status, score: null, raw: null, grade: null, label, components: [], deductions: [], stats: null,
});

/**
 * Rates the stock on its candles as given (pass completed candles for a settled
 * rating). `turnoverCr` is the 50-session median traded value in ₹ crore.
 */
export function priceActionRating(
  candles: ReadonlyArray<Candle>,
  turnoverCr: number | null,
  knots: ReadonlyArray<readonly [number, number]> = PA_CALIBRATION,
): PriceActionRating {
  const R = PA_RULES;
  const n = candles.length;
  if (n < R.minSessions) return unrated("insufficient", "Too little data · not rated");
  if (turnoverCr != null && turnoverCr < R.illiquidBelowCr) return unrated("illiquid", "Illiquid · under ₹1 Cr a day");

  const i = n - 1;
  const closes = candles.map((c) => c.close);
  const close = closes[i];
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const E20 = e20[i] ?? close;
  const E50 = e50[i] ?? close;
  const E200 = e200[i] ?? close;

  const trend =
    (close > E200 ? 6 : 0) + (E50 > E200 ? 4 : 0) + (E20 > E50 ? 4 : 0) + (close > E20 ? 2 : 0) +
    4 * scale((E50 / E200 - 1) * 100, 0, 10);

  const horizons = [21, 63, 126, 252].filter((h) => i - h >= 0 && closes[i - h] > 0);
  const logs: number[] = [];
  for (let k = Math.max(1, n - 252); k < n; k += 1) {
    logs.push(closes[k] > 0 && closes[k - 1] > 0 ? Math.log(closes[k] / closes[k - 1]) : 0);
  }
  const mean = logs.reduce((a, b) => a + b, 0) / (logs.length || 1);
  const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length || 1));
  const rets = horizons.map((h) => close / closes[i - h] - 1);
  const rawReturn = rets.length ? (rets.reduce((a, b) => a + b, 0) / rets.length) * 100 : 0;
  const riskAdjusted = rets.length && sd > 0
    ? horizons.reduce((a, h, k) => a + rets[k] / (sd * Math.sqrt(h)), 0) / horizons.length
    : 0;
  const momentum = 10 * scale(rawReturn, -10, 40) + 10 * scale(riskAdjusted, -0.5, 1.5);

  const highOf = (sessions: number) => {
    let hi = -Infinity;
    for (let k = Math.max(0, n - sessions); k < n; k += 1) hi = Math.max(hi, candles[k].high);
    return hi;
  };
  let low52 = Infinity;
  for (let k = Math.max(0, n - 252); k < n; k += 1) low52 = Math.min(low52, candles[k].low);
  const high52 = highOf(252);
  const below = (hi: number) => (hi > 0 ? (1 - close / hi) * 100 : 100);
  const rangePosition = high52 > low52 ? clamp01((close - low52) / (high52 - low52)) : 0;
  const leadership =
    5 * rangePosition +
    2.5 * scale(below(highOf(20)), 8, 0) +
    2.5 * scale(below(highOf(126)), 20, 0) +
    2.5 * scale(below(high52), 30, 0) +
    2.5 * scale(below(highOf(n)), 40, 0);

  const avgVolume = (sessions: number) => {
    const from = Math.max(0, n - sessions);
    let sum = 0;
    for (let k = from; k < n; k += 1) sum += candles[k].volume;
    return sum / (n - from);
  };
  const v60 = avgVolume(60);
  const uptrend = close > E50 && E50 > (e50[i - 10] ?? Infinity);
  const volume = uptrend && v60 > 0 ? 5 * scale(avgVolume(10) / v60, 1.3, 0.7) : 0;

  let trSum = 0;
  for (let k = n - 14; k < n; k += 1) {
    const c = candles[k];
    const prev = candles[k - 1].close;
    trSum += Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  }
  const atrPercent = close > 0 ? (trSum / 14 / close) * 100 : 100;
  let gaps = 0;
  for (let k = n - 20; k < n; k += 1) {
    const prev = candles[k - 1].close;
    if (prev > 0 && Math.abs(candles[k].open / prev - 1) * 100 >= R.gapPercent) gaps += 1;
  }
  const stability = 25 * scale(atrPercent, 6, 1.5) + 15 * scale(gaps / 20, 0.3, 0);

  const points: Record<PaComponentKey, number> = { trend, momentum, leadership, volume, stability };
  const components = PA_COMPONENTS.map((c) => ({ key: c.key, label: c.label, max: c.max, points: round1(points[c.key]) }));

  const deductions: { label: string; points: number }[] = [];
  const flags = riskFlags(candles, { vs50: null, turnoverCr: null });
  if (flags.some((f) => f.key === "gap-fade")) deductions.push({ label: "Gap-and-fade", points: -R.gapFadePenalty });
  if (flags.some((f) => f.key === "climax-run")) deductions.push({ label: "Climax run", points: -R.climaxPenalty });
  if (turnoverCr != null && turnoverCr < R.thinBelowCr) {
    const penalty = R.thinMaxPenalty * scale(turnoverCr, R.thinBelowCr, R.illiquidBelowCr);
    if (penalty >= 0.5) deductions.push({ label: `Thin: ₹${turnoverCr.toFixed(1)} Cr a day`, points: -round1(penalty) });
  }

  const total = components.reduce((a, c) => a + c.points, 0) + deductions.reduce((a, d) => a + d.points, 0);
  const raw = round1(Math.max(0, Math.min(100, total)));
  const score = Math.round(calibrate(raw, knots));
  const grade = paGrade(score);
  const stats: PaStats = {
    atrPercent: round1(atrPercent),
    gapCount20: gaps,
    fromHigh52: round1(below(high52)),
    fromLow52: round1(low52 > 0 ? (close / low52 - 1) * 100 : 0),
    rangePosition: round1(rangePosition * 100) / 100,
    aboveEma200: close > E200,
    emaStackBullish: E20 > E50 && E50 > E200,
  };
  return { status: "rated", score, raw, grade, label: GRADE_LABEL[grade], components, deductions, stats };
}

const componentShare = (rating: PriceActionRating, key: PaComponentKey): number | null => {
  const c = rating.components.find((x) => x.key === key);
  return c ? c.points / c.max : null;
};

/**
 * Plain-English reasons behind the score, grounded in the same numbers the
 * components were scored from — never a templated line disconnected from the
 * actual rating, the way a static "why" blurb can drift out of sync.
 */
export function paWhy(rating: PriceActionRating): string[] {
  if (rating.status !== "rated" || !rating.stats) return [];
  const s = rating.stats;
  const lines: string[] = [];

  if (s.aboveEma200 && s.emaStackBullish) lines.push("Close above a rising 20/50/200 EMA stack");
  else if (s.aboveEma200) lines.push("Close above the 200 EMA, but the shorter EMAs are not yet stacked with it");
  else lines.push("Close below the 200 EMA — the long-term trend is not confirmed up");

  const momentumShare = componentShare(rating, "momentum");
  if (momentumShare != null) {
    lines.push(momentumShare >= 0.7
      ? "Strong risk-adjusted momentum over the last year"
      : momentumShare <= 0.25
        ? "Weak momentum — flat to down over the last year on a risk-adjusted basis"
        : "Middling momentum over the last year");
  }

  lines.push(s.rangePosition >= 0.8
    ? `Trading near its 52-week high (${s.fromHigh52.toFixed(1)}% below it)`
    : s.rangePosition <= 0.2
      ? `Trading near its 52-week low (${s.fromLow52.toFixed(1)}% above it)`
      : `${s.fromHigh52.toFixed(1)}% below its 52-week high, ${s.fromLow52.toFixed(1)}% above its 52-week low`);

  const volumeShare = componentShare(rating, "volume");
  if (volumeShare != null && volumeShare > 0) lines.push("Volume contracting on the way up (healthy accumulation pattern)");

  lines.push(s.gapCount20 === 0
    ? `Contained volatility (ATR ${s.atrPercent.toFixed(1)}% of price), no 2%+ gaps in the last 20 sessions`
    : `Contained volatility (ATR ${s.atrPercent.toFixed(1)}% of price), but ${s.gapCount20} gap${s.gapCount20 === 1 ? "" : "s"} of 2%+ in the last 20 sessions`);

  return lines;
}
