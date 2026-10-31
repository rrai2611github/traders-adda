import { isTradingDay, istDateKey } from "../market/marketHours.ts";
import type { MarketPhase, MarketStatus, Quote } from "../market/types.ts";
import type { TodaysPick } from "./todaysPicks.ts";

export const PAPER_ENTRY_WINDOW_SESSIONS = 3;
export const PAPER_MAX_HOLD_SESSIONS = 30;
export const MAX_PAPER_QUOTE_AGE_MS = 120 * 1000;

export interface PaperTradePlan {
  readonly entry: number;
  readonly buyZoneHigh: number;
  readonly stop: number;
  readonly target1: number;
  readonly target2: number;
}

export type PaperOrderStage = "pending" | "open" | "closed" | "cancelled" | "expired";

export interface PaperOrder {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly source: string;
  readonly status: PaperOrderStage;
  readonly stage: PaperOrderStage;
  readonly plan: Readonly<PaperTradePlan>;
  readonly signalDate: string;
  readonly approvedAt: number;
  readonly quantity: number;
  readonly filledQuantity: number;
  readonly lastQuoteTimestamp: number | null;
  readonly entryPrice: number | null;
  readonly activeStop: number;
  readonly entryFillPrice: number | null;
  readonly openedAt: number | null;
  readonly partialT1Quantity: number;
  readonly remainingQuantity: number;
  readonly realizedPnl: number;
  readonly reason: string;
  readonly updatedAt: number;
  readonly lastProcessedAt: number | null;
  readonly lastObservedPrice: number | null;
  readonly closedAt: number | null;
  readonly events: readonly PaperOrderEvent[];
  /** Simulated executions, oldest first: one BUY at entry, then SELLs at T1/T2/stop/time exit. */
  readonly fills: readonly PaperFill[];
}

export type PaperFillLabel = "Entry" | "T1" | "T2" | "Stop" | "Time exit" | "Manual";

export interface PaperFill {
  readonly timestamp: number;
  readonly side: "buy" | "sell";
  readonly quantity: number;
  readonly price: number;
  readonly label: PaperFillLabel;
}

export interface PaperOrderEvent {
  readonly timestamp: number;
  readonly message: string;
}

export interface CreatePaperOrderInput {
  readonly id: string;
  readonly symbol: string;
  readonly name?: string;
  readonly plan: PaperTradePlan;
  readonly signalDate: string;
  readonly approvedAt: number;
  readonly quantity: number;
  readonly source?: string;
}

export interface PaperQuote {
  readonly price: number;
  readonly timestamp: number;
  readonly symbol?: string;
}

export interface PaperMarketState {
  readonly phase: MarketPhase;
  readonly isLive: boolean;
  readonly now: number;
  /** Must be true for a forced/simulated market session. */
  readonly simulated: boolean;
}

export type PaperAdvanceRejection =
  | "order-not-active"
  | "invalid-market-time"
  | "market-not-open"
  | "market-not-live"
  | "simulated-market"
  | "non-trading-session"
  | "invalid-quote"
  | "quote-symbol-mismatch"
  | "future-quote"
  | "stale-quote"
  | "quote-not-new";

export type PaperAdvanceResult =
  | { readonly accepted: true; readonly order: PaperOrder }
  | {
      readonly accepted: false;
      readonly order: PaperOrder;
      readonly rejection: PaperAdvanceRejection;
    };

export function validatePaperTradePlan(plan: unknown): string | null {
  if (!isRecord(plan)) return "A trade plan is required.";
  const { entry, buyZoneHigh, stop, target1, target2 } = plan;
  if (
    !isPositiveFiniteNumber(entry) ||
    !isPositiveFiniteNumber(buyZoneHigh) ||
    !isPositiveFiniteNumber(stop) ||
    !isPositiveFiniteNumber(target1) ||
    !isPositiveFiniteNumber(target2)
  ) {
    return "Plan prices must all be finite positive numbers.";
  }
  if (!(stop < entry && entry <= buyZoneHigh && buyZoneHigh < target1 && target1 < target2)) {
    return "Plan levels must satisfy stop < entry <= buy-zone high < T1 < T2.";
  }
  return null;
}

