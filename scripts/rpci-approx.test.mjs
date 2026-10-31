import assert from "node:assert/strict";
import { test } from "node:test";
import { measureRpciApproximation } from "../src/lib/screen/rpciApprox.ts";
import { getActiveSession } from "../src/lib/market/marketHours.ts";
import { rpciFreshness } from "../src/lib/screen/rpciFreshness.ts";

const day = (index) => Date.UTC(2026, 0, index + 1, 6);
const closed = { dateKey: "2026-03-02", progress: 1 };
const open = { dateKey: "2026-03-02", progress: 0.5 };
const nextDay = { dateKey: "2026-03-03", progress: 0.5 };
const metrics = {
  passesFloor: true, rs: 80, vs50: 5, vs200: 12, fromHigh: 2, price: 118,
};

function base() {
  return Array.from({ length: 60 }, (_, i) => ({
    t: day(i), open: 110, close: 110, high: 120,
    low: i < 20 ? 100 : i < 40 ? 103 : 108,
    volume: i < 40 ? 100 : 70,
  }));
}

function lastCandle(values = {}) {
  return { t: day(60), open: 118, high: 123, low: 115, close: 122, volume: 150, ...values };
}

function measure(candles, values = metrics, session = closed) {
  return measureRpciApproximation(candles, values, session);
}

test("uses the latest completed candle for a forming base after the close", () => {
  const candles = base();
  const completed = measure(candles);
  assert.ok(completed);
  assert.equal(completed.stage, "forming");
  assert.equal(completed.pivotPrice, 120);
  assert.equal(completed.baseLowPrice, 108);
  assert.equal(completed.entryTriggerPrice, 120);
  assert.equal(completed.riskPerShare, 12);
  assert.equal(completed.riskPercent, 10);
  assert.equal(completed.lastCompletedCandleTimestamp, day(59));
  assert.equal(completed.rangePercent, 10);
  assert.ok(Math.abs(completed.priorContractionRatio - 0.85) < 1e-10);
  assert.ok(Math.abs(completed.contractionRatio - 10 / (17 / 120 * 100)) < 1e-10);
  assert.equal(completed.volumeRatio, 0.7);

  const refreshed = measure(
    [...candles, lastCandle({ high: 120, close: 115, low: 108, volume: 40 })],
    metrics,
  );
  assert.ok(refreshed);
  assert.equal(refreshed.rangePercent, 10);
  assert.ok(refreshed.volumeRatio < completed.volumeRatio);
});

test("ignores an incomplete daily candle including its misleading volume and high", () => {
  const candles = [...base(), lastCandle({ high: 200, volume: 0 })];
  const result = measure(candles, metrics, open);
  assert.ok(result);
  assert.equal(result.stage, "forming");
  assert.equal(result.pivotPrice, 120);
  assert.equal(result.volumeRatio, 0.7);
  assert.equal(measure(candles, metrics, nextDay), null);
});

test("market calendar includes completed candles after close and on weekends", () => {
  const mondayOpen = getActiveSession(Date.UTC(2026, 2, 2, 8));
  const mondayClose = getActiveSession(Date.UTC(2026, 2, 2, 11));
  assert.equal(mondayOpen.dateKey, "2026-03-02");
  assert.ok(mondayOpen.progress < 1);
  assert.equal(mondayClose.progress, 1);
  const withMonday = [...base(), lastCandle({ high: 120, close: 115, low: 108, volume: 40 })];
  assert.equal(measure(withMonday, metrics, mondayOpen)?.volumeRatio, 0.7);
  assert.ok(measure(withMonday, metrics, mondayClose).volumeRatio < 0.7);

  const friday = { ...withMonday[withMonday.length - 1], t: day(64) };
  const weekend = getActiveSession(Date.UTC(2026, 2, 7, 8));
  assert.equal(weekend.dateKey, "2026-03-06");
  assert.equal(weekend.progress, 1);
  assert.ok(measure([...base(), friday], metrics, weekend).volumeRatio < 0.7);
});

test("an intraday pivot cross is testing, never a confirmed breakout", () => {
  const result = measure(
    [...base(), lastCandle({ close: 119, high: 122, volume: 0 })],
    { ...metrics, price: 121 },
    open,
  );
  assert.equal(result?.stage, "testing");
  assert.equal(result.breakoutVolumeRatio, null);
});

