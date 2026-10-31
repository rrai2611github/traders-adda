import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndexAnalysis, buildIndexBreadth, completedIndexCandles, completedIndexWeeks } from "../src/lib/market/indexAnalysis.ts";
import { wilderAtr, adx } from "../src/lib/screen/oscillators.ts";

const candles = Array.from({ length: 220 }, (_, index) => {
  const close = 100 + index * 0.5;
  return {
    t: Date.UTC(2025, 0, index + 1),
    open: close - 0.2,
    high: close + 1,
    low: close - 1,
    close,
    volume: 0,
  };
});

test("builds trend, momentum, volatility, and range analysis", () => {
  const result = buildIndexAnalysis(candles, "NIFTY50");
  assert.ok(result);
  assert.ok(result.sma20 > result.sma50);
  assert.ok(result.sma50 > result.sma200);
  assert.equal(result.rsi14, 100);
  assert.equal(result.resistance, candles.at(-2).high);
  assert.equal(result.support, candles.at(-21).low);
  assert.deepEqual(result.observations.map(({ label }) => label), [
    "Trend",
    "Momentum",
    "Key levels",
    "Daily volatility",
  ]);
  assert.equal(result.observations[0].tone, "positive");
});

test("uses volatility-specific interpretation for India VIX", () => {
  const result = buildIndexAnalysis(candles.slice(0, 40).map((candle) => ({
    ...candle,
    open: 21,
    high: 22,
    low: 20,
    close: 21,
  })), "INDIAVIX");
  assert.ok(result);
  assert.equal(result.observations[0].label, "Risk regime");
  assert.equal(result.observations[0].tone, "caution");
  assert.match(result.observations[0].text, /high zone/);
});

const ist = (value) => Date.parse(`${value}+05:30`);
const bar = (day, close = 100) => ({
  t: ist(`${day}T09:15:00`), open: close, high: close + 1, low: close - 1, close, volume: 0,
});

test("Wilder RSI agrees with a known seed and smooths later changes", () => {
  const closes = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00];
  const bars = closes.map((close, i) => ({ ...candles[i], open: close, high: close + 1, low: close - 1, close }));
  assert.ok(Math.abs(buildIndexAnalysis(bars.slice(0, 15), "NIFTY50").rsi14 - 70.464135) < 0.00001);
  assert.ok(Math.abs(buildIndexAnalysis(bars, "NIFTY50").rsi14 - 66.249619) < 0.00001);
});

test("Wilder ATR has a 14-change warmup and agrees with the existing ADX ATR", () => {
  const bars = candles.slice(0, 40);
  assert.equal(wilderAtr(bars)[13], null);
  assert.equal(wilderAtr(bars)[14], 2);
  assert.deepEqual(wilderAtr(bars).slice(14), adx(bars).atr.slice(14));
});

test("completed daily and weekly readings exclude in-progress sessions and weeks", () => {
  const bars = [bar("2026-09-25"), bar("2026-09-28"), bar("2026-09-29"), bar("2026-09-30"), bar("2026-10-01")];
  const now = ist("2026-10-01T12:00:00");
  assert.equal(completedIndexCandles(bars, now).at(-1).t, bars[3].t);
  assert.equal(completedIndexWeeks(completedIndexCandles(bars, now), now).length, 1);
  // Friday is Gandhi Jayanti: the week completes on Thursday's close.
  assert.equal(completedIndexWeeks(bars, ist("2026-10-01T16:00:00")).length, 2);
  assert.equal(completedIndexWeeks(bars, ist("2026-10-03T15:00:00")).length, 2);
});

test("breadth uses actual members, reports coverage and excludes nonmembers", () => {
  const histories = new Map([
    ["A", candles.slice(0, 220)],
    ["B", candles.slice(0, 40).map((c, i) => ({ ...c, close: 100 - i }))],
    ["OUTSIDE", candles],
  ]);
  const result = buildIndexBreadth(histories, ["A", "B", "MISSING"]);
  assert.equal(result.total, 3);
  assert.equal(result.covered, 2);
  assert.equal(result.above20, 50);
  assert.equal(result.above50, 100);
  assert.equal(result.coverage50, 1);
  assert.equal(result.coverage200, 1);
  assert.equal(result.advances, 1);
  assert.equal(result.declines, 1);
});

test("nearby levels bracket price without treating an incomplete candle as a completed level", () => {
  const now = ist("2026-10-01T12:00:00");
  const bars = [...candles, bar("2026-09-30", 200), bar("2026-10-01", 202)];
  const result = buildIndexAnalysis(bars, "NIFTY50", now);
  assert.equal(result.provisional, true);
  assert.ok(result.nearbySupport.price < result.close);
  assert.ok(result.nearbyResistance.price > result.close);
  assert.equal(result.structuralLevels.find((l) => l.label === "Last completed day high").price, 201);
  assert.match(result.scenarios.bullish, /breadth/);
  assert.doesNotMatch(result.scenarios.range, /guaranteed/);
});
