import type { Candle } from "./types.ts";
import { ema, rsi } from "../screen/oscillators.ts";

const HOUR = 3_600_000;
const IST = 19_800_000;
/** NSE hourly bars start at :15 past the hour (09:15 ... 15:15). Yahoo also appends a bar stamped at the quote time; it is not one of them. */
const onBarGrid = (t: number) => (t + IST) % HOUR === 900_000;
/** About two sessions of hourly bars: the range that makes the hourly support and resistance. */
export const HOURLY_RANGE_BARS = 14;
export const HOURLY_MIN_BARS = 30;

export type HourlyTrend = "Constructive" | "Weak" | "Mixed";
export type HourlyPosition = "above" | "below" | "inside";

/** The index's hourly-candle read for the hourly email. Completed hourly bars only. */
export interface HourlyIndexRead {
  /** Start time of the last completed hourly bar. */
  asOf: number;
  close: number;
  trend: HourlyTrend;
  ema20: number | null;
  ema50: number | null;
  aboveEma20: boolean | null;
  rsi14: number | null;
  /** Highest high / lowest low of the previous ~2 sessions of hourly bars (excluding the last bar). */
  resistance: number;
  support: number;
  position: HourlyPosition;
  /** Close-to-close move of the last completed hourly bar, in percent. */
  lastBarPercent: number | null;
  /** Direction of the last three completed hourly closes, oldest first: "up" or "down". */
  lastThree: Array<"up" | "down">;
}

/**
 * Completed hourly bars. While the market is open a bar counts once its full hour
 * has passed; after the close every bar counts, including the short 15:15 bar.
 * Bars off the :15 grid (Yahoo's live quote bar) are dropped.
 */
export function completedHourlyBars(candles: ReadonlyArray<Candle>, now: number, marketLive: boolean): Candle[] {
  return candles
    .filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0) && c.t <= now)
    .filter((c) => onBarGrid(c.t))
    .filter((c) => !marketLive || c.t + HOUR <= now)
    .sort((a, b) => a.t - b.t);
}

/** Null when there are fewer than HOURLY_MIN_BARS completed bars. */
export function hourlyIndexRead(candles: ReadonlyArray<Candle>, now: number, marketLive: boolean): HourlyIndexRead | null {
  const bars = completedHourlyBars(candles, now, marketLive);
  if (bars.length < HOURLY_MIN_BARS) return null;
  const last = bars[bars.length - 1];
  const closes = bars.map((b) => b.close);
  const e20 = ema(closes, 20).at(-1) ?? null;
  const e50 = ema(closes, 50).at(-1) ?? null;
  const rsi14 = rsi(closes, 14).at(-1) ?? null;
  const trend: HourlyTrend = e20 == null || e50 == null
    ? "Mixed"
    : last.close > e20 && e20 > e50 ? "Constructive" : last.close < e20 && e20 < e50 ? "Weak" : "Mixed";
  const range = bars.slice(-HOURLY_RANGE_BARS - 1, -1);
  const resistance = Math.max(...range.map((b) => b.high));
  const support = Math.min(...range.map((b) => b.low));
  const prev = bars[bars.length - 2];
  return {
    asOf: last.t,
    close: last.close,
    trend,
    ema20: e20,
    ema50: e50,
    aboveEma20: e20 == null ? null : last.close > e20,
    rsi14: rsi14 == null ? null : Math.round(rsi14 * 10) / 10,
    resistance,
    support,
    position: last.close > resistance ? "above" : last.close < support ? "below" : "inside",
    lastBarPercent: prev ? (last.close / prev.close - 1) * 100 : null,
    lastThree: bars.slice(-3).map((b, i, a) => {
      const before = i === 0 ? bars[bars.length - 4] : a[i - 1];
      return before && b.close < before.close ? "down" : "up";
    }),
  };
}