test("only a completed close above the prior pivot on volume confirms a breakout", () => {
  const breakout = [...base(), lastCandle()];
  const result = measure(breakout, { ...metrics, price: 122 });
  assert.equal(result?.stage, "breakout");
  assert.equal(result.pivotPrice, 120);
  assert.ok(result.breakoutVolumeRatio >= 1.5);

  assert.equal(measure(breakout, { ...metrics, price: 122 }, open)?.stage, "testing");
  assert.equal(measure([...base(), lastCandle({ close: 119 })], { ...metrics, price: 122 })?.stage, "testing");
  assert.equal(measure([...base(), lastCandle({ volume: 100 })], { ...metrics, price: 122 })?.stage, "testing");
  assert.equal(measure([...base(), lastCandle({ volume: 105 })], { ...metrics, price: 122 })?.stage, "breakout");
});

test("requires two consecutive contractions and volume dry-up", () => {
  assert.ok(measure(base()));
  const noFirst = base().map((c, i) => i >= 20 && i < 40 ? { ...c, low: 101 } : c);
  assert.equal(measure(noFirst), null);
  const noSecond = base().map((c, i) => i >= 40 ? { ...c, low: 105 } : c);
  assert.equal(measure(noSecond), null);
  const highVolume = base().map((c, i) => i >= 40 ? { ...c, volume: 81 } : c);
  assert.equal(measure(highVolume), null);
  assert.ok(measure(base().map((c, i) => i >= 40 ? { ...c, volume: 80 } : c)));
});

test("applies range, distance, trend, liquidity and history limits", () => {
  const input = base();
  assert.equal(measure(input.slice(1)), null);
  assert.equal(measure(input, { ...metrics, vs200: null }), null);
  assert.equal(measure(input, { ...metrics, rs: 69 }), null);
  assert.equal(measure(input, { ...metrics, passesFloor: false }), null);
  assert.ok(measure(input, { ...metrics, price: 120 * 1.03 }));
  assert.ok(measure(input, { ...metrics, price: 120 * 0.92 }));
  assert.equal(measure(input, { ...metrics, price: 120 * 1.031 }), null);
  assert.equal(measure(input, { ...metrics, price: 120 * 0.919 }), null);
  const wide = input.map((c, i) => i < 40 ? { ...c, high: 150 } : c);
  assert.equal(measure(wide), null);
});

test("freshness distinguishes recent, delayed, closed, stale, missing and simulated data", () => {
  const now = Date.UTC(2026, 2, 2, 9);
  const input = {
    updatedAt: now - 20_000,
    sessionDateKey: "2026-03-02",
    marketOpen: true,
    sourceId: "yahoo",
    quoteTimestamp: now - 60_000,
    candleTimestamp: now - 10_000,
  };
  assert.deepEqual(rpciFreshness(input, now), {
    label: "Recent quote · delay unverified", actionable: true,
  });
  assert.equal(rpciFreshness({ ...input, quoteTimestamp: now - 6 * 60_000 }, now).label, "Delayed quote");
  assert.equal(rpciFreshness({ ...input, quoteTimestamp: null }, now).label, "No quote · candle close only");
  assert.equal(rpciFreshness({ ...input, candleTimestamp: now - 24 * 60 * 60_000 }, now).label, "Stale daily candle");
  assert.equal(rpciFreshness({ ...input, updatedAt: now - 150_000 }, now).label, "Recent quote · delay unverified");
  assert.equal(rpciFreshness({ ...input, updatedAt: now - 181_000 }, now).label, "Stale scan");
  assert.equal(rpciFreshness({ ...input, marketOpen: false }, now).label, "Last session · market closed");
  // Closed-market snapshots refresh every 15 minutes, so a 10-minute-old scan is still current.
  assert.equal(rpciFreshness({ ...input, marketOpen: false, updatedAt: now - 10 * 60_000 }, now).label, "Last session · market closed");
  assert.equal(rpciFreshness({ ...input, marketOpen: false, updatedAt: now - 21 * 60_000 }, now).label, "Stale scan");
  assert.equal(rpciFreshness({ ...input, sourceId: "mock" }, now).label, "Simulated data");
});
