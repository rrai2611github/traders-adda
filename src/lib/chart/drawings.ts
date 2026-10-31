import type { Candle } from "../market/types.ts";

export interface DrawingPoint {
  t: number;
  price: number;
}

export type Drawing =
  | { kind: "trend"; a: DrawingPoint; b: DrawingPoint }
  | { kind: "hline"; price: number };

/**
 * Index of the bar that contains time `t`: the last bar starting at or before
 * it. Lets a line drawn on the daily chart land on the right weekly or monthly
 * bar. Returns null when `t` is before the first bar.
 */
export function barIndexAt(bars: ReadonlyArray<Pick<Candle, "t">>, t: number): number | null {
  let lo = 0;
  let hi = bars.length - 1;
  if (hi < 0 || t < bars[0].t) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
