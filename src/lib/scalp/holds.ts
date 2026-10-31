/**
 * Longer-hold index setups, priced as index futures: two intraday rules held
 * to 15:15 (1-minute data) and two 1–3 day swing rules (daily data). Rules and
 * numbers were fixed before the first run and are not tuned to the results.
 */
import { costInPoints, priceTrade, type BacktestTrade, type CostModel, type DayContext } from "./backtest.ts";
import { trend5mSignals, type SetupSignal } from "./setups.ts";
import { istDayKey, istMinute, orbSignals, type Bar, type Side } from "./scalpLogic.ts";

const DAY_MS = 86_400_000;

/** First-hour (09:15–10:14) range breakout with EMA 9/21 and futures-VWAP agreement; one a day, 10:15–13:00. */
export function firstHourBreakoutSignals(ctx: DayContext): SetupSignal[] {
  return orbSignals(
    { spot: ctx.spot, fut: ctx.fut },
    { stopPoints: 1, orbMinutes: 60, maxPerDay: 1, lastEntryMin: 13 * 60 },
  ).map((s) => ({ t: s.t, side: s.side }));
}

/** The first 5-minute EMA trend signal of the day, if it comes before 13:00. */
export function trendHoldSignals(ctx: DayContext): SetupSignal[] {
  return trend5mSignals(ctx).filter((s) => istMinute(s.t) < 13 * 60).slice(0, 1);
}

/* ---------- daily indicators ---------- */

export function sma(values: number[], period: number): Array<number | null> {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period];
    return i >= period - 1 ? sum / period : null;
  });
}

/** Wilder RSI of closes. */
export function rsi(bars: Bar[], period: number): Array<number | null> {
  let gain = 0, loss = 0;
  return bars.map((bar, i) => {
    if (i === 0) return null;
    const change = bar.close - bars[i - 1].close;
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (i <= period) {
      gain += up / period;
      loss += down / period;
      if (i < period) return null;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
    return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  });
}

/** Wilder average true range. */
export function atr(bars: Bar[], period: number): Array<number | null> {
  let value: number | null = null;
  let sum = 0;
  return bars.map((bar, i) => {
    const tr = i === 0 ? bar.high - bar.low
      : Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i - 1].close), Math.abs(bar.low - bars[i - 1].close));
    if (i < period) {
      sum += tr;
      if (i === period - 1) value = sum / period;
      return value;
    }
    value = ((value as number) * (period - 1) + tr) / period;
    return value;
  });
}

/* ---------- swing setups (signal on a daily close, entry next open) ---------- */

export interface DailySignal {
  /** Index of the signal day in the daily bars. */
  i: number;
  side: Side;
}

/** Close above the prior 20-day high (long) or below the prior 20-day low (short). */
export function breakout20Signals(bars: Bar[]): DailySignal[] {
  const out: DailySignal[] = [];
  for (let i = 20; i < bars.length; i++) {
    const window = bars.slice(i - 20, i);
    const high = Math.max(...window.map((b) => b.high));
    const low = Math.min(...window.map((b) => b.low));
    if (bars[i].close > high) out.push({ i, side: "CE" });
    else if (bars[i].close < low) out.push({ i, side: "PE" });
  }
  return out;
}

/** Above the 200-day average with RSI(2) < 10 (buy the dip), or below it with RSI(2) > 90 (sell the rally). */
export function rsi2Signals(bars: Bar[]): DailySignal[] {
  const r = rsi(bars, 2);
  const long = sma(bars.map((b) => b.close), 200);
  const out: DailySignal[] = [];
  for (let i = 0; i < bars.length; i++) {
    const [ri, li] = [r[i], long[i]];
    if (ri == null || li == null) continue;
    if (bars[i].close > li && ri < 10) out.push({ i, side: "CE" });
    else if (bars[i].close < li && ri > 90) out.push({ i, side: "PE" });
  }
  return out;
}

export interface SwingPlan {
  /** Stop distance as a multiple of ATR(14) on the signal day. */
  stopAtr: number;
  /** Exit at the close of this many days held (entry day counts as day 1). */
  maxDays: number;
  /** Also exit at the first close back beyond the 5-day average (mean-reversion exit). */
  exitOnSma5: boolean;
  /** Futures carry in % a year: longs pay it as the premium decays, shorts earn it. */
  carryPctYear: number;
}

