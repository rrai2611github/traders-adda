import { SCREEN_NAMES, matchesScreenName, type FactorValues, type ScreenName } from "./criteria.ts";

/**
 * The trading checklist for one stock, built from the rules the 10-year backtest favoured (/backtest): the market must be healthy,
 * the stock must be on a screen, strong, in an uptrend near its high, liquid, not already stretched, with a stop that is not wide.
 */
export type CheckState = "pass" | "warn" | "fail" | "na";

export interface CheckItem {
  key: string;
  label: string;
  state: CheckState;
  /** What was measured, in plain words. */
  detail: string;
}

export interface ChecklistInputs {
  /** Share of liquid stocks above their 50-day average, percent. */
  breadth50: number | null;
  values: FactorValues & { price: number; turnoverCr: number | null; /** "BE" is trade-for-trade. */ series?: "EQ" | "BE" };
  /** Stop distance of the trade plan, percent of the buy price. */
  stopPercent: number | null;
  /** Days to the next results announcement; null when none is announced; leave out when the calendar is not loaded. */
  resultsInDays?: number | null;
  /** The Nifty 50 closes above its 200-day average; null when unknown; leave out when not loaded. */
  niftyAbove200?: boolean | null;
  /** Percent the Nifty 50 is above (positive) or below its 200-day average, for the wording. */
  niftyPercent?: number | null;
}

export interface Checklist {
  items: CheckItem[];
  screens: ScreenName[];
  verdict: "ready" | "partly" | "not-yet";
  headline: string;
  /** Trailing average the tested exit uses for the screens this stock is on. */
  exitDays: 50 | 100;
}

const pct = (v: number, d = 0) => `${v.toFixed(d)}%`;

