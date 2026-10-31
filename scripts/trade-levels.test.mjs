import test from "node:test";
import assert from "node:assert/strict";
import { levelStatus, tradeLevels } from "../src/lib/screen/tradeLevels.ts";

const bar = (low, high, close = (low + high) / 2) => ({ t: 0, open: close, high, low, close, volume: 1 });
const flat = (n, low, high) => Array.from({ length: n }, () => bar(low, high));

test("stop sits just below the swing low when it is within 1–2.5 ATR", () => {
  // entry 110, swing low 104, ATR 4 → stop 104 − 0.4 = 103.6 (1.6 ATR)
  const lv = tradeLevels([...flat(9, 104, 108), bar(106, 110)], 4);
  assert.equal(lv.entry, 110);
  assert.equal(lv.stopBasis, "swing");
  assert.equal(lv.stop, 103.6);
  assert.equal(lv.buyZoneHigh, 112);
  assert.equal(lv.target1, 110 + 2 * 6.4);
  assert.equal(lv.target2, 110 + 3 * 6.4);
  assert.equal(lv.riskPercent, 5.82);
});

test("stop is capped at 2.5 ATR and floored at 1 ATR", () => {
  const wide = tradeLevels([...flat(9, 80, 108), bar(106, 110)], 4);
  assert.equal(wide.stopBasis, "atr-cap");
  assert.equal(wide.stop, 100);
  const tight = tradeLevels([...flat(9, 109, 110), bar(109.5, 110)], 4);
  assert.equal(tight.stopBasis, "atr-floor");
  assert.equal(tight.stop, 106);
});

test("flags the 52-week high only when it sits between entry and T2", () => {
  const history = [bar(100, 125), ...flat(20, 104, 108), bar(106, 110)];
  assert.equal(tradeLevels(history, 4).resistance, 125);
  assert.equal(tradeLevels([bar(100, 200), ...history.slice(1)], 4).resistance, null);
});

test("rejects missing ATR or short history", () => {
  assert.equal(tradeLevels(flat(5, 1, 2), 1), null);
  assert.equal(tradeLevels(flat(12, 1, 2), 0), null);
});

test("live price status against the plan", () => {
  const lv = tradeLevels([...flat(9, 104, 108), bar(106, 110)], 4);
  assert.equal(levelStatus(lv, 109), "wait");
  assert.equal(levelStatus(lv, 111), "triggered");
  assert.equal(levelStatus(lv, 113), "extended");
  assert.equal(levelStatus(lv, 103), "stopped");
});

test("high win-rate plan: target +0.5R and SL -2R from entry", () => {
  // entry 110, stop 103.6 → R 6.4
  const lv = tradeLevels([...flat(9, 104, 108), bar(106, 110)], 4);
  assert.equal(lv.highWinTarget, 113.2);
  assert.equal(lv.highWinStop, 97.2);
  assert.equal(lv.highWinStopPercent, 11.64);
});
