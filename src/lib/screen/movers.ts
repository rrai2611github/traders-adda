export interface MoverInput {
  symbol: string;
  price: number;
  changePercent: number;
}

/**
 * Biggest risers and fallers of the day among the stocks the scan already covers (the liquid ones, so a thinly traded stock
 * cannot top the list on a few trades). Only real risers count as gainers and only real fallers as losers.
 */
export function topMovers<T extends MoverInput>(rows: ReadonlyArray<T>, count = 5): { gainers: T[]; losers: T[] } {
  const valid = rows.filter((row) => Number.isFinite(row.changePercent) && Number.isFinite(row.price));
  return {
    gainers: valid.filter((row) => row.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, count),
    losers: valid.filter((row) => row.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, count),
  };
}

export interface HeatInput {
  changePercent: number;
  rvol?: { ratio: number } | null;
  fromHigh?: number | null;
  vs50?: number | null;
  vs200?: number | null;
}

/**
 * "Heating up": up 3% or more on at least twice its usual volume, within 10% of its 52-week high and above both its 50-day and
 * 200-day averages. In 10 years of history such stocks jumped 10% the next day about 5 times as often as an average liquid stock
 * (about 2.5% of the time against 0.5%), but buying the next morning still lost about 0.5% to 0.8% on average after costs.
 * It is a watch tag, never a buy signal.
 */
export function isHeatingUp(row: HeatInput): boolean {
  return (
    row.changePercent >= 3 &&
    (row.rvol?.ratio ?? 0) >= 2 &&
    row.fromHigh != null && row.fromHigh <= 10 &&
    row.vs50 != null && row.vs50 >= 0 &&
    row.vs200 != null && row.vs200 >= 0
  );
}
