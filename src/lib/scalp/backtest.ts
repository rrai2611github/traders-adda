/**
 * Pure 1-minute ORB backtest for the Index Scalp Desk. Replays `orbSignals`
 * day by day on index spot bars (plus continuous futures for the VWAP filter),
 * fills at the next bar's open, and prices each trade as an ATM option bought
 * with an assumed delta, after Fyers brokerage, taxes and slippage.
 *
 * Limits (stated in the report): expired option contracts have no Fyers
 * history, so the option-above-VWAP filter cannot be tested and option P&L is
 * modelled as delta × index points (no theta/gamma/IV change).
 */
import {
  SCALP_INDEXES, istDayKey, istMinute, orbSignals,
  type Bar, type ScalpIndex, type Side, type SignalOptions,
} from "./scalpLogic.ts";

const SESSION_FIRST_MIN = 9 * 60 + 15;
const SESSION_LAST_MIN = 15 * 60 + 29;

export interface CostModel {
  /** ATM option bought (P&L = delta × points) or index future (P&L = points). */
  kind: "option" | "future";
  lotSize: number;
  /** Options: assumed ATM premium in rupees for the percentage charges. Futures: unused (the entry price is used). */
  premium: number;
  /** Rupee change per index point per unit: assumed ATM delta for options, 1 for futures. */
  delta: number;
  /** Rupees per unit lost per side to spread and slippage (premium for options, index points for futures). */
  slippagePerSide: number;
  brokeragePerOrder: number;
  /** Fractions of turnover. */
  exchangePct: number;
  sttSellPct: number;
  stampBuyPct: number;
  sebiPerCrore: number;
  gstPct: number;
}

// Fyers: flat ₹20 per F&O order. STT from 1 Apr 2026: options 0.15% of sell premium, futures 0.05% of sell value.
const FYERS_OPTION_CHARGES = {
  brokeragePerOrder: 20,
  exchangePct: 0.000355,
  sttSellPct: 0.0015,
  stampBuyPct: 0.00003,
  sebiPerCrore: 10,
  gstPct: 0.18,
};

const FYERS_FUTURE_CHARGES = {
  brokeragePerOrder: 20,
  exchangePct: 0.0000173,
  sttSellPct: 0.0005,
  stampBuyPct: 0.00002,
  sebiPerCrore: 10,
  gstPct: 0.18,
};

export const DEFAULT_COSTS: Record<ScalpIndex, CostModel> = {
  NIFTY: { kind: "option", lotSize: 65, premium: 120, delta: 0.5, slippagePerSide: 0.5, ...FYERS_OPTION_CHARGES },
  BANKNIFTY: { kind: "option", lotSize: 30, premium: 350, delta: 0.5, slippagePerSide: 1, ...FYERS_OPTION_CHARGES },
};

export const FUTURES_COSTS: Record<ScalpIndex, CostModel> = {
  NIFTY: { kind: "future", lotSize: 65, premium: 0, delta: 1, slippagePerSide: 1, ...FYERS_FUTURE_CHARGES },
  BANKNIFTY: { kind: "future", lotSize: 30, premium: 0, delta: 1, slippagePerSide: 3, ...FYERS_FUTURE_CHARGES },
};

/** Round-trip cost of one lot (buy then sell) in rupees, slippage included. `price` is the index level for futures. */
export function roundTripCost(c: CostModel, price = 0): number {
  const side = (c.kind === "future" ? price : c.premium) * c.lotSize;
  const brokerage = 2 * c.brokeragePerOrder;
  const exchange = 2 * side * c.exchangePct;
  const sebi = (2 * side * c.sebiPerCrore) / 1e7;
  const gst = (brokerage + exchange + sebi) * c.gstPct;
  const stt = side * c.sttSellPct;
  const stamp = side * c.stampBuyPct;
  const slippage = 2 * c.slippagePerSide * c.lotSize;
  return brokerage + exchange + sebi + gst + stt + stamp + slippage;
}

/** Index points a trade must make just to pay its costs. */
export const costInPoints = (c: CostModel, price = 0) => roundTripCost(c, price) / (c.delta * c.lotSize);

export interface BacktestParams extends SignalOptions {
  /** Require futures on the right side of their session VWAP. */
  useFutVwap: boolean;
  /** Close anything still open at this IST minute (default 15:20). */
  squareOffMin?: number;
}

export type ExitReason = "target" | "stop" | "time" | "eod";

