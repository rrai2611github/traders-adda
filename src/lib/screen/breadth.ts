/** Below this share of liquid stocks above their 50-day average, the backtest lost money on every filter. */
export const HEALTHY_BREADTH_PERCENT = 50;

export interface MovingAverageBreadth {
  covered: number;
  above: number;
  percent: number | null;
}

export function movingAverageBreadth(
  rows: ReadonlyArray<{ vs50: number | null; vs200: number | null }>,
  key: "vs50" | "vs200",
): MovingAverageBreadth {
  const values = rows.map((row) => row[key]).filter((value): value is number =>
    value != null && Number.isFinite(value),
  );
  const above = values.filter((value) => value >= 0).length;
  return {
    covered: values.length,
    above,
    percent: values.length ? Math.round(above / values.length * 100) : null,
  };
}
