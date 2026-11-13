import test from "node:test";
import assert from "node:assert/strict";
import {
  measureStage2Base, rankStage2Bases, matchesBaseFilter, NO_BASE_FILTER, bucketCounts, LENGTH_BUCKETS, DISTANCE_BUCKETS,
} from "../src/lib/screen/stage2Bases.ts";

const DAY = 86400e3;
const bar = (i, close, { high = close + 1, low = close - 1, volume = 200_000 } = {}) => ({ t: i * DAY, open: close, high, low, close, volume });

/**
 * 300 sessions of a steady uptrend (100 -> ~220), a peak high of 230 set 40 sessions before the end, a pullback to
 * a low of 190, then a recovery to `lastClose`.
 */
function series({ lastClose = 220, lastVolume = 200_000, peakAt = 259 } = {}) {
  const c = [];
  for (let i = 0; i < peakAt; i++) c.push(bar(i, 100 + i * 0.45));
  c.push(bar(peakAt, 228, { high: 230 }));
  for (let i = peakAt + 1; i < 299; i++) c.push(bar(i, 205 + ((i * 7) % 11), { low: i === 275 ? 190 : undefined }));
  c.push(bar(299, lastClose, { volume: lastVolume, high: lastClose + 1 }));
  return c;
}

test("a stock under its base high in a Stage 2 trend is a forming base with the right facts", () => {
  const base = measureStage2Base(series({ lastClose: 224 }));
  assert.ok(base);
  assert.equal(base.kind, "forming");
  assert.equal(base.baseHigh, 230);
  assert.equal(base.baseLow, 190);
  assert.equal(base.lengthSessions, 40);
  assert.equal(base.depthPercent, 21.05); // 230 / 190 - 1
  assert.equal(base.toHighPercent, 2.61); // (1 - 224/230)
});

test("closing above the base high after 4+ weeks is a breakout; volume decides quality", () => {
  const weak = measureStage2Base(series({ lastClose: 235 }));
  assert.equal(weak.kind, "breakout");
  assert.equal(weak.quality, false); // average volume, no confirmation
  assert.equal(measureStage2Base(series({ lastClose: 224 })).quality, false); // a forming base is never flagged
  const strong = measureStage2Base(series({ lastClose: 235, lastVolume: 400_000 }));
  assert.equal(strong.kind, "breakout");
  assert.equal(strong.quality, true);
});

test("a close above a base that is under 4 weeks old is not a breakout", () => {
  assert.equal(measureStage2Base(series({ lastClose: 235, peakAt: 285 })), null);
});

test("no Stage 2 trend, no base", () => {
  const falling = series().map((c, i) => ({ ...c, close: c.close * (i > 200 ? 0.6 : 1), low: c.low * 0.6, high: c.high * 0.6 }));
  assert.equal(measureStage2Base(falling), null);
  assert.equal(measureStage2Base(series().slice(0, 150)), null);
});

test("depth does not change the quality flag: a deep base with a volume-backed breakout still qualifies", () => {
  const deep = series({ lastClose: 235, lastVolume: 400_000 }).map((c, i) => (i === 275 ? { ...c, low: 120 } : c));
  const base = measureStage2Base(deep);
  assert.ok(base.depthPercent > 35);
  assert.equal(base.kind, "breakout");
  assert.equal(base.quality, true);
});

test("ranking puts breakouts first, then the nearest forming base", () => {
  const row = (kind, toHighPercent) => ({ kind, toHighPercent });
  const sorted = [row("forming", 4), row("forming", 1), row("breakout", -2), row("breakout", -5)].sort(rankStage2Bases);
  assert.deepEqual(sorted.map((r) => `${r.kind}:${r.toHighPercent}`), ["breakout:-2", "breakout:-5", "forming:1", "forming:4"]);
});

test("filters and bucket counts use consistent edges", () => {
  const rows = [
    { toHighPercent: 0.5, lengthSessions: 9, depthPercent: 8 },
    { toHighPercent: 1, lengthSessions: 10, depthPercent: 25 },
    { toHighPercent: 6, lengthSessions: 120, depthPercent: 50 },
  ];
  assert.equal(rows.filter((r) => matchesBaseFilter(r, { ...NO_BASE_FILTER, maxToHigh: 3, maxDepth: 20 })).length, 1);
  assert.equal(rows.filter((r) => matchesBaseFilter(r, { ...NO_BASE_FILTER, minSessions: 10, maxSessions: 119 })).length, 1);
  assert.deepEqual(bucketCounts(rows.map((r) => r.lengthSessions), LENGTH_BUCKETS), [1, 1, 0, 0, 0, 1]);
  assert.deepEqual(bucketCounts(rows.map((r) => r.toHighPercent), DISTANCE_BUCKETS), [1, 1, 0, 0, 1, 0]);
});
