import type { BacktestSettings, Trade } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

/**
 * Plan rehearsal: run the tested rules (Blue sky + Multi-year breakouts, 12% stop, exit under the 50-day average) on one stock's own ten-year
 * history, to see how that stock has behaved under this exact plan, set beside the odds a plan needs to break even. The market check is left
 * off so the stock gets as many trades as possible; the sample is still small, and the summary says so.
 */
export function rehearsalSettings(symbol: string, stopPercent: 8 | 12 = 12): BacktestSettings {
  return {
    ...DEFAULT_SETTINGS,
    strategy: { kind: "screen", screen: "Blue sky" },
    alsoScreens: ["Multi-year breakouts"],
    from: "2016-12-01",
    to: "2099-12-31",
    entry: "next-open",
    stop: { kind: "percent", percent: stopPercent },
    exit: { kind: "ma", type: "sma", period: 50, when: "close" },
    maxHoldDays: 0,
    costPercent: 0.25,
    capital: 1_000_000,
    maxPositions: 10,
    sizing: { kind: "risk", riskPercent: 2 },
    positionCapPercent: 20,
    turnoverLimitPercent: 10,
    breadthMin: 0,
    floor: "screen",
    maxNewPerDay: 3,
    symbol,
  };
}

export interface Rehearsal {
  trades: number;
  wins: number;
  /** Percent of trades that made money; null with no trades. */
  winRate: number | null;
  avgR: number | null;
  bestR: number | null;
  worstR: number | null;
  /** How many trades ended at +1R, +2R and +3R or better. */
  reached: { r1: number; r2: number; r3: number };
  medianHoldDays: number | null;
  /** Win rate a plan needs to break even when its winners average `r` times the loss, in percent. */
  breakEven: Array<{ r: number; winRate: number }>;
  /** How the stock's own win rate compares with the break-even rate its own average winner needs; null when there is no winner and loser to compare. */
  edge: { needed: number; actual: number } | null;
  /** Plain-words reading, always including how thin the sample is. */
  verdict: string;
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function summariseRehearsal(trades: ReadonlyArray<Pick<Trade, "r" | "pnl" | "holdDays" | "exitReason">>): Rehearsal {
  const done = trades.filter((t) => t.exitReason !== "end");
  const n = done.length;
  const wins = done.filter((t) => t.pnl > 0);
  const losses = done.filter((t) => t.pnl <= 0);
  const rs = done.map((t) => t.r);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.r, 0) / wins.length : null;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.r, 0) / losses.length) : null;
  const edge = avgWin != null && avgLoss != null && avgLoss > 0 ? { needed: Math.round((100 / (1 + avgWin / avgLoss)) * 10) / 10, actual: Math.round((wins.length / n) * 1000) / 10 } : null;
  const winRate = n ? (wins.length / n) * 100 : null;
  const avgR = n ? rs.reduce((a, b) => a + b, 0) / n : null;
  let verdict: string;
  if (n === 0) verdict = "This stock has had no breakout on these screens since 2016, so there is nothing to rehearse.";
  else if (n < 8) verdict = `Only ${n} trade${n === 1 ? "" : "s"}: far too few to say anything about this stock. Use the all-stock results (about 40% win, +1.0R) instead.`;
  else if (edge && edge.actual >= edge.needed + 5) verdict = `Across ${n} trades this stock won ${edge.actual}% against the ${edge.needed}% its own average winner needs to break even: the plan has worked here, but ${n} trades is still a small sample.`;
  else if (edge && edge.actual <= edge.needed - 5) verdict = `Across ${n} trades this stock won ${edge.actual}% against the ${edge.needed}% it needed to break even: the plan has not paid on this stock. Small sample, so do not read too much into it.`;
  else verdict = `Across ${n} trades this stock is close to break-even for the plan (${edge ? `${edge.actual}% won against ${edge.needed}% needed` : "no winner or loser to compare"}). A small sample.`;
  return {
    trades: n,
    wins: wins.length,
    winRate,
    avgR,
    bestR: n ? Math.max(...rs) : null,
    worstR: n ? Math.min(...rs) : null,
    reached: { r1: done.filter((t) => t.r >= 1).length, r2: done.filter((t) => t.r >= 2).length, r3: done.filter((t) => t.r >= 3).length },
    medianHoldDays: median(done.map((t) => t.holdDays)),
    breakEven: [1, 2, 3].map((r) => ({ r, winRate: Math.round((100 / (1 + r)) * 10) / 10 })),
    edge,
    verdict,
  };
}