/** One swing trade from the next day's open; stop checked against each day's range first, gaps fill at the open. */
export function simulateSwing(
  bars: Bar[],
  signal: DailySignal,
  plan: SwingPlan,
  atrValues: Array<number | null>,
  sma5: Array<number | null>,
): Omit<BacktestTrade, "grossRs" | "netRs"> | null {
  const e = signal.i + 1;
  const range = atrValues[signal.i];
  if (e >= bars.length || range == null) return null;
  const dir = signal.side === "CE" ? 1 : -1;
  const entry = bars[e].open;
  const stop = entry - dir * plan.stopAtr * range;
  const done = (k: number, exit: number, reason: BacktestTrade["reason"]) => ({
    day: istDayKey(bars[e].t), side: signal.side, signalAt: bars[signal.i].t,
    entryAt: bars[e].t, entry, exitAt: bars[k].t, exit, reason, points: dir * (exit - entry),
  });
  for (let k = e; k < bars.length && k < e + plan.maxDays; k++) {
    const bar = bars[k];
    if (dir === 1 ? bar.low <= stop : bar.high >= stop) {
      return done(k, k > e && (dir === 1 ? bar.open < stop : bar.open > stop) ? bar.open : stop, "stop");
    }
    const mean = sma5[k];
    if (plan.exitOnSma5 && mean != null && (dir === 1 ? bar.close > mean : bar.close < mean)) return done(k, bar.close, "target");
    if (k === e + plan.maxDays - 1) return done(k, bar.close, "time");
  }
  return null;
}

/* ---------- positional trend following (held for weeks to months) ---------- */

export interface TrendPlan {
  /** longShort: SMA50 vs SMA200 decides long or short. longOnly: long or flat. price200: close vs SMA200, long or short. buyHold: always long (benchmark). */
  mode: "longShort" | "longOnly" | "price200" | "buyHold";
  fast: number;
  slow: number;
  carryPctYear: number;
}

/**
 * Daily position from the close, changed at the next open. A held future is
 * rolled each month (charged one extra round trip per month boundary) and pays
 * or earns carry like `backtestSwing`. An open position is closed at the last close.
 */
export function trendFollow(bars: Bar[], plan: TrendPlan, costs: CostModel): BacktestTrade[] {
  const closes = bars.map((b) => b.close);
  const fast = sma(closes, plan.fast);
  const slow = sma(closes, plan.slow);
  const want = (i: number): -1 | 0 | 1 | null => {
    if (plan.mode === "buyHold") return slow[i] == null ? null : 1;
    const [f, s] = [fast[i], slow[i]];
    if (f == null || s == null) return null;
    if (plan.mode === "price200") return closes[i] > s ? 1 : -1;
    if (plan.mode === "longOnly") return f > s ? 1 : 0;
    return f > s ? 1 : -1;
  };
  const trades: BacktestTrade[] = [];
  let open: { i: number; dir: 1 | -1 } | null = null;
  const close = (k: number, exit: number, reason: BacktestTrade["reason"]) => {
    if (!open) return;
    const entryBar = bars[open.i];
    const entry = entryBar.open;
    const monthIndex = (t: number) => { const [y, m] = istDayKey(t).split("-").map(Number); return y * 12 + m; };
    const rolls = monthIndex(bars[k].t) - monthIndex(entryBar.t);
    const days = Math.max(0, Math.round((bars[k].t - entryBar.t) / DAY_MS));
    const carry = entry * (plan.carryPctYear / 100) * (days / 365);
    const side: Side = open.dir === 1 ? "CE" : "PE";
    const trade = {
      day: istDayKey(entryBar.t), side, signalAt: bars[Math.max(0, open.i - 1)].t, entryAt: entryBar.t, entry,
      exitAt: bars[k].t, exit, reason, points: open.dir * (exit - entry),
    };
    trades.push(priceTrade(trade, costs, (open.dir === 1 ? carry : -carry) + rolls * costInPoints(costs, entry)));
    open = null;
  };
  for (let i = 0; i + 1 < bars.length; i++) {
    const target = want(i);
    if (target == null) continue;
    const current: -1 | 0 | 1 = open ? (open as { dir: 1 | -1 }).dir : 0;
    if (target === current) continue;
    close(i + 1, bars[i + 1].open, "time");
    if (target !== 0) open = { i: i + 1, dir: target };
  }
  close(bars.length - 1, bars[bars.length - 1].close, "eod");
  return trades;
}

/** Runs a daily setup one trade at a time, priced as futures with carry. */
export function backtestSwing(
  bars: Bar[],
  detect: (bars: Bar[]) => DailySignal[],
  plan: SwingPlan,
  costs: CostModel,
): BacktestTrade[] {
  const atrValues = atr(bars, 14);
  const sma5 = sma(bars.map((b) => b.close), 5);
  const trades: BacktestTrade[] = [];
  let busyUntil = -Infinity;
  for (const signal of detect(bars)) {
    if (bars[signal.i].t <= busyUntil) continue;
    const trade = simulateSwing(bars, signal, plan, atrValues, sma5);
    if (!trade) continue;
    busyUntil = trade.exitAt;
    const days = Math.max(0, Math.round((trade.exitAt - trade.entryAt) / DAY_MS));
    const carry = trade.entry * (plan.carryPctYear / 100) * (days / 365);
    trades.push(priceTrade(trade, costs, trade.side === "CE" ? carry : -carry));
  }
  return trades;
}
