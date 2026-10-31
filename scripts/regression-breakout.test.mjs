import test from "node:test";
import assert from "node:assert/strict";
import { ARBM_DEFAULTS, arbmLongSignal, regressionBands, regressionBreakoutMap } from "../src/lib/chart/regressionBreakout.ts";
import { runScanners } from "../src/lib/screen/chartinkScans.ts";

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 6, 10, 0);
const bar = (i, close, { high = close * 1.005, low = close * 0.995 } = {}) => ({ t: START + i * DAY, open: close, high, low, close, volume: 1_000_000 });

/** Wide swings for 100 bars, then a tight 60-bar range, then the given closes. */
function squeezeThen(...tail) {
  const closes = [];
  for (let i = 0; i < 100; i++) closes.push(100 + 12 * Math.sin(i / 4));
  for (let i = 0; i < 60; i++) closes.push(100 + 0.6 * Math.sin(i * 1.7));
  closes.push(...tail);
  return closes.map((c, i) => bar(i, c));
}

test("regressionBands matches a hand-computed linear regression and population stdev", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 50 + i + (i % 2 ? 1 : -1));
  const o = { ...ARBM_DEFAULTS, length: 4, sqzLen: 3 };
  const b = regressionBands(closes, o);
  const ys = closes.slice(-4);
  const xs = [0, 1, 2, 3];
  const mx = 1.5;
  const my = ys.reduce((a, y) => a + y, 0) / 4;
  const slope = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const reg = my + slope * (3 - mx);
  const sd = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0) / 4);
  assert.ok(Math.abs(b.upper.at(-1) - (reg + 2 * sd)) < 1e-9);
  assert.ok(Math.abs(b.lower.at(-1) - (reg - 2 * sd)) < 1e-9);
  assert.equal(b.upper[2], null);
});

test("a close out of a squeezed channel is a long signal with band stop and width targets", () => {
  const candles = squeezeThen(104);
  const b = regressionBands(candles.map((c) => c.close));
  const i = candles.length - 1;
  assert.equal(b.squeeze[i - 1], true);
  const s = arbmLongSignal(candles);
  assert.ok(s);
  assert.ok(Math.abs(s.stop - b.lower[i - 1]) < 1e-9);
  const w = b.width[i - 1];
  assert.ok(Math.abs(s.targets[0] - (104 + w)) < 1e-9);
  assert.ok(Math.abs(s.targets[2] - (104 + 3 * w)) < 1e-9);
  // No break-out, no signal.
  assert.equal(arbmLongSignal(squeezeThen(100.2)), null);
  // The scanner exposes it under the arbm key.
  const hit = runScanners("TEST", candles, {}, { dateKey: "2099-01-01", progress: 1 }).arbm;
  assert.ok(hit);
  assert.equal(hit.values.bandStop, Math.round(s.stop * 100) / 100);
});

test("trade map trails the stop at TP1/TP2 and closes at TP3", () => {
  const candles = squeezeThen(104);
  const w = regressionBands(candles.map((c) => c.close)).width[candles.length - 2];
  // Climb through TP1, TP2 and TP3 on three later bars.
  for (const k of [1.2, 2.2, 3.2]) candles.push(bar(candles.length, 104 + k * w, { high: 104 + k * w, low: 104 + (k - 0.3) * w }));
  const map = regressionBreakoutMap(candles);
  const t = map.trades.at(-1);
  assert.equal(t.dir, 1);
  assert.deepEqual(t.events.map((e) => e.kind), ["tp1", "tp2", "tp3"]);
  assert.equal(t.outcome, "tp3");
  assert.equal(t.stopPath[1], t.entry);
  assert.equal(t.stopPath[2], t.targets[0]);
  assert.equal(map.open, null);
});

test("indicator win rate counts TP1-then-breakeven as a win; the real one does not", () => {
  const candles = squeezeThen(104);
  const w = regressionBands(candles.map((c) => c.close)).width[candles.length - 2];
  candles.push(bar(candles.length, 104 + 1.05 * w, { high: 104 + 1.1 * w, low: 104 + 0.5 * w }));
  candles.push(bar(candles.length, 103, { high: 104.2, low: 102 }));
  const map = regressionBreakoutMap(candles);
  const t = map.trades.at(-1);
  assert.equal(t.outcome, "breakeven");
  assert.equal(t.exitPrice, t.entry);
  assert.equal(t.indicatorWin, true);
  assert.equal(map.stats.indicator.winRate, 100);
  assert.equal(map.stats.real.winRate, 0);
});
