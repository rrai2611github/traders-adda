import { macroSector, UNCLASSIFIED } from "../industry.ts";

/**
 * Sector Stage 2 breadth: for each sector, the share of its stocks that sit in a Stage 2 uptrend, session by session,
 * against the whole market. A sector with a rising share is where uptrends are spreading; a falling one is where they
 * are failing, whatever the sector's index did that day.
 *
 * "Stage 2" is the same test the Stage 2 Bases scanner uses (`inStage2Trend`): close above the 50-day average, the 50
 * above the 200, and the 200 higher than it was 20 sessions ago. A stock counts on a day only with a full history for it.
 */
export const SECTOR_STAGE2_RULES = {
  short: 50,
  long: 200,
  slopeLookback: 20,
  /** Sessions of history kept per sector. */
  sessions: 60,
  /** A sector's share on a day is withheld with fewer scored stocks than this, rather than guessed. */
  minNames: 3,
  /** A day with fewer than this share of the busiest day's stocks is a partial feed, not a session. */
  minDayCoverage: 0.5,
  red: 20,
  green: 40,
} as const;

/**
 * The sector a stock is counted under: its label folded onto NSE's macro sector (so "Financials" and "Financial
 * Services" are one row), or null when it has no sector or a label that is not an NSE sector. Such stocks still count
 * in the market figure; they are not guessed into a sector. `known` is the set of NSE sector names.
 */
export function stage2SectorOf(label: string | null | undefined, known: ReadonlySet<string>): string | null {
  const sector = macroSector(label);
  return sector === UNCLASSIFIED || !known.has(sector) ? null : sector;
}

export interface DayBar { day: number; close: number }
export interface SectorStock { sector: string | null; bars: ReadonlyArray<DayBar> }

export type Band = "red" | "amber" | "green";
export const bandOf = (share: number): Band => (share < SECTOR_STAGE2_RULES.red ? "red" : share < SECTOR_STAGE2_RULES.green ? "amber" : "green");

/** One flag per close: true in Stage 2, false not, null until there is enough history to judge. */
export function stage2Flags(closes: ReadonlyArray<number>): (boolean | null)[] {
  const { short, long, slopeLookback } = SECTOR_STAGE2_RULES;
  const prefix = new Array<number>(closes.length + 1).fill(0);
  for (let i = 0; i < closes.length; i++) prefix[i + 1] = prefix[i] + closes[i];
  const avg = (end: number, n: number) => (end + 1 < n ? null : (prefix[end + 1] - prefix[end + 1 - n]) / n);
  return closes.map((close, i) => {
    const s = avg(i, short);
    const l = avg(i, long);
    const before = i - slopeLookback >= 0 ? avg(i - slopeLookback, long) : null;
    if (s == null || l == null || before == null) return null;
    return close > s && s > l && l > before;
  });
}

export interface SectorStage2Row {
  sector: string;
  /** Scored stocks on the latest session. */
  names: number;
  inStage2: number;
  /** Share in Stage 2 per session, 0-100, null where fewer than `minNames` stocks were scored. Aligned to `days`. */
  share: (number | null)[];
  now: number | null;
  /** Points gained since the first session with a value. */
  change: number | null;
  /** Points above (positive) or below the whole market now. */
  vsMarket: number | null;
  band: Band | null;
}

