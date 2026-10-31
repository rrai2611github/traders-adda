import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INDEX_SETTINGS, advanceIndexOrder, cancelIndexOrder, closeIndexOrderNow, createIndexOrder, indexOrderCosts, indexRisk, indexStats, marginForLots, pnlAt, sizeLots,
} from "../src/lib/paper/indexPaper.ts";

const at = (hhmm, date = "2026-10-14") => Date.parse(`${date}T${hhmm}:00+05:30`);
const make = (o = {}) => createIndexOrder({ id: "o1", index: "NIFTY", side: "long", lots: 2, lotSize: 65, trigger: null, referencePrice: 22700, stop: 22650, target: 22800, squareOff: "intraday", now: at("10:00"), ...o });
const q = (price, hhmm, date) => ({ price, timestamp: at(hhmm, date), contract: "NSE:NIFTY26OCTFUT" });
const ctx = (hhmm, extra = {}) => ({ now: at(hhmm) + 1000, isLive: true, entryBlocked: false, ...extra });
const FUT = { lotSize: 65, slippagePerSide: 1, brokeragePerOrder: 20, exchangePct: 0.0000173, sttSellPct: 0.0005, stampBuyPct: 0.00002, sebiPerCrore: 10, gstPct: 0.18 };

test("order validation: sides of trigger, stop and target; lots; trigger must not already be passed", () => {
  assert.throws(() => make({ lots: 0 }), /Lots must be/);
  assert.throws(() => make({ stop: 22750 }), /stop must be below/);
  assert.throws(() => make({ target: 22600 }), /target must be above/);
  assert.throws(() => make({ trigger: 22650 }), /trigger must be above the current price/);
  assert.throws(() => make({ side: "short", stop: 22650 }), /stop must be above/);
  assert.throws(() => make({ side: "short", trigger: 22800, stop: 22850, target: 22600 }), /trigger must be below/);
  const short = make({ side: "short", stop: 22750, target: 22600 });
  assert.equal(short.status, "pending");
  assert.equal(make({ trigger: 22720 }).trigger, 22720);
});

test("a market order fills on the next live quote and then runs to its target", () => {
  let o = advanceIndexOrder(make(), q(22702, "10:01"), ctx("10:01"));
  assert.equal(o.status, "open");
  assert.equal(o.entryPrice, 22702);
  assert.equal(o.contract, "NSE:NIFTY26OCTFUT");
  o = advanceIndexOrder(o, q(22760, "10:05"), ctx("10:05"));
  assert.equal(o.status, "open");
  assert.equal(pnlAt(o, 22760), (22760 - 22702) * 2 * 65);
  o = advanceIndexOrder(o, q(22803, "10:30"), ctx("10:30"));
  assert.equal(o.status, "closed");
  assert.equal(o.exitReason, "target");
  assert.equal(pnlAt(o, o.exitPrice), (22803 - 22702) * 130);
});

test("a long breakout order waits for the trigger; a short stops out above its stop at the observed price", () => {
  let o = make({ trigger: 22720 });
  o = advanceIndexOrder(o, q(22710, "10:01"), ctx("10:01"));
  assert.equal(o.status, "pending");
  o = advanceIndexOrder(o, q(22724, "10:10"), ctx("10:10"));
  assert.equal(o.status, "open");
  assert.equal(o.entryPrice, 22724, "fills at the quote, not the trigger");

  let s = make({ side: "short", stop: 22750, target: 22600 });
  s = advanceIndexOrder(s, q(22698, "10:01"), ctx("10:01"));
  assert.equal(s.status, "open");
  s = advanceIndexOrder(s, q(22760, "10:20"), ctx("10:20")); // gaps through the 22,750 stop
  assert.equal(s.status, "closed");
  assert.equal(s.exitReason, "stop");
  assert.equal(s.exitPrice, 22760);
  assert.equal(pnlAt(s, s.exitPrice), (22698 - 22760) * 130);
});

test("quotes that are stale, from the future, duplicated, or outside live trading never move an order", () => {
  const o = make();
  assert.equal(advanceIndexOrder(o, q(22702, "10:00"), { now: at("10:03"), isLive: true, entryBlocked: false }), o, "stale");
  assert.equal(advanceIndexOrder(o, q(22702, "10:05"), ctx("10:01")), o, "future quote");
  assert.equal(advanceIndexOrder(o, q(22702, "10:01"), { ...ctx("10:01"), isLive: false }), o, "market closed");
  const filled = advanceIndexOrder(o, q(22702, "10:01"), ctx("10:01"));
  assert.equal(advanceIndexOrder(filled, q(22600, "10:01"), ctx("10:01")), filled, "same quote time is not new");
});

test("a loss or trade limit stops a pending order from filling; an open one keeps its stop", () => {
  const blocked = { ...ctx("10:01"), entryBlocked: true };
  const pending = advanceIndexOrder(make(), q(22702, "10:01"), blocked);
  assert.equal(pending.status, "pending");
  const open = advanceIndexOrder(make(), q(22702, "10:01"), ctx("10:01"));
  const stopped = advanceIndexOrder(open, q(22640, "10:02"), { ...ctx("10:02"), entryBlocked: true });
  assert.equal(stopped.exitReason, "stop");
});

