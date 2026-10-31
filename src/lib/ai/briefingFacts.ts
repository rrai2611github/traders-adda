import type { BriefingFacts } from "./briefing.ts";
import { setupStatus } from "../screen/setupGate.ts";

/** What the facts block needs of an analysed pick (the full AnalysedPick satisfies it). */
interface FactPick {
  symbol: string;
  tag: "ready" | "broke" | "watch" | "extended";
  ext: number | null;
  resultsInDays?: number | null;
  news?: { flag: "clear" | "watch" | "caution"; note: string } | null;
  analysis: { status: string };
}

export interface FactsInput {
  date: string;
  outlook: { label: string; score: number; conviction: string; gift?: { gapPercent: number } | null } | null;
  topPicks: { breadth50: number | null; nifty: { above: boolean; percent: number } | null; picks: ReadonlyArray<FactPick> } | null;
}

/** A small, plain block of facts for the daily briefing: the setup check, the outlook, and the stocks on the tested setup. */
export function buildBriefingFacts(input: FactsInput): BriefingFacts {
  const picks = input.topPicks?.picks ?? [];
  const gate = setupStatus(input.topPicks?.breadth50 ?? null, input.topPicks?.nifty ?? null);
  return {
    date: input.date,
    outlook: input.outlook ? { label: input.outlook.label, score: input.outlook.score, conviction: input.outlook.conviction } : null,
    giftGapPercent: input.outlook?.gift ? Math.round(input.outlook.gift.gapPercent * 100) / 100 : null,
    breadth50: input.topPicks?.breadth50 != null ? Math.round(input.topPicks.breadth50) : null,
    nifty: input.topPicks?.nifty ? { above: input.topPicks.nifty.above, percent: Math.round(input.topPicks.nifty.percent * 10) / 10 } : null,
    setupAllowed: gate.allowed,
    setupReason: gate.reason,
    candidates: picks
      .filter((p) => p.tag === "ready" || p.tag === "broke")
      .slice(0, 6)
      .map((p) => ({ symbol: p.symbol, status: p.analysis.status, ext: p.ext != null ? Math.round(p.ext * 10) / 10 : null, resultsInDays: p.resultsInDays ?? null, news: p.news && p.news.flag !== "clear" ? p.news.note : null })),
    waiting: picks.filter((p) => p.tag === "watch" || p.tag === "extended").slice(0, 5).map((p) => p.symbol),
  };
}
