import type { Candle } from "./types.ts";
import { buildIndexBreadth, type IndexBreadth } from "./indexAnalysis.ts";
import { istDateKey } from "./marketHours.ts";
import { indexHistoryIssue } from "./indexDataQuality.ts";

export interface IndexParticipation {
  current: IndexBreadth;
  asOf: string;
  comparisonDate: string | null;
  comparisonCoverage: number;
  change50pp: number | null;
  direction: "Improving" | "Deteriorating" | "Stable" | "Unavailable";
}

/** Five index sessions, not calendar days; both measurements use the same eligible constituents. */
export function buildIndexParticipation(histories: Map<string, Candle[]>, members: string[], indexBars: Candle[]): IndexParticipation | null {
  const latest = indexBars.at(-1);
  if (!latest) return null;
  const currentDay = istDateKey(latest.t);
  const priorDay = indexBars.at(-6) ? istDateKey(indexBars.at(-6)!.t) : null;
  const current = new Map<string, Candle[]>();
  const commonNow = new Map<string, Candle[]>();
  const commonBefore = new Map<string, Candle[]>();
  for (const symbol of members) {
    const history = histories.get(symbol)?.filter((c) => istDateKey(c.t) <= currentDay);
    if (!history?.length || istDateKey(history.at(-1)!.t) !== currentDay) continue;
    if (indexHistoryIssue(history, latest.t)) continue;
    current.set(symbol, history);
    const before = priorDay ? history.filter((c) => istDateKey(c.t) <= priorDay) : [];
    if (before.length >= 50 && istDateKey(before.at(-1)!.t) === priorDay) {
      commonNow.set(symbol, history);
      commonBefore.set(symbol, before);
    }
  }
  const currentBreadth = buildIndexBreadth(current, members);
  const a = buildIndexBreadth(commonNow, members);
  const b = buildIndexBreadth(commonBefore, members);
  // A direction from a small or changing sample is misleading.
  const enough = a.coverage50 >= Math.ceil(members.length * 0.8);
  const change = enough && a.above50 != null && b.above50 != null ? a.above50 - b.above50 : null;
  return {
    current: currentBreadth, asOf: currentDay, comparisonDate: priorDay,
    comparisonCoverage: a.coverage50, change50pp: change,
    direction: change == null ? "Unavailable" : change > 0.5 ? "Improving" : change < -0.5 ? "Deteriorating" : "Stable",
  };
}
