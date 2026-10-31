/**
 * Close of the session before the one the live price belongs to. While an Asian market is trading
 * its own candle has no close yet and is dropped, so the last candle is already the prior session;
 * taking the one before it would overstate the move (Kospi read -8.9% instead of -5.5%).
 */
export function priorSessionClose(candles: ReadonlyArray<{ t: number; close: number }>, quoteTime?: number): number | null {
  const last = candles.at(-1);
  if (!last) return null;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  if (quoteTime != null && day(quoteTime) !== day(last.t)) return last.close;
  return candles.at(-2)?.close ?? null;
}
