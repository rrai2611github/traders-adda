import test from "node:test";
import assert from "node:assert/strict";
import { combinedStatusKey, longStatusKey } from "../src/lib/screen/tradeStatus.ts";
import { extraPickStatus, passesWatchRules, todaysPicks } from "../src/lib/screen/todaysPicks.ts";
import { SCANNER_KEYS } from "../src/lib/screen/chartinkScans.ts";

const checks = (failed, keys = ["breadth", "trend", "rs", "notExtended", "risk"]) =>
  keys.map((key) => ({ key, pass: !failed.includes(key) }));

test("long status: all pass is Buy ready, breadth only is Watch, extension only is Extended", () => {
  assert.equal(longStatusKey(checks([])), "buy-ready");
  assert.equal(longStatusKey(checks(["breadth"])), "watch");
  assert.equal(longStatusKey(checks(["notExtended"])), "extended");
  assert.equal(longStatusKey(checks(["breadth", "notExtended"])), "extended");
  assert.equal(longStatusKey(checks(["trend"])), "avoid");
  assert.equal(longStatusKey(checks(["notExtended", "rs"])), "avoid");
  assert.equal(longStatusKey([]), "avoid");
});

test("combined status: a live long status wins, then Short ready, else Avoid", () => {
  assert.equal(combinedStatusKey("watch", "short-ready"), "watch");
  assert.equal(combinedStatusKey("avoid", "short-ready"), "short-ready");
  assert.equal(combinedStatusKey("avoid", "avoid"), "avoid");
  assert.equal(combinedStatusKey(null, undefined), "avoid");
});

test("RPCI/Oscillator picks without the gate are never actionable", () => {
  assert.equal(extraPickStatus({ failed: undefined }, true), "avoid");
  assert.equal(extraPickStatus({ failed: [] }, true), "buy-ready");
  assert.equal(extraPickStatus({ failed: [] }, false), "watch");
  assert.equal(extraPickStatus({ failed: ["notExtended"] }, true), "extended");
});

const plan = { entry: 100, buyZoneHigh: 102, stop: 95, target1: 110, target2: 115, riskPercent: 5, highWinTarget: 102.5, highWinStop: 90, basis: "" };
const readiness = (failed, breadthPass) => ({
  checks: [{ key: "breadth", pass: breadthPass }, ...["trend", "rs", "notExtended", "risk"].map((key) => ({ key, pass: !failed.includes(key) }))],
  passed: 0, buyReady: false, setupReady: false, plan,
});
const row = (symbol, rs, failed = [], breadthPass = true, extra = {}) => ({
  symbol, name: `${symbol} Ltd`, close: 99, changePercent: 1, rs, score: 10, passesFloor: true,
  paRating: { status: "rated", score: 83.6, grade: "A", label: "Healthy trend", raw: 70, components: [], deductions: [] },
  readiness: readiness(failed, breadthPass), ...extra,
});
const extraPick = (symbol, rs, failed = []) => ({ symbol, name: `${symbol} Ltd`, close: 99, changePercent: 1, rs, score: 12, pa: { score: 91, grade: "A+" }, note: "Testing pivot", plan, failed });
const payload = (breadth, results, extras) => ({
  breadth: { percent: breadth, above: 0, covered: 100 },
  results: Object.fromEntries(SCANNER_KEYS.map((key) => [key, results[key] ?? []])),
  extras,
});

test("Today's Picks: Buy ready only, one entry per stock, ranked by RS, limited", () => {
  const p = payload(60, {
    leader: [row("AAA", 70), row("BBB", 95), row("FAIL", 99, ["trend"]), row("THIN", 99, [], true, { passesFloor: false })],
    fall4: [row("AAA", 70), row("CCC", 80)],
    inside: [row("HIDDEN", 99)],
  }, { rpci: { total: 1, top: [extraPick("RRR", 90)] }, oscillator: { total: 1, top: [{ ...extraPick("OLD", 99), failed: undefined }] } });
  const result = todaysPicks(p, 3);
  assert.equal(result.healthy, true);
  assert.deepEqual(result.picks.map((pick) => pick.symbol), ["BBB", "RRR", "CCC"]);
  assert.equal(result.buyReadyTotal, 4);
  const aaa = todaysPicks(p).picks.find((pick) => pick.symbol === "AAA");
  assert.equal(aaa.sources.length, 2);
  assert.deepEqual(result.watch, []);
  assert.ok(result.quiet.includes("Oscillator buy-watch"));
  assert.deepEqual(result.picks.map((pick) => pick.pa), [{ score: 84, grade: "A" }, { score: 91, grade: "A+" }, { score: 84, grade: "A" }]);
});