export function buildChecklist(input: ChecklistInputs): Checklist {
  const { values: v, breadth50, stopPercent, resultsInDays, niftyAbove200, niftyPercent } = input;
  // A stock up to 5% past its breakout level is the breakout the backtest bought, so it is judged as if sitting at the level.
  const justBroke = v.ext != null && v.ext > 0 && v.ext <= 5;
  const judged = justBroke ? { ...v, ext: 0 } : v;
  const screens = SCREEN_NAMES.filter((name) => matchesScreenName(judged, name));
  const items: CheckItem[] = [];
  const add = (key: string, label: string, state: CheckState, detail: string) => items.push({ key, label, state, detail });

  add("market", "Market is healthy", breadth50 == null ? "na" : breadth50 >= 50 ? "pass" : breadth50 >= 30 ? "warn" : "fail",
    breadth50 == null ? "Breadth is not available yet." : `${pct(breadth50)} of stocks are above their 50-day average (buy at 50% or more; 30–50% only small or on paper).`);
  // The Ready rule (tested on its own): strong and within 6% under its breakout level, with or without a screen.
  const ready = judged.ext != null && judged.ext >= -6 && judged.ext <= 0 && v.rs != null && v.rs >= 85;
  add("setup", "On a tested setup", screens.length || ready ? "pass" : "fail",
    screens.length ? `${justBroke ? "Just broke out; " : ""}matches ${screens.join(", ")}.` : ready ? `${Math.abs(judged.ext as number).toFixed(1)}% under its breakout level with RS ${Math.round(v.rs as number)} (the Ready rule); not on one of the four screens.` : "Matches none of the four screens and is not just under a breakout level.");
  add("rs", "Strong versus the market (RS 80+)", v.rs == null ? "na" : v.rs >= 80 ? "pass" : v.rs >= 70 ? "warn" : "fail",
    v.rs == null ? "Not rated." : `RS ${Math.round(v.rs)}.`);
  // The averages come from how far the price sits above each one.
  const ma50 = v.vs50 == null ? null : v.price / (1 + v.vs50 / 100);
  const ma200 = v.vs200 == null ? null : v.price / (1 + v.vs200 / 100);
  const stacked = ma50 != null && ma200 != null && v.price > ma50 && ma50 > ma200;
  add("trend", "Uptrend (price above the 50-day, 50-day above the 200-day)", ma50 == null || ma200 == null ? "na" : stacked ? "pass" : v.price > ma50 ? "warn" : "fail",
    ma50 == null || ma200 == null ? "Needs 200 sessions of history." : stacked ? "Stacked in the right order." : v.price > ma50 ? "Above the 50-day, but the averages are not stacked." : "Below the 50-day average.");
  add("high", "Within 25% of the 52-week high", v.fromHigh == null ? "na" : Math.abs(v.fromHigh) <= 25 ? "pass" : Math.abs(v.fromHigh) <= 35 ? "warn" : "fail",
    v.fromHigh == null ? "No 52-week high." : `${pct(Math.abs(v.fromHigh), 1)} below the high.`);
  add("liquidity", "Easy to buy and sell (₹5 Cr a day)", v.series === "BE" ? "fail" : v.turnoverCr == null ? "na" : v.turnoverCr >= 5 ? "pass" : v.turnoverCr >= 1 ? "warn" : "fail",
    v.series === "BE" ? "Trade-for-trade stock: not tradable for swing trades." : v.turnoverCr == null ? "No turnover data." : `Median ₹${v.turnoverCr.toFixed(1)} Cr traded a day.`);
  add("extended", "Not already stretched past the breakout", v.ext == null || v.ext < -20 ? "na" : v.ext <= 5 ? "pass" : v.ext <= 10 ? "warn" : "fail",
    v.ext == null ? "No breakout level to measure from." : v.ext < -20 ? "Far below any breakout level, so not a setup." : v.ext <= 0 ? `${pct(Math.abs(v.ext), 1)} under the breakout level.` : `${pct(v.ext, 1)} above the breakout level (skip above 5%).`);
  add("stop", "Normal swings fit inside a 12% stop", stopPercent == null ? "na" : stopPercent <= 12 ? "pass" : stopPercent <= 16 ? "warn" : "fail",
    stopPercent == null ? "Not enough price history for a stop." : `Twice its normal daily range is ${pct(stopPercent, 1)} of the price${stopPercent > 12 ? ", wider than the 12% stop: ordinary moves can hit it, so expect more stop-outs or buy fewer shares" : ""}.`);

  if (resultsInDays !== undefined) {
    add("results", "No results announcement in the next 2 weeks", resultsInDays == null ? "na" : resultsInDays <= 5 ? "fail" : resultsInDays <= 14 ? "warn" : "pass",
      resultsInDays == null ? "No results date announced yet; check before buying." : resultsInDays === 0 ? "Results are today." : `Results in ${resultsInDays} day${resultsInDays === 1 ? "" : "s"}${resultsInDays <= 14 ? ": a gap up or down can jump the stop" : ""}.`);
  }
  if (niftyAbove200 !== undefined) {
    add("nifty", "Nifty 50 above its 200-day average (information, not a rule)", niftyAbove200 == null ? "na" : niftyAbove200 ? "pass" : "warn",
      niftyAbove200 == null ? "The Nifty trend is not available." : niftyAbove200 ? `The Nifty is ${niftyPercent != null ? `${niftyPercent.toFixed(1)}% ` : ""}above it, a friendly backdrop.` : `The Nifty is ${niftyPercent != null ? `${Math.abs(niftyPercent).toFixed(1)}% ` : ""}under it. The tested rule does not use this (the tests did not support it as a filter), but a falling market makes breakouts harder.`);
  }
  const hard = ["market", "setup", "rs", "trend", "liquidity", "extended"];
  const failed = items.filter((i) => hard.includes(i.key) && i.state === "fail");
  const anyWarnOrFail = items.some((i) => i.state === "warn" || i.state === "fail");
  const verdict: Checklist["verdict"] = failed.length ? "not-yet" : anyWarnOrFail ? "partly" : "ready";
  const headline = verdict === "ready" ? "Meets every rule." : verdict === "partly" ? "Meets the main rules, with a caution." : `Not yet: ${failed.map((i) => i.label.toLowerCase()).join("; ")}.`;
  return { items, screens, verdict, headline, exitDays: 50 };
}
