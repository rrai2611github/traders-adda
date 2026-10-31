import type { BuyHorizon } from "./horizonSignal.ts";

export type JournalStatus = "open" | "closed";

export interface JournalEntry {
  id: string;
  symbol: string;
  name: string;
  horizon: BuyHorizon;
  /** Scanner family/families that produced the pick, for context only. */
  source: string;
  entryDate: string;
  entryPrice: number;
  stop: number;
  target1: number;
  target2: number;
  quantity: number;
  status: JournalStatus;
  exitDate?: string;
  exitPrice?: number;
}

export interface JournalStats {
  open: number;
  closed: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
}

/** Long-only R multiple: risk is entry-to-stop, reward is exit-to-entry. Null when entry is not above stop. */
export function realizedR(entry: JournalEntry): number | null {
  if (entry.exitPrice == null) return null;
  const risk = entry.entryPrice - entry.stop;
  if (!(risk > 0)) return null;
  return (entry.exitPrice - entry.entryPrice) / risk;
}

/**
 * Win rate and average R across closed trades, in the same shape as
 * `ScannerBacktestStat` so a trader's own record can sit next to the
 * disclosed backtest for direct comparison.
 */
export function journalStats(entries: ReadonlyArray<JournalEntry>): JournalStats {
  const closed = entries.filter((e) => e.status === "closed");
  const rs = closed.map(realizedR).filter((r): r is number => r != null);
  const wins = rs.filter((r) => r > 0).length;
  return {
    open: entries.filter((e) => e.status === "open").length,
    closed: closed.length,
    wins,
    winRate: rs.length ? Math.round((wins / rs.length) * 1000) / 10 : null,
    avgR: rs.length ? Math.round((rs.reduce((sum, r) => sum + r, 0) / rs.length) * 100) / 100 : null,
  };
}
