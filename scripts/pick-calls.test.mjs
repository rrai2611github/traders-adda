import test from "node:test";
import assert from "node:assert/strict";
import { pickCallFor, pickCalls, currentRun, callProgress, shortDay } from "../src/lib/radar/pickCalls.ts";
import { TERM_LABEL, TERM_LIMITS, holdPosition, perStockTermJustified, pickTerm, termForHold } from "../src/lib/screen/pickTerm.ts";
import holding from "../src/lib/screen/pickHolding.json" with { type: "json" };

/** Weekday dates from `from` to `to` inclusive. */
function weekdays(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
/** A steady climb, with optional overrides: { "2026-10-12": 280 } sets that day's close. */
function bars(overrides = {}, start = 300, step = 0.45) {
  return weekdays("2026-07-01", "2026-11-13").map((date, i) => {
    const close = overrides[date] ?? start + i * step;
    return { date, open: close, high: close + 1, low: close - 1, close };
  });
}
const nifty = bars({}, 20000, 20);

const entry = (over) => ({
  symbol: "CUPID", name: "Cupid", sector: null, list: "top-picks", tag: "broke", price: 381.25, rs: 99, buy: 381.25, stop: 335.5, target1: 442.25, target2: 472.75,
  rank: 1, id: "x", firstDay: "2026-11-12", firstAt: 1, email: "hourly", breadth50: 50, lastDay: "2026-11-13", mentions: 14, ...over,
});

test("Cupid's real case: on the list since 2 Nov as Extended, first buyable call on 12 Nov with its own levels", () => {
  const entries = [
    entry({ tag: "extended", price: 324.8, buy: null, stop: null, target1: null, target2: null, firstDay: "2026-11-02", lastDay: "2026-11-11", mentions: 63, email: "pre-open" }),
    entry({}),
    entry({ list: "confluence", tag: null, firstDay: "2026-11-04", lastDay: "2026-11-12" }), // another list: ignored
  ];
  const r = pickCallFor(entries, bars(), nifty);
  assert.equal(r.onListSince, "2026-11-02");
  assert.equal(r.firstTag, "extended");
  assert.equal(r.call.day, "2026-11-12");
  assert.equal(r.call.tag, "broke");
  assert.equal(r.call.buy, 381.25);
  assert.equal(r.call.stop, 335.5);
  assert.equal(r.call.target1, 442.25);
  assert.equal(r.call.target2, 472.75);
  assert.equal(r.call.mentions, 14);
  assert.equal(r.endedCalls, 0);
  assert.ok(r.state === "open" || r.state === "too-new", r.state);
});

test("a stock only ever listed as Watch or Extended has no buy call", () => {
  const r = pickCallFor([entry({ tag: "watch", buy: null, stop: null, firstDay: "2026-11-05" })], bars(), nifty);
  assert.equal(r.call, null);
  assert.equal(r.onListSince, "2026-11-05");
});

test("Ready then Just broke out is one call: the first levels are kept, not today's", () => {
  const entries = [
    entry({ tag: "ready", price: 366, buy: 370, stop: 325.6, target1: 424, target2: 447, firstDay: "2026-11-09", lastDay: "2026-11-11", mentions: 5 }),
    entry({ tag: "broke", price: 381.25, buy: 381.25, stop: 335.5, firstDay: "2026-11-12" }),
  ];
  const r = pickCallFor(entries, bars(), nifty);
  assert.equal(r.call.tag, "ready");
  assert.equal(r.call.buy, 370);
  assert.equal(r.call.stop, 325.6);
  assert.equal(r.call.day, "2026-11-09");
});

test("a call that already hit its stop has ended; the next buyable listing is the new call", () => {
  const entries = [
    entry({ tag: "ready", price: 330, buy: 330, stop: 290, firstDay: "2026-10-05", lastDay: "2026-10-09", email: "pre-open" }),
    // Listed again a week later, within the same-episode window, after the first call's stop was hit.
    entry({ tag: "broke", price: 300, buy: 300, stop: 264, firstDay: "2026-10-16", lastDay: "2026-11-13", email: "pre-open" }),
  ];
  // The stock fell through the first stop on 12 Oct (closing at 280 for four sessions), then climbed back from 300.
  const path = {};
  for (const d of weekdays("2026-10-12", "2026-10-15")) path[d] = 280;
  for (const [i, d] of weekdays("2026-10-16", "2026-11-13").entries()) path[d] = 300 + i * 4;
  const r = pickCallFor(entries, bars(path), nifty);
  assert.equal(r.onListSince, "2026-10-05");
  assert.equal(r.endedCalls, 1);
  assert.equal(r.call.day, "2026-10-16");
  assert.equal(r.call.buy, 300);
  assert.equal(r.call.stop, 264);
});

test("a call whose stop was hit and that is not listed again has no live call", () => {
  const entries = [entry({ tag: "ready", price: 330, buy: 330, stop: 290, firstDay: "2026-10-05", lastDay: "2026-11-13", email: "pre-open" })];
  const path = {};
  for (const d of weekdays("2026-10-12", "2026-11-13")) path[d] = 280;
  const r = pickCallFor(entries, bars(path), nifty);
  assert.equal(r.call, null);
  assert.equal(r.endedCalls, 1);
});

test("a gap longer than the same-episode window starts a new run, so an old appearance is not 'on the list since'", () => {
  const entries = [
    entry({ tag: "broke", firstDay: "2026-09-01", lastDay: "2026-09-04", buy: 300, price: 300, stop: 264 }),
    entry({ tag: "broke", firstDay: "2026-11-12", lastDay: "2026-11-13" }),
  ];
  assert.deepEqual(currentRun(entries).map((e) => e.firstDay), ["2026-11-12"]);
  assert.equal(pickCallFor(entries, bars(), nifty).onListSince, "2026-11-12");
});

test("pickCalls covers only Top picks stocks seen recently, and ignores other lists", () => {
  const entries = [
    entry({ symbol: "AAA", lastDay: "2026-11-13" }),
    entry({ symbol: "OLD", firstDay: "2026-09-01", lastDay: "2026-09-02" }), // not on the list for over ten days
    entry({ symbol: "BBB", list: "buy-list", tag: null }),
  ];
  const result = pickCalls(entries, () => bars(), nifty, "2026-11-13");
  assert.deepEqual(Object.keys(result), ["AAA"]);
  assert.equal(pickCallFor([], bars(), nifty), null);
});

test("terms use the app's own limits: short up to 30 sessions, mid up to 63, long beyond", () => {
  assert.deepEqual(TERM_LIMITS, { short: 30, mid: 63, long: 250 });
  assert.equal(termForHold(30), "short");
  assert.equal(termForHold(31), "mid");
  assert.equal(termForHold(63), "mid");
  assert.equal(termForHold(64), "long");
  assert.equal(TERM_LABEL.mid, "Mid term");
});

test("the Top pick term comes from the measured hold of the tested strategy", () => {
  assert.ok(holding.trades >= 200, "the holding sample should be the full ten-year test");
  const t = pickTerm();
  assert.equal(t.term, termForHold(holding.hold.median));
  assert.match(t.headline, new RegExp(`${Math.round(holding.hold.median / 5)} weeks`));
  assert.match(t.detail, new RegExp(`${holding.trades} trades`));
  assert.match(t.detail, /not this label/);
  // A strategy that held for years would be Long term; one that exited within days, Short term.
  assert.equal(pickTerm({ ...holding, hold: { ...holding.hold, median: 120 } }).term, "long");
  assert.equal(pickTerm({ ...holding, hold: { ...holding.hold, median: 10 } }).term, "short");
});

test("how a call is doing against the live price", () => {
  const call = { buy: 381.25, stop: 335.5, target1: 442.25, target2: 472.75 };
  assert.equal(callProgress(call, 377.8).key, "in-zone");
  assert.equal(callProgress(call, 377.8).changePercent, -0.9);
  assert.match(callProgress(call, 377.8).label, /Below the call's buy level/);
  assert.match(callProgress(call, 385).label, /Still near/);
  // Past the zone: more than 5% above the call's buy is "do not chase".
  assert.equal(callProgress(call, 410).key, "past-zone");
  assert.equal(callProgress(call, 410).tone, "warn");
  assert.equal(callProgress(call, 400.3).key, "in-zone"); // 5.0% exactly is still inside
  assert.equal(callProgress(call, 445).key, "target1");
  assert.equal(callProgress(call, 480).key, "target2");
  assert.equal(callProgress(call, 335.5).key, "stop"); // at the stop counts as hit
  assert.equal(callProgress(call, 300).tone, "bad");
  // A call with no stop or targets still reports a move; bad inputs report nothing.
  assert.equal(callProgress({ buy: 100, stop: null, target1: null, target2: null }, 103).key, "in-zone");
  assert.equal(callProgress({ buy: 0, stop: null, target1: null, target2: null }, 103), null);
  assert.equal(callProgress(call, NaN), null);
});

test("short day labels", () => {
  assert.equal(shortDay("2026-11-12"), "12 Nov");
  assert.equal(shortDay("2026-11-02"), "2 Nov");
  assert.equal(shortDay("not a date"), "not a date");
});

test("no trait known at entry predicts the holding time, so every Top pick honestly shares one term", () => {
  const p = holding.predictors;
  assert.ok(p && p.matchedTrades >= 100, "the saved test should have matched most trades to price history");
  // If this fails, a trait now predicts hold time beyond chance: revisit per-stock terms (scripts/backtest-holding.mjs).
  assert.equal(perStockTermJustified(), false, `${p.strongest.label} now correlates ${p.strongest.spearman} with the hold (noise ±${p.noiseLevel})`);
  assert.match(pickTerm().detail, /So every pick gets the same term/);
  // The same data with a strong relationship would be reported, not hidden.
  const strong = { ...holding, predictors: { ...p, strongest: { label: "Base length", spearman: 0.4 } } };
  assert.equal(perStockTermJustified(strong), true);
  assert.match(pickTerm(strong).detail, /terms could differ by stock/);
  assert.equal(perStockTermJustified({ ...holding, predictors: null }), false);
});

test("a call's age is placed against how long past trades lasted", () => {
  const { p25, p75, p90 } = holding.hold;
  assert.equal(holdPosition(0).key, "new");
  assert.equal(holdPosition(p25 - 1).key, "early");
  assert.equal(holdPosition(p25).key, "typical");
  assert.equal(holdPosition(p75).key, "typical");
  assert.equal(holdPosition(p75 + 1).key, "long");
  assert.equal(holdPosition(p90 + 1).key, "very-long");
  assert.match(holdPosition(7).text, new RegExp(`Session 7.*${p25}–${p75} sessions`));
  assert.match(holdPosition(p90 + 5).text, /until the stop or a close under the 50-day average/);
});
