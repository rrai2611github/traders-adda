import type { Candle } from "./types.ts";
import { rsi as wilderRsi, wilderAtr } from "../screen/oscillators.ts";
import { aggregateCandles } from "../chart/aggregate.ts";
import { getMarketStatus, isTradingDay, istDateKey } from "./marketHours.ts";
import { rankIndexLevels, type RankedIndexLevel } from "./indexLevelRanking.ts";

export type IndexTrend = "Constructive" | "Weak" | "Mixed" | "Unavailable";
export interface IndexBreadth {
  total: number;
  covered: number;
  above20: number | null;
  above50: number | null;
  above200: number | null;
  coverage20: number;
  coverage50: number;
  coverage200: number;
  advances: number;
  declines: number;
  unchanged: number;
}
export interface StructuralLevel { label: string; price: number }

export type AnalysisTone = "positive" | "neutral" | "caution";

export interface IndexObservation {
  label: string;
  tone: AnalysisTone;
  text: string;
}

export interface IndexAnalysis {
  asOf: number;
  provisional: boolean;
  dailyTrend: IndexTrend;
  weeklyTrend: IndexTrend;
  weeklyAsOf: number | null;
  nearbySupport: StructuralLevel | null;
  nearbyResistance: StructuralLevel | null;
  structuralLevels: StructuralLevel[];
  rankedLevels: RankedIndexLevel[];
  summary: string;
  scenarios: { bullish: string; bearish: string; range: string };
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  atr14Percent: number | null;
  return5d: number | null;
  return20d: number | null;
  support: number | null;
  resistance: number | null;
  high52w: number | null;
  low52w: number | null;
  from52wHighPercent: number | null;
  observations: IndexObservation[];
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const percentChange = (current: number, prior: number | undefined) =>
  prior && prior > 0 ? ((current / prior) - 1) * 100 : null;

const sma = (candles: Candle[], sessions: number) =>
  candles.length >= sessions ? average(candles.slice(-sessions).map((candle) => candle.close)) : null;

const atrPercent = (candles: Candle[], sessions = 14) => {
  const atr = wilderAtr(candles, sessions).at(-1);
  const close = candles.at(-1)?.close;
  return atr != null && close ? (atr / close) * 100 : null;
};

export function completedIndexCandles(candles: Candle[], now: number): Candle[] {
  const market = getMarketStatus(now);
  const today = istDateKey(now);
  return candles.filter((c) => istDateKey(c.t) < today ||
    (istDateKey(c.t) === today && !market.isLive && market.phase !== "PRE_OPEN" &&
      new Date(now + 19_800_000).getUTCHours() * 60 + new Date(now + 19_800_000).getUTCMinutes() >= 930));
}

const trend = (candles: Candle[], short: number, long: number): IndexTrend => {
  const a = sma(candles, short);
  const b = sma(candles, long);
  const prior = sma(candles.slice(0, -1), long);
  const close = candles.at(-1)?.close;
  if (a == null || b == null || prior == null || close == null) return "Unavailable";
  return close > a && a > b && b > prior ? "Constructive"
    : close < a && a < b && b < prior ? "Weak" : "Mixed";
};

/** Excludes the current week until its final scheduled trading session has closed. */
export function completedIndexWeeks(candles: Candle[], now: number): Candle[] {
  const day = Math.floor((now + 19_800_000) / 86_400_000);
  const monday = day - ((day + 3) % 7);
  let finished = true;
  for (let d = monday; d < monday + 7; d++) {
    const closeAt = d * 86_400_000 - 19_800_000 + 930 * 60_000;
    if (isTradingDay(closeAt) && closeAt > now) finished = false;
  }
  return aggregateCandles(candles.filter((c) =>
    finished || Math.floor((c.t + 19_800_000) / 86_400_000) < monday), "W");
}

export function buildIndexBreadth(histories: Map<string, Candle[]>, members: string[]): IndexBreadth {
  let covered = 0, advances = 0, declines = 0, unchanged = 0;
  const counts = [0, 0, 0], eligible = [0, 0, 0];
  for (const member of members) {
    const bars = histories.get(member);
    if (!bars?.length) continue;
    const last = bars.at(-1)!;
    const prior = bars.at(-2);
    if (!prior || !Number.isFinite(last.close) || !Number.isFinite(prior.close)) continue;
    covered++;
    if (last.close > prior.close) advances++; else if (last.close < prior.close) declines++; else unchanged++;
    [20, 50, 200].forEach((period, i) => {
      const mean = sma(bars, period);
      if (mean != null) { eligible[i]++; if (last.close > mean) counts[i]++; }
    });
  }
  const pct = (i: number) => eligible[i] ? counts[i] / eligible[i] * 100 : null;
  return { total: members.length, covered, above20: pct(0), above50: pct(1), above200: pct(2),
    coverage20: eligible[0], coverage50: eligible[1], coverage200: eligible[2], advances, declines, unchanged };
}

const signedPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const distance = (price: number, level: number) => Math.abs(((price / level) - 1) * 100);

export function buildIndexAnalysis(candles: Candle[], symbol: string, now = Date.now()): IndexAnalysis | null {
  const clean = candles.filter((candle) =>
    [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0),
  ).filter((c) => c.t <= now).sort((a, b) => a.t - b.t);
  const latest = clean.at(-1);
  if (!latest || clean.length < 5) return null;

  const close = latest.close;
  const sma20 = sma(clean, 20);
  const sma50 = sma(clean, 50);
  const sma200 = sma(clean, 200);
  const rsi14 = wilderRsi(clean.map((c) => c.close)).at(-1) ?? null;
  const atr14 = atrPercent(clean);
  const return5d = percentChange(close, clean.at(-6)?.close);
  const return20d = percentChange(close, clean.at(-21)?.close);
  const prior20 = clean.slice(-21, -1);
  const support = prior20.length ? Math.min(...prior20.map((candle) => candle.low)) : null;
  const resistance = prior20.length ? Math.max(...prior20.map((candle) => candle.high)) : null;
  const year = clean.slice(-252);
  const high52w = year.length ? Math.max(...year.map((candle) => candle.high)) : null;
  const low52w = year.length ? Math.min(...year.map((candle) => candle.low)) : null;
  const from52wHighPercent = high52w ? ((close / high52w) - 1) * 100 : null;
  const isVix = symbol === "INDIAVIX";
  const observations: IndexObservation[] = [];
  const completed = completedIndexCandles(clean, now);
  const weeks = completedIndexWeeks(completed, now);
  const dailyTrend = trend(clean, 20, 50);
  const weeklyTrend = trend(weeks, 10, 30);
  const reference = completed.at(-1);
  const lastWeek = weeks.at(-1);
  const structuralLevels: StructuralLevel[] = [];
  const add = (label: string, price: number | null | undefined) => {
    if (price != null && Number.isFinite(price)) structuralLevels.push({ label, price });
  };
  add("Last completed day high", reference?.high);
  add("Last completed day low", reference?.low);
  add("Last completed week high", lastWeek?.high);
  add("Last completed week low", lastWeek?.low);
  add("20-day average", sma20); add("50-day average", sma50); add("200-day average", sma200);
  const pivots = completed.slice(-65);
  for (let i = 2; i < pivots.length - 2; i++) {
    const neighbors = [pivots[i - 2], pivots[i - 1], pivots[i + 1], pivots[i + 2]];
    if (neighbors.every((c) => pivots[i].high > c.high)) add("Confirmed swing high", pivots[i].high);
    if (neighbors.every((c) => pivots[i].low < c.low)) add("Confirmed swing low", pivots[i].low);
  }
  const nearbySupport = structuralLevels.filter((l) => l.price < close).sort((a, b) => b.price - a.price)[0] ?? null;
  const nearbyResistance = structuralLevels.filter((l) => l.price > close).sort((a, b) => a.price - b.price)[0] ?? null;
  const rankedLevels = rankIndexLevels(structuralLevels, close, atr14);
  const summary = `${dailyTrend} daily trend; ${weeklyTrend.toLowerCase()} completed-week trend.`;
  const scenarios = {
    bullish: nearbyResistance
      ? `Reclaim and hold ${nearbyResistance.price.toFixed(2)} (${nearbyResistance.label.toLowerCase()}); look for improving constituent breadth.`
      : "No nearby overhead reference identified; avoid chasing and wait for a new base.",
    bearish: nearbySupport
      ? `Lose ${nearbySupport.price.toFixed(2)} (${nearbySupport.label.toLowerCase()}) with weakening breadth; downside risk increases.`
      : "No nearby support reference identified; avoid assuming an oversold bounce.",
    range: nearbySupport && nearbyResistance
      ? `Between ${nearbySupport.price.toFixed(2)} and ${nearbyResistance.price.toFixed(2)}, wait for confirmation; these are references, not predicted bounds.`
      : "Insufficient nearby levels to define a two-sided scenario.",
  };

  if (isVix) {
    const riskTone: AnalysisTone = close < 15 ? "positive" : close < 20 ? "neutral" : "caution";
    const regime = close < 15 ? "calm" : close < 20 ? "elevated" : close < 30 ? "high" : "extreme";
    observations.push({
      label: "Risk regime",
      tone: riskTone,
      text: `India VIX is ${close.toFixed(2)}, which places implied market volatility in the ${regime} zone. A rising VIX usually signals greater demand for downside protection.`,
    });
  } else if (sma20 != null && sma50 != null) {
    observations.push({
      label: "Trend",
      tone: dailyTrend === "Constructive" ? "positive" : dailyTrend === "Weak" ? "caution" : "neutral",
      text: `${summary} ${dailyTrend === "Constructive"
        ? "Price is above the 20-day average, the short average is above the 50-day average, and the 50-day average is rising."
        : dailyTrend === "Weak"
          ? "Price is below the 20-day average, the short average is below the 50-day average, and the 50-day average is falling."
          : "Price, the 20/50-day averages and their slope are not fully aligned."}`,
    });
  }

  if (rsi14 != null) {
    const momentum = rsi14 >= 70 ? "overbought" : rsi14 <= 30 ? "oversold" : rsi14 >= 55 ? "positive" : rsi14 <= 45 ? "weak" : "balanced";
    observations.push({
      label: "Momentum",
      tone: rsi14 >= 70 || rsi14 <= 30 ? "caution" : rsi14 >= 55 ? "positive" : rsi14 <= 45 ? "caution" : "neutral",
      text: `RSI(14) is ${rsi14.toFixed(1)}, indicating ${momentum} momentum${return5d == null ? "." : `; the five-session move is ${signedPercent(return5d)}.`}`,
    });
  }

  if (support != null && resistance != null) {
    observations.push({
      label: "Key levels",
      tone: close > resistance ? "positive" : close < support ? "caution" : "neutral",
      text: close > resistance
        ? `Price is above the prior 20-session high of ${resistance.toFixed(2)}. That level can now be watched as potential support.`
        : close < support
          ? `Price is below the prior 20-session low of ${support.toFixed(2)}. That level can now act as overhead resistance.`
          : `The prior 20-session range runs from ${support.toFixed(2)} to ${resistance.toFixed(2)}. Price is ${distance(close, support).toFixed(1)}% above support and ${distance(close, resistance).toFixed(1)}% below resistance.`,
    });
  }

  if (atr14 != null) {
    observations.push({
      label: "Daily volatility",
      tone: atr14 >= 2 ? "caution" : "neutral",
      text: `ATR(14) is ${atr14.toFixed(2)}% of the index value. This describes the recent typical daily range; it is not a forecast of the next move.`,
    });
  }

  return {
    asOf: latest.t,
    provisional: completed.length !== clean.length,
    dailyTrend, weeklyTrend, weeklyAsOf: lastWeek?.t ?? null,
    nearbySupport, nearbyResistance, structuralLevels, rankedLevels, summary, scenarios,
    close,
    sma20,
    sma50,
    sma200,
    rsi14,
    atr14Percent: atr14,
    return5d,
    return20d,
    support,
    resistance,
    high52w,
    low52w,
    from52wHighPercent,
    observations,
  };
}
