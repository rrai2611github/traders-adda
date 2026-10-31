import test from "node:test";
import assert from "node:assert/strict";
import { measureBottomedOut, rankBottomedOut } from "../src/lib/screen/bottomedOut.ts";

const DAY = 86400e3;
const bar = (i, close, low = close - 1, volume = 100_000) => ({ t: i * DAY, open: close, high: close + 1, low, close, volume });

/**
 * 300 sessions: a flat 200 for 180 sessions, a slide to a low of 60 about 40 sessions ago,
 * a higher low, then a recovery to `lastClose`.
 */
function series({ lastClose = 82, peak = 200 } = {}) {
  const c = [];
  for (let i = 0; i < 180; i++) c.push(bar(i, peak));
  for (let i = 180; i < 255; i++) c.push(bar(i, peak - ((peak - 62) * (i - 179)) / 75));
  c.push(bar(255, 60, 55)); // base low
  for (let i = 256; i < 290; i++) c.push(bar(i, 66 + (i - 256) * 0.2, 64));
  for (let i = 290; i < 299; i++) c.push(bar(i, 74 + (i - 290) * 0.8));
  c.push(bar(299, lastClose, lastClose - 1));
  return c;
}

test("deep base: far off the high, old-enough low, higher low, above the 20 EMA", () => {
  const pick = measureBottomedOut(series());
  assert.ok(pick);
  assert.equal(pick.tier, "deep");
  assert.equal(pick.lowPrice, 55);
  assert.equal(pick.lowAgeSessions, 44);
  assert.ok(pick.fromHighPercent > 50);
  assert.ok(pick.higherLow > 55 * 1.02);
  assert.equal(pick.stop, 75.44);
  assert.equal(pick.target, 95.12);
});

test("a shallower fall is the early tier", () => {
  const pick = measureBottomedOut(series({ peak: 140 }));
  assert.ok(pick);
  assert.equal(pick.tier, "early");
  // Under 35% off the high is not a bottom candidate at all.
  assert.equal(measureBottomedOut(series({ peak: 100 })), null);
});

test("rejects a stock still making new lows", () => {
  const c = series();
  c.push(bar(300, 50, 48));
  assert.equal(measureBottomedOut(c), null);
});

test("rejects a low that is too recent (still selling)", () => {
  const c = series();
  const recent = c.slice(0, 292);
  recent.push(bar(292, 52, 50), bar(293, 54, 53), bar(294, 56, 55), bar(295, 58, 57), bar(296, 60, 59), bar(297, 62, 61), bar(298, 64, 63), bar(299, 66, 65));
  assert.equal(measureBottomedOut(recent), null);
});

test("rejects a close below the 20 EMA and thin or cheap stocks", () => {
  const below = series({ lastClose: 70 });
  assert.equal(measureBottomedOut(below), null);
  const thin = series();
  thin[thin.length - 1].volume = 1_000;
  assert.equal(measureBottomedOut(thin), null);
  assert.equal(measureBottomedOut(series().slice(0, 200)), null);
});

test("ranking puts the deep tier first, then the smaller bounce", () => {
  const a = { tier: "early", offLowPercent: 3 };
  const b = { tier: "deep", offLowPercent: 9 };
  const c = { tier: "deep", offLowPercent: 5 };
  assert.deepEqual([a, b, c].sort(rankBottomedOut), [c, b, a]);
});
