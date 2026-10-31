import test from "node:test";
import assert from "node:assert/strict";
import { basicStats, listingStats, medianTurnoverCr, unratedReason } from "../src/lib/screen/unrated.ts";

const candle = (open, high, low, close, volume = 1e6) => ({ t: 0, open, high, low, close, volume });
const series = (n, close = 100, volume = 1e6) => Array.from({ length: n }, () => candle(close, close + 1, close - 1, close, volume));

test("no scan yet is loading", () => {
  assert.equal(unratedReason("AAA", null, []).kind, "loading");
});

test("stocks in insufficientHistory are recent listings with sessions remaining", () => {
  const candles = [candle(610, 671, 601, 671), candle(654, 692, 621, 679), candle(700, 824, 693, 812)];
  const reason = unratedReason("NEW", { insufficientHistory: ["NEW"] }, candles);
  assert.equal(reason.kind, "recent-listing");
  assert.equal(reason.sessions, 3);
  assert.equal(reason.remaining, 17);
  assert.equal(reason.stats.listingOpen, 610);
  assert.equal(reason.stats.highSinceListing, 824);
  assert.equal(reason.stats.lowSinceListing, 601);
  assert.ok(Math.abs(reason.stats.changeFromListing - ((812 - 610) / 610) * 100) < 1e-9);
});

test("short history is a recent listing even before the scan lists it", () => {
  assert.equal(unratedReason("NEW", { insufficientHistory: [] }, series(5)).kind, "recent-listing");
});

test("enough history but unrated means below the liquidity floor", () => {
  const reason = unratedReason("THIN", { insufficientHistory: [] }, series(60, 100, 10_000));
  assert.equal(reason.kind, "below-floor");
  assert.ok(Math.abs(reason.turnoverCr - 0.1) < 1e-9);
});

test("no candles and not short-history means no data", () => {
  assert.equal(unratedReason("GONE", { insufficientHistory: [] }, []).kind, "no-data");
});

test("helpers handle empty input", () => {
  assert.equal(listingStats([]), null);
  assert.equal(medianTurnoverCr([]), null);
});

test("basic stats for unrated stocks: averages, 52-week high and median turnover from candles", () => {
  assert.equal(basicStats([]), null);
  const flat = series(199, 100, 1e5);
  const last = candle(110, 120, 108, 110, 1e5);
  const stats = basicStats([...flat, last]);
  assert.ok(Math.abs(stats.vs50 - ((110 / ((49 * 100 + 110) / 50) - 1) * 100)) < 1e-9);
  assert.ok(Math.abs(stats.vs200 - ((110 / ((199 * 100 + 110) / 200) - 1) * 100)) < 1e-9);
  assert.ok(Math.abs(stats.fromHigh - ((120 - 110) / 120) * 100) < 1e-9);
  assert.equal(stats.turnoverCr, 1);
  const short = basicStats(series(30));
  assert.equal(short.vs50, null);
  assert.equal(short.vs200, null);
});