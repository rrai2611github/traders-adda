import test from "node:test";
import assert from "node:assert/strict";
import { adx, ema, macd, measureMomentumOscillator, rsi, stochastic, weeklyCloses } from "../src/lib/screen/oscillators.ts";

const DAY = 86_400_000;
// 2026-01-05 is a Monday; candles at 15:30 IST.
const START = Date.UTC(2026, 0, 5, 10, 0);
const candle = (i, close, spread = 1, volume = 1_000_000) => ({
  t: START + i * DAY, open: close, high: close + spread, low: close - spread, close, volume,
});
const settled = { dateKey: "2099-01-01", progress: 1 };
const strong = { passesFloor: true, rs: 85, vs50: 5, vs200: 15 };

test("Wilder RSI matches the textbook example", () => {
  const closes = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.6140, 46.2820, 46.2820, 46.0028, 46.0328, 46.4116, 46.2222];
  const out = rsi(closes, 14);
  assert.equal(out[13], null);
  assert.ok(Math.abs(out[14] - 70.53) < 0.05, `got ${out[14]}`);
  assert.ok(Math.abs(out[15] - 66.32) < 0.05, `got ${out[15]}`);
  assert.ok(Math.abs(out[18] - 66.36) < 0.05, `got ${out[18]}`);
});

test("EMA seeds with the simple average then smooths", () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(out.slice(0, 3), [null, null, 2]);
  assert.equal(out[3], 3);
  assert.equal(out[4], 4);
});

test("MACD is flat zero on a constant series", () => {
  const { line, signal } = macd(new Array(60).fill(100));
  assert.equal(line[24], null);
  assert.equal(line[25], 0);
  assert.equal(signal[33], 0);
  assert.equal(signal[32], null);
});

test("stochastic reads 100 at the top of the range and ADX 100 in a one-way trend", () => {
  const up = Array.from({ length: 60 }, (_, i) => candle(i, 100 + i));
  const s = stochastic(up);
  assert.ok(Math.abs(s.k[59] - 93.33) < 0.01, `got ${s.k[59]}`); // close 159 in a 145–160 range
  const d = adx(up);
  assert.equal(d.minusDi[59], 0);
  assert.ok(d.plusDi[59] > 40);
  assert.ok(Math.abs(d.adx[59] - 100) < 1e-9);
  assert.ok(Math.abs(d.atr[59] - 2) < 1e-9);
});

test("weekly closes take the last close of each IST week", () => {
  const days = Array.from({ length: 12 }, (_, i) => candle(i, 100 + i));
  assert.deepEqual(weeklyCloses(days), [106, 111]);
});

// A zigzag uptrend (two up days, one down) that can dip for 4 sessions and bounce.
function trend(n, dipAt) {
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= i >= dipAt + 4 ? 1.015 : i >= dipAt ? 0.99 : i % 3 === 0 ? 0.99 : 1.009;
    out.push(candle(i, +price.toFixed(2), price * 0.012));
  }
  return out;
}

test("screen rejects weak, downtrending or short-history stocks", () => {
  const candles = trend(200, 500);
  assert.equal(measureMomentumOscillator(candles, { ...strong, rs: 60 }, settled), null);
  assert.equal(measureMomentumOscillator(candles, { ...strong, vs200: -1 }, settled), null);
  assert.equal(measureMomentumOscillator(candles, { ...strong, passesFloor: false }, settled), null);
  assert.equal(measureMomentumOscillator(candles.slice(0, 100), strong, settled), null);
});

test("uptrend with moderate momentum qualifies as continuation", () => {
  const result = measureMomentumOscillator(trend(200, 500), strong, settled);
  assert.ok(result, "expected a result");
  assert.equal(result.setup, "continuation");
  assert.ok(result.rsi >= 50 && result.rsi <= 70);
  assert.ok(result.macd > result.macdSignal && result.macd > 0);
  assert.ok(result.adx >= 20 && result.plusDi > result.minusDi);
  assert.ok(result.atr > 0);
});

test("a dip that turns up inside the trend is a fresh pullback", () => {
  const candles = trend(196, 190);
  const result = measureMomentumOscillator(candles, strong, settled);
  assert.ok(result, "expected a result");
  assert.equal(result.setup, "pullback");
  assert.equal(result.fresh, true);
  assert.ok(result.signalTimestamp >= candles[candles.length - 3].t);
});

test("the running session's candle is ignored until it completes", () => {
  const candles = trend(201, 500);
  const lastDay = new Date(candles[200].t + 19_800_000).toISOString().slice(0, 10);
  const live = measureMomentumOscillator(candles, strong, { dateKey: lastDay, progress: 0.5 });
  assert.ok(live);
  assert.equal(live.lastCompletedCandleTimestamp, candles[199].t);
});
