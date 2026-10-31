/**
 * How each scanner's hits did, split by the market's breadth on the signal day. From scripts/backtest-scanners.mjs
 * ("BY BREADTH", exit: next open, stop 2 x ATR, 3R target, 40 days), all liquid hits, Oct 2022 - Sep 2026, after 0.25% costs.
 * Re-run that script and update this table when the history grows. Breadth = share of liquid stocks above their 50-day average.
 */
interface Bucket { trades: number; avgR: number }
interface ByBreadth { under50: Bucket; full: Bucket }

const BY_BREADTH: Record<string, ByBreadth> = {
  arbm: { under50: { trades: 902, avgR: -0.28 }, full: { trades: 789, avgR: 0.02 } },
  ath: { under50: { trades: 228, avgR: -0.48 }, full: { trades: 177, avgR: 0.1 } },
  ema21: { under50: { trades: 7068, avgR: -0.25 }, full: { trades: 2333, avgR: 0.05 } },
  fall4: { under50: { trades: 1041, avgR: -0.27 }, full: { trades: 423, avgR: 0 } },
  high52: { under50: { trades: 639, avgR: -0.34 }, full: { trades: 558, avgR: 0.13 } },
  inside: { under50: { trades: 10739, avgR: -0.21 }, full: { trades: 3876, avgR: 0.07 } },
  leader: { under50: { trades: 712, avgR: -0.12 }, full: { trades: 410, avgR: 0.34 } },
  nr7: { under50: { trades: 2242, avgR: -0.22 }, full: { trades: 1453, avgR: 0.02 } },
  pocket: { under50: { trades: 1814, avgR: -0.3 }, full: { trades: 1145, avgR: -0.07 } },
  pullback20: { under50: { trades: 1826, avgR: -0.21 }, full: { trades: 1009, avgR: -0.02 } },
  range: { under50: { trades: 3753, avgR: -0.21 }, full: { trades: 2654, avgR: -0.04 } },
  rsidiv: { under50: { trades: 1012, avgR: -0.29 }, full: { trades: 604, avgR: -0.05 } },
  swing: { under50: { trades: 3909, avgR: -0.23 }, full: { trades: 2214, avgR: 0.08 } },
  up3: { under50: { trades: 279, avgR: -0.39 }, full: { trades: 232, avgR: 0.24 } },
};

export type EdgeLevel = "edge" | "weak" | "none";

export interface ScannerEdge {
  level: EdgeLevel;
  under50: Bucket;
  full: Bucket;
}

/** At least +0.10R a trade with 150+ trades in strong markets counts as an edge; under 0R is no edge. */
export const EDGE_MIN_R = 0.1;
export const EDGE_MIN_TRADES = 150;

export function scannerEdge(key: string): ScannerEdge | null {
  const row = BY_BREADTH[key];
  if (!row) return null;
  const level: EdgeLevel = row.full.avgR >= EDGE_MIN_R && row.full.trades >= EDGE_MIN_TRADES ? "edge" : row.full.avgR >= 0 ? "weak" : "none";
  return { level, ...row };
}

export const EDGE_TAG: Record<EdgeLevel, string> = { edge: "edge", weak: "weak", none: "no edge" };

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`;

/** One plain sentence on what the scanner did in strong and weak markets. */
export function scannerEdgeSentence(label: string, edge: ScannerEdge): string {
  const verdict = edge.level === "edge" ? "A real edge, but only in strong markets." : edge.level === "weak" ? "Barely above break-even: use it only to confirm a stock." : "No edge: it lost money even in strong markets.";
  return `${label}: ${signed(edge.full.avgR)} a trade when 60%+ of stocks are in an uptrend (${edge.full.trades.toLocaleString("en-IN")} trades), ${signed(edge.under50.avgR)} when under 50%. ${verdict}`;
}

/** Keys ordered best first by their strong-market result; scanners without a backtest go last in their original order. */
export function sortByEdge<T extends string>(keys: ReadonlyArray<T>): T[] {
  return [...keys].sort((a, b) => (BY_BREADTH[b]?.full.avgR ?? -9) - (BY_BREADTH[a]?.full.avgR ?? -9));
}
