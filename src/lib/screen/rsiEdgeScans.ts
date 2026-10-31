import type { Candle } from "../market/types.ts";
import { ema, rsi, weeklyCloses } from "./oscillators.ts";

export interface RsiEdgeFacts {
  dailyClose: number;
  dailyOpen: number;
  dailyLow: number;
  previousClose: number;
  previousLow: number;
  dailyChangePercent: number;
  dailyRsi: number;
  dailyRsiTwoSessionsAgo: number;
  dailyPivot: number;
  weeklyPivot: number;
  dailyVolume: number;
  volumeSma9: number;
  closeSma9: number;
  closeEma45: number;
  weeklyClose: number;
  weeklyOpen: number;
  weeklyRsi: number;
  previousWeeklyRsi: number;
  weeklyCloseSma9: number;
  weeklyCloseEma45: number;
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function aggregateWeeks(candles: Candle[]): Candle[] {
  const weeks: Candle[] = [];
  let key: number | null = null;
  for (const candle of candles) {
    const day = Math.floor((candle.t + 19_800_000) / 86_400_000);
    const weekKey = Math.floor((day + 3) / 7);
    if (weekKey !== key) {
      weeks.push({ ...candle });
      key = weekKey;
      continue;
    }
    const week = weeks[weeks.length - 1];
    week.high = Math.max(week.high, candle.high);
    week.low = Math.min(week.low, candle.low);
    week.close = candle.close;
    week.volume += candle.volume;
    week.t = candle.t;
  }
  return weeks;
}

export function measureRsiEdgeFacts(candles: Candle[]): RsiEdgeFacts | null {
  if (candles.length < 60) return null;
  const dailyRsi = rsi(candles.map((candle) => candle.close));
  const dailyEma45 = ema(candles.map((candle) => candle.close), 45);
  const weeks = aggregateWeeks(candles);
  if (weeks.length < 16) return null;
  const weeklyRsiSeries = rsi(weeklyCloses(candles));
  const weeklyEma45 = ema(weeks.map((candle) => candle.close), 45);
  if (weeks.length < 45) return null;

  const i = candles.length - 1;
  const wi = weeks.length - 1;
  const last = candles[i];
  const previous = candles[i - 1];
  const previousWeek = weeks[wi - 1];
  const required = [
    dailyRsi[i],
    dailyRsi[i - 2],
    dailyEma45[i],
    weeklyRsiSeries[wi],
    weeklyRsiSeries[wi - 1],
    weeklyEma45[wi],
  ];
  if (required.some((value) => value == null || !Number.isFinite(value))) return null;

  return {
    dailyClose: last.close,
    dailyOpen: last.open,
    dailyLow: last.low,
    previousClose: previous.close,
    previousLow: previous.low,
    dailyChangePercent: previous.close > 0 ? (last.close / previous.close - 1) * 100 : 0,
    dailyRsi: dailyRsi[i] as number,
    dailyRsiTwoSessionsAgo: dailyRsi[i - 2] as number,
    dailyPivot: (previous.high + previous.low + previous.close) / 3,
    weeklyPivot: (previousWeek.high + previousWeek.low + previousWeek.close) / 3,
    dailyVolume: last.volume,
    volumeSma9: average(candles.slice(-9).map((candle) => candle.volume)),
    closeSma9: average(candles.slice(-9).map((candle) => candle.close)),
    closeEma45: dailyEma45[i] as number,
    weeklyClose: weeks[wi].close,
    weeklyOpen: weeks[wi].open,
    weeklyRsi: weeklyRsiSeries[wi] as number,
    previousWeeklyRsi: weeklyRsiSeries[wi - 1] as number,
    weeklyCloseSma9: average(weeks.slice(-9).map((candle) => candle.close)),
    weeklyCloseEma45: weeklyEma45[wi] as number,
  };
}
