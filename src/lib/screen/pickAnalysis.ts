import { buildChecklist, type CheckItem } from "./checklist.ts";
import { SETUP_BREADTH_MIN, setupStatus } from "./setupGate.ts";
import type { TopPick } from "./topPicks.ts";

/**
 * The written analysis of one pick, in plain words, for the dashboard card and the email: whether to act, why the stock is on the
 * list, what to watch out for, and the plan with an example position size. Built from the same rules as the trade checklist.
 */
export type PickVerdict = "buy" | "paper" | "wait" | "skip";

export interface PickAnalysis {
  verdict: PickVerdict;
  /** The one status shown for the stock: it combines the setup and what to do about it. */
  status: string;
  /** One sentence: what to do. */
  headline: string;
  why: string[];
  watchOut: string[];
  plan: {
    buy: number;
    stop: number;
    stopPercent: number;
    exit: string;
    /** The tighter alternative: an 8% stop, which allows a bigger position but is stopped out more often. */
    tighter: { stop: number; percent: number; note: string };
    /** Optional places to book part profit, with how often the history reached them. */
    targets: { t1: number; t1Percent: number; t2: number; t2Percent: number; note: string } | null;
    example: { capital: number; riskPercent: number; quantity: number; invested: number; maxLoss: number } | null;
  } | null;
  checklist: CheckItem[];
  /** Short positives for a compact view, at most three. */
  chips: string[];
  /** Short cautions for a compact view; the market note is left out because it is shown once for the whole list. */
  flags: string[];
}

export interface AnalysisContext {
  /** Share of liquid stocks above their 50-day average. */
  breadth50: number | null;
  /** Days to the next results announcement; null when none is announced; undefined when the calendar is unavailable. */
  resultsInDays?: number | null;
  /** The Nifty 50 closes above its 200-day average (null when unknown, undefined when not loaded), and how far above or below. */
  niftyAbove200?: boolean | null;
  niftyPercent?: number | null;
  /** Capital for the example position; default ₹5,00,000. */
  capital?: number;
}

export const EXAMPLE_CAPITAL = 500_000;