export function createPaperOrder(input: CreatePaperOrderInput): PaperOrder;
export function createPaperOrder(pick: TodaysPick, signalDate: string, quantity: number, approvedAt: number): PaperOrder;
export function createPaperOrder(
  input: CreatePaperOrderInput | TodaysPick,
  signalDate?: string,
  quantity?: number,
  approvedAt?: number,
): PaperOrder {
  if (signalDate !== undefined || quantity !== undefined || approvedAt !== undefined) {
    if (!("status" in input)) throw new TypeError("A confirmed Buy ready setup is required.");
    const pick = input;
    if (pick.status !== "buy-ready") throw new Error("Only confirmed Buy ready setups can be approved.");
    if (
      signalDate === undefined ||
      quantity === undefined ||
      approvedAt === undefined ||
      !Array.isArray(pick.sources)
    ) {
      throw new TypeError("Signal date, quantity, and approval timestamp are required.");
    }
    return createPaperOrder({
      id: `${pick.symbol}-${approvedAt}`,
      symbol: pick.symbol,
      name: pick.name,
      source: pick.sources[0] ?? "Today's Picks",
      plan: pick.plan,
      signalDate,
      quantity,
      approvedAt,
    });
  }

  if (!("id" in input)) throw new TypeError("Paper order input is invalid.");
  const orderInput = input;
  if (typeof orderInput.id !== "string" || !orderInput.id.trim()) throw new TypeError("Paper order id is required.");
  if (typeof orderInput.symbol !== "string" || !orderInput.symbol.trim()) throw new TypeError("Paper order symbol is required.");
  if (!isFiniteTimestamp(orderInput.approvedAt)) throw new TypeError("Approval timestamp must be a valid finite timestamp.");
  if (!Number.isInteger(orderInput.quantity) || orderInput.quantity < 2) {
    throw new RangeError("Quantity must be an integer of at least 2 shares for a partial T1 exit.");
  }
  if (!isValidDateKey(orderInput.signalDate)) throw new TypeError("Signal date must be a valid YYYY-MM-DD IST date.");

  const planError = validatePaperTradePlan(orderInput.plan);
  if (planError) throw new RangeError(planError);

  return freezeOrder({
    id: orderInput.id.trim(),
    symbol: orderInput.symbol.trim().toUpperCase(),
    name: orderInput.name?.trim() || orderInput.symbol.trim(),
    source: orderInput.source?.trim() || "Manual approval",
    status: "pending",
    stage: "pending",
    plan: {
      entry: orderInput.plan.entry,
      buyZoneHigh: orderInput.plan.buyZoneHigh,
      stop: orderInput.plan.stop,
      target1: orderInput.plan.target1,
      target2: orderInput.plan.target2,
    },
    signalDate: orderInput.signalDate,
    approvedAt: orderInput.approvedAt,
    quantity: orderInput.quantity,
    filledQuantity: 0,
    lastQuoteTimestamp: null,
    entryPrice: null,
    activeStop: orderInput.plan.stop,
    entryFillPrice: null,
    openedAt: null,
    partialT1Quantity: 0,
    remainingQuantity: orderInput.quantity,
    realizedPnl: 0,
    reason: "Approved manually; waiting for a live trigger crossing.",
    updatedAt: orderInput.approvedAt,
    lastProcessedAt: null,
    lastObservedPrice: null,
    closedAt: null,
    events: [{ timestamp: orderInput.approvedAt, message: "Approved manually; waiting for a live trigger crossing." }],
    fills: [],
  });
}

