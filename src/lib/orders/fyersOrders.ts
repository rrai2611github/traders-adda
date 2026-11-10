import { createHash } from "node:crypto";
import { RISK_LIMITS } from "../risk/riskGate.ts";
import type { PlanOrder } from "../positions/tomorrowPlan.ts";

/**
 * Turns the "Tomorrow's plan" buys into Fyers order payloads, and decides whether they are allowed out. Pure, so the panel, the sender and
 * the tests agree. Nothing here talks to the broker.
 *
 * Each buy is a LIMIT order at the plan's "skip above" price (5% over the planned price): it fills at the open like a market order but can
 * never pay more than the rule allows. Delivery product (CNC), valid for the day. After the close it goes out as an after-market order.
 */
export interface FyersOrderPayload {
  symbol: string;
  qty: number;
  /** 1 = limit. */
  type: 1;
  /** 1 = buy. */
  side: 1;
  productType: "CNC";
  limitPrice: number;
  stopPrice: 0;
  validity: "DAY";
  disclosedQty: 0;
  /** True for an after-market order (placed while the exchange is closed, queued for the next open). */
  offlineOrder: boolean;
  /** Our own id, so the same order is recognisable in the broker's list. Letters and digits only, 20 characters at most. */
  orderTag: string;
}

export type BrokerOrderState = "pending" | "partially-filled" | "filled" | "cancelled" | "rejected" | "expired" | "unknown";

/** FYERS order-book status codes; filled quantity takes precedence for partial fills. */
export function brokerOrderState(status: unknown, filledQty: unknown, remainingQuantity: unknown): BrokerOrderState {
  const filled = Number(filledQty);
  const remaining = Number(remainingQuantity);
  if (Number.isFinite(filled) && filled > 0 && Number.isFinite(remaining) && remaining > 0) return "partially-filled";
  switch (Number(status)) {
    case 1: return "cancelled";
    case 2: return "filled";
    case 4:
    case 6: return "pending";
    case 5: return "rejected";
    case 7: return "expired";
    default: return "unknown";
  }
}

/** The smallest price step on NSE equities. */
const TICK = 0.05;
/** The most one order may be worth, as a guard against a sizing bug (percent of the account). */
export const MAX_ORDER_ACCOUNT_PERCENT = RISK_LIMITS.maxPositionPercent + 1;

export const fyersSymbol = (symbol: string) => `NSE:${symbol}-EQ`;

/** Rounds down to the 5-paise step; the limit may never be higher than the rule allows. */
export const floorToTick = (price: number) => Math.floor(price / TICK + 1e-9) * TICK;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function orderTag(day: string, symbol: string): string {
  return `TA${day.replace(/-/g, "").slice(2)}${symbol.replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 20);
}

export function buyPayload(order: Pick<PlanOrder, "symbol" | "shares" | "skipAbove">, day: string, afterMarket: boolean): FyersOrderPayload {
  return {
    symbol: fyersSymbol(order.symbol),
    qty: order.shares,
    type: 1,
    side: 1,
    productType: "CNC",
    limitPrice: round2(floorToTick(order.skipAbove)),
    stopPrice: 0,
    validity: "DAY",
    disclosedQty: 0,
    offlineOrder: afterMarket,
    orderTag: orderTag(day, order.symbol),
  };
}

/** A short code for one exact set of orders. The panel sends it back with Approve, so what is approved is what was shown. */
export function planFingerprint(day: string, orders: ReadonlyArray<Pick<PlanOrder, "symbol" | "shares" | "skipAbove">>): string {
  const text = `${day}|${orders.map((o) => `${o.symbol}:${o.shares}:${o.skipAbove}`).join(",")}`;
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Reasons the orders must not go out. Empty means they may. */
export function sendBlocks(input: {
  orders: ReadonlyArray<Pick<PlanOrder, "symbol" | "shares" | "skipAbove" | "invested">>;
  accountSize: number | null;
  /** The last trading day the plan was built from, and the day the data is from now. */
  planDay: string | null;
  dataDay: string | null;
  killed: boolean;
}): string[] {
  const blocks: string[] = [];
  if (input.killed) blocks.push("The kill switch is on (the file .cache/orders-off exists). Delete it to allow orders again.");
  if (input.accountSize == null) blocks.push("Save your account size first (Plan email on this page): orders are sized from it.");
  if (!input.planDay || input.planDay !== input.dataDay) blocks.push("The plan is not from the latest close. Wait for the evening refresh.");
  if (input.orders.length === 0) blocks.push("There is nothing to send today.");
  if (input.orders.length > RISK_LIMITS.maxNewPerDay) blocks.push(`More than ${RISK_LIMITS.maxNewPerDay} buys in one day is not allowed.`);
  const seen = new Set<string>();
  for (const o of input.orders) {
    if (seen.has(o.symbol)) blocks.push(`${o.symbol} appears twice.`);
    seen.add(o.symbol);
    if (!Number.isInteger(o.shares) || o.shares < 1) blocks.push(`${o.symbol}: the share count is not valid.`);
    if (!(o.skipAbove > 0)) blocks.push(`${o.symbol}: the price limit is not valid.`);
    if (input.accountSize != null && o.invested > (input.accountSize * MAX_ORDER_ACCOUNT_PERCENT) / 100) {
      blocks.push(`${o.symbol}: the order is larger than ${MAX_ORDER_ACCOUNT_PERCENT}% of your account. Something is wrong with the sizing.`);
    }
  }
  return blocks;
}
