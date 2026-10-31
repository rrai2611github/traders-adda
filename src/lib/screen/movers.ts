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