export function advancePaperOrder(
  order: PaperOrder,
  quote: PaperQuote,
  market: PaperMarketState,
): PaperAdvanceResult;
export function advancePaperOrder(
  order: PaperOrder,
  quote: Quote,
  market: MarketStatus,
  now: number,
): PaperOrder;
export function advancePaperOrder(
  order: PaperOrder,
  quote: PaperQuote | Quote,
  market: PaperMarketState | MarketStatus,
  now?: number,
): PaperAdvanceResult | PaperOrder {
  if (now !== undefined) {
    const quotePrice = "price" in quote ? quote.price : quote.ltp;
    const simulated = "simulated" in market
      ? market.simulated
      : market.label.toLowerCase().includes("simulated");
    const result = advancePaperOrderCore(order, {
      price: quotePrice,
      timestamp: quote.timestamp,
      ...("symbol" in quote ? { symbol: quote.symbol } : {}),
    }, {
      phase: market.phase,
      isLive: "isLive" in market ? market.isLive : true,
      now,
      simulated,
    });
    return result.accepted ? result.order : order;
  }
  if (!("simulated" in market) || !("price" in quote)) {
    throw new TypeError("Pass a paper quote and explicit paper market state.");
  }
  return advancePaperOrderCore(order, quote, market);
}

export function cancelPaperOrder(order: PaperOrder, at: number): PaperOrder {
  if (!isPaperOrder(order)) throw new TypeError("Cannot cancel an invalid paper order.");
  if (order.status !== "pending") throw new Error("Only pending paper orders can be cancelled.");
  if (!isFiniteTimestamp(at)) throw new TypeError("Cancellation timestamp must be valid.");
  if (at <= order.updatedAt) throw new RangeError("Cancellation timestamp must be newer than the last order update.");
  return freezeOrder({
    ...order,
    status: "cancelled",
    stage: "cancelled",
    reason: "Cancelled manually before entry.",
    updatedAt: at,
    events: [...order.events, { timestamp: at, message: "Cancelled manually before entry." }],
  });
}

/**
 * Closes an open order right now, at a price you supply, instead of waiting
 * for the automatic stop/T1/T2/time-exit. Exits the full remaining size in
 * one fill — a deliberate simplification: half-booked T1 proceeds are
 * untouched, only the still-open remainder is sold.
 */
export function closePaperOrderNow(order: PaperOrder, exitPrice: number, at: number): PaperOrder {
  if (!isPaperOrder(order)) throw new TypeError("Cannot close an invalid paper order.");
  if (order.status !== "open") throw new Error("Only an open paper order can be closed manually.");
  if (!isFiniteTimestamp(at)) throw new TypeError("Close timestamp must be valid.");
  if (at <= order.updatedAt) throw new RangeError("Close timestamp must be newer than the last order update.");
  if (!isPositiveFiniteNumber(exitPrice)) throw new TypeError("Exit price must be a positive finite number.");
  const entryFillPrice = order.entryFillPrice;
  if (entryFillPrice === null) throw new Error(`Open paper order ${order.id} has no entry fill.`);
  const exitQuantity = order.remainingQuantity;
  const reason = `Closed manually at ₹${exitPrice.toFixed(2)}.`;
  return freezeOrder({
    ...order,
    status: "closed",
    stage: "closed",
    remainingQuantity: 0,
    realizedPnl: order.realizedPnl + (exitPrice - entryFillPrice) * exitQuantity,
    fills: [...order.fills, { timestamp: at, side: "sell", quantity: exitQuantity, price: exitPrice, label: "Manual" }],
    reason,
    updatedAt: at,
    lastProcessedAt: at,
    lastObservedPrice: exitPrice,
    closedAt: at,
    events: [...order.events, { timestamp: at, message: reason }],
  });
}

export function tradingSessionsBetween(startDate: string, endDate: string): number {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    throw new TypeError("Trading-session dates must be valid YYYY-MM-DD dates.");
  }
  if (endDate < startDate) return -countTradingSessionsAfter(endDate, startDate, Number.MAX_SAFE_INTEGER);
  return countTradingSessionsAfter(startDate, endDate, Number.MAX_SAFE_INTEGER);
}

