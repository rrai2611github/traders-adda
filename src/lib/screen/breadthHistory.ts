import { regimeKeyFor, type RegimeKey } from "./commandCenter.ts";

export const BREADTH_WINDOWS = [10, 20, 50, 200] as const;
export type BreadthWindow = (typeof BREADTH_WINDOWS)[number];

/** Above this share the market is stretched, below the other it is washed out. */
export const OVERBOUGHT_PERCENT = 80;
export const OVERSOLD_PERCENT = 20;

export interface BreadthDay {
  /** IST day number (days since 1970-01-01). */
  day: number;
  /** Share of covered stocks closing above each moving average, 0-100, or null with too few stocks. */
  above: Record<BreadthWindow, number | null>;
  advancing: number;
  declining: number;
  covered: number;
}

export interface MarketMode {
  key: RegimeKey;
  label: "Risk-on" | "Selective" | "Risk-off";
  size: string;
  note: string;
}

interface Bar { day: number; close: number }

/** Fewer covered stocks than this on a day and the percentage is withheld rather than guessed. */
const MIN_COVERED = 50;

/**
 * Share of stocks above their 10/20/50/200-day simple average, and advance/decline, for each of the last
 * `sessions` trading days, measured on the same candles the screens use. A stock counts on a day only when it
 * has a full window of closes up to that day.
 */
export function breadthSeries(bars: ReadonlyArray<ReadonlyArray<Bar>>, sessions = 130): BreadthDay[] {
  const perDay = new Map<number, number>();
  for (const series of bars) for (const bar of series) perDay.set(bar.day, (perDay.get(bar.day) ?? 0) + 1);
  const peak = Math.max(0, ...perDay.values());
  // A day with a handful of stocks (a partial feed) is not a session for breadth.
  const days = [...perDay].filter(([, count]) => count >= peak * 0.5).map(([day]) => day).sort((a, b) => a - b).slice(-sessions);
  const index = new Map(days.map((day, i) => [day, i]));
  const tally = days.map(() => ({
    above: { 10: 0, 20: 0, 50: 0, 200: 0 } as Record<BreadthWindow, number>,
    eligible: { 10: 0, 20: 0, 50: 0, 200: 0 } as Record<BreadthWindow, number>,
    advancing: 0, declining: 0, covered: 0,
  }));

  for (const series of bars) {
    const prefix = new Array<number>(series.length + 1).fill(0);
    for (let i = 0; i < series.length; i += 1) prefix[i + 1] = prefix[i] + series[i].close;
    for (let i = 0; i < series.length; i += 1) {
      const slot = index.get(series[i].day);
      if (slot == null) continue;
      const t = tally[slot];
      t.covered += 1;
      if (i > 0) {
        if (series[i].close > series[i - 1].close) t.advancing += 1;
        else if (series[i].close < series[i - 1].close) t.declining += 1;
      }
      for (const w of BREADTH_WINDOWS) {
        if (i + 1 < w) continue;
        t.eligible[w] += 1;
        if (series[i].close > (prefix[i + 1] - prefix[i + 1 - w]) / w) t.above[w] += 1;
      }
    }
  }

  return days.map((day, i) => {
    const t = tally[i];
    const pct = (w: BreadthWindow) => (t.eligible[w] >= MIN_COVERED ? Math.round((t.above[w] / t.eligible[w]) * 1000) / 10 : null);
    return {
      day,
      above: { 10: pct(10), 20: pct(20), 50: pct(50), 200: pct(200) },
      advancing: t.advancing,
      declining: t.declining,
      covered: t.covered,
    };
  });
}

/** Same thresholds as the Buy ready gate (`marketRegime`), plus what that means for position size. */
export function marketMode(above50: number | null, above200: number | null): MarketMode {
  const key = regimeKeyFor(above50 == null ? null : Math.round(above50), above200 == null ? null : Math.round(above200));
  if (key === "risk-on") return { key, label: "Risk-on", size: "Normal size", note: "Broad participation: breakouts have the best follow-through." };
  if (key === "risk-off") return { key, label: "Risk-off", size: "No new longs", note: "Most stocks are below their averages: protect capital, keep a watchlist." };
  return { key, label: "Selective", size: "Reduce size", note: "Participation is narrow: favour leaders and cut size on marginal setups." };
}

/** Extremes of the 50-day reading, where the thread's rule ("when breadth is weak, trade smaller") bites hardest. */
export function breadthExtreme(above50: number | null): "overbought" | "oversold" | null {
  if (above50 == null) return null;
  if (above50 >= OVERBOUGHT_PERCENT) return "overbought";
  if (above50 <= OVERSOLD_PERCENT) return "oversold";
  return null;
}
