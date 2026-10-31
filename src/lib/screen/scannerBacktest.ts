import raw from "./scannerBacktest.json";
import { SCANNERS, type ScannerKey } from "./chartinkScans.ts";

/**
 * Per-scanner backtest stats (Buy ready rules, the T1/T2 exit plan the app and
 * the alerts tell people to use). The blended "ANY" figure that used to be the
 * only number shown hides that some scanners have a real historical edge and
 * others do not: e.g. "leader" and "fall4" are net positive while "range" and
 * "high52" are clearly negative. Surface the scanner's own number wherever a
 * pick is shown, not just one average across all of them.
 */

type Stat = { trades: number; winRate: number; avgR: number; profitFactor?: number } | null;

interface RawBacktest {
  from: string;
  to: string;
  split: string;
  costPercent: number;
  scanners: Record<string, { ready?: { targets?: { all?: Stat; secondHalf?: Stat } } }>;
}

const backtest = raw as RawBacktest;

/** Below this average gain per trade, a scanner has no proven edge yet. */
export const PROVEN_EDGE_R = 0.1;

export interface ScannerBacktestStat {
  key: string;
  from: string;
  to: string;
  trades: number;
  winRate: number;
  avgR: number;
  profitFactor?: number;
  costPercent: number;
  /** The later out-of-sample half of the test period. */
  recent?: { from: string; trades: number; avgR: number };
  /** Whether the full-period average gain clears PROVEN_EDGE_R. */
  edge: "proven" | "unproven";
}

/** `key` is a ScannerKey or the blended "ANY" aggregate; null when the scanner has no backtest yet (new scanner, or RPCI/Oscillator, which this backtest does not cover). */
export function scannerBacktestStat(key: ScannerKey | "ANY"): ScannerBacktestStat | null {
  const targets = backtest.scanners[key]?.ready?.targets;
  const all = targets?.all;
  if (!all) return null;
  const recent = targets?.secondHalf;
  return {
    key,
    from: backtest.from,
    to: backtest.to,
    trades: all.trades,
    winRate: all.winRate,
    avgR: all.avgR,
    profitFactor: all.profitFactor,
    costPercent: backtest.costPercent,
    recent: recent ? { from: backtest.split, trades: recent.trades, avgR: recent.avgR } : undefined,
    edge: all.avgR >= PROVEN_EDGE_R ? "proven" : "unproven",
  };
}

const signedR = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`;

/** Short, scanner-specific backtest line for a table cell or tooltip. */
export function scannerBacktestSentence(stat: ScannerBacktestStat): string {
  const verdict = stat.edge === "unproven"
    ? " No proven edge yet — treat as a research idea, size down."
    : " Proven edge in the backtest (confirm the sample size before sizing up).";
  return `${stat.trades.toLocaleString("en-IN")} trades · ${stat.winRate}% winners · avg ${signedR(stat.avgR)}/trade` +
    ` (${stat.from} → ${stat.to}, after ${stat.costPercent}% costs).${verdict}`;
}

/** Menu label (e.g. "Range Breakout") → ScannerKey, for sources that are shown to the user by label only. */
export const SCANNER_KEY_BY_LABEL: Record<string, ScannerKey> = Object.fromEntries(
  Object.values(SCANNERS).map((def) => [def.menuLabel, def.key]),
);
