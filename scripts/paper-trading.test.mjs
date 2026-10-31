import test from "node:test";
import assert from "node:assert/strict";
import {
  advancePaperOrder,
  cancelPaperOrder,
  closePaperOrderNow,
  createPaperOrder,
  istDayKey,
  isPaperOrder,
  MAX_PAPER_QUOTE_AGE_MS,
  tradingSessionsBetween,
} from "../src/lib/screen/paperTrading.ts";

const plan = { entry: 100, buyZoneHigh: 102, stop: 95, target1: 110, target2: 120 };
const market = (now, overrides = {}) => ({ phase: "OPEN", isLive: true, now, simulated: false, ...overrides });
const at = (date, hour = "04:00:00.000Z") => Date.parse(`${date}T${hour}`);
const quote = (date, price, seconds = 0) => ({ price, timestamp: at(date, `04:00:${String(seconds).padStart(2, "0")}.000Z`) });
const makeOrder = (overrides = {}) => createPaperOrder({
  id: "order-1",
  symbol: "abc",
  plan,
  signalDate: "2026-09-28",
  approvedAt: at("2026-09-28", "10:10:00.000Z"),
  quantity: 10,
  ...overrides,
});
const advance = (order, observedQuote, now = observedQuote.timestamp + 1_000, state = {}) =>
  advancePaperOrder(order, observedQuote, market(now, state));
const mustAdvance = (...args) => {
  const result = advance(...args);
  assert.equal(result.accepted, true, result.accepted ? "" : result.rejection);
  return result.order;
};
const openOrder = () => {
  let order = makeOrder();
  order = mustAdvance(order, quote("2026-09-29", 98));
  return mustAdvance(order, quote("2026-09-29", 100, 1));
};

test("creates an immutable manual-approval snapshot and validates the plan", () => {
  const order = makeOrder();
  assert.equal(order.symbol, "ABC");
  assert.equal(order.name, "abc");
  assert.equal(order.stage, "pending");
  assert.equal(order.filledQuantity, 0);
  assert.equal(order.remainingQuantity, 10);
  assert.equal(order.lastQuoteTimestamp, null);
  assert.equal(order.plan.entry, 100);
  assert.equal(Object.isFrozen(order), true);
  assert.equal(Object.isFrozen(order.plan), true);
  assert.throws(() => makeOrder({ quantity: 1 }), /at least 2 shares/);
  assert.throws(() => makeOrder({ signalDate: "2026-02-30" }), /valid YYYY-MM-DD/);
  assert.throws(() => makeOrder({ plan: { ...plan, target1: 101 } }), /Plan levels/);
  assert.throws(() => makeOrder({ plan: { ...plan, stop: Number.NaN } }), /finite positive/);
});

test("supports only confirmed Buy ready approvals and persists validated order state", () => {
  const pick = { symbol: "ABC", name: "ABC Limited", status: "buy-ready", sources: ["Core Setups"], plan };
  const order = createPaperOrder(pick, "2026-09-28", 10, at("2026-09-28", "10:10:00.000Z"));
  assert.equal(order.name, "ABC Limited");
  assert.equal(order.source, "Core Setups");
  const persisted = JSON.parse(JSON.stringify(order));
  assert.equal(isPaperOrder(persisted), true);
  assert.equal(isPaperOrder(null), false);
  assert.equal(isPaperOrder({ ...persisted, quantity: Number.NaN }), false);
  assert.equal(isPaperOrder({ ...persisted, status: "unknown", stage: "unknown" }), false);
  assert.equal(isPaperOrder({ ...persisted, events: [{ timestamp: Number.NaN, message: "bad" }] }), false);
  const missingUiField = { ...persisted };
  delete missingUiField.lastQuoteTimestamp;
  assert.equal(isPaperOrder(missingUiField), false);
  assert.throws(() => createPaperOrder({ ...pick, status: "watch" }, "2026-09-28", 10, order.approvedAt), /Buy ready/);

  const cancelled = cancelPaperOrder(order, order.approvedAt + 1);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.events.at(-1).message, "Cancelled manually before entry.");
  assert.throws(() => cancelPaperOrder(cancelled, cancelled.updatedAt + 1), /Only pending/);
  assert.throws(() => cancelPaperOrder(order, Number.NaN), /timestamp must be valid/);
  assert.throws(() => cancelPaperOrder(order, order.updatedAt), /newer than the last order update/);
  assert.equal(tradingSessionsBetween("2026-10-02", "2026-10-06"), 2);

  const adapted = advancePaperOrder(
    order,
    { symbol: "ABC", name: "ABC Ltd", kind: "EQUITY", ltp: 99, timestamp: at("2026-09-29"), previousClose: 98, change: 1, changePercent: 1, open: 98, high: 99, low: 98, volume: 1000 },
    { phase: "OPEN", isLive: true, label: "Market open", exchange: "NSE", serverTimeIst: "2026-09-29 09:30:00", nextTransition: null, nextTransitionLabel: null },
    at("2026-09-29") + 1_000,
  );
  assert.equal(adapted.status, "pending");
  assert.equal(adapted.name, "ABC Limited");
  assert.equal(adapted.lastQuoteTimestamp, at("2026-09-29"));
  assert.equal(isPaperOrder(adapted), true);
});

