import test from "node:test";
import assert from "node:assert/strict";
import { advancePaperOrder, closePaperOrderNow, createPaperOrder } from "../src/lib/screen/paperTrading.ts";
import { DEFAULT_PAPER_SETTINGS, committedCash, istWeekStartKey, orderCosts, paperRisk, paperStats, paperTotals } from "../src/lib/paper/paperRules.ts";

const plan = { entry: 100, buyZoneHigh: 102, stop: 95, target1: 110, target2: 120 };
const at = (date, hour = "04:00:00.000Z") => Date.parse(`${date}T${hour}`);
const market = (now) => ({ phase: "OPEN", isLive: true, now, simulated: false });
const quote = (date, price, seconds = 0) => ({ price, timestamp: at(date, `04:00:${String(seconds).padStart(2, "0")}.000Z`) });
const make = (id, quantity = 10) => createPaperOrder({ id, symbol: "ABC", plan, signalDate: "2026-09-28", approvedAt: at("2026-09-28", "10:10:00.000Z"), quantity });
const must = (order, q) => { const r = advancePaperOrder(order, q, market(q.timestamp + 1000)); assert.equal(r.accepted, true, r.accepted ? "" : r.rejection); return r.order; };
const open = (id, quantity) => must(must(make(id, quantity), quote("2026-09-29", 98)), quote("2026-09-29", 100, 1));
const NOW = at("2026-09-29", "08:00:00.000Z");
const S = DEFAULT_PAPER_SETTINGS;

test("costs: slippage on every fill value, statutory charges and one depository charge per sale day", () => {
  const closed = closePaperOrderNow(open("c1"), 90, at("2026-09-29", "06:00:00.000Z"));
  const c = orderCosts(closed, S);
  assert.equal(Math.round(c.slippage * 100) / 100, 0.95); // 0.05% of 1,000 + 900
  assert.ok(Math.abs(c.charges - 18.05) < 0.1, `charges ${c.charges}`);
  assert.equal(Math.round(c.total * 100) / 100, Math.round((c.charges + c.slippage) * 100) / 100);
  assert.equal(orderCosts(make("p1"), S).total, 0, "a pending order has no fills and no costs");
});

test("totals: net P&L is gross less costs, demo orders are left out, open P&L uses the last price", () => {
  const closed = closePaperOrderNow(open("c2"), 90, at("2026-09-29", "06:00:00.000Z"));
  const held = must(open("h1"), quote("2026-09-29", 104, 2));
  const demo = { ...make("demo-1"), id: "demo-1" };
  const t = paperTotals([closed, held, demo], S);
  assert.equal(t.realized, -100);
  assert.equal(t.unrealized, 40);
  assert.equal(t.gross, -60);
  assert.ok(t.net < t.gross && t.charges > 0 && t.slippage > 0);
});

test("risk: a daily loss beyond 2% of capital blocks entries and approvals; a quiet day does not", () => {
  const big = closePaperOrderNow(open("b1", 1000), 85, at("2026-09-29", "06:00:00.000Z")); // -15,000
  const hit = paperRisk([big], 500_000, S, NOW);
  assert.equal(hit.dayPnl, -15000);
  assert.equal(hit.dayLimit, 10000);
  assert.equal(hit.entryBlocked, true);
  assert.equal(hit.approvalBlocked, true);
  assert.match(hit.reasons[0], /Daily loss limit reached/);
  const calm = paperRisk([closePaperOrderNow(open("b2", 10), 99, at("2026-09-29", "06:00:00.000Z"))], 500_000, S, NOW);
  assert.equal(calm.entryBlocked, false);
  assert.equal(calm.approvalBlocked, false);
  // The next day the daily limit resets; the weekly one (5% = 25,000) does not trip on -15,000.
  const next = paperRisk([big], 500_000, S, at("2026-09-30", "08:00:00.000Z"));
  assert.equal(next.dayPnl, 0);
  assert.equal(next.weekPnl, -15000);
  assert.equal(next.entryBlocked, false);
});

test("risk: the position cap blocks approvals but not entries of orders already approved", () => {
  const r = paperRisk([make("a"), make("b")], 500_000, { ...S, maxOpenPositions: 2 }, NOW);
  assert.equal(r.openCount, 2);
  assert.equal(r.approvalBlocked, true);
  assert.equal(r.entryBlocked, false);
  assert.match(r.reasons[0], /Position cap reached: 2 of 2/);
});

test("stats: win rate, expectancy in R, profit factor and drawdown over closed orders", () => {
  const win = closePaperOrderNow(open("w1"), 110, at("2026-09-29", "06:00:00.000Z")); // +100
  const loss = closePaperOrderNow(open("l1"), 95, at("2026-09-29", "07:00:00.000Z")); // -50
  const s = paperStats([win, loss, make("pending")], S);
  assert.equal(s.closed, 2);
  assert.equal(s.winRate, 50);
  assert.ok(s.expectancyR > 0 && s.expectancyR < 1);
  assert.ok(s.profitFactor > 1);
  assert.ok(s.maxDrawdown > 0 && s.maxDrawdown < 100);
  assert.equal(paperStats([], S).winRate, null);
});

test("week starts on Monday in IST and committed cash follows the order stage", () => {
  assert.equal(istWeekStartKey(at("2026-10-14", "06:00:00.000Z")), "2026-10-12");
  assert.equal(istWeekStartKey(at("2026-10-12", "00:30:00.000Z")), "2026-10-12");
  assert.equal(istWeekStartKey(at("2026-10-18", "10:00:00.000Z")), "2026-10-12");
  assert.equal(committedCash(make("x", 10)), 1020);
  assert.equal(committedCash(open("y", 10)), 1000);
});
