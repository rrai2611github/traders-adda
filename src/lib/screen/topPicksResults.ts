import { getResultsDates, daysUntil } from "../market/boardMeetings.ts";
import { istDateKey } from "../market/marketHours.ts";
import { getUniverseSnapshot } from "../market/universeSnapshot.ts";
import { readNiftyTrend } from "../market/niftyTrendServer.ts";
import type { NiftyTrend } from "../market/niftyTrend.ts";
import { movingAverageBreadth } from "./breadth.ts";
import { analysePick, type PickAnalysis } from "./pickAnalysis.ts";
import { scanUniverse } from "./scan.ts";
import { buildTopPicks, type TopPick } from "./topPicks.ts";
import { getWeeklyTop5 } from "./weeklyTop5Results.ts";
import type { Top5Size } from "./weeklyTop5.ts";
import type { NewsNote } from "../ai/newsCheck.ts";

export interface AnalysedPick extends TopPick {
  analysis: PickAnalysis;
  /** Days to the next results announcement, when known. */
  resultsInDays: number | null;
  /** The AI news check's note from the stock's recent NSE announcements; absent when the check is off. */
  news?: NewsNote | null;
}

export interface TopPicksPayload {
  updatedAt: number;
  breadth50: number | null;
  size: Top5Size;
  /** The Nifty 50 against its 200-day average; null when unavailable. */
  nifty: NiftyTrend | null;
  picks: AnalysedPick[];
}

/** The merged Top picks list with its written analysis, from the same scan the dashboard uses; null while the data is loading. */
export async function getTopPicks(mode: "completed" | "live" = "completed"): Promise<TopPicksPayload | null> {
  const snapshot = getUniverseSnapshot();
  if (snapshot.status !== "ready") return null;
  const top5 = getWeeklyTop5(mode);
  if (top5.status !== "ready") return null;
  const scan = scanUniverse(snapshot.snapshot);
  const eligible = scan.metrics.filter((row) => row.passesFloor);
  const breadth50 = movingAverageBreadth(eligible, "vs50").percent;
  const today = istDateKey();
  const [calendar, nifty] = await Promise.all([getResultsDates(today).catch(() => null), readNiftyTrend()]);
  const picks = buildTopPicks(eligible, top5.payload.picks).map((pick): AnalysedPick => {
    const date = calendar?.dates[pick.symbol];
    const resultsInDays = calendar ? (date ? daysUntil(date, today) : null) : null;
    return { ...pick, resultsInDays, analysis: analysePick(pick, { breadth50, resultsInDays: calendar ? resultsInDays : undefined, niftyAbove200: nifty ? nifty.above : undefined, niftyPercent: nifty?.percent }) };
  });
  return { updatedAt: snapshot.snapshot.completedAt, breadth50, size: top5.payload.size, nifty, picks };
}