export function istDayKey(timestamp: number): string {
  if (!isFiniteTimestamp(timestamp)) throw new TypeError("IST day key requires a valid finite timestamp.");
  return istDateKey(timestamp);
}

/** Demo orders are replays of past signals loaded for illustration; they never poll quotes or use paper cash. */
export function isDemoPaperOrder(order: PaperOrder): boolean {
  return order.id.startsWith("demo-");
}

export function isPaperOrder(value: unknown): value is PaperOrder {
  if (!isRecord(value)) return false;
  const order = value;
  if (
    typeof order.id !== "string" ||
    typeof order.symbol !== "string" ||
    typeof order.name !== "string" ||
    typeof order.source !== "string" ||
    !isPaperOrderStage(order.status) ||
    order.stage !== order.status ||
    typeof order.signalDate !== "string" ||
    !isValidDateKey(order.signalDate) ||
    !isFiniteTimestamp(order.approvedAt) ||
    typeof order.quantity !== "number" || !Number.isInteger(order.quantity) || order.quantity < 2 ||
    typeof order.filledQuantity !== "number" || !Number.isInteger(order.filledQuantity) ||
    order.filledQuantity < 0 || order.filledQuantity > order.quantity ||
    !(order.lastQuoteTimestamp === null || isFiniteTimestamp(order.lastQuoteTimestamp)) ||
    validatePaperTradePlan(order.plan) !== null ||
    typeof order.realizedPnl !== "number" || !Number.isFinite(order.realizedPnl) ||
    typeof order.remainingQuantity !== "number" || !Number.isInteger(order.remainingQuantity) || order.remainingQuantity < 0 ||
    typeof order.partialT1Quantity !== "number" || !Number.isInteger(order.partialT1Quantity) ||
    order.partialT1Quantity < 0 || order.partialT1Quantity > order.quantity ||
    typeof order.reason !== "string" ||
    !isFiniteTimestamp(order.updatedAt) ||
    !isPositiveFiniteNumber(order.activeStop) ||
    !(order.entryPrice === null || isPositiveFiniteNumber(order.entryPrice)) ||
    !(order.entryFillPrice === null || isPositiveFiniteNumber(order.entryFillPrice)) ||
    order.entryPrice !== order.entryFillPrice ||
    !isNullableTimestamp(order.openedAt) ||
    !isNullableTimestamp(order.closedAt) ||
    !isNullableTimestamp(order.lastProcessedAt) ||
    !(order.lastObservedPrice === null || isPositiveFiniteNumber(order.lastObservedPrice)) ||
    !Array.isArray(order.events) ||
    !order.events.every(isPaperOrderEvent) ||
    !Array.isArray(order.fills) ||
    !order.fills.every(isPaperFill)
  ) return false;

  const fills = order.fills as PaperFill[];
  const bought = fills.filter((fill) => fill.side === "buy").reduce((sum, fill) => sum + fill.quantity, 0);
  const sold = fills.filter((fill) => fill.side === "sell").reduce((sum, fill) => sum + fill.quantity, 0);
  if (bought !== order.filledQuantity || sold !== order.filledQuantity - (order.filledQuantity ? order.remainingQuantity : 0)) return false;

  if (order.status === "pending") {
    return order.entryFillPrice === null && order.openedAt === null && order.closedAt === null
      && order.remainingQuantity === order.quantity && order.filledQuantity === 0;
  }
  if (order.status === "open") {
    return order.entryFillPrice !== null && order.openedAt !== null && order.closedAt === null
      && order.remainingQuantity > 0
      && order.filledQuantity === order.quantity
      && order.partialT1Quantity + order.remainingQuantity === order.quantity;
  }
  if (order.status === "closed") {
    return order.entryFillPrice !== null && order.openedAt !== null && order.closedAt !== null
      && order.remainingQuantity === 0 && order.filledQuantity === order.quantity;
  }
  return order.entryFillPrice === null && order.openedAt === null && order.closedAt === null
    && order.remainingQuantity === order.quantity && order.filledQuantity === 0;
}

