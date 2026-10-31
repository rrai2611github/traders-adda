/**
 * A pre-trade risk gate: every proposed buy is checked against hard limits before it is shown as something you can act on, and a block names
 * the reason and the largest size that would pass. Exits are never blocked. These are safety limits, not part of the tested edge: they keep
 * one bad trade, one bad day and one crowded week small. Pure, so the dashboard, the live check and the tests agree.
 */
export const RISK_LIMITS = {
  /** Most the account may lose if one position is stopped, percent of the account. */
  maxRiskPerTradePercent: 2,
  /** Largest single position, percent of the account (the tested rules use the same cap). */
  maxPositionPercent: 20,
  maxPositions: 10,
  /** Most new buys on one day (the tested rules use the same cap). */
  maxNewPerDay: 3,
  /** Most the account may lose if every open position were stopped at once, percent of the account. */
  maxOpenRiskPercent: 15,
  /** Once the account is down this much on the day, no new buys. */
  dailyLossStopPercent: 3,
  /** Results this close are a warning; the price can gap through the stop. */
  resultsWarnDays: 5,
} as const;

export interface RiskOrder {
  symbol: string;
  quantity: number;
  entry: number;
  stop: number;
  resultsInDays?: number | null;
}

export interface RiskPortfolio {
  accountValue: number;
  openPositions: ReadonlyArray<{ symbol: string; quantity: number; last: number; stop: number }>;
  /** Buys already made today (or already passed in this batch). */
  newToday: number;
  /** Account change today, percent; null when unknown. */
  dayChangePercent: number | null;
  /** The setup check (breadth and Nifty) allows real buys; null when unknown. */
  marketOk: boolean | null;
}

export interface RiskVerdict {
  verdict: "PASS" | "WARN" | "BLOCK";
  blocks: string[];
  warnings: string[];
  /** The loss if stopped, percent of the account. */
  riskPercent: number;
  positionPercent: number;
  /** Open risk across all positions including this one, percent of the account. */
  openRiskPercent: number;
  /** The most shares that would pass the size limits; 0 when a non-size rule blocks. */
  maxQuantity: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function checkOrder(order: RiskOrder, pf: RiskPortfolio, limits = RISK_LIMITS): RiskVerdict {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const perShare = order.entry - order.stop;
  const account = pf.accountValue;
  const hasStop = Number.isFinite(order.stop) && order.stop > 0 && perShare > 0;
  const loss = hasStop ? order.quantity * perShare : 0;
  const riskPercent = account > 0 ? (loss / account) * 100 : 0;
  const positionPercent = account > 0 ? ((order.quantity * order.entry) / account) * 100 : 0;
  const openRisk = pf.openPositions.reduce((a, p) => a + Math.max(0, p.last - p.stop) * p.quantity, 0);
  const openRiskPercent = account > 0 ? ((openRisk + loss) / account) * 100 : 0;

  const bySize: number[] = [];
  if (hasStop && account > 0) {
    bySize.push(Math.floor((account * limits.maxRiskPerTradePercent) / 100 / perShare));
    bySize.push(Math.floor((account * limits.maxPositionPercent) / 100 / order.entry));
    bySize.push(Math.floor(Math.max(0, (account * limits.maxOpenRiskPercent) / 100 - openRisk) / perShare));
  }
  const maxQuantity = bySize.length ? Math.max(0, Math.min(...bySize)) : 0;

  if (!hasStop) blocks.push("A stop below the buy price is required.");
  if (!(order.quantity >= 1)) blocks.push("The size is under one share.");
  if (pf.marketOk === false) blocks.push("The setup check is not passed (breadth or the Nifty trend), so this is a paper trade only.");
  if (pf.dayChangePercent != null && pf.dayChangePercent <= -limits.dailyLossStopPercent) blocks.push(`The account is down ${Math.abs(pf.dayChangePercent).toFixed(1)}% today, past the ${limits.dailyLossStopPercent}% daily loss stop. No new buys until tomorrow.`);
  if (pf.openPositions.some((p) => p.symbol === order.symbol)) blocks.push(`${order.symbol} is already held.`);
  if (pf.openPositions.length >= limits.maxPositions) blocks.push(`Already ${pf.openPositions.length} positions; the limit is ${limits.maxPositions}.`);
  if (pf.newToday >= limits.maxNewPerDay) blocks.push(`Already ${pf.newToday} new buys today; the limit is ${limits.maxNewPerDay}.`);
  if (hasStop && riskPercent > limits.maxRiskPerTradePercent) blocks.push(`If stopped, this loses ${round1(riskPercent)}% of the account (limit ${limits.maxRiskPerTradePercent}%).`);
  if (positionPercent > limits.maxPositionPercent) blocks.push(`The position is ${round1(positionPercent)}% of the account (limit ${limits.maxPositionPercent}%).`);
  if (hasStop && openRiskPercent > limits.maxOpenRiskPercent && riskPercent <= limits.maxRiskPerTradePercent) blocks.push(`With this buy, stops across all positions would lose ${round1(openRiskPercent)}% of the account (limit ${limits.maxOpenRiskPercent}%).`);

  if (order.resultsInDays != null && order.resultsInDays <= limits.resultsWarnDays) warnings.push(`Results ${order.resultsInDays === 0 ? "are today" : `in ${order.resultsInDays} day${order.resultsInDays === 1 ? "" : "s"}`}: the price can gap through the stop.`);
  if (pf.marketOk == null) warnings.push("The market check could not be read.");

  const sizeBlocked = blocks.some((b) => /loses|position is|stops across/.test(b));
  return {
    verdict: blocks.length ? "BLOCK" : warnings.length ? "WARN" : "PASS",
    blocks,
    warnings,
    riskPercent: round1(riskPercent),
    positionPercent: round1(positionPercent),
    openRiskPercent: round1(openRiskPercent),
    maxQuantity: blocks.length && !sizeBlocked ? 0 : maxQuantity,
  };
}

/** Checks orders in order, as if each one that passed had filled, so a batch that only breaks a limit together is still caught. */
export function checkBatch(orders: ReadonlyArray<RiskOrder>, pf: RiskPortfolio, limits = RISK_LIMITS): RiskVerdict[] {
  let state = pf;
  return orders.map((order) => {
    const verdict = checkOrder(order, state, limits);
    if (verdict.verdict !== "BLOCK") {
      state = { ...state, newToday: state.newToday + 1, openPositions: [...state.openPositions, { symbol: order.symbol, quantity: order.quantity, last: order.entry, stop: order.stop }] };
    }
    return verdict;
  });
}

/** The order's own reasons in one sentence, with the largest size that would pass when that helps. */
export function verdictLine(v: RiskVerdict): string {
  if (v.verdict === "PASS") return `Passes: loses ${v.riskPercent}% of the account if stopped, position ${v.positionPercent}%.`;
  const text = [...v.blocks, ...v.warnings].join(" ");
  return v.verdict === "BLOCK" && v.maxQuantity > 0 ? `${text} The most that would pass is ${v.maxQuantity} shares.` : text;
}
