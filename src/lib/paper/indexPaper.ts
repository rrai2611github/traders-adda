/**
 * Index paper trading: Nifty and Bank Nifty futures, long or short, in lots.
 * Pure state machine over saved orders: every function takes the order and a quote and returns a new order,
 * so the server loop, the API and the tests agree. Simulation only; no broker order is ever placed.
 */

export type IndexKey = "NIFTY" | "BANKNIFTY";
export type IndexSide = "long" | "short";
export type IndexStatus = "pending" | "open" | "closed" | "cancelled" | "expired";
export type SquareOff = "intraday" | "carry";
export type IndexExitReason = "stop" | "target" | "squareoff" | "manual";

export interface IndexEvent {
  timestamp: number;
  message: string;
}

export interface IndexOrder {
  id: string;
  index: IndexKey;
  side: IndexSide;
  lots: number;
  lotSize: number;
  /** Price that starts the order: buy above (long) or sell below (short). Null means market: fill on the next quote. */
  trigger: number | null;
  stop: number;
  target: number | null;
  squareOff: SquareOff;
  source: "manual" | "framework";
  status: IndexStatus;
  /** IST day the order was placed; a pending order is good for that day only. */
  day: string;
  contract: string | null;
  createdAt: number;
  openedAt: number | null;
  closedAt: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  exitReason: IndexExitReason | null;
  lastPrice: number | null;
  lastQuoteAt: number | null;
  events: IndexEvent[];
}

export const SQUARE_OFF_MINUTE = 15 * 60 + 15;
export const MAX_INDEX_QUOTE_AGE_MS = 60_000;
export const MAX_LOTS = 50;
/** Rough futures margin as a share of contract value (the same figure the Scalp Desk uses). */
export const DEFAULT_MARGIN_PERCENT = 12;

const IST_MS = 19_800_000;
export const istDay = (t: number) => new Date(t + IST_MS).toISOString().slice(0, 10);
export const istMinuteOfDay = (t: number) => Math.floor(((t + IST_MS) % 86_400_000) / 60_000);
const dir = (side: IndexSide) => (side === "long" ? 1 : -1);

export interface NewIndexOrder {
  id: string;
  index: IndexKey;
  side: IndexSide;
  lots: number;
  lotSize: number;
  trigger: number | null;
  /** Current futures price, used to check that the trigger, stop and target sit on the right sides. */
  referencePrice: number;
  stop: number;
  target: number | null;
  squareOff: SquareOff;
  source?: "manual" | "framework";
  now: number;
}

export function createIndexOrder(input: NewIndexOrder): IndexOrder {
  const { side, trigger, stop, target, referencePrice: ref } = input;
  if (!Number.isInteger(input.lots) || input.lots < 1 || input.lots > MAX_LOTS) throw new RangeError(`Lots must be a whole number from 1 to ${MAX_LOTS}.`);
  if (!(input.lotSize > 0) || !(ref > 0)) throw new RangeError("Lot size and the current price must be positive.");
  if (![stop, ...(trigger != null ? [trigger] : []), ...(target != null ? [target] : [])].every((v) => Number.isFinite(v) && v > 0)) throw new RangeError("Trigger, stop and target must be positive numbers.");
  const d = dir(side);
  if (trigger != null && (trigger - ref) * d <= 0) {
    throw new RangeError(`A ${side} trigger must be ${side === "long" ? "above" : "below"} the current price ${ref}; use a market order to enter now.`);
  }
  const basis = trigger ?? ref;
  if ((basis - stop) * d <= 0) throw new RangeError(`The stop must be ${side === "long" ? "below" : "above"} the entry ${basis}.`);
  if (target != null && (target - basis) * d <= 0) throw new RangeError(`The target must be ${side === "long" ? "above" : "below"} the entry ${basis}.`);
  return {
    id: input.id, index: input.index, side, lots: input.lots, lotSize: input.lotSize, trigger, stop, target,
    squareOff: input.squareOff, source: input.source ?? "manual", status: "pending", day: istDay(input.now), contract: null,
    createdAt: input.now, openedAt: null, closedAt: null, entryPrice: null, exitPrice: null, exitReason: null,
    lastPrice: null, lastQuoteAt: null,
    events: [{ timestamp: input.now, message: trigger == null ? `Market ${side} order placed.` : `${side === "long" ? "Buy above" : "Sell below"} ${trigger} order placed.` }],
  };
}

export const isActive = (order: IndexOrder) => order.status === "pending" || order.status === "open";
export const units = (order: IndexOrder) => order.lots * order.lotSize;

/** Gross rupee P&L at `price` (long gains when price rises, short when it falls). */
export const pnlAt = (order: IndexOrder, price: number): number =>
  order.entryPrice == null ? 0 : (price - order.entryPrice) * dir(order.side) * units(order);

export interface IndexQuote {
  price: number;
  timestamp: number;
  contract: string;
}

export interface AdvanceContext {
  now: number;
  /** The exchange is in continuous trading. */
  isLive: boolean;
  /** A loss or trade-count limit is hit: pending orders must not fill. */
  entryBlocked: boolean;
}

