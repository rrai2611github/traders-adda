import { getDailyCandles } from "./engine.ts";
import { niftyTrend, type NiftyTrend } from "./niftyTrend.ts";

const TTL_MS = 5 * 60_000;
let cache: { at: number; trend: NiftyTrend } | null = null;

/** The Nifty 50 against its 200-day average, read from daily candles and cached five minutes; null when the history is unavailable. */
export async function readNiftyTrend(): Promise<NiftyTrend | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.trend;
  try {
    const trend = niftyTrend(await getDailyCandles("NIFTY50", 320));
    if (trend) cache = { at: Date.now(), trend };
    return trend ?? cache?.trend ?? null;
  } catch (error) {
    console.error("[nifty-trend] Failed:", error instanceof Error ? error.message : error);
    return cache?.trend ?? null;
  }
}