test("PA is display only: a higher PA never outranks a higher RS", () => {
  const low = { status: "rated", score: 40, grade: "C", label: "Weak", raw: 30, components: [], deductions: [] };
  const high = { ...low, score: 95, grade: "A+" };
  const p = payload(60, { leader: [row("HIGHRS", 95, [], true, { paRating: low }), row("HIGHPA", 75, [], true, { paRating: high })] }, undefined);
  assert.deepEqual(todaysPicks(p).picks.map((pick) => pick.symbol), ["HIGHRS", "HIGHPA"]);
  const unrated = row("NOPA", 80, [], true, { paRating: { status: "illiquid", score: null, grade: null, label: "", raw: null, components: [], deductions: [] } });
  assert.equal(todaysPicks(payload(60, { leader: [unrated] }, undefined)).picks[0].pa, null);
});

test("Today's Picks on a weak-breadth day: no picks, a separate watch list", () => {
  const strong = (symbol, rs, sector, extra = {}) => row(symbol, rs, [], false, { turnoverCr: 100, sector, ...extra });
  const p = payload(40, {
    leader: [strong("AAA", 80, "Pharma"), row("EXT", 90, ["notExtended"], false, { turnoverCr: 100 })],
    swing: [strong("BBB", 95, "Pharma"), strong("CCC", 90, "Pharma"), strong("DDD", 85, "Banks")],
    pullback20: [strong("AAA", 80, "Pharma")],
  }, { rpci: { total: 1, top: [extraPick("RRR", 90)] }, oscillator: { total: 0, top: [] } });
  const result = todaysPicks(p);
  assert.equal(result.healthy, false);
  assert.deepEqual(result.picks, []);
  // Every scanner counts, RS ranks, at most two per sector; RPCI/Oscillator stay out of the watch list.
  assert.deepEqual(result.watch.map((pick) => pick.symbol), ["BBB", "CCC", "DDD"]);
  assert.ok(result.watch.every((pick) => pick.status === "watch"));
});

test("Watch list is not capped at the picks limit: every qualifying stock, ranked by RS", () => {
  const sectors = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const leader = sectors.map((sector, i) => row(`S${i}`, 80 + i, [], false, { turnoverCr: 100, sector }));
  const result = todaysPicks(payload(40, { leader }, undefined), 5);
  assert.equal(result.watch.length, 8);
  assert.equal(result.watchTotal, 8);
  assert.deepEqual(result.watch.map((pick) => pick.symbol), ["S7", "S6", "S5", "S4", "S3", "S2", "S1", "S0"]);
});

test("Watch list quality bar: turnover, PA, RS and stop distance", () => {
  const base = { turnoverCr: 100, sector: "X" };
  assert.equal(passesWatchRules(row("OK", 80, [], false, base)), true);
  assert.equal(passesWatchRules(row("THIN", 80, [], false, { ...base, turnoverCr: 39 })), false);
  assert.equal(passesWatchRules(row("LOWRS", 74, [], false, base)), false);
  const lowPa = { status: "rated", score: 75, grade: "A", label: "", raw: 70, components: [], deductions: [] };
  assert.equal(passesWatchRules(row("LOWPA", 80, [], false, { ...base, paRating: lowPa })), false);
  const wide = row("WIDE", 80, [], false, base);
  wide.readiness.plan = { ...plan, riskPercent: 6.5 };
  assert.equal(passesWatchRules(wide), false);
});
