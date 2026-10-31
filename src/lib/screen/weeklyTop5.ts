import type { Candle } from "@/lib/market/types";

/**
 * Weekly Top 5: strong stocks ranked by relative strength. Tested in scripts/backtest-gate-stops.mjs on
 * Dec 2024 - Sep 2026: leaders with RS 80+, 50/150/200-day averages stacked upward and the price within 25% of the
 * 52-week high, a stop 2 x ATR(14) below entry and a 3R target made about +0.25R a trade when 60%+ of stocks were
 * above their 50-day average, and lost money when fewer than 50% were. The market note is part of the pick.
 */
export const TOP5_RULES = {
  minRs: 80,
  nearHighPercent: 25,
  aboveLowPercent: 30,
  minPrice: 20,
  minVolume: 50_000,
  atrDays: 14,
  atrStopMultiple: 2,
  targetR: 3,
  maxRiskPercent: 12,
  limit: 5,
} as const;

export interface Top5Core {
  close: number;
  stop: number;
  target: number;
  riskPercent: number;
  fromHighPercent: number;
  atr: number;
}

export interface Top5Pick extends Top5Core {
  /** The last 40 daily closes, oldest first, for the sparkline. */
  spark: number[];
  symbol: string;
  name: string;
  sector: string | null;
  rs: number;
  /** How many of the app's scanners list the stock today; a tie-breaker, not a score. */
  scanners: number | null;
  turnoverCr: number | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const mean = (candles: ReadonlyArray<Candle>, from: number, to: number, pick: (c: Candle) => number) => {
  let sum = 0;
  for (let i = from; i <= to; i += 1) sum += pick(candles[i]);
  return sum / (to - from + 1);
};

/** `candles` are the sessions to measure on; null unless the stock is a trend leader with a stop inside the risk limit. */
export function measureTop5(candles: ReadonlyArray<Candle>): Top5Core | null {
  const R = TOP5_RULES;
  const i = candles.length - 1;
  if (i < 251) return null;
  const last = candles[i];
  if (last.close < R.minPrice || last.volume < R.minVolume) return null;
  const sma = (n: number) => mean(candles, i - n + 1, i, (c) => c.close);
  const s50 = sma(50), s150 = sma(150), s200 = sma(200);
  if (!(last.close > s50 && s50 > s150 && s150 > s200)) return null;
  let high = 0, low = Infinity;
  for (let k = i - 251; k <= i; k += 1) { high = Math.max(high, candles[k].high); low = Math.min(low, candles[k].low); }
  const fromHighPercent = (1 - last.close / high) * 100;
  if (fromHighPercent > R.nearHighPercent || last.close < low * (1 + R.aboveLowPercent / 100)) return null;
  let atr = 0;
  for (let k = i - R.atrDays + 1; k <= i; k += 1) {
    const prev = candles[k - 1].close;
    atr += Math.max(candles[k].high - candles[k].low, Math.abs(candles[k].high - prev), Math.abs(candles[k].low - prev)) / R.atrDays;
  }
  const risk = R.atrStopMultiple * atr;
  const riskPercent = (risk / last.close) * 100;
  if (!(risk > 0) || riskPercent > R.maxRiskPercent) return null;
  return {
    close: last.close,
    stop: round2(last.close - risk),
    target: round2(last.close + R.targetR * risk),
    riskPercent: round2(riskPercent),
    fromHighPercent: round2(fromHighPercent),
    atr: round2(atr),
  };
}

/** Highest RS first; the scanner count only breaks ties. */
export const rankTop5 = (a: Top5Pick, b: Top5Pick) =>
  b.rs - a.rs || (b.scanners ?? 0) - (a.scanners ?? 0) || a.symbol.localeCompare(b.symbol);

export type Top5Size = { key: "full" | "quarter" | "paper"; label: string; detail: string };

/** How much to risk, from the share of stocks above their 50-day average (the backtest's market gate). */
export function top5Size(breadth50: number | null): Top5Size {
  if (breadth50 != null && breadth50 >= 60) return { key: "full", label: "Normal size", detail: "Risk about 1% of capital per trade. This is the market the rule was tested to work in." };
  if (breadth50 != null && breadth50 >= 50) return { key: "quarter", label: "Quarter size or paper only", detail: "The 50–60% breadth zone was a coin flip in the backtest. Risk about 0.25% per trade, or paper trade." };
  return { key: "paper", label: "Paper trade only", detail: "Under 50% breadth these picks lost money on average in the backtest. Paper trade, or risk no more than 0.25% per trade." };
}