const note = (order: IndexOrder, timestamp: number, message: string): IndexOrder => ({ ...order, events: [...order.events, { timestamp, message }] });

function exit(order: IndexOrder, price: number, timestamp: number, reason: IndexExitReason, message: string): IndexOrder {
  return note({ ...order, status: "closed", closedAt: timestamp, exitPrice: price, exitReason: reason, lastPrice: price, lastQuoteAt: timestamp }, timestamp, message);
}

/** Moves an order forward on one quote. Returns the same object when nothing changed, a new one otherwise. */
export function advanceIndexOrder(order: IndexOrder, quote: IndexQuote, ctx: AdvanceContext): IndexOrder {
  if (!isActive(order) || !ctx.isLive) return order;
  const { price, timestamp } = quote;
  if (!(price > 0) || !Number.isFinite(timestamp) || timestamp > ctx.now) return order;
  if (ctx.now - timestamp > MAX_INDEX_QUOTE_AGE_MS) return order;
  if (order.lastQuoteAt != null && timestamp <= order.lastQuoteAt) return order;
  const d = dir(order.side);
  const squareOffTime = istMinuteOfDay(ctx.now) >= SQUARE_OFF_MINUTE;
  let next: IndexOrder = { ...order, lastPrice: price, lastQuoteAt: timestamp };

  if (next.status === "pending") {
    if (istDay(ctx.now) !== next.day || (next.squareOff === "intraday" && squareOffTime)) {
      return note({ ...next, status: "expired", closedAt: timestamp }, timestamp, "Not triggered before the end of the day; the order expired.");
    }
    if (ctx.entryBlocked) return next;
    const triggered = next.trigger == null || (price - next.trigger) * d >= 0;
    if (!triggered) return next;
    next = note({ ...next, status: "open", openedAt: timestamp, entryPrice: price, contract: quote.contract },
      timestamp, `${order.side === "long" ? "Bought" : "Sold"} ${order.lots} lot${order.lots === 1 ? "" : "s"} at ${price} (${quote.contract}).`);
  }

  // Open: stop first (a gap through it fills at the observed price), then the target, then the 15:15 square-off.
  if ((price - next.stop) * d <= 0) return exit(next, price, timestamp, "stop", `Stop ${next.stop} hit; exited at ${price}.`);
  if (next.target != null && (price - next.target) * d >= 0) return exit(next, price, timestamp, "target", `Target ${next.target} hit; exited at ${price}.`);
  if (next.squareOff === "intraday" && squareOffTime) return exit(next, price, timestamp, "squareoff", `Intraday square-off at 15:15; exited at ${price}.`);
  return next;
}

export function cancelIndexOrder(order: IndexOrder, now: number): IndexOrder {
  if (order.status !== "pending") throw new Error("Only a pending order can be cancelled.");
  return note({ ...order, status: "cancelled", closedAt: now }, now, "Cancelled before it triggered.");
}

export function closeIndexOrderNow(order: IndexOrder, price: number, now: number): IndexOrder {
  if (order.status !== "open") throw new Error("Only an open position can be closed.");
  if (!(price > 0)) throw new RangeError("Exit price must be positive.");
  return exit(order, price, now, "manual", `Closed manually at ${price}.`);
}

/* ---------- money ---------- */

/** Subset of the Scalp Desk cost model, so the pure module needs no import from it. */
export interface FuturesCostModel {
  lotSize: number;
  slippagePerSide: number;
  brokeragePerOrder: number;
  exchangePct: number;
  sttSellPct: number;
  stampBuyPct: number;
  sebiPerCrore: number;
  gstPct: number;
}

/** Round-trip charges and slippage in rupees for the whole order (brokerage is per order, the rest scales with size). */
export function indexOrderCosts(order: IndexOrder, model: FuturesCostModel): number {
  if (order.entryPrice == null) return 0;
  const quantity = units(order);
  const side = order.entryPrice * quantity;
  const brokerage = 2 * model.brokeragePerOrder;
  const exchange = 2 * side * model.exchangePct;
  const sebi = (2 * side * model.sebiPerCrore) / 1e7;
  const gst = (brokerage + exchange + sebi) * model.gstPct;
  return brokerage + exchange + sebi + gst + side * model.sttSellPct + side * model.stampBuyPct + 2 * model.slippagePerSide * quantity;
}

export const marginForLots = (price: number, lotSize: number, lots: number, marginPercent = DEFAULT_MARGIN_PERCENT) => (price * lotSize * lots * marginPercent) / 100;

export interface LotSizing {
  lots: number;
  riskAmount: number;
  margin: number;
  limitedBy: "risk" | "margin" | "none";
}