test("closes an open order manually at a chosen price, independent of stop/T1/T2", () => {
  const order = openOrder(); // entry fill at 100
  const at1 = order.updatedAt + 1_000;
  const closed = closePaperOrderNow(order, 101.5, at1);
  assert.equal(closed.status, "closed");
  assert.equal(closed.stage, "closed");
  assert.equal(closed.remainingQuantity, 0);
  assert.equal(closed.partialT1Quantity, 0); // no T1 booking happened first
  assert.equal(Math.round(closed.realizedPnl * 100) / 100, Math.round((101.5 - 100) * 10 * 100) / 100);
  const fill = closed.fills.at(-1);
  assert.equal(fill.side, "sell");
  assert.equal(fill.quantity, 10);
  assert.equal(fill.price, 101.5);
  assert.equal(fill.label, "Manual");
  assert.equal(closed.closedAt, at1);
  assert.match(closed.events.at(-1).message, /Closed manually at ₹101\.50/);
  assert.equal(isPaperOrder(closed), true);
});

test("closePaperOrderNow only books the still-open remainder after a T1 partial", () => {
  let order = openOrder();
  order = mustAdvance(order, quote("2026-09-30", 110)); // T1 at 110, sells half
  assert.equal(order.partialT1Quantity, 5);
  const closed = closePaperOrderNow(order, 112, order.updatedAt + 1_000);
  assert.equal(closed.remainingQuantity, 0);
  const manualFill = closed.fills.find((f) => f.label === "Manual");
  assert.equal(manualFill.quantity, 5); // only the remaining half, T1's half stays booked separately
});

test("closePaperOrderNow rejects pending/closed orders, bad prices and non-advancing timestamps", () => {
  const pending = makeOrder();
  assert.throws(() => closePaperOrderNow(pending, 100, pending.approvedAt + 1), /Only an open paper order/);

  const order = openOrder();
  assert.throws(() => closePaperOrderNow(order, -5, order.updatedAt + 1), /positive finite number/);
  assert.throws(() => closePaperOrderNow(order, 100, Number.NaN), /timestamp must be valid/);
  assert.throws(() => closePaperOrderNow(order, 100, order.updatedAt), /newer than the last order update/);

  const closed = closePaperOrderNow(order, 101, order.updatedAt + 1_000);
  assert.throws(() => closePaperOrderNow(closed, 102, closed.updatedAt + 1), /Only an open paper order/);
});

test("exports IST day and trading-session helpers for UI guards", () => {
  assert.equal(istDayKey(at("2026-10-01", "19:00:00.000Z")), "2026-10-02");
  assert.equal(tradingSessionsBetween("2026-10-02", "2026-10-06"), 2);
  assert.throws(() => istDayKey(Number.NaN), /valid finite timestamp/);
});

