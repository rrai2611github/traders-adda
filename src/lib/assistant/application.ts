import { researchAnswer, type ResearchAnswer, type ResearchIntent, type StockResearch } from "./research.ts";
import { setupStatus } from "../screen/setupGate.ts";
import { PICK_RULES, type TopPick } from "../screen/topPicks.ts";
import type { PerformanceReport } from "../performance/report.ts";

export function radarCandidates(picks: ReadonlyArray<TopPick>): TopPick[] {
  // Preserve the app's ordering; never invent another best-stock scoring system.
  return picks.filter((p) => p.tag !== "extended").slice(0, 6);
}

export function radarAnswer(stocks: StockResearch[], breadth: number | null, now: number, snapshotAt: number, warnings: string[]): ResearchAnswer {
  const answer = researchAnswer("radar", stocks, breadth, now);
  return {
    ...answer, title: "Stocks for your radar",
    summary: warnings.length || stocks.some((s) => s.status.startsWith("Data limited")) ? "Data is limited: these are historical research candidates, not a current shortlist or buy approval." :
      stocks.length ? "Here are the app's current Top Picks/watch candidates to monitor, preserving its existing ordering—not a forecast of the best returns." :
        "No non-extended Top Picks/watch candidates are available in the current scan. Do not force a trade.",
    sections: [
      { title: "How this shortlist was selected", lines: [
        `Shared scan read completed at ${new Date(snapshotAt).toISOString()}. Individual stock sessions are shown on each card.`,
        "Uses the existing Top Picks builder: just-broken-out setups, near-breakout candidates, then its watch candidates. Extended names are omitted.",
        "These are radar ideas, not an instruction to buy. No new scanner thresholds, strategy rankings or probability estimates are introduced.",
        ...warnings,
      ] },
      ...answer.sections,
      { title: "What to do next", lines: [
        setupStatus(breadth).allowed ? "Review the complete trading checklist and fresh execution data before considering an entry." : "Breadth gate is blocked or unavailable: monitor only; no new tested-strategy entries.",
        "Ask 'Analyse SBIN' with a returned symbol, or 'Why these stocks?' to revisit the shortlist's evidence.",
      ] },
    ],
  };
}

export function applicationAnswer(intent: ResearchIntent, now: number, report?: PerformanceReport): ResearchAnswer {
  const answer = researchAnswer(intent, [], null, now);
  const base = { ...answer, sections: [], sources: [{ label: "Performance & reliability", href: "/performance" }, { label: "Today / Top Picks", href: "/" }, { label: "Live strategy check", href: "/positions#strategy-check" }, { label: "Historical backtest", href: "/backtest" }] };
  if (intent === "strategy") return {
    ...base, title: "The application's strategy", summary: "The main tested strategy is Blue Sky + Multi-year Breakouts. This describes existing rules; it does not change them.",
    sections: [
      { title: "Rules", lines: [
        "Breakout signal, next-open entries; breadth50 at least 35%. Nifty200 is informational, not an entry gate.",
        `Main stop: ${PICK_RULES.stopPercent}%; exit on a close below SMA50. Risk 2% per trade; position cap 20%; maximum 10 positions and 3 buys/day.`,
        "The +16%/+24% levels are partial-profit references, not fixed strategy exits.",
      ] },
      { title: "Evidence limitations", lines: ["Historical tests contain today's listed stocks, so survivor bias can overstate results.", "Judge the live strategy check after 30 closed trades. Older scanners and index experiments are separate, unproven frameworks.", "Read the tracker settings for the actual running configuration; this is not a claim that every paper engine uses identical rules."] },
    ],
  };
  if (intent === "features") return {
    ...base, title: "What I can explain about this application", summary: "Ask normally about the app's research and operations. I retrieve approved data readers, not source code or arbitrary files.",
    sections: [{ title: "Supported questions", lines: [
      "Which stocks should I keep on my radar? — existing Top Picks/watch candidates and evidence.",
      "How is the market? — breadth, gate and scan coverage. Analyse SBIN / compare SBIN and ICICIBANK — stock facts.",
      "Which strategy do we use? How are the paper results? Why is Fyers/email/paper trading not working? — existing rules, result records and reported status.",
      "Scanners discover setups; ratings are check scores, not win probabilities. Use Core Setups, Monthly Setups and older scanners as separately labelled research.",
    ] }, { title: "Limitations", lines: ["This is a local intent-based chatbot, not an unrestricted language model. Unknown questions are explicitly rejected.", "No news, fundamentals, private holdings, credentials, order actions, settings changes or external AI calls. Selected stocks and the last app topic support follow-ups only in page memory."] }],
  };
  if (!report) throw new Error("Application report required for results or operations.");
  const money = (n: number | null) => n == null ? "Not available" : `INR ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return {
    ...base, title: intent === "performance" ? "Application results" : "Application status",
    summary: intent === "performance" ? "These are separate tracker/paper/straddle results, not one combined account or a best-strategy ranking. The historical 10-year backtest is a separate linked tool, not included in these figures." :
      `Market: ${report.market}. These are reported statuses, not independent uptime or delivery verification.`,
    sections: [
      ...(intent === "performance" ? report.cards.filter((c) => c.evidence !== "Manually recorded").map((c) => ({
        title: c.title, lines: [`Evidence: ${c.evidence}. ${c.closed} closed ${c.unit}, ${c.open} open.`,
          `Starting capital: ${money(c.capital)}; closed P&L: ${money(c.closedPnl)}; total P&L: ${money(c.totalPnl)}.`,
          `Closed win rate: ${c.winRate == null ? "Not available" : `${c.winRate.toFixed(1)}%`}. Source time: ${typeof c.asOf === "number" ? new Date(c.asOf).toISOString() : c.asOf ?? "not recorded"}.`, c.note],
      })) : []),
      { title: "Reported system checks", lines: report.checks.map((c) => `${c.title}: ${c.state}. ${c.detail} Last event: ${c.lastAt ? new Date(c.lastAt).toISOString() : "not recorded"}.`) },
      ...(report.errors.length ? [{ title: "Source failures", lines: report.errors.map((e) => `${e.source}: ${e.message}. This source may be missing; no result is invented.`) }] : []),
      { title: "Safety / interpretation", lines: ["SMTP acceptance does not prove inbox delivery; fetch timestamps do not prove exchange tick freshness.", "This answer sends no emails or orders and changes no settings. Private manually recorded positions are not read for chatbot answers."] },
    ],
  };
}