export interface BacktestTrade {
  day: string;
  side: Side;
  signalAt: number;
  entryAt: number;
  entry: number;
  exitAt: number;
  exit: number;
  reason: ExitReason;
  /** Index points in the trade's favour (negative = loss). */
  points: number;
  grossRs: number;
  netRs: number;
}

/** Spot bars inside 09:15–15:29 IST grouped by IST day, oldest first. */
export function sessionsByDay(bars: Bar[]): Array<{ day: string; bars: Bar[] }> {
  const days: Array<{ day: string; bars: Bar[] }> = [];
  for (const bar of bars) {
    const minute = istMinute(bar.t);
    if (minute < SESSION_FIRST_MIN || minute > SESSION_LAST_MIN) continue;
    const day = istDayKey(bar.t);
    const last = days[days.length - 1];
    if (last?.day === day) last.bars.push(bar);
    else days.push({ day, bars: [bar] });
  }
  return days;
}

/**
 * Plays one setup forward from the next bar's open. Stop is checked before
 * target inside a bar (conservative); gaps through a level fill at the open.
 */
export function simulateTrade(
  session: Bar[],
  signalAt: number,
  side: Side,
  opts: { stopPoints: number; rewardRisk: number; timeStopMin: number; squareOffMin: number },
): Omit<BacktestTrade, "day" | "grossRs" | "netRs"> | null {
  const e = session.findIndex((bar) => bar.t > signalAt);
  if (e < 0 || istMinute(session[e].t) >= opts.squareOffMin) return null;
  const dir = side === "CE" ? 1 : -1;
  const entry = session[e].open;
  const stop = entry - dir * opts.stopPoints;
  const target = entry + dir * opts.stopPoints * opts.rewardRisk;
  const done = (i: number, exit: number, reason: ExitReason) => ({
    side, signalAt, entryAt: session[e].t, entry, exitAt: session[i].t, exit, reason, points: dir * (exit - entry),
  });
  for (let i = e; i < session.length; i++) {
    const bar = session[i];
    if (i > e && istMinute(bar.t) >= opts.squareOffMin) return done(i, bar.open, "eod");
    const adverse = dir === 1 ? bar.low <= stop : bar.high >= stop;
    if (adverse) return done(i, dir === 1 ? Math.min(bar.open, stop) : Math.max(bar.open, stop), "stop");
    const favourable = dir === 1 ? bar.high >= target : bar.low <= target;
    if (favourable) return done(i, dir === 1 ? Math.max(bar.open, target) : Math.min(bar.open, target), "target");
    if (i - e + 1 >= opts.timeStopMin) return done(i, bar.close, "time");
  }
  const last = session.length - 1;
  return done(last, session[last].close, "eod");
}

export interface ExitPlan {
  stopPoints: number;
  rewardRisk: number;
  timeStopMin: number;
  squareOffMin?: number;
}

/** One session handed to a setup detector: the previous day's bars then today's, plus today's futures. */
export interface DayContext {
  spot: Bar[];
  fut: Bar[];
}

/**
 * Runs any setup detector day by day and plays each signal with `simulateTrade`.
 * A signal that arrives while the previous trade is still open is skipped.
 */
export function backtestSignals(
  input: { spot: Bar[]; fut?: Bar[] },
  detect: (ctx: DayContext) => Array<{ t: number; side: Side }>,
  exits: ExitPlan,
  costs: CostModel,
): BacktestTrade[] {
  const plan = { ...exits, squareOffMin: exits.squareOffMin ?? 15 * 60 + 20 };
  const days = sessionsByDay(input.spot);
  const futDays = new Map(sessionsByDay(input.fut ?? []).map((d) => [d.day, d.bars]));
  const trades: BacktestTrade[] = [];
  for (let k = 1; k < days.length; k++) {
    const { day, bars } = days[k];
    let busyUntil = -Infinity;
    for (const signal of detect({ spot: [...days[k - 1].bars, ...bars], fut: futDays.get(day) ?? [] })) {
      if (signal.t < busyUntil) continue;
      const trade = simulateTrade(bars, signal.t, signal.side, plan);
      if (!trade) continue;
      busyUntil = trade.exitAt;
      trades.push(priceTrade({ ...trade, day }, costs));
    }
  }
  return trades;
}

