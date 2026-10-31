import type { Candle } from "../market/types.ts";
import { aggregateCandles } from "../chart/aggregate.ts";
import { istDateKey } from "../market/marketHours.ts";
import { isMonthlyRegularSession } from "../market/monthlyCalendar.ts";
import { indexHistoryIssue } from "../market/indexDataQuality.ts";
import type { DataHealth } from "../market/historyQuality.ts";
import { adx } from "./oscillators.ts";

const IST = 19_800_000;
const DAY = 86_400_000;

export interface MonthlySetup {
  signalMonth: string;
  completedMonths: number;
  close: number;
  breakout: { level: number; distancePercent: number; volumeRatio: number | null } | null;
  compression: { motherMonth: string; high: number; low: number; insideMonths: number; upsideProjection: number; downsideProjection: number | null } | null;
  dmi: { plusDi: number | null; minusDi: number | null; adx: number | null };
  provisional: { month: string; asOf: string; close: number; aboveBreakout: boolean; rangePosition: "Above" | "Below" | "Inside" | null } | null;
}

export interface MonthlySetupResult {
  setup: MonthlySetup | null;
  issue: string | null;
}

function monthBounds(month: string): { first: string; last: string; closeAt: number } {
  const [year, number] = month.split("-").map(Number);
  let first = Date.UTC(year, number - 1, 1, 12) - IST;
  let last = Date.UTC(year, number, 0, 12) - IST;
  while (!isMonthlyRegularSession(first)) first += DAY;
  while (!isMonthlyRegularSession(last)) last -= DAY;
  return { first: istDateKey(first), last: istDateKey(last), closeAt: last + 210 * 60_000 };
}

const monthKey = (bar: Candle) => istDateKey(bar.t).slice(0, 7);
const monthNumber = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return year * 12 + number - 1;
};

export function latestCompletedMonth(now: number): string {
  const current = istDateKey(now).slice(0, 7);
  if (monthBounds(current).closeAt <= now) return current;
  const date = new Date(now + IST);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

export function measureMonthlySetups(history: Candle[], now: number, mergedQuoteAt?: number): MonthlySetupResult {
  const invalid = indexHistoryIssue(history, now);
  if (invalid) return { setup: null, issue: invalid };
  if (history.some((bar) => !Number.isFinite(bar.volume) || bar.volume < 0)) {
    return { setup: null, issue: "Invalid daily volume." };
  }
  if (mergedQuoteAt != null && (!Number.isFinite(mergedQuoteAt) || mergedQuoteAt > now)) {
    return { setup: null, issue: "Invalid or future-dated merged quote." };
  }
  const daily = history.filter((bar) => bar.t <= now);
  const expected = latestCompletedMonth(now);
  const finalSession = monthBounds(expected);
  if (mergedQuoteAt != null && istDateKey(mergedQuoteAt) === finalSession.last && mergedQuoteAt < finalSession.closeAt) {
    return { setup: null, issue: "Final-month session quote is still pre-close; completed monthly OHLC is unverified." };
  }
  const grouped = new Map<string, Candle[]>();
  for (const bar of daily) {
    const key = monthKey(bar);
    const group = grouped.get(key) ?? [];
    group.push(bar);
    grouped.set(key, group);
  }
  const keys = [...grouped.keys()].filter((key) => key <= expected);
  if (!keys.length) return { setup: null, issue: "No completed monthly history." };
  const first = grouped.get(keys[0])!;
  if (istDateKey(first[0].t) > monthBounds(keys[0]).first) keys.shift();
  if (!keys.length || keys.at(-1) !== expected) {
    return { setup: null, issue: `Latest completed month ${expected} is unavailable.` };
  }
  for (let i = 0; i < keys.length; i++) {
    const bars = grouped.get(keys[i])!;
    const bounds = monthBounds(keys[i]);
    if (istDateKey(bars[0].t) > bounds.first || istDateKey(bars.at(-1)!.t) < bounds.last ||
      (i > 0 && monthNumber(keys[i]) !== monthNumber(keys[i - 1]) + 1)) {
      return { setup: null, issue: `Incomplete monthly boundaries or missing month near ${keys[i]}.` };
    }
  }
  const months = aggregateCandles(keys.flatMap((key) => grouped.get(key)!), "M");
  if (months.length < 13) return { setup: null, issue: "At least 13 consecutive complete months are required." };
  const last = months.at(-1)!;
  const prior = months.slice(-13, -1);
  const level = Math.max(...prior.map((bar) => bar.high));
  const averageVolume = prior.reduce((sum, bar) => sum + bar.volume, 0) / 12;
  const breakout = last.close > level
    ? { level, distancePercent: (last.close / level - 1) * 100, volumeRatio: averageVolume > 0 ? last.volume / averageVolume : null }
    : null;
  let compression: MonthlySetup["compression"] = null;
  // Prefer the most recent mother candle whose following completed months stay inside.
  for (let i = months.length - 3; i >= 0; i--) {
    const mother = months[i];
    const inside = months.slice(i + 1);
    if (mother.high > mother.low && inside.every((bar) => bar.high <= mother.high && bar.low >= mother.low)) {
      const range = mother.high - mother.low;
      compression = {
        motherMonth: keys[i], high: mother.high, low: mother.low, insideMonths: inside.length,
        upsideProjection: mother.high + range,
        downsideProjection: mother.low - range > 0 ? mother.low - range : null,
      };
      break;
    }
  }
  const dmi = adx(months);
  const liveKey = istDateKey(now).slice(0, 7);
  const live = liveKey > expected ? aggregateCandles(grouped.get(liveKey) ?? [], "M").at(-1) : undefined;
  return {
    issue: null,
    setup: {
      signalMonth: expected, completedMonths: months.length, close: last.close, breakout, compression,
      dmi: { plusDi: dmi.plusDi.at(-1) ?? null, minusDi: dmi.minusDi.at(-1) ?? null, adx: dmi.adx.at(-1) ?? null },
      provisional: live ? {
        month: liveKey, asOf: istDateKey((grouped.get(liveKey)!).at(-1)!.t), close: live.close,
        aboveBreakout: live.close > Math.max(...months.slice(-12).map((bar) => bar.high)),
        rangePosition: compression ? live.close > compression.high ? "Above" : live.close < compression.low ? "Below" : "Inside" : null,
      } : null,
    },
  };
}

export interface MonthlySetupRow {
  symbol: string;
  name: string;
  turnoverCr: number;
  rs: number | null;
  setup: MonthlySetup;
}

export interface MonthlySetupsPayload extends DataHealth {
  updatedAt: number;
  signalMonth: string;
  source: { id: string; label: string; isRealtime: boolean };
  eligible: number;
  analyzed: number;
  unavailable: string[];
  issues: { symbol: string; reason: string }[];
  rows: MonthlySetupRow[];
}