/** One word-or-two status: what to do, which already says where the stock is in its setup. */
export function statusLabel(verdict: PickVerdict, tag: TopPick["tag"]): string {
  if (verdict === "buy") return tag === "broke" ? "Buy now" : "Buy on breakout";
  if (verdict === "paper") return "Paper trade";
  if (verdict === "skip") return "Don't chase";
  return "Wait";
}

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 0 : 2 })}`;

export function analysePick(pick: TopPick, ctx: AnalysisContext): PickAnalysis {
  const v = pick.values;
  const why: string[] = [];
  const watchOut: string[] = [];
  const checklist = v
    ? buildChecklist({ breadth50: ctx.breadth50, values: v, stopPercent: null, resultsInDays: ctx.resultsInDays, niftyAbove200: ctx.niftyAbove200, niftyPercent: ctx.niftyPercent })
    : null;

  why.push(`RS ${Math.round(pick.rs)}: stronger than ${Math.round(pick.rs)}% of NSE stocks over the past year.`);
  if (v) {
    if (v.vs50 != null && v.vs200 != null && v.vs50 > 0 && v.vs200 > 0) why.push(`In an uptrend: ${v.vs50.toFixed(0)}% above its 50-day average and ${v.vs200.toFixed(0)}% above its 200-day average.`);
    if (v.fromHigh != null) why.push(`${Math.abs(v.fromHigh).toFixed(1)}% below its 52-week high, so there is little overhead resistance.`);
    if (v.turnoverCr != null && v.turnoverCr >= 5) why.push(`Trades about ₹${v.turnoverCr.toFixed(0)} Cr a day, so it is easy to buy and sell.`);
  }
  if (pick.tag === "ready" && pick.ext != null) why.unshift(`${Math.abs(pick.ext).toFixed(1)}% under its breakout level${pick.pivotPrice != null ? ` of ${inr(pick.pivotPrice)}` : ""}: it is coiled just below the ceiling, and a close above it is the buy signal.`);
  if (pick.tag === "broke" && pick.ext != null) why.unshift(`Just broke out: ${pick.ext.toFixed(1)}% above its breakout level${pick.pivotPrice != null ? ` of ${inr(pick.pivotPrice)}` : ""}.`);
  if (pick.quiet && v?.dry != null) why.push(`Volume has dried up to ${v.dry.toFixed(2)}× normal: sellers have gone quiet, which often comes before a move.`);
  if (checklist && !checklist.screens.length && (pick.tag === "ready" || pick.tag === "broke")) why.push("Not on one of the four screens, but it meets the near-breakout rule that was tested on its own.");
  if (checklist?.screens.length) why.push(`Passes the ${checklist.screens.join(" and ")} screen${checklist.screens.length > 1 ? "s" : ""}.`);

  const breadth = ctx.breadth50;
  const niftyBelow = ctx.niftyAbove200 === false;
  const gate = setupStatus(breadth);
  const weak = gate.breadthOk === false;
  if (gate.breadthOk === false) watchOut.push(`The market check is not passed: only ${Math.round(breadth ?? 0)}% of stocks are above their 50-day average, and the tested setup needs ${SETUP_BREADTH_MIN}%.`);
  if (niftyBelow) watchOut.push(`The Nifty 50 is ${ctx.niftyPercent != null ? `${Math.abs(ctx.niftyPercent).toFixed(1)}% ` : ""}under its 200-day average. That is not part of the rule (the tests did not support it as a filter), but a falling market makes breakouts harder.`);
  const days = ctx.resultsInDays;
  if (days != null && days <= 14) watchOut.push(`Results ${days === 0 ? "are today" : `in ${days} day${days === 1 ? "" : "s"}`}: the price can gap through the stop. ${days <= 5 ? "Wait until they are out." : "Wait, or buy fewer shares."}`);
  if (pick.tag === "ready" && v?.dry != null && v.dry > 0.9) watchOut.push(`Volume has not dried up yet (${v.dry.toFixed(2)}× normal), so the base is not fully quiet.`);
  if (pick.tag === "extended" && pick.ext != null) watchOut.push(`Already ${pick.ext.toFixed(0)}% past its breakout level. Buying now means a late entry with a big drop to any sensible stop. Wait for a pullback.`);
  if (pick.tag === "watch") watchOut.push("It does not meet every buy rule yet (level, trend, volume or liquidity). Keep it on the watchlist.");
  if (checklist) {
    for (const item of checklist.items) {
      if (["market", "nifty", "results", "extended"].includes(item.key) || item.state === "pass" || item.state === "na") continue;
      if (item.key === "stop" || item.key === "setup") continue;
      watchOut.push(`${item.label}: ${item.detail}`);
    }
  }
  if (days === null && (pick.tag === "ready" || pick.tag === "broke")) watchOut.push("No results date is announced yet; check before buying.");

  const buyable = pick.tag === "ready" || pick.tag === "broke";
  const resultsSoon = days != null && days <= 5;
  const failed = (checklist?.items ?? []).filter((i) => i.state === "fail" && ["setup", "rs", "trend", "liquidity", "extended"].includes(i.key));
  const hardFail = failed.length > 0;
  let verdict: PickVerdict;
  let headline: string;
  if (pick.tag === "extended") {
    verdict = "skip";
    headline = "Do not chase: it has already run. Wait for a pullback.";
  } else if (!buyable || hardFail) {
    verdict = "wait";
    headline = failed.length ? `Not buyable yet: ${failed.map((i) => i.label.replace(/^On a /, "not on a ").replace(/^Strong versus the market.*/, "not strong enough").replace(/^Uptrend.*/, "not in a clean uptrend").replace(/^Easy to buy and sell.*/, "too thin to trade")).join("; ")}.` : "Not buyable yet: keep it on the watchlist.";
  } else if (resultsSoon) {
    verdict = "wait";
    headline = `Wait: results are ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}. Decide after they are out.`;
  } else if (weak) {
    verdict = "paper";
    headline = "Good setup, but the market is weak: paper trade only.";
  } else {
    verdict = "buy";
    headline = pick.tag === "ready"
      ? `Buy plan ready: buy on a close above ${inr(pick.buy ?? pick.price)}, stop ${inr(pick.stop ?? 0)}.`
      : `Buy plan ready: it just broke out. Buy near ${inr(pick.buy ?? pick.price)}, stop ${inr(pick.stop ?? 0)}.`;
  }

  let plan: PickAnalysis["plan"] = null;
  if (buyable && pick.buy != null && pick.stop != null) {
    const capital = ctx.capital ?? EXAMPLE_CAPITAL;
    const riskPercent = weak ? 0.25 : 1;
    const risk = pick.buy - pick.stop;
    const quantity = risk > 0 ? Math.max(0, Math.min(Math.floor((capital * riskPercent) / 100 / risk), Math.floor(capital / pick.buy))) : 0;
    plan = {
      buy: pick.buy,
      stop: pick.stop,
      stopPercent: Math.round(((pick.buy - pick.stop) / pick.buy) * 1000) / 10,
      targets: pick.target1 != null && pick.target2 != null
        ? {
          t1: pick.target1, t1Percent: Math.round(((pick.target1 - pick.buy) / pick.buy) * 100), t2: pick.target2, t2Percent: Math.round(((pick.target2 - pick.buy) / pick.buy) * 100),
          note: "Places to book part profit, not the exit. In the 10-year test only about 1 trade in 6 reached the first target and 1 in 8 the second; most of the profit came from holding the few big winners with the trailing exit.",
        }
        : null,
      exit: "Sell if it closes under its 50-day average, or hits the stop. Do not sell just because it went up.",
      tighter: { stop: Math.round(pick.buy * 0.92 * 100) / 100, percent: 8, note: "A tighter 8% stop lets you buy more shares for the same money at risk, but it is stopped out more often. In the 10-year test it made a little less (about 389L against 412L on 10 lakh) and its worst drop was about 27% against 21% with the 12% stop." },
      example: quantity > 0 ? { capital, riskPercent, quantity, invested: Math.round(quantity * pick.buy), maxLoss: Math.round(quantity * risk) } : null,
    };
  }
  const chips: string[] = [];
  if (pick.quiet) chips.push("Volume dried up");
  if (checklist?.screens.length) chips.push(checklist.screens.join(" + "));
  else if (buyable) chips.push("Near breakout level");
  if (v && v.vs50 != null && v.vs200 != null && v.vs50 > 0 && v.vs200 > 0) chips.push("Uptrend");
  const flags: string[] = [];
  if (days != null && days <= 14) flags.push(days === 0 ? "Results today" : `Results in ${days} day${days === 1 ? "" : "s"}`);
  if (pick.tag === "extended" && pick.ext != null) flags.push(`${pick.ext.toFixed(0)}% past its level`);
  if (pick.tag === "ready" && v?.dry != null && v.dry > 0.9) flags.push("Volume not quiet yet");
  if (checklist) for (const item of checklist.items) if (item.state === "warn" && !["market", "nifty", "results", "stop", "setup", "extended"].includes(item.key)) flags.push(item.label.split(" (")[0]);
  return { verdict, status: statusLabel(verdict, pick.tag), headline, why, watchOut, plan, checklist: checklist?.items ?? [], chips: chips.slice(0, 3), flags: flags.slice(0, 3) };
}