/** Adds rupee P&L for one lot; `carryPoints` is subtracted from the index points first (futures roll-down). */
export function priceTrade(
  trade: Omit<BacktestTrade, "grossRs" | "netRs">,
  costs: CostModel,
  carryPoints = 0,
): BacktestTrade {
  const points = trade.points - carryPoints;
  const grossRs = points * costs.delta * costs.lotSize;
  return { ...trade, points, grossRs, netRs: grossRs - roundTripCost(costs, trade.entry) };
}

export function backtestOrb(
  input: { spot: Bar[]; fut?: Bar[] },
  params: BacktestParams,
  costs: CostModel,
): BacktestTrade[] {
  const { rewardRisk = 1.5, timeStopMin = 10, squareOffMin } = params;
  return backtestSignals(
    input,
    (ctx) => orbSignals({ spot: ctx.spot, fut: params.useFutVwap ? ctx.fut : undefined }, params),
    { stopPoints: params.stopPoints, rewardRisk, timeStopMin, squareOffMin },
    costs,
  );
}

export interface TradeStats {
  trades: number;
  winRate: number | null;
  avgPoints: number | null;
  /** Average rupees per lot per trade after costs. */
  netPerTrade: number | null;
  totalNet: number;
  totalGross: number;
  profitFactor: number | null;
  /** Largest peak-to-trough fall of cumulative net rupees per lot. */
  maxDrawdown: number;
  exits: Record<ExitReason, number>;
}

export function summarize(trades: BacktestTrade[]): TradeStats {
  const exits: Record<ExitReason, number> = { target: 0, stop: 0, time: 0, eod: 0 };
  let totalNet = 0, totalGross = 0, wins = 0, won = 0, lost = 0, points = 0, peak = 0, maxDrawdown = 0;
  for (const t of trades) {
    exits[t.reason]++;
    totalNet += t.netRs;
    totalGross += t.grossRs;
    points += t.points;
    if (t.netRs > 0) { wins++; won += t.netRs; } else lost -= t.netRs;
    peak = Math.max(peak, totalNet);
    maxDrawdown = Math.max(maxDrawdown, peak - totalNet);
  }
  const n = trades.length;
  return {
    trades: n,
    winRate: n ? wins / n : null,
    avgPoints: n ? points / n : null,
    netPerTrade: n ? totalNet / n : null,
    totalNet,
    totalGross,
    profitFactor: lost > 0 ? won / lost : won > 0 ? Infinity : null,
    maxDrawdown,
    exits,
  };
}

export interface Verdict {
  edge: boolean;
  label: string;
  detail: string;
}

/**
 * "Edge" only when the average trade is positive after costs, both halves of
 * the period are positive (not one lucky stretch) and the sample is big enough.
 */
export function verdictOf(trades: BacktestTrade[], minTrades = 100): Verdict {
  const all = summarize(trades);
  if (all.trades < minTrades) {
    return { edge: false, label: "Too few trades", detail: `${all.trades} trades; need at least ${minTrades} to judge.` };
  }
  const mid = Math.floor(trades.length / 2);
  const first = summarize(trades.slice(0, mid));
  const second = summarize(trades.slice(mid));
  if ((all.netPerTrade ?? 0) <= 0) {
    return { edge: false, label: "No edge after costs", detail: "The average trade loses money once brokerage, taxes and slippage are paid." };
  }
  if (first.totalNet <= 0 || second.totalNet <= 0) {
    return { edge: false, label: "Not consistent", detail: "Profitable overall but one half of the period lost money, so the result is not stable." };
  }
  return { edge: true, label: "Positive after costs", detail: "Positive after costs in both halves. Still needs paper trading before any real money." };
}

/** Net rupees per lot by calendar month (IST), oldest first. */
export function byMonth(trades: BacktestTrade[]): Array<{ month: string; trades: number; net: number; winRate: number }> {
  const map = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const month = t.day.slice(0, 7);
    map.set(month, [...(map.get(month) ?? []), t]);
  }
  return [...map.entries()].map(([month, list]) => {
    const s = summarize(list);
    return { month, trades: s.trades, net: s.totalNet, winRate: s.winRate ?? 0 };
  });
}

export const defaultParams = (index: ScalpIndex): BacktestParams => ({
  stopPoints: SCALP_INDEXES[index].stopPoints,
  rewardRisk: 1.5,
  orbMinutes: 15,
  timeStopMin: 10,
  maxPerDay: 3,
  cooldownMin: 15,
  lastEntryMin: 15 * 60,
  useFutVwap: true,
});
