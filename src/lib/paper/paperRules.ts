import { isDemoPaperOrder, istDayKey, type PaperFill, type PaperOrder } from "../screen/paperTrading.ts";

/**
 * Portfolio-level rules for paper trading: trading costs, loss limits and performance stats.
 * Pure functions over the saved orders, so the server engine and the UI agree on every number.
 */

export interface PaperSettings {
  /** Pending plus open positions allowed at once; blocks new approvals. */
  maxOpenPositions: number;
  /** Stop new entries for the rest of the day once the day's loss reaches this share of starting capital. */
  dailyLossPercent: number;
  /** Same, for the week (Monday to Friday, IST). */
  weeklyLossPercent: number;
  /** Assumed slippage on every fill, as a percentage of the fill value. */
  slippagePercent: number;
}

export const DEFAULT_PAPER_SETTINGS: PaperSettings = {
  maxOpenPositions: 8,
  dailyLossPercent: 2,
  weeklyLossPercent: 5,
  slippagePercent: 0.05,
};

/**
 * Estimated equity-delivery costs. Brokerage is taken as zero for delivery (Fyers' published plan); the rest are
 * statutory rates as best known and can change: STT 0.1% each side, exchange charge 0.00297%, SEBI ₹10 per crore,
 * stamp duty 0.015% on buys, GST 18% on exchange and SEBI charges, and a ₹13.5 + GST depository charge per sale day.
 * They are estimates for a realistic net figure, not a contract note.
 */
export const COST_RATES = {
  sttPercent: 0.1,
  exchangePercent: 0.00297,
  sebiPercent: 0.0001,
  stampBuyPercent: 0.015,
  gstPercent: 18,
  dpChargePerSaleDay: 13.5,
} as const;

export interface OrderCosts {
  charges: number;
  slippage: number;
  total: number;
}

const value = (fill: PaperFill) => fill.price * fill.quantity;

/** Charges and slippage on the fills an order has so far. Sale costs of a still-open position are not included. */
export function orderCosts(order: PaperOrder, settings: PaperSettings): OrderCosts {
  let charges = 0;
  let slippage = 0;
  const saleDays = new Set<string>();
  for (const fill of order.fills) {
    const v = value(fill);
    const exchange = (v * (COST_RATES.exchangePercent + COST_RATES.sebiPercent)) / 100;
    charges += (v * COST_RATES.sttPercent) / 100 + exchange + (exchange * COST_RATES.gstPercent) / 100;
    if (fill.side === "buy") charges += (v * COST_RATES.stampBuyPercent) / 100;
    else saleDays.add(istDayKey(fill.timestamp));
    slippage += (v * settings.slippagePercent) / 100;
  }
  charges += saleDays.size * COST_RATES.dpChargePerSaleDay * (1 + COST_RATES.gstPercent / 100);
  return { charges, slippage, total: charges + slippage };
}

/** Gross P&L: booked exits plus the open remainder marked at the last price seen. */
export function orderPnl(order: PaperOrder): { realized: number; unrealized: number; gross: number } {
  const holding = order.status === "open" ? order.remainingQuantity : 0;
  const last = order.lastObservedPrice ?? order.entryPrice ?? 0;
  const unrealized = holding && order.entryPrice !== null ? (last - order.entryPrice) * holding : 0;
  return { realized: order.realizedPnl, unrealized, gross: order.realizedPnl + unrealized };
}

const real = (orders: ReadonlyArray<PaperOrder>) => orders.filter((order) => !isDemoPaperOrder(order));

export interface PaperTotals {
  realized: number;
  unrealized: number;
  gross: number;
  charges: number;
  slippage: number;
  net: number;
}

export function paperTotals(orders: ReadonlyArray<PaperOrder>, settings: PaperSettings): PaperTotals {
  let realized = 0, unrealized = 0, charges = 0, slippage = 0;
  for (const order of real(orders)) {
    const pnl = orderPnl(order);
    const costs = orderCosts(order, settings);
    realized += pnl.realized;
    unrealized += pnl.unrealized;
    charges += costs.charges;
    slippage += costs.slippage;
  }
  const gross = realized + unrealized;
  return { realized, unrealized, gross, charges, slippage, net: gross - charges - slippage };
}

