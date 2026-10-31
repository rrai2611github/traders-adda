import test from "node:test";
import assert from "node:assert/strict";
import { buildTomorrowPlan, planEmail } from "../src/lib/positions/tomorrowPlan.ts";

const cand = (symbol, close = 100, rs = 90) => ({ symbol, rs, close });
const held = (symbol, sector = null, over = {}) => ({ symbol, qty: 10, last: 100, stop: 88, sector, ...over });
const base = (over = {}) => ({ candidates: [], held: [], accountSize: 1_000_000, sectorOf: () => null, resultsInDays: () => null, marketOk: true, ...over });

test("nothing is planned when the market check has not passed", () => {
  assert.deepEqual(buildTomorrowPlan(base({ candidates: [cand("AAA")], marketOk: false })), { orders: [], skipped: [] });
});

test("an order is sized at 2% of the account at risk with a 12% stop, and carries the entry guidance", () => {
  const plan = buildTomorrowPlan(base({ candidates: [cand("AAA", 100)] }));
  assert.equal(plan.orders.length, 1);
  const o = plan.orders[0];
  assert.deepEqual([o.symbol, o.shares, o.buy, o.stop, o.stopPercent, o.skipAbove], ["AAA", 1666, 100, 88, 12, 105]);
  assert.equal(o.invested, 166_600);
  assert.equal(o.atRisk, 19_992);
  assert.equal(o.atRiskPercent, 2);
});

test("stocks already held, and a fourth in a crowded sector, are skipped with the reason", () => {
  const plan = buildTomorrowPlan(base({
    candidates: [cand("HELD"), cand("B4", 50), cand("OK", 60)],
    held: [held("HELD", "IT"), held("X1", "Banks"), held("X2", "Banks"), held("X3", "Banks")],
    sectorOf: (s) => (s === "B4" ? "Banks" : s === "OK" ? "IT" : null),
  }));
  assert.deepEqual(plan.orders.map((o) => o.symbol), ["OK"]);
  assert.deepEqual(plan.skipped, [{ symbol: "HELD", reason: "you already hold it" }, { symbol: "B4", reason: "you would have more than 3 positions in Banks" }]);
});

test("results within 5 days mean wait, not buy; later results do not", () => {
  const plan = buildTomorrowPlan(base({ candidates: [cand("SOON"), cand("LATER"), cand("TODAY")], resultsInDays: (s) => ({ SOON: 3, LATER: 12, TODAY: 0 })[s] }));
  assert.deepEqual(plan.orders.map((o) => o.symbol), ["LATER"]);
  assert.match(plan.skipped.find((s) => s.symbol === "SOON").reason, /results in 3 days: the price can gap through the stop, so wait/);
  assert.match(plan.skipped.find((s) => s.symbol === "TODAY").reason, /results are today/);
});

test("at most three new buys, and the open positions count against the ten-position limit", () => {
  const many = ["A", "B", "C", "D", "E"].map((s) => cand(s, 100));
  const plan = buildTomorrowPlan(base({ candidates: many }));
  assert.deepEqual(plan.orders.map((o) => o.symbol), ["A", "B", "C"]);
  assert.match(plan.skipped[0].reason, /already 3 buys planned/);
  const nine = Array.from({ length: 9 }, (_, i) => held(`H${i}`));
  const full = buildTomorrowPlan(base({ candidates: many, held: nine }));
  assert.deepEqual(full.orders.map((o) => o.symbol), ["A"]);
  assert.match(full.skipped[0].reason, /Already 10 positions/);
});

test("open risk across positions is capped at 15%: the buy is cut to what fits, or skipped with the reason", () => {
  // Each held position risks about 2% (1,666 shares, 12 under 100 on a 10 lakh account).
  const heldRisky = (n) => Array.from({ length: n }, (_, i) => held(`R${i}`, null, { qty: 1666, last: 100, stop: 88 }));
  const six = buildTomorrowPlan(base({ candidates: [cand("NEW")], held: heldRisky(6) }));
  assert.deepEqual([six.orders[0].shares, six.orders[0].atRiskPercent], [1666, 2]);
  const seven = buildTomorrowPlan(base({ candidates: [cand("NEW")], held: heldRisky(7) }));
  assert.deepEqual([seven.orders[0].shares, seven.orders[0].atRiskPercent], [838, 1]);
  const eight = buildTomorrowPlan(base({ candidates: [cand("NEW")], held: heldRisky(8) }));
  assert.equal(eight.orders.length, 0);
  assert.equal(eight.skipped[0].reason, "With this buy, stops across all positions would lose 18% of the account (limit 15%).");
});

test("a stock too dear for the account at 2% risk is skipped plainly", () => {
  const plan = buildTomorrowPlan(base({ candidates: [cand("DEAR", 60_000)], accountSize: 100_000 }));
  assert.equal(plan.orders.length, 0);
  assert.equal(plan.skipped[0].reason, "too expensive for this account size at 2% risk");
});

test("the email lists exact orders and the skips, or nothing at all", () => {
  const plan = buildTomorrowPlan(base({ candidates: [cand("AAA", 100), cand("SOON", 50)], resultsInDays: (s) => (s === "SOON" ? 2 : null), sectorOf: (s) => (s === "AAA" ? "Capital Goods" : null) }));
  const mail = planEmail({ plan, accountSize: 1_000_000, accountSaved: true, breadth50: 41.2, breadthMin: 35, lastDay: "2026-11-03", heldCount: 0, candidateCount: 2 });
  assert.equal(mail.subject, "Tomorrow's plan · 1 buy · after the close on 2026-11-03");
  assert.match(mail.lines[0], /The market check passed \(41% of stocks are above their 50-day average; the setup needs 35%\)\. The rules found 2 breakouts on the close of 2026-11-03\. Here is what fits your account of ₹10,00,000 and your 0 open positions\./);
  assert.match(mail.lines[1], /^1\. AAA: buy 1,666 shares at the open, about ₹100 \(skip it if it opens above ₹105\)\. Stop ₹88 \(−12%\): set it with your broker the same day\. About ₹1,66,600 in the stock; ₹19,992 \(2% of your account\) is lost if the stop is hit\. Sector: Capital Goods\.$/);
  assert.match(mail.lines.join("\n"), /Not on your list: SOON \(results in 2 days/);
  assert.match(mail.lines.join("\n"), /The app never places orders/);
  assert.doesNotMatch(mail.lines.join("\n"), /the default/);
  assert.match(planEmail({ plan, accountSize: 500_000, accountSaved: false, breadth50: null, breadthMin: 35, lastDay: "2026-11-03", heldCount: 1, candidateCount: 1 }).lines.join("\n"), /\(the default: set yours on My positions\)/);
  assert.equal(planEmail({ plan: { orders: [], skipped: [] }, accountSize: 1, accountSaved: true, breadth50: 50, breadthMin: 35, lastDay: "x", heldCount: 0, candidateCount: 0 }), null);
});
