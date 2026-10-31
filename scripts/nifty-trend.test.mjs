import test from "node:test";
import assert from "node:assert/strict";
import { niftyTrend } from "../src/lib/market/niftyTrend.ts";

const DAY = 86_400_000;
const series = (n, f) => Array.from({ length: n }, (_, i) => ({ t: Date.UTC(2026, 0, 1) + i * DAY, close: f(i) }));

test("above the 200-day average when the close is higher", () => {
  const t = niftyTrend(series(260, (i) => 100 + i));
  assert.equal(t.above, true);
  assert.ok(t.percent > 0);
  assert.equal(t.close, 359);
});

test("below it after a fall, with the percentage gap", () => {
  const t = niftyTrend(series(260, (i) => (i < 230 ? 200 : 150)));
  assert.equal(t.above, false);
  assert.ok(t.percent < -10 && t.percent > -30);
});

test("exactly equal is not above, and too little history gives null", () => {
  assert.equal(niftyTrend(series(200, () => 100)).above, false);
  assert.equal(niftyTrend(series(120, () => 100)), null);
});