test("does not fill on the signal day and requires an observed upward crossing", () => {
  let order = makeOrder({ signalDate: "2026-09-29", approvedAt: at("2026-09-29", "03:00:00.000Z") });
  order = mustAdvance(order, quote("2026-09-29", 99));
  assert.equal(order.stage, "pending");
  order = mustAdvance(order, quote("2026-09-29", 101, 1));
  assert.equal(order.stage, "pending");
  order = mustAdvance(order, quote("2026-09-30", 100));
  assert.equal(order.stage, "pending");
  order = mustAdvance(order, quote("2026-09-30", 99, 1));
  order = mustAdvance(order, quote("2026-09-30", 101, 2));
  assert.equal(order.stage, "open");
  assert.equal(order.entryFillPrice, 101);
});

test("skips an extended first observation and conservatively rejects an entry gap above the zone", () => {
  const first = mustAdvance(makeOrder(), quote("2026-09-29", 103));
  assert.equal(first.stage, "cancelled");
  assert.match(first.reason, /above the buy-zone high/);

  let order = makeOrder();
  order = mustAdvance(order, quote("2026-09-29", 99));
  const gap = mustAdvance(order, quote("2026-09-29", 103, 1));
  assert.equal(gap.stage, "cancelled");
  assert.equal(gap.entryFillPrice, null);
});

test("rejects invalid, stale, replayed, closed-market, and simulated quotes without changing the order", () => {
  const order = makeOrder();
  const validQuote = quote("2026-09-29", 99);
  assert.equal(advance(order, { ...validQuote, price: Number.NaN }).rejection, "invalid-quote");
  assert.equal(advance(order, { ...validQuote, timestamp: Number.NaN }, validQuote.timestamp + 1_000).rejection, "invalid-quote");
  assert.equal(advance(order, validQuote, validQuote.timestamp + MAX_PAPER_QUOTE_AGE_MS + 1).rejection, "stale-quote");
  assert.equal(advance(order, validQuote, validQuote.timestamp + 120_000).accepted, true);
  assert.equal(advance(order, { ...validQuote, symbol: "OTHER" }).rejection, "quote-symbol-mismatch");
  assert.equal(advance(order, validQuote, validQuote.timestamp + 1_000, { phase: "CLOSED" }).rejection, "market-not-open");
  assert.equal(advance(order, validQuote, validQuote.timestamp + 1_000, { simulated: true }).rejection, "simulated-market");

  const processed = mustAdvance(order, validQuote);
  assert.equal(advance(processed, validQuote).rejection, "quote-not-new");
  assert.equal(processed.lastProcessedAt, validQuote.timestamp);
  assert.equal(order.lastProcessedAt, null);
});

test("sells half at T1, then moves the stop to cost for the remainder", () => {
  let order = openOrder();
  order = mustAdvance(order, quote("2026-09-29", 110, 2));
  assert.equal(order.stage, "open");
  assert.equal(order.partialT1Quantity, 5);
  assert.equal(order.remainingQuantity, 5);
  assert.equal(order.realizedPnl, 50);

  order = mustAdvance(order, quote("2026-09-29", 90, 3));
  assert.equal(order.stage, "closed");
  assert.equal(order.remainingQuantity, 0);
  assert.equal(order.realizedPnl, 0);
  assert.match(order.reason, /Stop hit/);
});

test("processes a quote that jumps over T1 and T2 at both target levels", () => {
  let order = openOrder();
  order = mustAdvance(order, quote("2026-09-29", 125, 2));
  assert.equal(order.stage, "closed");
  assert.equal(order.partialT1Quantity, 5);
  assert.equal(order.realizedPnl, 150);
  assert.match(order.reason, /T2 reached/);
});

test("uses stop-first behavior when a quote gaps below the stop", () => {
  let order = openOrder();
  order = mustAdvance(order, quote("2026-09-29", 90, 2));
  assert.equal(order.stage, "closed");
  assert.equal(order.realizedPnl, -100);
  assert.match(order.reason, /Stop hit/);
});

