import { aggregateCandles, type ChartTimeframe } from "../chart/aggregate.ts";
import type { Candle } from "../market/types.ts";
import { ema } from "./oscillators.ts";

export type TrendDirection = "up" | "down" | null;

export interface TimeframeAgreement {
  daily: TrendDirection;
  weekly: TrendDirection;
  monthly: TrendDirection;
  /** true only when every timeframe with a reading agrees and at least one is up or down. */
  aligned: boolean;
  /** true when at least one readable timeframe disagrees with another. */
  conflicting: boolean;
}

const EMA_PERIOD = 20;
const MIN_BARS = EMA_PERIOD + 1;

/** Close above/below its own 20-period EMA, on that timeframe's own bars. Same overlay as the chart's "MA 20/50/200". */
function trendOn(candles: ReadonlyArray<Candle>, timeframe: ChartTimeframe): TrendDirection {
  const bars = aggregateCandles(candles, timeframe);
  if (bars.length < MIN_BARS) return null;
  const closes = bars.map((bar) => bar.close);
  const ema20 = ema(closes, EMA_PERIOD);
  const lastEma = ema20.at(-1);
  const lastClose = closes.at(-1);
  if (lastEma == null || lastClose == null) return null;
  return lastClose > lastEma ? "up" : lastClose < lastEma ? "down" : null;
}

/**
 * Daily/weekly/monthly trend agreement from one daily candle series. A
 * technically-valid setup on one timeframe often fails because a higher
 * timeframe disagrees; this makes that visible without flipping the chart's
 * own timeframe toggle three times by hand.
 */
export function timeframeAgreement(candles: ReadonlyArray<Candle>): TimeframeAgreement {
  const daily = trendOn(candles, "D");
  const weekly = trendOn(candles, "W");
  const monthly = trendOn(candles, "M");
  const readable = [daily, weekly, monthly].filter((d): d is "up" | "down" => d != null);
  const aligned = readable.length > 0 && readable.every((d) => d === readable[0]);
  const conflicting = readable.length > 1 && !aligned;
  return { daily, weekly, monthly, aligned, conflicting };
}
