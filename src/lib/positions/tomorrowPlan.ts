import { checkOrder, RISK_LIMITS, type RiskPortfolio } from "../risk/riskGate.ts";
import { ruleStop, SECTOR_LIMIT, suggestedShares } from "./positions.ts";

/**
 * "Tomorrow's plan": the breakout-day signals the rules found on the last close, cut down to what the user's real account can take: the
 * positions already held, the sector limit, results dates, the position size (2% at risk, at most 20% in one stock) and the risk gate's
 * limits. The result is a short list of exact orders, or nothing. The app never places them.
 */
export interface PlanCandidate {
  symbol: string;
  rs: number;
  /** The signal day's close: the planned buy price (the real buy is the next open). */
  close: number;
}

export interface HeldItem {
  symbol: string;
  qty: number;
  last: number;
  stop: number;
  sector: string | null;
}

export interface PlanOrder {
  symbol: string;
  rs: number;
  shares: number;
  /** Planned buy price. */
  buy: number;
  /** Skip the buy if the stock opens above this (5% over the planned price). */
  skipAbove: number;
  stop: number;
  stopPercent: number;
  invested: number;
  atRisk: number;
  atRiskPercent: number;
  sector: string | null;
  /** Things to watch, from the risk gate's warnings. */
  warnings: string[];
}

export interface PlanSkip {
  symbol: string;
  reason: string;
}

export interface TomorrowPlan {
  orders: PlanOrder[];
  skipped: PlanSkip[];
}

const CHASE_LIMIT = 1.05;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function buildTomorrowPlan(input: {
  candidates: ReadonlyArray<PlanCandidate>;
  held: ReadonlyArray<HeldItem>;
  accountSize: number;
  sectorOf: (symbol: string) => string | null;
  /** Days until the stock's results, null when none is announced, undefined when unknown. */
  resultsInDays: (symbol: string) => number | null | undefined;
  marketOk: boolean;
}): TomorrowPlan {
  const plan: TomorrowPlan = { orders: [], skipped: [] };
  if (!input.marketOk) return plan;

  let portfolio: RiskPortfolio = {
    accountValue: input.accountSize,
    openPositions: input.held.map((h) => ({ symbol: h.symbol, quantity: h.qty, last: h.last, stop: h.stop })),
    newToday: 0,
    dayChangePercent: null,
    marketOk: true,
  };
  const heldSymbols = new Set(input.held.map((h) => h.symbol));
  const perSector = new Map<string, number>();
  for (const h of input.held) if (h.sector) perSector.set(h.sector, (perSector.get(h.sector) ?? 0) + 1);

  for (const c of input.candidates) {
    const skip = (reason: string) => { plan.skipped.push({ symbol: c.symbol, reason }); };
    if (plan.orders.length >= RISK_LIMITS.maxNewPerDay) { skip(`already ${RISK_LIMITS.maxNewPerDay} buys planned for one day (the limit)`); continue; }
    if (heldSymbols.has(c.symbol)) { skip("you already hold it"); continue; }
    const sector = input.sectorOf(c.symbol);
    const inSector = sector ? perSector.get(sector) ?? 0 : 0;
    if (sector && inSector >= SECTOR_LIMIT) { skip(`you would have more than ${SECTOR_LIMIT} positions in ${sector}`); continue; }
    const days = input.resultsInDays(c.symbol);
    if (days != null && days <= RISK_LIMITS.resultsWarnDays) { skip(`results ${days === 0 ? "are today" : `in ${days} day${days === 1 ? "" : "s"}`}: the price can gap through the stop, so wait until they are out`); continue; }

    const stop = ruleStop(c.close);
    const size = suggestedShares({ capital: input.accountSize, buy: c.close, stop });
    if (size.qty < 1) { skip("too expensive for this account size at 2% risk"); continue; }
    let qty = size.qty;
    let verdict = checkOrder({ symbol: c.symbol, quantity: qty, entry: c.close, stop, resultsInDays: days ?? null }, portfolio);
    if (verdict.verdict === "BLOCK" && verdict.maxQuantity > 0 && verdict.maxQuantity < qty) {
      qty = verdict.maxQuantity;
      verdict = checkOrder({ symbol: c.symbol, quantity: qty, entry: c.close, stop, resultsInDays: days ?? null }, portfolio);
    }
    if (verdict.verdict === "BLOCK") { skip(verdict.blocks.join(" ") || "the risk limits do not allow it"); continue; }

    plan.orders.push({
      symbol: c.symbol, rs: c.rs, shares: qty, buy: c.close, skipAbove: round2(c.close * CHASE_LIMIT), stop,
      stopPercent: round2(((c.close - stop) / c.close) * 100), invested: Math.round(qty * c.close), atRisk: Math.round(qty * (c.close - stop)),
      atRiskPercent: verdict.riskPercent, sector, warnings: verdict.warnings,
    });
    portfolio = { ...portfolio, newToday: portfolio.newToday + 1, openPositions: [...portfolio.openPositions, { symbol: c.symbol, quantity: qty, last: c.close, stop }] };
    if (sector) perSector.set(sector, inSector + 1);
  }
  return plan;
}

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** The email for the plan: a subject and plain lines. Empty when there is nothing to buy. */
export function planEmail(input: { plan: TomorrowPlan; accountSize: number; accountSaved: boolean; breadth50: number | null; breadthMin: number; lastDay: string; heldCount: number; candidateCount: number; resultsKnown?: boolean }): { subject: string; lines: string[] } | null {
  const { plan } = input;
  if (plan.orders.length === 0) return null;
  const n = plan.orders.length;
  const lines: string[] = [
    `The market check passed${input.breadth50 != null ? ` (${Math.round(input.breadth50)}% of stocks are above their 50-day average; the setup needs ${input.breadthMin}%)` : ""}. The rules found ${input.candidateCount} breakout${input.candidateCount === 1 ? "" : "s"} on the close of ${input.lastDay}. Here is what fits your account of ${inr(input.accountSize)} and your ${input.heldCount} open position${input.heldCount === 1 ? "" : "s"}.`,
    ...plan.orders.map((o, i) =>
      `${i + 1}. ${o.symbol}: buy ${o.shares.toLocaleString("en-IN")} shares at the open, about ${inr(o.buy)} (skip it if it opens above ${inr(o.skipAbove)}). Stop ${inr(o.stop)} (−${o.stopPercent}%): set it with your broker the same day. About ${inr(o.invested)} in the stock; ${inr(o.atRisk)} (${o.atRiskPercent}% of your account) is lost if the stop is hit.${o.sector ? ` Sector: ${o.sector}.` : ""}${o.warnings.length ? ` Note: ${o.warnings.join(" ")}` : ""}`),
  ];
  if (plan.skipped.length) lines.push(`Not on your list: ${plan.skipped.map((s) => `${s.symbol} (${s.reason})`).join("; ")}.`);
  if (input.resultsKnown === false) lines.push("The results calendar could not be checked today, so look up each stock's results date before you buy.");
  lines.push(
    "The app never places orders. After you buy, open My positions and tap \"I bought it\" on the pick (or add the position) with the price you actually paid, so the exits are watched for you.",
    `Account size used: ${inr(input.accountSize)}${input.accountSaved ? "" : " (the default: set yours on My positions)"}. This email goes only to you, and only on days the market check passes and something fits.`,
  );
  return { subject: `Tomorrow's plan · ${n} buy${n === 1 ? "" : "s"} · after the close on ${input.lastDay}`, lines };
}