test("intraday orders square off at 15:15 and an untriggered one expires; carry orders stay open", () => {
  const o = advanceIndexOrder(make(), q(22702, "10:01"), ctx("10:01"));
  const sq = advanceIndexOrder(o, q(22710, "15:15"), ctx("15:15"));
  assert.equal(sq.status, "closed");
  assert.equal(sq.exitReason, "squareoff");
  const waiting = advanceIndexOrder(make({ trigger: 22800, target: 22900 }), q(22710, "15:15"), ctx("15:15"));
  assert.equal(waiting.status, "expired");
  const carry = advanceIndexOrder(advanceIndexOrder(make({ squareOff: "carry" }), q(22702, "10:01"), ctx("10:01")), q(22710, "15:20"), ctx("15:20"));
  assert.equal(carry.status, "open");
  const nextDay = advanceIndexOrder(make({ trigger: 22800, target: 22900 }), q(22790, "10:00", "2026-10-15"), { now: at("10:00", "2026-10-15") + 1000, isLive: true, entryBlocked: false });
  assert.equal(nextDay.status, "expired", "a pending order is good for its own day only");
});

test("cancel and manual close", () => {
  const p = make({ trigger: 22720 });
  assert.equal(cancelIndexOrder(p, at("10:02")).status, "cancelled");
  assert.throws(() => closeIndexOrderNow(p, 22700, at("10:02")), /Only an open/);
  const open = advanceIndexOrder(make(), q(22702, "10:01"), ctx("10:01"));
  assert.throws(() => cancelIndexOrder(open, at("10:02")), /Only a pending/);
  const closed = closeIndexOrderNow(open, 22730, at("10:05"));
  assert.equal(closed.exitReason, "manual");
  assert.equal(pnlAt(closed, 22730), 28 * 130);
});

test("costs: one brokerage per order, charges and slippage scale with size", () => {
  const one = indexOrderCosts(advanceIndexOrder(make({ lots: 1 }), q(22700, "10:01"), ctx("10:01")), FUT);
  const four = indexOrderCosts(advanceIndexOrder(make({ lots: 4 }), q(22700, "10:01"), ctx("10:01")), FUT);
  assert.ok(one > 40 && four > one && four < 4 * one, `${one} ${four}`);
  assert.equal(indexOrderCosts(make(), FUT), 0, "no fill, no cost");
});

test("sizing: whole lots within 1% risk and the free margin", () => {
  const s = sizeLots({ capital: 1_000_000, riskPercent: 1, entry: 22700, stop: 22600, lotSize: 65, freeMargin: 1_000_000 });
  assert.equal(s.lots, 1); // 10,000 / (100 x 65) = 1.5 -> 1
  assert.equal(s.riskAmount, 6500);
  const tight = sizeLots({ capital: 1_000_000, riskPercent: 1, entry: 22700, stop: 22690, lotSize: 65, freeMargin: 1_000_000 });
  assert.equal(tight.lots, 5); // margin: 1,000,000 / (22,700 x 65 x 12%) = 5.6 -> 5, fewer than the risk limit allows
  assert.equal(tight.limitedBy, "margin");
  assert.equal(sizeLots({ capital: 1_000_000, riskPercent: 1, entry: 22700, stop: 22600, lotSize: 65, freeMargin: 100_000 }).lots, 0);
  assert.equal(marginForLots(22700, 65, 2), 22700 * 65 * 2 * 0.12);
});

test("risk: three trades, two losers, or a 2% day stop new entries", () => {
  const s = DEFAULT_INDEX_SETTINGS;
  const now = at("12:00");
  const trade = (id, exitPrice, hhmm) => {
    const o = advanceIndexOrder(make({ id }), q(22700, hhmm), { now: at(hhmm) + 1000, isLive: true, entryBlocked: false });
    return closeIndexOrderNow(o, exitPrice, at(hhmm) + 60_000);
  };
  assert.equal(indexRisk([], 1_000_000, s, now).entryBlocked, false);
  const two = [trade("a", 22650, "10:01"), trade("b", 22650, "10:20")]; // two losers of 6,500 each
  const r = indexRisk(two, 1_000_000, s, now);
  assert.equal(r.lossesToday, 2);
  assert.equal(r.entryBlocked, true);
  assert.match(r.reasons.join(" "), /2 losing trades/);
  const three = [trade("a", 22710, "10:01"), trade("b", 22710, "10:20"), trade("c", 22710, "10:40")];
  assert.match(indexRisk(three, 1_000_000, s, now).reasons[0], /Daily trade limit reached: 3 of 3/);
  const big = [trade("d", 20000, "10:01")];
  assert.match(indexRisk(big, 1_000_000, s, now).reasons.join(" "), /Daily loss limit reached/);
  assert.equal(indexRisk(two, 1_000_000, s, at("12:00", "2026-10-15")).entryBlocked, false, "a new day resets the daily limits");
});

test("stats over closed orders, net of costs", () => {
  const open = (id) => advanceIndexOrder(make({ id }), q(22700, "10:01"), ctx("10:01"));
  const win = closeIndexOrderNow(open("w"), 22750, at("10:30"));
  const loss = closeIndexOrderNow(open("l"), 22650, at("11:30"));
  const st = indexStats([win, loss, make({ id: "p" })], () => 100);
  assert.equal(st.closed, 2);
  assert.equal(st.winRate, 50);
  assert.equal(st.net, 3250 - 100 - 3250 - 100);
  assert.ok(st.profitFactor < 1 && st.maxDrawdown > 0);
});
