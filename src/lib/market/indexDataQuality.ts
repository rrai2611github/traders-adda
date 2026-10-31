import type { Candle } from "./types.ts";
import { isTradingDay, istDateKey } from "./marketHours.ts";

export function isIndexContextCacheFresh(cachedAt: number, cachedBreadth: number | null, currentBreadth: number | null, now: number): boolean {
  return cachedBreadth === currentBreadth && now - cachedAt >= 0 && now - cachedAt < 60_000;
}

export function expectedIndexSession(mode: "completed" | "live", now: number): string {
  const clock = new Date(now + 19_800_000);
  const minutes = clock.getUTCHours() * 60 + clock.getUTCMinutes();
  let time = now;
  if (minutes < (mode === "completed" ? 930 : 555)) time -= 86_400_000;
  while (!isTradingDay(time)) time -= 86_400_000;
  return istDateKey(time);
}

export function indexHistoryIssue(bars: Candle[], now: number): string | null {
  let previousDay = "";
  for (const bar of bars) {
    if (![bar.t, new Date(bar.t).getTime(), bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) ||
      Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 ||
      bar.high < Math.max(bar.open, bar.close, bar.low) ||
      bar.low > Math.min(bar.open, bar.close)) return "Invalid daily OHLC data.";
    const day = istDateKey(bar.t);
    if (day > istDateKey(now)) return "Future-dated daily candle.";
    if (day <= previousDay) return "Duplicate or unordered daily sessions.";
    previousDay = day;
  }
  return null;
}