/** Monday of the IST week containing `now`, as a YYYY-MM-DD key. */
export function istWeekStartKey(now: number): string {
  const shifted = new Date(now + 19_800_000);
  const day = (shifted.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(shifted.getTime() - day * 86_400_000).toISOString().slice(0, 10);
}

/** P&L from sales on or after `sinceKey` plus open P&L on positions entered on or after it. */
function periodPnl(orders: ReadonlyArray<PaperOrder>, sinceKey: string): number {
  let pnl = 0;
  for (const order of real(orders)) {
    if (order.entryFillPrice === null) continue;
    for (const fill of order.fills) {
      if (fill.side === "sell" && istDayKey(fill.timestamp) >= sinceKey) pnl += (fill.price - order.entryFillPrice) * fill.quantity;
    }
    if (order.status === "open" && order.openedAt !== null && istDayKey(order.openedAt) >= sinceKey) pnl += orderPnl(order).unrealized;
  }
  return pnl;
}

export interface PaperRisk {
  openCount: number;
  dayPnl: number;
  weekPnl: number;
  dayLimit: number;
  weekLimit: number;
  /** New approvals are refused (position cap or a loss limit). */
  approvalBlocked: boolean;
  /** Pending orders must not enter (a loss limit is hit). */
  entryBlocked: boolean;
  reasons: string[];
}

export function paperRisk(orders: ReadonlyArray<PaperOrder>, initialCapital: number, settings: PaperSettings, now: number): PaperRisk {
  const live = real(orders);
  const openCount = live.filter((order) => order.status === "pending" || order.status === "open").length;
  const dayPnl = periodPnl(live, istDayKey(now));
  const weekPnl = periodPnl(live, istWeekStartKey(now));
  const dayLimit = (initialCapital * settings.dailyLossPercent) / 100;
  const weekLimit = (initialCapital * settings.weeklyLossPercent) / 100;
  const reasons: string[] = [];
  const dayHit = dayPnl <= -dayLimit;
  const weekHit = weekPnl <= -weekLimit;
  if (dayHit) reasons.push(`Daily loss limit reached: ${dayPnl.toFixed(0)} against −${dayLimit.toFixed(0)} (${settings.dailyLossPercent}% of capital).`);
  if (weekHit) reasons.push(`Weekly loss limit reached: ${weekPnl.toFixed(0)} against −${weekLimit.toFixed(0)} (${settings.weeklyLossPercent}% of capital).`);
  const capped = openCount >= settings.maxOpenPositions;
  if (capped) reasons.push(`Position cap reached: ${openCount} of ${settings.maxOpenPositions} pending or open orders.`);
  return { openCount, dayPnl, weekPnl, dayLimit, weekLimit, approvalBlocked: dayHit || weekHit || capped, entryBlocked: dayHit || weekHit, reasons };
}

export interface PaperStats {
  closed: number;
  wins: number;
  winRate: number | null;
  /** Mean of net P&L divided by the amount risked to the original stop, over closed orders. */
  expectancyR: number | null;
  profitFactor: number | null;
  /** Largest fall in closed-order net P&L from a prior peak, in rupees. */
  maxDrawdown: number;
  net: number;
}

export function paperStats(orders: ReadonlyArray<PaperOrder>, settings: PaperSettings): PaperStats {
  const closed = real(orders).filter((order) => order.status === "closed" && order.entryFillPrice !== null)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let equity = 0, peak = 0, drawdown = 0, grossWin = 0, grossLoss = 0, rSum = 0, wins = 0;
  for (const order of closed) {
    const net = order.realizedPnl - orderCosts(order, settings).total;
    const risk = (order.entryFillPrice! - order.plan.stop) * order.quantity;
    rSum += risk > 0 ? net / risk : 0;
    if (net > 0) { wins++; grossWin += net; } else grossLoss -= net;
    equity += net;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return {
    closed: closed.length,
    wins,
    winRate: closed.length ? (wins / closed.length) * 100 : null,
    expectancyR: closed.length ? rSum / closed.length : null,
    profitFactor: closed.length && grossLoss > 0 ? grossWin / grossLoss : null,
    maxDrawdown: drawdown,
    net: equity,
  };
}

/** Cash committed to an order: the buy-zone limit while pending, the held cost once open. */
export function committedCash(order: PaperOrder): number {
  if (order.status === "pending") return order.quantity * order.plan.buyZoneHigh;
  if (order.status === "open") return order.remainingQuantity * (order.entryPrice ?? order.plan.buyZoneHigh);
  return 0;
}
