import type { Candle } from "../market/types.ts";

export type ChartTimeframe = "D" | "W" | "M";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Bucket key in IST: the Monday of the week for W, year*12+month for M. */
function bucketKey(t: number, timeframe: Exclude<ChartTimeframe, "D">): number {
  const ist = new Date(t + IST_OFFSET_MS);
  if (timeframe === "M") return ist.getUTCFullYear() * 12 + ist.getUTCMonth();
  const dayNo = Math.floor((t + IST_OFFSET_MS) / DAY_MS);
  // 1 Jan 1970 was a Thursday; shift so weeks start on Monday.
  return dayNo - ((dayNo + 3) % 7);
}

/**
 * Rolls daily candles into weekly (Mon–Fri, IST) or monthly bars. Each bar is
 * stamped with the time of its first session so it sits at the period start.
 */
export function aggregateCandles(candles: ReadonlyArray<Candle>, timeframe: ChartTimeframe): Candle[] {
  if (timeframe === "D") return candles.slice();
  const out: Candle[] = [];
  let key: number | null = null;
  for (const c of candles) {
    const k = bucketKey(c.t, timeframe);
    const bar = out[out.length - 1];
    if (k !== key || !bar) {
      out.push({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
      key = k;
    } else {
      bar.high = Math.max(bar.high, c.high);
      bar.low = Math.min(bar.low, c.low);
      bar.close = c.close;
      bar.volume += c.volume;
    }
  }
  return out;
}