/** Whole lots that risk at most `riskPercent` of capital to the stop and fit the free margin. */
export function sizeLots(input: { capital: number; riskPercent: number; entry: number; stop: number; lotSize: number; freeMargin: number; marginPercent?: number }): LotSizing {
  const riskPerLot = Math.abs(input.entry - input.stop) * input.lotSize;
  const marginPerLot = marginForLots(input.entry, input.lotSize, 1, input.marginPercent);
  if (!(riskPerLot > 0) || !(marginPerLot > 0)) return { lots: 0, riskAmount: 0, margin: 0, limitedBy: "none" };
  const byRisk = Math.floor((input.capital * input.riskPercent) / 100 / riskPerLot);
  const byMargin = Math.floor(input.freeMargin / marginPerLot);
  const lots = Math.max(0, Math.min(byRisk, byMargin, MAX_LOTS));
  return { lots, riskAmount: lots * riskPerLot, margin: lots * marginPerLot, limitedBy: lots === 0 ? (byMargin <= byRisk ? "margin" : "risk") : byMargin < byRisk ? "margin" : byRisk < byMargin ? "risk" : "none" };
}

/* ---------- risk limits and stats ---------- */

export interface IndexSettings {
  maxTradesPerDay: number;
  maxLossesPerDay: number;
  dailyLossPercent: number;
  weeklyLossPercent: number;
  riskPercent: number;
  marginPercent: number;
}

export const DEFAULT_INDEX_SETTINGS: IndexSettings = {
  maxTradesPerDay: 3, maxLossesPerDay: 2, dailyLossPercent: 2, weeklyLossPercent: 5, riskPercent: 1, marginPercent: DEFAULT_MARGIN_PERCENT,
};

export function weekStart(now: number): string {
  const shifted = new Date(now + IST_MS);
  return new Date(shifted.getTime() - ((shifted.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

export interface IndexRisk {
  tradesToday: number;
  lossesToday: number;
  dayPnl: number;
  weekPnl: number;
  dayLimit: number;
  weekLimit: number;
  marginUsed: number;
  entryBlocked: boolean;
  reasons: string[];
}

export function indexRisk(orders: ReadonlyArray<IndexOrder>, capital: number, s: IndexSettings, now: number): IndexRisk {
  const today = istDay(now);
  const monday = weekStart(now);
  let tradesToday = 0, lossesToday = 0, dayPnl = 0, weekPnl = 0, marginUsed = 0;
  for (const o of orders) {
    if (o.openedAt != null && istDay(o.openedAt) === today) tradesToday++;
    const gross = o.status === "closed" && o.exitPrice != null ? pnlAt(o, o.exitPrice) : o.status === "open" && o.lastPrice != null ? pnlAt(o, o.lastPrice) : 0;
    const when = o.status === "closed" ? o.closedAt : o.openedAt;
    if (when != null && istDay(when) === today) dayPnl += gross;
    if (when != null && istDay(when) >= monday) weekPnl += gross;
    if (o.status === "closed" && o.closedAt != null && istDay(o.closedAt) === today && gross < 0) lossesToday++;
    if (o.status === "open" && o.entryPrice != null) marginUsed += marginForLots(o.entryPrice, o.lotSize, o.lots, s.marginPercent);
  }
  const dayLimit = (capital * s.dailyLossPercent) / 100;
  const weekLimit = (capital * s.weeklyLossPercent) / 100;
  const reasons: string[] = [];
  if (tradesToday >= s.maxTradesPerDay) reasons.push(`Daily trade limit reached: ${tradesToday} of ${s.maxTradesPerDay}.`);
  if (lossesToday >= s.maxLossesPerDay) reasons.push(`${lossesToday} losing trades today: stop trading for the day.`);
  if (dayPnl <= -dayLimit) reasons.push(`Daily loss limit reached: ${Math.round(dayPnl)} against −${Math.round(dayLimit)}.`);
  if (weekPnl <= -weekLimit) reasons.push(`Weekly loss limit reached: ${Math.round(weekPnl)} against −${Math.round(weekLimit)}.`);
  return { tradesToday, lossesToday, dayPnl, weekPnl, dayLimit, weekLimit, marginUsed, entryBlocked: reasons.length > 0, reasons };
}

export interface IndexStats {
  closed: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  net: number;
  maxDrawdown: number;
}

export function indexStats(orders: ReadonlyArray<IndexOrder>, costs: (order: IndexOrder) => number): IndexStats {
  const closed = orders.filter((o) => o.status === "closed" && o.exitPrice != null && o.entryPrice != null).sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let equity = 0, peak = 0, dd = 0, win = 0, loss = 0, wins = 0, r = 0;
  for (const o of closed) {
    const net = pnlAt(o, o.exitPrice!) - costs(o);
    const risk = Math.abs(o.entryPrice! - o.stop) * units(o);
    r += risk > 0 ? net / risk : 0;
    if (net > 0) { wins++; win += net; } else loss -= net;
    equity += net; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity);
  }
  return {
    closed: closed.length, winRate: closed.length ? (wins / closed.length) * 100 : null, expectancyR: closed.length ? r / closed.length : null,
    profitFactor: closed.length && loss > 0 ? win / loss : null, net: equity, maxDrawdown: dd,
  };
}
