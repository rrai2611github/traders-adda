/**
 * Is the Nifty 50 above its 200-day average? In the 10-year backtest, buying breakouts only while it was cut total losses by about a
 * third (scripts/backtest-defence.mjs). Pure: the caller supplies the daily closes, oldest first.
 */
export interface NiftyTrend {
  close: number;
  sma200: number;
  /** Percent the close is above (positive) or below (negative) its 200-day average. */
  percent: number;
  above: boolean;
  /** Date of the last close used, YYYY-MM-DD (IST). */
  asOf: string | null;
}

export function niftyTrend(candles: ReadonlyArray<{ t: number; close: number }>, days = 200): NiftyTrend | null {
  if (candles.length < days) return null;
  const last = candles[candles.length - 1];
  if (!(last.close > 0)) return null;
  let sum = 0;
  for (let i = candles.length - days; i < candles.length; i += 1) sum += candles[i].close;
  const sma200 = sum / days;
  return {
    close: last.close,
    sma200,
    percent: (last.close / sma200 - 1) * 100,
    above: last.close > sma200,
    asOf: new Date(last.t + 19_800_000).toISOString().slice(0, 10),
  };
}
