import test from "node:test";
import assert from "node:assert/strict";
import { trackerSettings, LIVE_RULES } from "../src/lib/backtest/tracker.ts";

const config = { startDate: "2026-10-19", startedAt: 1, capital: 500_000, niftyGate: false, stopPercent: 8 };

test("the live check uses exactly the backtested preset: Blue sky + Multi-year", () => {
  const s = trackerSettings(config);
  assert.deepEqual(s.strategy, { kind: "screen", screen: "Blue sky" });
  assert.deepEqual(s.alsoScreens, ["Multi-year breakouts"]);
  assert.equal(s.addOn, undefined);
  assert.deepEqual(s.stop, { kind: "percent", percent: 8 });
  assert.deepEqual(s.exit, { kind: "ma", type: "sma", period: 50, when: "close" });
  assert.equal(s.breadthMin, 35);
  assert.equal(s.maxPositions, 10);
  assert.equal(s.maxNewPerDay, 3);
  assert.deepEqual(s.sizing, { kind: "risk", riskPercent: 2 });
  assert.equal(s.positionCapPercent, 20);
  assert.equal(s.costPercent, 0.25);
  assert.equal(s.from, "2026-10-19");
  assert.equal(s.capital, 500_000);
  assert.equal(s.niftyAbove, undefined);
});

test("the Nifty option adds the 200-day gate and nothing else", () => {
  const plain = trackerSettings(config);
  const gated = trackerSettings({ ...config, niftyGate: true });
  assert.equal(gated.niftyAbove, 200);
  assert.deepEqual({ ...gated, niftyAbove: undefined }, { ...plain, niftyAbove: undefined });
});

test("the rules shown to the user match the settings", () => {
  const text = LIVE_RULES.lines.join(" ");
  assert.match(text, /35%/);
  assert.match(text, /8%/);
  assert.match(text, /50-day average/);
  assert.match(text, /12%/);
});

test("the smoother option widens the stop and changes nothing else", () => {
  const plain = trackerSettings(config);
  const wide = trackerSettings({ ...config, stopPercent: 12 });
  assert.deepEqual(wide.stop, { kind: "percent", percent: 12 });
  assert.deepEqual({ ...wide, stop: undefined }, { ...plain, stop: undefined });
});
