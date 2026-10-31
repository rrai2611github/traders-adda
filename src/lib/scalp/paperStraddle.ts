/**
 * Paper trading for the 09:20 short straddle with real option prices: each
 * day's legs are replayed from the actual contracts' 1-minute candles (no
 * orders are ever placed). Pure functions; I/O lives in `paperStraddleRun.ts`.
 */
import { shortLegCost } from "./premium.ts";
import type { CostModel } from "./backtest.ts";
import { istDayKey, istMinute, type Bar, type ScalpIndex, type Side } from "./scalpLogic.ts";

export interface PaperPlan {
  entryMin: number;
  exitMin: number;
  /** Leg stop as a fraction above the sale price. */
  legStopPct: number;
}

export const PAPER_PLAN: PaperPlan = { entryMin: 9 * 60 + 20, exitMin: 15 * 60 + 15, legStopPct: 0.25 };

export type LegStatus = "stop" | "close" | "open";

export interface PaperLeg {
  side: Side;
  symbol: string;
  sold: number;
  soldAt: number;
  /** Buy-back price, or null while the leg is still open. */
  bought: number | null;
  boughtAt: number | null;
  status: LegStatus;
  /** Last traded price used for an open leg's running P&L. */
  mark: number;
  /** What the backtest model would have sold this leg for at the same minute. */
  modelSold: number | null;
}

export interface PaperDay {
  index: ScalpIndex;
  day: string;
  expiry: string;
  strike: number;
  spotAtEntry: number;
  vixAtEntry: number | null;
  status: "open" | "closed";
  legs: PaperLeg[];
  grossRs: number;
  netRs: number;
  updatedAt: number;
}

/**
 * Replays one short leg on its real 1-minute candles: sold at the first bar
 * at or after the entry minute (its open), stopped when a bar's high reaches
 * the stop (a gap above the stop fills at the open), otherwise bought back at
 * the exit bar's open. Before the exit bar exists the leg stays open.
 */
export function replayLeg(bars: Bar[], day: string, plan: PaperPlan = PAPER_PLAN): Omit<PaperLeg, "side" | "symbol" | "modelSold"> | null {
  const session = bars.filter((b) => istDayKey(b.t) === day && istMinute(b.t) >= 9 * 60 + 15 && istMinute(b.t) <= 15 * 60 + 29);
  const e = session.findIndex((b) => istMinute(b.t) >= plan.entryMin);
  if (e < 0) return null;
  const sold = session[e].open;
  const stop = sold * (1 + plan.legStopPct);
  for (let i = e; i < session.length; i++) {
    const bar = session[i];
    if (istMinute(bar.t) >= plan.exitMin) {
      return { sold, soldAt: session[e].t, bought: bar.open, boughtAt: bar.t, status: "close", mark: bar.open };
    }
    if (bar.high >= stop) {
      const fill = i > e && bar.open > stop ? bar.open : stop;
      return { sold, soldAt: session[e].t, bought: fill, boughtAt: bar.t, status: "stop", mark: fill };
    }
  }
  const last = session[session.length - 1];
  return { sold, soldAt: session[e].t, bought: null, boughtAt: null, status: "open", mark: last.close };
}

/** Gross and net rupees for one lot of each leg; open legs are marked at their last price with exit costs estimated. */
export function priceDay(legs: PaperLeg[], costs: CostModel): { grossRs: number; netRs: number } {
  let grossRs = 0, netRs = 0;
  for (const leg of legs) {
    const exit = leg.bought ?? leg.mark;
    const gross = (leg.sold - exit) * costs.lotSize;
    grossRs += gross;
    netRs += gross - shortLegCost(costs, leg.sold, exit);
  }
  return { grossRs, netRs };
}

export interface PaperSummary {
  days: number;
  closedDays: number;
  winDays: number;
  grossRs: number;
  netRs: number;
  maxDrawdown: number;
  stops: number;
  /** Average real sale price ÷ model sale price; above 1 means the backtest model was conservative. */
  realToModel: number | null;
  /** Closed days needed before reading anything into the result. */
  needed: number;
}

export const PAPER_DAYS_NEEDED = 40;

export function summarizePaper(days: PaperDay[]): PaperSummary {
  const closed = days.filter((d) => d.status === "closed").sort((a, b) => a.day.localeCompare(b.day));
  let net = 0, peak = 0, maxDrawdown = 0;
  for (const d of closed) {
    net += d.netRs;
    peak = Math.max(peak, net);
    maxDrawdown = Math.max(maxDrawdown, peak - net);
  }
  const ratios = days.flatMap((d) => d.legs).filter((l) => l.modelSold && l.modelSold > 0).map((l) => l.sold / (l.modelSold as number));
  return {
    days: days.length,
    closedDays: closed.length,
    winDays: closed.filter((d) => d.netRs > 0).length,
    grossRs: closed.reduce((a, d) => a + d.grossRs, 0),
    netRs: net,
    maxDrawdown,
    stops: closed.flatMap((d) => d.legs).filter((l) => l.status === "stop").length,
    realToModel: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
    needed: PAPER_DAYS_NEEDED,
  };
}

/** Converts the Fyers expiry label "06-10-2026" to "2026-10-06". */
export const chainDate = (label: string) => {
  const [d, m, y] = label.split("-");
  return `${y}-${m}-${d}`;
};
