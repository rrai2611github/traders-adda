import { getDataSource, getQuotes } from "@/lib/market/engine";
import { getMarketStatus } from "@/lib/market/marketHours";
import type { Quote } from "@/lib/market/types";
import { entryState } from "./entryState";
import type { AlertTable, AlertTableRow } from "./scannerAlert";

/**
 * Puts the latest market price on every stock in an email just before it is built or sent.
 * The scan behind the lists can be up to a minute old; this asks the quote feed again (about a second old with Fyers)
 * so CMP and today's move are current, and each recommendation shows where that price sits against its trigger.
 * The levels themselves (entry, stop, targets) stay on the analysis they were built from.
 * If the feed fails the scan prices are kept and the email says so.
 */

export interface PriceSource {
  label: string;
  /** When the prices were fetched. */
  at: number;
  /** Market in continuous trading and a real-time feed: the prices are live. */
  live: boolean;
  /** The refresh succeeded; false means the scan's own (older) prices are shown. */
  refreshed: boolean;
  /** How many stocks got a fresh price, out of how many are listed. */
  covered: number;
  total: number;
}

const live = (row: AlertTableRow, quote: Quote): AlertTableRow => ({
  ...row,
  signalClose: row.signalClose ?? row.close,
  close: quote.ltp,
  changePercent: quote.changePercent,
  entryState: entryState(quote.ltp, row.entry, row.buyZoneHigh),
});

export async function overlayLiveQuotes(table: AlertTable, now: number = Date.now()): Promise<AlertTable> {
  const symbols = [...new Set([
    ...table.rows.map((r) => r.symbol), ...(table.watch ?? []).map((r) => r.symbol),
    ...(table.bullConfluence ?? []).map((i) => i.symbol), ...(table.bottomedOut ?? []).map((p) => p.symbol),
  ])];
  const source = getDataSource();
  const market = getMarketStatus(now);
  let quotes = new Map<string, Quote>();
  let refreshed = false;
  if (symbols.length) {
    try {
      quotes = new Map((await getQuotes(symbols)).map((quote) => [quote.symbol, quote]));
      refreshed = quotes.size > 0;
    } catch (error) {
      console.error("[email] live price refresh failed; showing scan prices:", error instanceof Error ? error.message : error);
    }
  }
  const covered = symbols.filter((s) => quotes.has(s)).length;
  const priceSource: PriceSource = { label: source.label, at: now, live: market.isLive && source.isRealtime && refreshed, refreshed, covered, total: symbols.length };
  if (!refreshed) return { ...table, priceSource };
  const rows = (list: AlertTableRow[]) => list.map((row) => { const q = quotes.get(row.symbol); return q ? live(row, q) : row; });
  return {
    ...table,
    rows: rows(table.rows),
    ...(table.watch ? { watch: rows(table.watch) } : {}),
    ...(table.bullConfluence ? {
      bullConfluence: table.bullConfluence.map((idea) => {
        const q = quotes.get(idea.symbol);
        if (!q) return idea;
        return { ...idea, price: q.ltp, changePercent: q.changePercent, entryState: idea.plan ? entryState(q.ltp, idea.plan.entry, idea.plan.buyZoneHigh) : undefined };
      }),
    } : {}),
    ...(table.bottomedOut ? { bottomedOut: table.bottomedOut.map((pick) => { const q = quotes.get(pick.symbol); return q ? { ...pick, signalClose: pick.signalClose ?? pick.close, close: q.ltp } : pick; }) } : {}),
    priceSource,
  };
}
