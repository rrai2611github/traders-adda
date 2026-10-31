import test from "node:test";
import assert from "node:assert/strict";
import { buildChecklist } from "../src/lib/screen/checklist.ts";

const good = { rs: 92, vs50: 10, vs200: 40, fromHigh: 3, aboveLow: 80, turn: 20, mcap: 5000, baseWk: 10, baseDepth: 20, coil: 0.5, dry: 0.7, listedWk: 300, level: 1, ext: -2, price: 110, turnoverCr: 20 };
const get = (c, key) => c.items.find((i) => i.key === key);

test("a strong stock in a healthy market with a narrow stop is ready", () => {
  const c = buildChecklist({ breadth50: 62, values: good, stopPercent: 6 });
  assert.equal(get(c, "market").state, "pass");
  assert.equal(get(c, "rs").state, "pass");
  assert.equal(get(c, "trend").state, "pass");
  assert.equal(get(c, "stop").state, "pass");
  assert.equal(c.verdict, "ready");
  assert.deepEqual(c.screens.includes("Blue sky"), true);
  assert.equal(c.exitDays === 100 || c.exitDays === 50, true);
});

test("a weak market is a hard fail whatever the stock looks like", () => {
  const c = buildChecklist({ breadth50: 20, values: good, stopPercent: 6 });
  assert.equal(get(c, "market").state, "fail");
  assert.equal(c.verdict, "not-yet");
});

test("breadth between 30 and 50 only warns", () => {
  assert.equal(get(buildChecklist({ breadth50: 40, values: good, stopPercent: 6 }), "market").state, "warn");
});

test("a stock far past its breakout is a hard stop; a wide stop only warns", () => {
  const stretched = buildChecklist({ breadth50: 60, values: { ...good, ext: 25 }, stopPercent: 6 });
  assert.equal(get(stretched, "extended").state, "fail");
  assert.equal(stretched.verdict, "not-yet");
  assert.equal(get(buildChecklist({ breadth50: 60, values: good, stopPercent: 12 }), "stop").state, "pass");
  assert.equal(get(buildChecklist({ breadth50: 60, values: good, stopPercent: 14 }), "stop").state, "warn");
  const wide = buildChecklist({ breadth50: 60, values: good, stopPercent: 18 });
  assert.equal(get(wide, "stop").state, "fail");
  assert.match(get(wide, "stop").detail, /wider than the 12% stop/);
  assert.notEqual(wide.verdict, "not-yet");
});

test("a stock just past its breakout level still counts as on the screen", () => {
  const c = buildChecklist({ breadth50: 60, values: { ...good, ext: 3 }, stopPercent: 6 });
  assert.equal(get(c, "setup").state, "pass");
  assert.equal(get(c, "extended").state, "pass");
});

test("a stock far under any breakout level is not judged on how stretched it is", () => {
  assert.equal(get(buildChecklist({ breadth50: 60, values: { ...good, ext: -60 }, stopPercent: 6 }), "extended").state, "na");
});

test("trade-for-trade and illiquid stocks fail liquidity", () => {
  assert.equal(get(buildChecklist({ breadth50: 60, values: { ...good, series: "BE" }, stopPercent: 6 }), "liquidity").state, "fail");
  assert.equal(get(buildChecklist({ breadth50: 60, values: { ...good, turnoverCr: 0.5 }, stopPercent: 6 }), "liquidity").state, "fail");
});

test("below the 50-day average fails the trend check", () => {
  assert.equal(get(buildChecklist({ breadth50: 60, values: { ...good, vs50: -10 }, stopPercent: 6 }), "trend").state, "fail");
});

test("results soon warn, results within a week fail, and the check is left out when the calendar is not loaded", () => {
  const state = (resultsInDays) => get(buildChecklist({ breadth50: 60, values: good, stopPercent: 6, resultsInDays }), "results")?.state;
  assert.equal(state(3), "fail");
  assert.equal(state(10), "warn");
  assert.equal(state(30), "pass");
  assert.equal(state(null), "na");
  assert.equal(state(undefined), undefined);
});

test("missing data is not applicable, never a pass", () => {
  const c = buildChecklist({ breadth50: null, values: { ...good, rs: null, ext: null }, stopPercent: null });
  assert.equal(get(c, "market").state, "na");
  assert.equal(get(c, "rs").state, "na");
  assert.equal(get(c, "stop").state, "na");
});

test("the Nifty line is information: a caution below its 200-day average, never a hard stop", () => {
  const above = buildChecklist({ breadth50: 62, values: good, stopPercent: 6, niftyAbove200: true, niftyPercent: 2 });
  assert.equal(get(above, "nifty").state, "pass");
  const below = buildChecklist({ breadth50: 62, values: good, stopPercent: 6, niftyAbove200: false, niftyPercent: -3 });
  assert.equal(get(below, "nifty").state, "warn");
  assert.match(get(below, "nifty").label, /not a rule/);
  assert.notEqual(below.verdict, "not-yet");
  assert.equal(below.verdict, "partly");
  assert.equal(get(buildChecklist({ breadth50: 62, values: good, stopPercent: 6 }), "nifty"), undefined);
});
