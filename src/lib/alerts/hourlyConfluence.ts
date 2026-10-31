import { rankConfluence, type Confluence } from "../screen/confluence.ts";
import type { ScanRow } from "../../hooks/useScreenScan.ts";
import type { AlertTable, AlertTableRow } from "./scannerAlert.ts";

/** Same liquidity bar as the app's Bullish confluence panel. */
export const CONFLUENCE_MIN_TURNOVER_CR = 5;
/** The email lists the 10 strongest liquid stocks where two or more families agree. */
export const HOURLY_CONFLUENCE_LIMIT = 10;

/** One stock in the hourly "Bullish confluence" section. Context only, never a buy. */
export interface ConfluenceIdea {
  symbol: string;
  name: string;
  price: number;
  changePercent: number | null;
  rs: number | null;
  pa: number | null;
  /** Bullish families, e.g. ["Core Setups", "Trade Triggers"]. */
  families: string[];
  /** Families measured (4 when RSI Edge is unavailable). */
  of: number;
  /** The individual bullish scanner hits, e.g. "VCP", "Score 9.7/15". */
  scanners: string[];
  /** Rule-based swing plan (same rules as Buy ready) if the stock triggers; absent when it cannot be computed. */
  plan?: ConfluencePlan;
  /** Where the latest price sits against the plan's trigger. */
  entryState?: import("./entryState.ts").EntryState;
}

export interface ConfluencePlan {
  /** Buy above this (the last completed session's high). */
  entry: number;
  stop: number;
  riskPercent: number;
  target1: number;
  target2: number;
  buyZoneHigh: number;
}

/** How strong a stock looks: more families first, then the mean of its RS rating and price-action score. */
const strength = (idea: ConfluenceIdea) => (idea.rs ?? 0) + (idea.pa ?? 0);
export const byStrength = (a: ConfluenceIdea, b: ConfluenceIdea) =>
  b.families.length - a.families.length || strength(b) - strength(a) || b.scanners.length - a.scanners.length;

/**
 * Tags each hourly-email stock with how many scanner families are bullish on it and adds
 * the top bullish-confluence stocks as a separate list. Display only: the Buy ready and
 * watch rows, their order and their status are left exactly as they were.
 */
export function withConfluence(
  table: AlertTable,
  confluence: ReadonlyMap<string, Confluence>,
  of: number,
  scanRows: ReadonlyArray<ScanRow> = [],
  limit = HOURLY_CONFLUENCE_LIMIT,
): AlertTable {
  const tagRow = (row: AlertTableRow): AlertTableRow => {
    const c = confluence.get(row.symbol);
    return { ...row, confluence: { bull: c?.bull.length ?? 0, of, conflict: c?.conflict ?? false } };
  };
  return {
    ...table,
    rows: table.rows.map(tagRow),
    ...(table.watch ? { watch: table.watch.map(tagRow) } : {}),
    bullConfluence: topConfluence(confluence, of, scanRows, limit),
  };
}

/** Liquid stocks where 2+ families agree and none disagree, 3+ families first (as the app panel ranks them). */
export function topConfluence(
  confluence: ReadonlyMap<string, Confluence>,
  of: number,
  scanRows: ReadonlyArray<ScanRow>,
  limit = HOURLY_CONFLUENCE_LIMIT,
): ConfluenceIdea[] {
  const bySymbol = new Map(scanRows.map((row) => [row.symbol, row]));
  const ideas: ConfluenceIdea[] = [];
  for (const c of rankConfluence(confluence, "bull", 2)) {
    const row = bySymbol.get(c.symbol);
    if (!row || row.turnoverCr == null || row.turnoverCr < CONFLUENCE_MIN_TURNOVER_CR) continue;
    ideas.push({
      symbol: c.symbol,
      name: row.name,
      price: row.price,
      changePercent: row.changePercent ?? null,
      rs: row.rs ?? null,
      pa: row.paRating?.status === "rated" ? row.paRating.score : null,
      families: [...c.bull],
      of,
      scanners: [...new Set(c.signals.filter((s) => s.tone === "bull").map((s) => s.label))],
    });
  }
  return ideas.sort(byStrength).slice(0, limit);
}
