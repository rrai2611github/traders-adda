import type { Candle } from "@/lib/market/types";

/**
 * One trade plan for any stock: where to buy, where the stop goes, where to take profit, and how many shares that is.
 * The stop is 2 x ATR(14) below. The 10-year backtest (/backtest, Dec 2016 to Oct 2026) found that holding while the stock closes
 * above its 50-day average earns about +0.5R a trade, against +0.12R for selling at a fixed 3R; the 2R/3R levels are kept only as
 * points to book part profit. T1 at 2R with the stop moved to cost is the app's existing scanner plan. The swing-low stop is
 * shown for reference: it tested worse as a rule and is not the recommended stop.
 */
export const PLAN_RULES = {
  atrDays: 14,
  atrStopMultiple: 2,
  t1R: 2,
  t2R: 3,
  /** Skip the trade if the stock opens this far above the signal close. */
  chasePercent: 5,
  swingLowSessions: 10,
  swingLowBuffer: 0.99,
  /** A stop wider than this means a small position, not a bad stock. */
  wideStopPercent: 8,
} as const;

export interface PlanInputs {
  close: number;
  atr: number;
  swingLow: number;
  ema21: number;
  ema50: number | null;
  /** 50-day simple average of the close; the tested exit is a close under it. */
  sma50?: number | null;
  /** 100-day simple average; the slower exit that tested better for Multi-year breakout stocks. */
  sma100?: number | null;
  high52: number;
}

export interface PlanSizing {
  capital: number;
  riskPercent: number;
  quantity: number;
  /** Money in the position at the buy price. */
  invested: number;
  /** What the stop costs if it is hit. */
  maxLoss: number;
  gainT1: number;
  gainT2: number;
  /** Quantity was cut because the position would not fit in the capital. */
  cappedByCapital: boolean;
}

export interface TradePlan {
  entry: number;
  skipAbove: number;
  stop: number;
  stopPercent: number;
  /** Reference stop under the last 10 sessions' low; not the recommended stop. */
  swingStop: number;
  swingStopPercent: number;
  /** Which rule set `stop`: the percent stop the breakout rules were tested with, or 2 x ATR. */
  stopKind: "atr" | "percent";
  /** The 2 x ATR stop for reference (it is `stop` when `stopKind` is "atr"). */
  atrStop: number;
  atrStopPercent: number;
  riskPerShare: number;
  t1: number;
  t2: number;
  /** Close under this 21 EMA is the exit for any shares kept after T1. */
  trailEma21: number;
  /** Close under this 50-day average is the tested exit; null with under 50 sessions. */
  trailSma50: number | null;
  trailSma100: number | null;
  /** Distance to the 52-week high as a percent of the entry, a natural place to expect resistance. */
  resistance: { price: number; percent: number } | null;
  wideStop: boolean;
  sizing: PlanSizing | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function ema(values: ReadonlyArray<number>, period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i += 1) e = values[i] * k + e * (1 - k);
  return e;
}

/** Inputs for the plan from daily candles (the last candle is the signal day); null with too little history. */
export function measurePlanInputs(candles: ReadonlyArray<Candle>): PlanInputs | null {
  const R = PLAN_RULES;
  const i = candles.length - 1;
  if (i < 60) return null;
  let atr = 0;
  for (let k = i - R.atrDays + 1; k <= i; k += 1) {
    const prev = candles[k - 1].close;
    atr += Math.max(candles[k].high - candles[k].low, Math.abs(candles[k].high - prev), Math.abs(candles[k].low - prev)) / R.atrDays;
  }
  if (!(atr > 0)) return null;
  let swingLow = Infinity;
  for (let k = i - R.swingLowSessions + 1; k <= i; k += 1) swingLow = Math.min(swingLow, candles[k].low);
  let high52 = 0;
  for (let k = Math.max(0, i - 251); k <= i; k += 1) high52 = Math.max(high52, candles[k].high);
  const closes = candles.slice(-260).map((c) => c.close);
  return {
    close: candles[i].close,
    atr: round2(atr),
    swingLow: round2(swingLow),
    ema21: round2(ema(closes, 21)),
    ema50: closes.length >= 50 ? round2(ema(closes, 50)) : null,
    sma100: closes.length >= 100 ? round2(closes.slice(-100).reduce((a, v) => a + v, 0) / 100) : null,
    sma50: closes.length >= 50 ? round2(closes.slice(-50).reduce((a, v) => a + v, 0) / 50) : null,
    high52: round2(high52),
  };
}

export function buildTradePlan(
  inputs: PlanInputs,
  size?: { capital: number; riskPercent: number } | null,
  stopRule: { kind: "atr" } | { kind: "percent"; percent: number } = { kind: "atr" },
): TradePlan {
  const R = PLAN_RULES;
  const entry = inputs.close;
  const atrRisk = R.atrStopMultiple * inputs.atr;
  const risk = stopRule.kind === "percent" ? (entry * stopRule.percent) / 100 : atrRisk;
  const stop = entry - risk;
  const swingStop = inputs.swingLow * R.swingLowBuffer;
  let sizing: PlanSizing | null = null;
  if (size && size.capital > 0 && size.riskPercent > 0 && risk > 0) {
    const byRisk = Math.floor((size.capital * size.riskPercent) / 100 / risk);
    const byCapital = Math.floor(size.capital / entry);
    const quantity = Math.max(0, Math.min(byRisk, byCapital));
    sizing = {
      capital: size.capital,
      riskPercent: size.riskPercent,
      quantity,
      invested: round2(quantity * entry),
      maxLoss: round2(quantity * risk),
      gainT1: round2(quantity * R.t1R * risk),
      gainT2: round2(quantity * R.t2R * risk),
      cappedByCapital: byCapital < byRisk,
    };
  }
  return {
    entry: round2(entry),
    skipAbove: round2(entry * (1 + R.chasePercent / 100)),
    stop: round2(stop),
    stopPercent: round2((risk / entry) * 100),
    swingStop: round2(swingStop),
    swingStopPercent: round2(((entry - swingStop) / entry) * 100),
    stopKind: stopRule.kind,
    atrStop: round2(entry - atrRisk),
    atrStopPercent: round2((atrRisk / entry) * 100),
    riskPerShare: round2(risk),
    t1: round2(entry + R.t1R * risk),
    t2: round2(entry + R.t2R * risk),
    trailEma21: inputs.ema21,
    trailSma50: inputs.sma50 ?? null,
    trailSma100: inputs.sma100 ?? null,
    resistance: inputs.high52 > entry ? { price: inputs.high52, percent: round2(((inputs.high52 - entry) / entry) * 100) } : null,
    wideStop: stopRule.kind === "atr" && (risk / entry) * 100 > R.wideStopPercent,
    sizing,
  };
}

/** Default percent of capital to risk, by the Weekly Top 5 market tier. */
export const DEFAULT_RISK_BY_TIER = { full: 1, quarter: 0.25, paper: 0.25 } as const;
