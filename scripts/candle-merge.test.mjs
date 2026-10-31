import assert from "node:assert/strict";
import test from "node:test";
import { medianTurnoverCr, mergeQuoteIntoCandles } from "../src/lib/market/candleMerge.ts";

const day = (key) => Date.parse(`${key}T09:15:00+05:30`);
const candle = (key, close, volume = 1000) => ({ t: day(key), open: close, high: close, low: close, close, volume });
const quote = (at, ltp, extra = {}) => ({
  symbol: "X", name: "X", kind: "EQUITY", ltp, previousClose: 100, change: 0, changePercent: 0,
  open: 101, high: 110, low: 99, volume: 5000, timestamp: Date.parse(at), ...extra,
});

test("quote replaces the candle for its own session", () => {
  const history = [candle("2026-09-24", 100), candle("2026-09-25", 102)];
  const merged = mergeQuoteIntoCandles(history, quote("2026-09-25T15:30:00+05:30", 105));
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[1], { t: day("2026-09-25"), open: 101, high: 110, low: 99, close: 105, volume: 5000 });
  assert.equal(history[1].close, 102, "input history is not mutated");
});

test("quote for a new session is appended", () => {
  const merged = mergeQuoteIntoCandles([candle("2026-09-24", 100)], quote("2026-09-25T11:00:00+05:30", 104));
  assert.equal(merged.length, 2);
  assert.equal(merged[1].t, day("2026-09-25"));
  assert.equal(merged[1].close, 104);
});

test("stale or empty quotes never rewrite history", () => {
  const history = [candle("2026-09-24", 100), candle("2026-09-25", 102)];
  assert.equal(mergeQuoteIntoCandles(history, quote("2026-09-24T15:30:00+05:30", 90)), history);
  assert.equal(mergeQuoteIntoCandles(history, quote("2026-09-25T15:30:00+05:30", 0)), history);
  assert.equal(mergeQuoteIntoCandles(history, undefined), history);
});

test("zero quote volume keeps the session's known volume; high/low include the price", () => {
  const history = [candle("2026-09-25", 102, 7000)];
  const merged = mergeQuoteIntoCandles(history, quote("2026-09-25T10:00:00+05:30", 120, { volume: 0 }));
  assert.equal(merged[0].volume, 7000);
  assert.equal(merged[0].high, 120);
});

test("an earlier same-day quote never shrinks the recorded high, low or volume", () => {
  const history = [{ t: day("2026-10-01"), open: 100, high: 120, low: 90, close: 110, volume: 10000 }];
  const merged = mergeQuoteIntoCandles(history, quote("2026-10-01T10:00:00+05:30", 105, { open: 100, high: 108, low: 98, volume: 500 }));
  assert.deepEqual(merged[0], { t: day("2026-10-01"), open: 100, high: 120, low: 90, close: 105, volume: 10000 });
});

test("future-dated quotes are ignored; small clock skew is tolerated", () => {
  const history = [candle("2026-10-01", 100)];
  const now = Date.parse("2026-10-01T11:00:00+05:30");
  assert.equal(mergeQuoteIntoCandles(history, quote("2026-10-02T10:00:00+05:30", 104), now), history);
  assert.equal(mergeQuoteIntoCandles(history, quote("2026-10-01T11:10:00+05:30", 104), now), history);
  assert.equal(mergeQuoteIntoCandles(history, quote("2026-10-01T11:02:00+05:30", 104), now)[0].close, 104);
});

test("median turnover in crore", () => {
  const candles = [candle("2026-09-23", 100, 1e6), candle("2026-09-24", 100, 2e6), candle("2026-09-25", 100, 9e6)];
  assert.equal(medianTurnoverCr(candles), 20);
  assert.equal(medianTurnoverCr([]), null);
});
