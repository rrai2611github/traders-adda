import type { Candle } from "@/lib/market/types";
import { inStage2Trend, measureStage2Base } from "./stage2Bases.ts";

/**
 * What changed on the latest session, stock by stock: a state a stock was in yesterday and is not today, or the reverse.
 * Every event is a plain, checkable fact recomputed from candles for both sessions; there is no composite score, and no
 * claim that any event predicts returns.
 */
export const DAILY_CHANGE_RULES = {
  short: 50,
  long: 200,
  highSessions: 252,
  /** Candles needed to judge Stage 2 on the previous session (200-day average 20 sessions earlier, plus one). */
  minCandles: 222,
} as const;

export type ChangeKind =
  | "enteredStage2" | "leftStage2"
  | "above50" | "below50"
  | "above200" | "below200"
  | "baseBreakout" | "baseFailed"
  | "newHigh";

export interface ChangeGroup { kind: ChangeKind; direction: "gain" | "loss"; label: string; detail: string }

export const CHANGE_GROUPS: ChangeGroup[] = [
  { kind: "enteredStage2", direction: "gain", label: "Entered Stage 2", detail: "Close above the 50-day average, the 50 above the 200, and the 200 rising: true today, not yesterday." },
  { kind: "leftStage2", direction: "loss", label: "Left Stage 2", detail: "In a Stage 2 uptrend yesterday, not today." },
  { kind: "baseBreakout", direction: "gain", label: "New base breakout", detail: "Closed above a Stage 2 base high of 20+ sessions today; did not yesterday." },
  { kind: "baseFailed", direction: "loss", label: "Breakout failed", detail: "Was a base breakout yesterday and closed back at or under that base high today." },
  { kind: "above50", direction: "gain", label: "Crossed above 50-day", detail: "Closed above its 50-day average today after closing at or below it yesterday." },
  { kind: "below50", direction: "loss", label: "Crossed below 50-day", detail: "Closed below its 50-day average today after closing at or above it yesterday." },
  { kind: "above200", direction: "gain", label: "Crossed above 200-day", detail: "Closed above its 200-day average today after closing at or below it yesterday." },
  { kind: "below200", direction: "loss", label: "Crossed below 200-day", detail: "Closed below its 200-day average today after closing at or above it yesterday." },
  { kind: "newHigh", direction: "gain", label: "New 52-week closing high", detail: "Closed above the highest high of the previous 252 sessions." },
];

export interface ChangeRow {
  symbol: string;
  name: string;
  sector: string | null;
  close: number;
  dayChangePercent: number | null;
  rs: number | null;
  turnoverCr: number | null;
  kinds: ChangeKind[];
}

function average(candles: ReadonlyArray<Candle>, end: number, length: number): number | null {
  if (end + 1 < length) return null;
  let sum = 0;
  for (let k = end - length + 1; k <= end; k++) sum += candles[k].close;
  return sum / length;
}

/**
 * `candles` must be completed sessions only, oldest first. Returns the events that happened on the last one, or an
 * empty list when there is not enough history to judge both sessions.
 */
export function measureDailyChange(candles: ReadonlyArray<Candle>): ChangeKind[] {
  const R = DAILY_CHANGE_RULES;
  const i = candles.length - 1;
  if (i + 1 < R.minCandles) return [];
  const today = candles[i].close;
  const yesterday = candles[i - 1].close;
  const kinds: ChangeKind[] = [];

  const before = candles.slice(0, -1);
  const stage2Now = inStage2Trend(candles);
  const stage2Before = inStage2Trend(before);
  if (stage2Now && !stage2Before) kinds.push("enteredStage2");
  if (!stage2Now && stage2Before) kinds.push("leftStage2");

  const baseNow = measureStage2Base(candles);
  const baseBefore = measureStage2Base(before);
  const breakoutNow = baseNow?.kind === "breakout";
  const breakoutBefore = baseBefore?.kind === "breakout";
  if (breakoutNow && !breakoutBefore) kinds.push("baseBreakout");
  // Failed means back at or under the base high it broke out of. A stock that keeps rising the next day starts a new,
  // young base (so it is no longer measured as a breakout) but has not failed.
  if (breakoutBefore && baseBefore && today <= baseBefore.baseHigh) kinds.push("baseFailed");

  for (const [length, up, down] of [[R.short, "above50", "below50"], [R.long, "above200", "below200"]] as const) {
    const nowAvg = average(candles, i, length);
    const beforeAvg = average(candles, i - 1, length);
    if (nowAvg == null || beforeAvg == null) continue;
    if (today > nowAvg && yesterday <= beforeAvg) kinds.push(up);
    if (today < nowAvg && yesterday >= beforeAvg) kinds.push(down);
  }

  if (i >= R.highSessions) {
    let high = -Infinity;
    for (let k = i - R.highSessions; k < i; k++) high = Math.max(high, candles[k].high);
    if (today > high) kinds.push("newHigh");
  }
  return kinds;
}

export interface ChangeSummary {
  counts: Record<ChangeKind, number>;
  /** Stocks that entered Stage 2 minus stocks that left it. */
  netStage2: number;
}

export function summarizeChanges(rows: ReadonlyArray<Pick<ChangeRow, "kinds">>): ChangeSummary {
  const counts = Object.fromEntries(CHANGE_GROUPS.map((g) => [g.kind, 0])) as Record<ChangeKind, number>;
  for (const row of rows) for (const kind of row.kinds) counts[kind] += 1;
  return { counts, netStage2: counts.enteredStage2 - counts.leftStage2 };
}

/** One sentence that reads the day, from the counts. */
export function changeSentence(summary: ChangeSummary, scored: number): string {
  const { counts, netStage2 } = summary;
  const parts: string[] = [];
  if (counts.enteredStage2 || counts.leftStage2) {
    parts.push(`${counts.enteredStage2} stock${counts.enteredStage2 === 1 ? "" : "s"} entered Stage 2 and ${counts.leftStage2} left it (${netStage2 > 0 ? "+" : netStage2 < 0 ? "−" : "±"}${Math.abs(netStage2)} net)`);
  } else parts.push("No stock entered or left Stage 2");
  parts.push(`${counts.baseBreakout} new base breakout${counts.baseBreakout === 1 ? "" : "s"} and ${counts.baseFailed} failed`);
  parts.push(`${counts.above50} crossed above the 50-day and ${counts.below50} below`);
  return `${parts.join("; ")}, of ${scored.toLocaleString("en-IN")} scored.`;
}

export function groupRows(rows: ReadonlyArray<ChangeRow>, kind: ChangeKind): ChangeRow[] {
  return rows.filter((row) => row.kinds.includes(kind)).sort((a, b) => (b.rs ?? -1) - (a.rs ?? -1) || a.symbol.localeCompare(b.symbol));
}

/** How many stocks in each sector had this event, most first (sectors with a name only). */
export function sectorTally(rows: ReadonlyArray<ChangeRow>, kind: ChangeKind): { sector: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const row of groupRows(rows, kind)) if (row.sector) tally.set(row.sector, (tally.get(row.sector) ?? 0) + 1);
  return [...tally].map(([sector, count]) => ({ sector, count })).sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
}