function isPaperOrderStage(value: unknown): value is PaperOrderStage {
  return value === "pending" || value === "open" || value === "closed" || value === "cancelled" || value === "expired";
}

function isPaperFill(value: unknown): value is PaperFill {
  return isRecord(value)
    && isFiniteTimestamp(value.timestamp)
    && (value.side === "buy" || value.side === "sell")
    && typeof value.quantity === "number" && Number.isInteger(value.quantity) && value.quantity > 0
    && isPositiveFiniteNumber(value.price)
    && (value.label === "Entry" || value.label === "T1" || value.label === "T2" || value.label === "Stop" || value.label === "Time exit" || value.label === "Manual");
}

/**
 * Adds `fills` to orders saved before executions were recorded, rebuilding them from the
 * entry, T1 and closing state. Records that already have fills are returned unchanged.
 */
export function upgradePaperOrder(value: unknown): unknown {
  if (!isRecord(value) || "fills" in value) return value;
  const order = value as Omit<PaperOrder, "fills">;
  const fills: PaperFill[] = [];
  if (typeof order.entryFillPrice === "number" && typeof order.openedAt === "number") {
    fills.push({ timestamp: order.openedAt, side: "buy", quantity: order.quantity, price: order.entryFillPrice, label: "Entry" });
    let t1Pnl = 0;
    if (order.partialT1Quantity > 0) {
      const at = order.events?.find((event) => event.message.startsWith("T1 reached"))?.timestamp ?? order.openedAt;
      fills.push({ timestamp: at, side: "sell", quantity: order.partialT1Quantity, price: order.plan.target1, label: "T1" });
      t1Pnl = (order.plan.target1 - order.entryFillPrice) * order.partialT1Quantity;
    }
    const rest = order.quantity - order.partialT1Quantity;
    if (order.status === "closed" && typeof order.closedAt === "number" && rest > 0) {
      const label: PaperFillLabel = order.reason.startsWith("T2") ? "T2" : order.reason.startsWith("Time exit") ? "Time exit" : "Stop";
      const price = order.entryFillPrice + (order.realizedPnl - t1Pnl) / rest;
      fills.push({ timestamp: order.closedAt, side: "sell", quantity: rest, price: Math.round(price * 100) / 100, label });
    }
  }
  return { ...order, fills };
}

