/**
 * The stocks behind each number in "Today in numbers", so a tile can be opened to see exactly which stocks it counts. The tile's number is
 * the length of this list, so the two can never disagree.
 */
export type StatKey = "up" | "down" | "nearHigh" | "nearLow" | "strong" | "above200" | "breakouts" | "failed";

export interface StatRow {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  rs: number | null;
  fromHigh: number | null;
  aboveLow: number | null;
  vs200: number | null;
}

export interface StatEvent {
  symbol: string;
  name: string;
  price: number;
  ext?: number;
  retPct?: number;
  why?: string | null;
}

export interface StatItem {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  rs: number | null;
  /** One short line of context, e.g. how far the stock is from its high. */
  note: string | null;
}

export const STAT_TITLES: Record<StatKey, { title: string; about: string }> = {
  up: { title: "Stocks up today", about: "Biggest gainers first." },
  down: { title: "Stocks down today", about: "Biggest losers first." },
  nearHigh: { title: "Near the 52-week high", about: "Within 5% of the high, closest first." },
  nearLow: { title: "Near the 52-week low", about: "Within 5% of the low, closest first." },
  strong: { title: "RS 80 and above", about: "The strongest stocks over the past year, strongest first." },
  above200: { title: "Above the 200-day average", about: "Stocks in a long-term uptrend, strongest first." },
  breakouts: { title: "New breakouts", about: "Stocks that broke out of a base today." },
  failed: { title: "Failed breakouts", about: "Breakouts that fell back under their level." },
};

const NEAR_PERCENT = 5;
const RS = (r: StatRow) => r.rs ?? 0;
const byRsThenSymbol = (a: StatRow, b: StatRow) => RS(b) - RS(a) || a.symbol.localeCompare(b.symbol);

const fromRow = (r: StatRow, note: string | null): StatItem => ({ symbol: r.symbol, name: r.name, price: r.price, changePercent: r.changePercent, rs: r.rs, note });

function fromEvents(events: ReadonlyArray<StatEvent>, rows: ReadonlyArray<StatRow>, note: (e: StatEvent) => string | null): StatItem[] {
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const seen = new Set<string>();
  const out: StatItem[] = [];
  for (const e of events) {
    if (seen.has(e.symbol)) continue;
    seen.add(e.symbol);
    const row = bySymbol.get(e.symbol);
    out.push({ symbol: e.symbol, name: e.name, price: e.price, changePercent: row?.changePercent ?? null, rs: row?.rs ?? null, note: note(e) });
  }
  return out;
}

/** The list behind one tile. */
export function statItems(key: StatKey, rows: ReadonlyArray<StatRow>, breakouts: ReadonlyArray<StatEvent>, failed: ReadonlyArray<StatEvent>): StatItem[] {
  switch (key) {
    case "up":
      return rows.filter((r) => r.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent || a.symbol.localeCompare(b.symbol)).map((r) => fromRow(r, null));
    case "down":
      return rows.filter((r) => r.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent || a.symbol.localeCompare(b.symbol)).map((r) => fromRow(r, null));
    case "nearHigh":
      return rows.filter((r) => r.fromHigh != null && r.fromHigh <= NEAR_PERCENT).sort((a, b) => a.fromHigh! - b.fromHigh! || byRsThenSymbol(a, b)).map((r) => fromRow(r, r.fromHigh! <= 0 ? "At its 52-week high" : `${r.fromHigh!.toFixed(1)}% under its high`));
    case "nearLow":
      return rows.filter((r) => r.aboveLow != null && r.aboveLow <= NEAR_PERCENT).sort((a, b) => a.aboveLow! - b.aboveLow! || byRsThenSymbol(a, b)).map((r) => fromRow(r, r.aboveLow! <= 0 ? "At its 52-week low" : `${r.aboveLow!.toFixed(1)}% over its low`));
    case "strong":
      return rows.filter((r) => RS(r) >= 80).sort(byRsThenSymbol).map((r) => fromRow(r, null));
    case "above200":
      return rows.filter((r) => r.vs200 != null && r.vs200 > 0).sort(byRsThenSymbol).map((r) => fromRow(r, `${r.vs200!.toFixed(0)}% above its 200-day average`));
    case "breakouts":
      return fromEvents(breakouts, rows, (e) => (e.ext != null ? `${e.ext.toFixed(1)}% past its level` : e.why ?? null));
    case "failed":
      return fromEvents(failed, rows, (e) => e.why ?? (e.retPct != null ? `${e.retPct.toFixed(1)}% since the breakout` : null));
  }
}
