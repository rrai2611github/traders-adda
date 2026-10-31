/**
 * "Ready to run": strong stocks sitting just under their breakout level in an uptrend, before the move. Built from the scan's rows.
 * Closest tested rule (/backtest, 2016-2026): RS 90+ within 5% of the 52-week high, 8% stop, exit under the 50-day average, bought only
 * while 60%+ of stocks are above their 50-day average, made about +0.7R a trade and 21% a year. Skipping stocks that had already run
 * lowered the return (about 8-14% a year), so this list trades some return for a lower chance of buying late.
 */
export const READY_RULES = {
  minRs: 85,
  /** Percent under the pivot, most to least. */
  maxUnderPivot: 6,
  maxFromHigh: 15,
  minTurnoverCr: 5,
  /** Volume against its 50-day normal; at or under this the base is quiet. */
  dryUpAt: 0.9,
  limit: 8,
} as const;

export interface ReadyInput {
  symbol: string;
  stage: string | null;
  liquid?: boolean;
  series?: "EQ" | "BE";
  rs: number | null;
  ext: number | null;
  vs50: number | null;
  vs200: number | null;
  fromHigh: number | null;
  dry: number | null;
  turnoverCr: number | null;
}

export interface ReadyStock<T extends ReadyInput = ReadyInput> {
  row: T;
  /** Percent under the breakout level. */
  underPivot: number;
  quiet: boolean;
}

export function readyToRun<T extends ReadyInput>(rows: ReadonlyArray<T>): ReadyStock<T>[] {
  const R = READY_RULES;
  const seen = new Set<string>();
  const out: ReadyStock<T>[] = [];
  for (const row of rows) {
    if (row.stage !== "forming" || row.liquid === false || row.series === "BE" || seen.has(row.symbol)) continue;
    if (row.rs == null || row.rs < R.minRs || row.ext == null || row.ext > 0 || row.ext < -R.maxUnderPivot) continue;
    if (row.vs50 == null || row.vs50 <= 0 || row.vs200 == null || row.vs200 <= 0) continue;
    if (row.fromHigh == null || Math.abs(row.fromHigh) > R.maxFromHigh) continue;
    if (row.turnoverCr == null || row.turnoverCr < R.minTurnoverCr) continue;
    seen.add(row.symbol);
    out.push({ row, underPivot: -row.ext, quiet: row.dry != null && row.dry <= R.dryUpAt });
  }
  return out.sort((a, b) => Number(b.quiet) - Number(a.quiet) || (b.row.rs ?? 0) - (a.row.rs ?? 0) || a.underPivot - b.underPivot).slice(0, R.limit);
}