test("counts exchange holidays and expires after the third eligible entry session", () => {
  const previousHolidays = process.env.MARKET_HOLIDAYS;
  process.env.MARKET_HOLIDAYS = "2026-10-05";
  try {
    let order = makeOrder({ signalDate: "2026-10-01", approvedAt: at("2026-10-01", "10:00:00.000Z") });
    const holidayQuote = quote("2026-10-05", 99);
    assert.equal(advance(order, holidayQuote).rejection, "non-trading-session");

    for (const date of ["2026-10-06", "2026-10-07", "2026-10-08"]) {
      order = mustAdvance(order, quote(date, 99));
      assert.equal(order.stage, "pending");
    }
    order = mustAdvance(order, quote("2026-10-09", 99));
    assert.equal(order.stage, "expired");
    assert.match(order.reason, /3 trading sessions/);
  } finally {
    if (previousHolidays === undefined) delete process.env.MARKET_HOLIDAYS;
    else process.env.MARKET_HOLIDAYS = previousHolidays;
  }
});

test("exits on the first observed quote after 30 trading sessions", () => {
  let order = makeOrder({ signalDate: "2026-02-02", approvedAt: at("2026-02-02", "03:00:00.000Z") });
  order = mustAdvance(order, quote("2026-02-03", 99));
  order = mustAdvance(order, quote("2026-02-03", 100, 1));

  let date = new Date("2026-02-03T00:00:00.000Z");
  let sessions = 0;
  while (sessions < 30) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) sessions += 1;
  }
  const dueDate = date.toISOString().slice(0, 10);
  order = mustAdvance(order, quote(dueDate, 105));
  assert.equal(order.stage, "closed");
  assert.equal(order.realizedPnl, 50);
  assert.match(order.reason, /Time exit after 30 trading sessions/);
});

test("logs only state changes, not every repeated quote", () => {
  let order = openOrder();
  const before = order.events.length;
  for (let s = 2; s < 30; s++) order = mustAdvance(order, quote("2026-09-29", 101, s));
  assert.equal(order.events.length, before + 1);
  assert.equal(order.events.at(-1).message, "Position remains open.");
});

test("demo orders are identified by id prefix and still validate", async () => {
  const { isDemoPaperOrder } = await import("../src/lib/screen/paperTrading.ts");
  const order = makeOrder();
  assert.equal(isDemoPaperOrder(order), false);
  const demo = { ...JSON.parse(JSON.stringify(order)), id: `demo-${order.id}` };
  assert.equal(isDemoPaperOrder(demo), true);
  assert.equal(isPaperOrder(demo), true);
});

test("records every simulated execution as a fill with time, quantity and price", async () => {
  const { upgradePaperOrder } = await import("../src/lib/screen/paperTrading.ts");
  let order = openOrder();
  assert.deepEqual(order.fills.map((f) => [f.side, f.quantity, f.price, f.label]), [["buy", 10, 100, "Entry"]]);
  assert.equal(order.fills[0].timestamp, order.openedAt);
  order = mustAdvance(order, quote("2026-09-30", 111));
  order = mustAdvance(order, quote("2026-10-01", 121));
  assert.equal(order.status, "closed");
  assert.deepEqual(order.fills.map((f) => [f.side, f.quantity, f.price, f.label]), [
    ["buy", 10, 100, "Entry"], ["sell", 5, 110, "T1"], ["sell", 5, 120, "T2"],
  ]);
  const sold = order.fills.filter((f) => f.side === "sell").reduce((s, f) => s + (f.price - 100) * f.quantity, 0);
  assert.equal(sold, order.realizedPnl);
  assert.equal(Object.isFrozen(order.fills[0]), true);

  const stopped = mustAdvance(openOrder(), quote("2026-09-30", 94));
  assert.deepEqual(stopped.fills.at(-1), { timestamp: stopped.closedAt, side: "sell", quantity: 10, price: 94, label: "Stop" });

  // Orders saved before fills existed are rebuilt from their entry, T1 and closing state.
  const legacy = JSON.parse(JSON.stringify(order));
  delete legacy.fills;
  assert.equal(isPaperOrder(legacy), false);
  const upgraded = upgradePaperOrder(legacy);
  assert.equal(isPaperOrder(upgraded), true);
  assert.deepEqual(upgraded.fills.map((f) => [f.side, f.quantity, f.price, f.label]), order.fills.map((f) => [f.side, f.quantity, f.price, f.label]));
  const tampered = { ...JSON.parse(JSON.stringify(order)), fills: order.fills.slice(0, 2) };
  assert.equal(isPaperOrder(tampered), false);
});
