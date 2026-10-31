import test from "node:test";
import assert from "node:assert/strict";
import { buildTradePlan, measurePlanInputs } from "../src/lib/screen/tradePlan.ts";

const DAY = 86_400_000;
const series = (n, price, spread = 0.01) => Array.from({ length: n }, (_, i) => {
  const close = price(i);
  return { t: i * DAY, open: close, high: close * (1 + spread), low: close * (1 - spread), close, volume: 1_000_000 };
});

test("inputs: ATR, 10-day low, 21 EMA and 52-week high from candles", () => {
  const c = series(300, (i) => 100 + i * 0.5);
  const p = measurePlanInputs(c);
  assert.ok(p);
  assert.equal(p.close, 249.5);
  assert.ok(p.atr > 4 && p.atr < 6, `atr ${p.atr}`); // 2% of price on a ~250 stock
  assert.ok(p.swingLow < p.close && p.swingLow > 240);
  assert.ok(p.ema21 < p.close && p.ema21 > 235);
  assert.ok(p.high52 >= p.close);
  assert.equal(measurePlanInputs(series(40, () => 100)), null);
});

test("plan: stop is 2 ATR below, T1 is 2R and T2 is 3R", () => {
  const plan = buildTradePlan({ close: 100, atr: 3, swingLow: 95, ema21: 97, ema50: 92, high52: 110 });
  assert.equal(plan.entry, 100);
  assert.equal(plan.stop, 94);
  assert.equal(plan.riskPerShare, 6);
  assert.equal(plan.stopPercent, 6);
  assert.equal(plan.t1, 112);
  assert.equal(plan.t2, 118);
  assert.equal(plan.skipAbove, 105);
  assert.equal(plan.swingStop, 94.05);
  assert.equal(plan.trailEma21, 97);
  assert.deepEqual(plan.resistance, { price: 110, percent: 10 });
  assert.equal(plan.wideStop, false);
  assert.equal(plan.sizing, null);
});

test("a stop wider than 8% is flagged, and no resistance when at the 52-week high", () => {
  const plan = buildTradePlan({ close: 100, atr: 5, swingLow: 90, ema21: 95, ema50: null, high52: 100 });
  assert.equal(plan.stopPercent, 10);
  assert.equal(plan.wideStop, true);
  assert.equal(plan.resistance, null);
});

test("sizing: risk percent of capital divided by the stop distance", () => {
  const plan = buildTradePlan({ close: 100, atr: 3, swingLow: 95, ema21: 97, ema50: 92, high52: 110 }, { capital: 500_000, riskPercent: 1 });
  // 1% of 5,00,000 = 5,000 risk; 6 per share -> 833 shares.
  assert.equal(plan.sizing.quantity, 833);
  assert.equal(plan.sizing.maxLoss, 4998);
  assert.equal(plan.sizing.invested, 83_300);
  assert.equal(plan.sizing.gainT1, 9996);
  assert.equal(plan.sizing.gainT2, 14_994);
  assert.equal(plan.sizing.cappedByCapital, false);
});

test("sizing never buys more than the capital allows", () => {
  const plan = buildTradePlan({ close: 100, atr: 0.2, swingLow: 99, ema21: 99, ema50: null, high52: 101 }, { capital: 10_000, riskPercent: 1 });
  assert.equal(plan.sizing.quantity, 100);
  assert.equal(plan.sizing.cappedByCapital, true);
  assert.ok(plan.sizing.maxLoss <= 100);
});

test("zero or missing capital gives no sizing", () => {
  const i = { close: 100, atr: 3, swingLow: 95, ema21: 97, ema50: null, high52: 110 };
  assert.equal(buildTradePlan(i, { capital: 0, riskPercent: 1 }).sizing, null);
  assert.equal(buildTradePlan(i, null).sizing, null);
});

test("percent stop: the stop is a fixed share below the buy price, sizing and targets follow it, and the 2 x ATR stop stays as a reference", () => {
  const inputs = { close: 100, atr: 3, swingLow: 95, ema21: 97, ema50: 92, high52: 110 };
  const atr = buildTradePlan(inputs, { capital: 100000, riskPercent: 1 });
  const pct = buildTradePlan(inputs, { capital: 100000, riskPercent: 1 }, { kind: "percent", percent: 8 });
  assert.equal(atr.stop, 94);
  assert.equal(atr.stopKind, "atr");
  assert.equal(pct.stopKind, "percent");
  assert.equal(pct.stop, 92);
  assert.equal(pct.stopPercent, 8);
  assert.equal(pct.riskPerShare, 8);
  assert.equal(pct.t1, 116);
  assert.equal(pct.t2, 124);
  assert.equal(pct.atrStop, 94);
  assert.equal(pct.atrStopPercent, 6);
  assert.equal(pct.sizing.quantity, 125);
  assert.equal(pct.wideStop, false);
});