export interface SectorStage2Result {
  days: number[];
  market: (number | null)[];
  marketNow: number | null;
  marketNames: number;
  sectors: SectorStage2Row[];
}

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export function sectorStage2Series(stocks: ReadonlyArray<SectorStock>, sessions: number = SECTOR_STAGE2_RULES.sessions): SectorStage2Result {
  const perDay = new Map<number, number>();
  for (const stock of stocks) for (const bar of stock.bars) perDay.set(bar.day, (perDay.get(bar.day) ?? 0) + 1);
  const peak = Math.max(0, ...perDay.values());
  const days = [...perDay].filter(([, n]) => n >= peak * SECTOR_STAGE2_RULES.minDayCoverage).map(([day]) => day).sort((a, b) => a - b).slice(-sessions);
  const slot = new Map(days.map((day, i) => [day, i]));

  const empty = () => ({ scored: new Array<number>(days.length).fill(0), up: new Array<number>(days.length).fill(0) });
  const market = empty();
  const bySector = new Map<string, ReturnType<typeof empty>>();
  for (const stock of stocks) {
    const flags = stage2Flags(stock.bars.map((bar) => bar.close));
    const own = stock.sector ? (bySector.get(stock.sector) ?? bySector.set(stock.sector, empty()).get(stock.sector)!) : null;
    stock.bars.forEach((bar, i) => {
      const at = slot.get(bar.day);
      const flag = flags[i];
      if (at == null || flag == null) return;
      market.scored[at] += 1;
      if (flag) market.up[at] += 1;
      if (own) { own.scored[at] += 1; if (flag) own.up[at] += 1; }
    });
  }

  const last = days.length - 1;
  const share = (t: ReturnType<typeof empty>) => t.scored.map((n, i) => (n >= SECTOR_STAGE2_RULES.minNames ? pct(t.up[i], n) : null));
  const marketShare = share(market);
  const marketNow = last >= 0 ? marketShare[last] : null;
  const sectors: SectorStage2Row[] = [];
  for (const [sector, t] of bySector) {
    if (last < 0 || t.scored[last] < SECTOR_STAGE2_RULES.minNames) continue;
    const series = share(t);
    const now = series[last];
    const first = series.find((v) => v != null) ?? null;
    sectors.push({
      sector,
      names: t.scored[last],
      inStage2: t.up[last],
      share: series,
      now,
      change: now != null && first != null ? Math.round((now - first) * 10) / 10 : null,
      vsMarket: now != null && marketNow != null ? Math.round((now - marketNow) * 10) / 10 : null,
      band: now == null ? null : bandOf(now),
    });
  }
  sectors.sort((a, b) => (b.now ?? -1) - (a.now ?? -1));
  return { days, market: marketShare, marketNow, marketNames: last >= 0 ? market.scored[last] : 0, sectors };
}

export interface SectorFilter {
  minNames: number;
  trend: "all" | "gaining" | "losing";
  market: "all" | "above" | "below";
}
export const NO_SECTOR_FILTER: SectorFilter = { minNames: 0, trend: "all", market: "all" };

export function matchesSectorFilter(row: SectorStage2Row, f: SectorFilter): boolean {
  if (row.names < f.minNames) return false;
  if (f.trend === "gaining" && !((row.change ?? 0) > 0)) return false;
  if (f.trend === "losing" && !((row.change ?? 0) < 0)) return false;
  if (f.market === "above" && !((row.vsMarket ?? 0) > 0)) return false;
  if (f.market === "below" && !((row.vsMarket ?? 0) < 0)) return false;
  return true;
}

export type SectorSort = "share" | "change" | "names";
export function sortSectors(rows: ReadonlyArray<SectorStage2Row>, by: SectorSort): SectorStage2Row[] {
  const key = (r: SectorStage2Row) => (by === "share" ? r.now : by === "change" ? r.change : r.names);
  return [...rows].sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));
}

/** A one-paragraph read of the table, from the rows shown (so it follows the filters). */
export function sectorSummary(rows: ReadonlyArray<SectorStage2Row>, marketNow: number | null, windowLabel: string): string {
  const scored = rows.filter((r) => r.now != null);
  if (!scored.length) return "No sector has enough scored stocks to read yet.";
  const byShare = sortSectors(scored, "share");
  const top = byShare.slice(0, 3).map((r) => `${r.sector} (${r.now!.toFixed(0)}%)`);
  const bottom = byShare.slice(-2).reverse().map((r) => `${r.sector} (${r.now!.toFixed(0)}%)`);
  const moved = scored.filter((r) => r.change != null);
  const gain = sortSectors(moved, "change")[0];
  const loss = sortSectors(moved, "change").at(-1);
  const parts = [`${top.join(", ")} have the largest share of names in Stage 2${marketNow == null ? "" : `, against ${marketNow.toFixed(1)}% for the whole market`}.`, `${bottom.join(" and ")} sit lowest.`];
  if (gain && loss && gain.sector !== loss.sector) parts.push(`${windowLabel}, ${gain.sector} gained most (${gain.change! > 0 ? "+" : ""}${gain.change!.toFixed(1)} points) and ${loss.sector} lost most (${loss.change! > 0 ? "+" : ""}${loss.change!.toFixed(1)}).`);
  return parts.join(" ");
}

/** The last `sessions` of a result, with each sector's change recomputed over that shorter window. */
export function windowResult(result: SectorStage2Result, sessions: number): SectorStage2Result {
  const keep = Math.max(1, Math.min(sessions, result.days.length));
  const from = result.days.length - keep;
  return {
    ...result,
    days: result.days.slice(from),
    market: result.market.slice(from),
    sectors: result.sectors.map((row) => {
      const share = row.share.slice(from);
      const first = share.find((v) => v != null) ?? null;
      return { ...row, share, change: row.now != null && first != null ? Math.round((row.now - first) * 10) / 10 : null };
    }),
  };
}