function isPaperOrderEvent(value: unknown): value is PaperOrderEvent {
  return isRecord(value)
    && isFiniteTimestamp(value.timestamp)
    && typeof value.message === "string";
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isFiniteTimestamp(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function advancePaperOrderCore(
  order: PaperOrder,
  quote: PaperQuote,
  market: PaperMarketState,
): PaperAdvanceResult {
  const reject = (rejection: PaperAdvanceRejection): PaperAdvanceResult => ({
    accepted: false,
    order,
    rejection,
  });

  if (order.stage !== "pending" && order.stage !== "open") return reject("order-not-active");
  if (!isFiniteTimestamp(market.now)) return reject("invalid-market-time");
  if (market.phase !== "OPEN") return reject("market-not-open");
  if (!market.isLive) return reject("market-not-live");
  if (market.simulated) return reject("simulated-market");
  if (!Number.isFinite(quote.price) || quote.price <= 0 || !isFiniteTimestamp(quote.timestamp)) {
    return reject("invalid-quote");
  }
  if (quote.symbol !== undefined && quote.symbol.toUpperCase() !== order.symbol) return reject("quote-symbol-mismatch");
  if (!isTradingDay(market.now) || !isTradingDay(quote.timestamp)) return reject("non-trading-session");
  if (quote.timestamp > market.now) return reject("future-quote");
  if (market.now - quote.timestamp > MAX_PAPER_QUOTE_AGE_MS) return reject("stale-quote");
  if (quote.timestamp <= order.approvedAt || (order.lastProcessedAt !== null && quote.timestamp <= order.lastProcessedAt)) {
    return reject("quote-not-new");
  }

  const quoteDate = istDateKey(quote.timestamp);
  const tradingSessionsSinceSignal = countTradingSessionsAfter(order.signalDate, quoteDate, PAPER_ENTRY_WINDOW_SESSIONS + 1);
  if (order.stage === "pending" && tradingSessionsSinceSignal > PAPER_ENTRY_WINDOW_SESSIONS) {
    return accept({
      ...order,
      stage: "expired",
      reason: `Entry window expired after ${PAPER_ENTRY_WINDOW_SESSIONS} trading sessions without a fill.`,
      updatedAt: quote.timestamp,
      lastProcessedAt: quote.timestamp,
      lastObservedPrice: quote.price,
    });
  }

  if (order.stage === "pending") {
    if (quote.price > order.plan.buyZoneHigh) {
      return accept({
        ...order,
        stage: "cancelled",
        reason: "Skipped: the first observed live price was above the buy-zone high.",
        updatedAt: quote.timestamp,
        lastProcessedAt: quote.timestamp,
        lastObservedPrice: quote.price,
      });
    }

    const previousPrice = order.lastObservedPrice;
    if (
      quoteDate !== order.signalDate &&
      previousPrice !== null &&
      previousPrice < order.plan.entry &&
      quote.price >= order.plan.entry
    ) {
      return accept({
        ...order,
        stage: "open",
        entryFillPrice: quote.price,
        openedAt: quote.timestamp,
        fills: [...order.fills, { timestamp: quote.timestamp, side: "buy", quantity: order.quantity, price: quote.price, label: "Entry" }],
        reason: `Live price crossed the entry trigger; simulated fill at ${quote.price.toFixed(2)}.`,
        updatedAt: quote.timestamp,
        lastProcessedAt: quote.timestamp,
        lastObservedPrice: quote.price,
      });
    }

    return accept({
      ...order,
      reason: quoteDate === order.signalDate
        ? "Signal-day quote observed; fills are not allowed until a later trading session."
        : "Live quote observed; waiting for a crossing up through the entry trigger.",
      updatedAt: quote.timestamp,
      lastProcessedAt: quote.timestamp,
      lastObservedPrice: quote.price,
    });
  }

  return advanceOpenOrder(order, quote);
}

function advanceOpenOrder(order: PaperOrder, quote: PaperQuote): PaperAdvanceResult {
  const previousPrice = order.lastObservedPrice;
  const entryFillPrice = order.entryFillPrice;
  if (entryFillPrice === null || previousPrice === null || order.openedAt === null) {
    throw new Error(`Open paper order ${order.id} is missing its fill or quote state.`);
  }

  const activeStop = order.partialT1Quantity > 0 ? entryFillPrice : order.plan.stop;
  if (quote.price <= activeStop) {
    return accept(closeOrder(order, quote, quote.price, order.remainingQuantity, "Stop hit; remaining shares exited at the observed quote."));
  }

  let partialT1Quantity = order.partialT1Quantity;
  let remainingQuantity = order.remainingQuantity;
  let realizedPnl = order.realizedPnl;
  let reason = "Position remains open.";
  const fills = [...order.fills];
  const sell = (quantity: number, price: number, label: PaperFillLabel) =>
    fills.push({ timestamp: quote.timestamp, side: "sell", quantity, price, label });

  if (partialT1Quantity === 0 && previousPrice < order.plan.target1 && quote.price >= order.plan.target1) {
    partialT1Quantity = Math.floor(order.quantity / 2);
    remainingQuantity -= partialT1Quantity;
    realizedPnl += (order.plan.target1 - entryFillPrice) * partialT1Quantity;
    sell(partialT1Quantity, order.plan.target1, "T1");
    reason = `T1 reached; sold ${partialT1Quantity} shares and moved the stop to cost.`;
  }

  if (remainingQuantity > 0 && previousPrice < order.plan.target2 && quote.price >= order.plan.target2) {
    realizedPnl += (order.plan.target2 - entryFillPrice) * remainingQuantity;
    sell(remainingQuantity, order.plan.target2, "T2");
    return accept({
      ...order,
      stage: "closed",
      partialT1Quantity,
      remainingQuantity: 0,
      realizedPnl,
      fills,
      reason: "T2 reached; remaining shares exited at T2.",
      updatedAt: quote.timestamp,
      lastProcessedAt: quote.timestamp,
      lastObservedPrice: quote.price,
      closedAt: quote.timestamp,
    });
  }

  const sessionsHeld = countTradingSessionsAfter(istDateKey(order.openedAt), istDateKey(quote.timestamp), PAPER_MAX_HOLD_SESSIONS);
  if (sessionsHeld >= PAPER_MAX_HOLD_SESSIONS && remainingQuantity > 0) {
    realizedPnl += (quote.price - entryFillPrice) * remainingQuantity;
    sell(remainingQuantity, quote.price, "Time exit");
    return accept({
      ...order,
      stage: "closed",
      partialT1Quantity,
      remainingQuantity: 0,
      realizedPnl,
      fills,
      reason: `Time exit after ${PAPER_MAX_HOLD_SESSIONS} trading sessions; remaining shares exited at the observed quote.`,
      updatedAt: quote.timestamp,
      lastProcessedAt: quote.timestamp,
      lastObservedPrice: quote.price,
      closedAt: quote.timestamp,
    });
  }

  return accept({
    ...order,
    partialT1Quantity,
    remainingQuantity,
    realizedPnl,
    fills,
    reason,
    updatedAt: quote.timestamp,
    lastProcessedAt: quote.timestamp,
    lastObservedPrice: quote.price,
  });
}

function closeOrder(
  order: PaperOrder,
  quote: PaperQuote,
  exitPrice: number,
  exitQuantity: number,
  reason: string,
): PaperOrder {
  const entryFillPrice = order.entryFillPrice;
  if (entryFillPrice === null) throw new Error(`Open paper order ${order.id} has no entry fill.`);
  return freezeOrder({
    ...order,
    status: "closed",
    stage: "closed",
    remainingQuantity: 0,
    realizedPnl: order.realizedPnl + (exitPrice - entryFillPrice) * exitQuantity,
    fills: [...order.fills, { timestamp: quote.timestamp, side: "sell", quantity: exitQuantity, price: exitPrice, label: "Stop" }],
    reason,
    updatedAt: quote.timestamp,
    lastProcessedAt: quote.timestamp,
    lastObservedPrice: quote.price,
    closedAt: quote.timestamp,
  });
}

function accept(order: PaperOrder): PaperAdvanceResult {
  // Log state changes only; repeated "still open/waiting" quotes would flood storage at a 5-second poll.
  const repeated = order.events.at(-1)?.message === order.reason;
  const updated = freezeOrder({
    ...order,
    events: repeated ? order.events : [...order.events, { timestamp: order.updatedAt, message: order.reason }],
  });
  return { accepted: true, order: updated };
}

function freezeOrder(order: PaperOrder): PaperOrder {
  const normalized = {
    ...order,
    status: order.stage,
    filledQuantity: order.entryFillPrice === null ? 0 : order.quantity,
    lastQuoteTimestamp: order.lastProcessedAt,
    entryPrice: order.entryFillPrice,
    activeStop: order.partialT1Quantity > 0 && order.entryFillPrice !== null
      ? order.entryFillPrice
      : order.plan.stop,
    plan: Object.freeze({ ...order.plan }),
    events: Object.freeze(order.events.map((event) => Object.freeze({ ...event }))),
    fills: Object.freeze(order.fills.map((fill) => Object.freeze({ ...fill }))),
  };
  return Object.freeze(normalized);
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
}

function countTradingSessionsAfter(startDate: string, endDate: string, limit: number): number {
  if (endDate <= startDate) return 0;
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  let count = 0;

  while (cursor.getTime() < end && count < limit) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = cursor.toISOString().slice(0, 10);
    if (isTradingDay(Date.parse(`${date}T12:00:00.000Z`))) count += 1;
  }
  return count;
}
