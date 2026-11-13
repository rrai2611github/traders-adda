import test from "node:test";
import assert from "node:assert/strict";
import { trackerValuation } from "../src/lib/backtest/trackerValuation.ts";

const now = Date.parse("2026-11-11T11:25:00+05:30");
const position = { quantity: 10, spent: 1000, last: 90, stop: 80 };
const quote = { ltp: 120, source: "fyers", timestamp: now - 1000, tradeTimestamp: now - 1000, timestampBasis: "trade", fetchedAt: now };

test("latest price valuation changes P/L without changing the daily position or risk rules", () => {
  const before = structuredClone(position);
  const v = trackerValuation(position, quote, true, now);
  assert.equal(v.price, 120);
  assert.equal(v.value, 1200);
  assert.equal(v.pnl, 200);
  assert.ok(Math.abs(v.gain - 20) < 1e-10);
  assert.match(v.label, /Recent provider quote/);
  assert.equal(v.tradeAt, now - 1000);
  assert.deepEqual(position, before);
  assert.equal(trackerValuation(position, { ...quote, ltp: 95 }, true, now).pnl, -50);
});

test("missing and simulated quotes never substitute daily close or fabricate P/L", () => {
  for (const q of [undefined, { ...quote, ltp: NaN }, { ...quote, ltp: 0 }, { ...quote, source: "mock" }]) {
    const v = trackerValuation(position, q, true, now);
    assert.equal(v.price, null);
    assert.equal(v.value, null);
    assert.equal(v.pnl, null);
    assert.equal(v.gain, null);
  }
});

test("quote quality distinguishes provider time, fetch time, stale data and delayed fallback", () => {
  const unverified = trackerValuation(position, { ...quote, tradeTimestamp: null, timestampBasis: "session" }, true, now);
  assert.match(unverified.label, /Exact trade time unavailable/);
  assert.equal(unverified.tradeAt, null);
  assert.equal(unverified.fetchedAt, now);
  assert.match(trackerValuation(position, { ...quote, tradeTimestamp: now - 120001 }, true, now).label, /Stale quote/);
  assert.match(trackerValuation(position, { ...quote, tradeTimestamp: null, fetchedAt: now - 120001 }, true, now).label, /Stale quote/);
  assert.match(trackerValuation(position, { ...quote, source: "yahoo" }, true, now).label, /Delayed \/ fallback/);
  assert.match(trackerValuation(position, quote, false, now).label, /Market closed/);
});
