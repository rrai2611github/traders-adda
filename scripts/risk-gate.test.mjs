import test from "node:test";
import assert from "node:assert/strict";
import { checkOrder, checkBatch, verdictLine, RISK_LIMITS } from "../src/lib/risk/riskGate.ts";
import { rehearsalSettings, summariseRehearsal } from "../src/lib/backtest/rehearsal.ts";
import { trackerSettings } from "../src/lib/backtest/tracker.ts";

const pf = (over = {}) => ({ accountValue: 1_000_000, openPositions: [], newToday: 0, dayChangePercent: 0, marketOk: true, ...over });
const order = (over = {}) => ({ symbol: "AAA", quantity: 500, entry: 100, stop: 92, resultsInDays: null, ...over });

test("a modest order with a stop in a green market passes", () => {
  const v = checkOrder(order(), pf());
  assert.equal(v.verdict, "PASS");
  assert.equal(v.riskPercent, 0.4);
  assert.equal(v.positionPercent, 5);
  assert.match(verdictLine(v), /^Passes: loses 0\.4% of the account if stopped, position 5%\./);
});

test("an order that risks too much is blocked, and the largest passing size is given", () => {
  const v = checkOrder(order({ quantity: 5000 }), pf());
  assert.equal(v.verdict, "BLOCK");
  assert.ok(v.blocks.some((b) => /loses 4% of the account \(limit 2%\)/.test(b)));
  assert.ok(v.blocks.some((b) => /position is 50% of the account \(limit 20%\)/.test(b)));
  assert.equal(v.maxQuantity, 2000);
  assert.match(verdictLine(v), /The most that would pass is 2000 shares\./);
});

test("no stop, a stop above the price, or a red market check blocks outright", () => {
  assert.ok(checkOrder(order({ stop: 0 }), pf()).blocks.some((b) => /stop below the buy price is required/.test(b)));
  assert.ok(checkOrder(order({ stop: 105 }), pf()).blocks.some((b) => /stop below the buy price is required/.test(b)));
  const red = checkOrder(order(), pf({ marketOk: false }));
  assert.equal(red.verdict, "BLOCK");
  assert.match(red.blocks[0], /paper trade only/);
  assert.equal(red.maxQuantity, 0);
});

test("the daily loss stop, the position count, the new-buys-a-day limit and a repeat buy are each blocked", () => {
  assert.ok(checkOrder(order(), pf({ dayChangePercent: -3.2 })).blocks.some((b) => /down 3\.2% today/.test(b)));
  const ten = Array.from({ length: 10 }, (_, i) => ({ symbol: `S${i}`, quantity: 10, last: 100, stop: 92 }));
  assert.ok(checkOrder(order(), pf({ openPositions: ten })).blocks.some((b) => /Already 10 positions/.test(b)));
  assert.ok(checkOrder(order(), pf({ newToday: 3 })).blocks.some((b) => /Already 3 new buys today/.test(b)));
  assert.ok(checkOrder(order(), pf({ openPositions: [{ symbol: "AAA", quantity: 10, last: 100, stop: 92 }] })).blocks.some((b) => /AAA is already held/.test(b)));
});

test("open risk across all positions is limited, and results soon only warn", () => {
  const heavy = Array.from({ length: 7 }, (_, i) => ({ symbol: `H${i}`, quantity: 2000, last: 100, stop: 90 }));
  const v = checkOrder(order({ quantity: 1500 }), pf({ openPositions: heavy }));
  assert.ok(v.blocks.some((b) => /stops across all positions would lose 15\.2%/.test(b)));
  const warn = checkOrder(order({ resultsInDays: 2 }), pf());
  assert.equal(warn.verdict, "WARN");
  assert.match(warn.warnings[0], /Results in 2 days/);
  assert.equal(checkOrder(order({ resultsInDays: 9 }), pf()).verdict, "PASS");
});

test("a batch is checked as if each passing order had filled", () => {
  const orders = ["A", "B", "C", "D"].map((s) => order({ symbol: s }));
  const out = checkBatch(orders, pf());
  assert.deepEqual(out.map((v) => v.verdict), ["PASS", "PASS", "PASS", "BLOCK"]);
  assert.match(out[3].blocks[0], /Already 3 new buys today/);
  assert.equal(RISK_LIMITS.maxNewPerDay, 3);
});

test("the rehearsal runs the live rules on one stock with the market gate left off", () => {
  const r = rehearsalSettings("WHEELS");
  const live = trackerSettings({ startDate: "2016-12-01", startedAt: 0, capital: 1_000_000, niftyGate: false, stopPercent: 12 });
  assert.equal(r.symbol, "WHEELS");
  assert.deepEqual({ ...r, symbol: undefined, breadthMin: 0, floor: undefined, to: undefined, from: undefined }, { ...live, symbol: undefined, breadthMin: 0, floor: undefined, to: undefined, from: undefined });
  assert.equal(rehearsalSettings("X", 8).stop.percent, 8);
});

const t = (r, over = {}) => ({ r, pnl: r * 1000, holdDays: 20, exitReason: r > 0 ? "trail" : "stop", ...over });

test("rehearsal summary: win rate, reach, break-even odds and an honest verdict about sample size", () => {
  const few = summariseRehearsal([t(2), t(-1)]);
  assert.equal(few.trades, 2);
  assert.match(few.verdict, /Only 2 trades: far too few/);
  const many = summariseRehearsal([t(3), t(2.5), t(-1), t(-1), t(1.2), t(-1), t(4), t(-1), t(-1), t(-0.8)]);
  assert.equal(many.trades, 10);
  assert.equal(many.wins, 4);
  assert.equal(many.winRate, 40);
  assert.equal(many.reached.r1, 4);
  assert.equal(many.reached.r3, 2);
  assert.deepEqual(many.breakEven.map((b) => b.winRate), [50, 33.3, 25]);
  assert.ok(many.edge.needed < 40);
  assert.match(many.verdict, /the plan has worked here, but 10 trades is still a small sample/);
  const bad = summariseRehearsal([t(-1), t(-1), t(-1), t(-1), t(-1), t(-1), t(-1), t(-1), t(1.5)]);
  assert.match(bad.verdict, /has not paid on this stock/);
  assert.match(summariseRehearsal([]).verdict, /no breakout on these screens since 2016/);
  assert.equal(summariseRehearsal([t(1, { exitReason: "end" })]).trades, 0);
});
