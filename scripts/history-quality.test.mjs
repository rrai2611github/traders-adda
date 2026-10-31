import assert from "node:assert/strict";
import test from "node:test";
import {
  checkDailyHistory,
  fallbackContinuityIssue,
  previousSessionConsensus,
} from "../src/lib/market/historyQuality.ts";
import { buildCandlesFromChart, buildSeriesFromChart } from "../src/lib/market/providers/yahooChart.ts";
import { parseKiteTimestamp } from "../src/lib/market/providers/kiteTime.ts";

const NOW = Date.parse("2026-10-03T12:00:00+05:30");
const day = (key) => Date.parse(`${key}T09:15:00+05:30`);
const bar = (key, close = 100, extra = {}) => ({ t: day(key), open: close, high: close + 1, low: close - 1, close, volume: 1000, ...extra });
const sessions = ["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"];

test("clean history is returned unchanged", () => {
  const candles = sessions.map((key) => bar(key));
  assert.deepEqual(checkDailyHistory(candles, NOW), { ok: true, candles, truncation: null });
});

test("a plausible bar whose high or low contradicts its own open and close is repaired, keeping the whole history", () => {
  const candles = sessions.map((key) => bar(key));
  candles[1] = bar(sessions[1], 100, { low: 101 });
  candles[3] = bar(sessions[3], 100, { high: 99 });
  const result = checkDailyHistory(candles, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.truncation, null);
  assert.equal(result.candles.length, sessions.length);
  assert.equal(result.candles[1].low, 100);
  assert.equal(result.candles[1].high, 101);
  assert.equal(result.candles[3].high, 100);
  assert.equal(result.candles[3].low, 99);
  // The caller's candles are not changed.
  assert.equal(candles[1].low, 101);
});

test("a bar that cannot be trusted keeps only sessions after the latest such bar and reports it", () => {
  const candles = sessions.map((key) => bar(key));
  candles[1] = bar(sessions[1], 100, { low: 101 });
  candles[3] = bar(sessions[3], 100, { high: 99, close: 400 });
  const result = checkDailyHistory(candles, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.candles, candles.slice(4));
  assert.deepEqual(result.truncation, { invalidBars: 1, lastInvalidSession: "2026-09-29", keptSessions: 2 });
});

test("a bad first bar has no previous close to check it against, so it is not repaired", () => {
  const candles = sessions.map((key) => bar(key));
  candles[0] = bar(sessions[0], 100, { low: 101 });
  const result = checkDailyHistory(candles, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.truncation, { invalidBars: 1, lastInvalidSession: "2026-09-24", keptSessions: 5 });
});

test("an invalid latest bar leaves no usable history", () => {
  const candles = sessions.map((key) => bar(key));
  candles[candles.length - 1] = bar("2026-10-01", 100, { open: 0 });
  assert.equal(checkDailyHistory(candles, NOW).ok, false);
});

test("structural faults exclude the history", () => {
  const cases = [
    [[bar("2026-09-30"), bar("2026-09-30")], /Duplicate/],
    [[bar("2026-10-01"), bar("2026-09-30")], /unordered/],
    [[bar("2026-09-30"), bar("2026-10-05")], /Future/],
    [[bar("2026-09-30", 100, { volume: -1 })], /Negative/],
    [[bar("2026-09-30", 100, { close: Number.NaN })], /Non-numeric/],
  ];
  for (const [candles, reason] of cases) {
    const result = checkDailyHistory(candles, NOW);
    assert.equal(result.ok, false);
    assert.match(result.reason, reason);
  }
});

test("expired fallback history cannot hide a missing session", () => {
  const fresh = Array.from({ length: 25 }, () => sessions.map((key) => bar(key)));
  const expected = previousSessionConsensus(fresh);
  const quoteAt = Date.parse("2026-10-01T15:30:00+05:30");
  assert.equal(expected("2026-10-01"), "2026-09-30");
  assert.match(fallbackContinuityIssue(sessions.slice(0, 4).map((key) => bar(key)), quoteAt, expected), /missing 2026-09-30/);
  assert.equal(fallbackContinuityIssue(sessions.slice(0, 5).map((key) => bar(key)), quoteAt, expected), null);
  // A quote for the history's own last session only replaces it.
  assert.equal(fallbackContinuityIssue(sessions.map((key) => bar(key)), quoteAt, expected), null);
});

test("without enough fresh histories continuity is unverified, never assumed", () => {
  const expected = previousSessionConsensus([sessions.map((key) => bar(key))]);
  const issue = fallbackContinuityIssue(sessions.slice(0, 5).map((key) => bar(key)), Date.parse("2026-10-01T15:30:00+05:30"), expected);
  assert.match(issue, /cannot be verified/);
});

test("Yahoo intraday points keep their own timestamps across missing closes", () => {
  const points = buildSeriesFromChart({ timestamp: [100, 200, 300], indicators: { quote: [{ close: [10, null, 30] }] } });
  assert.deepEqual(points, [{ t: 100, p: 10 }, { t: 300, p: 30 }]);
});

test("Yahoo daily candles skip incomplete rows; null volume is zero", () => {
  const candles = buildCandlesFromChart({
    timestamp: [100, 200],
    indicators: { quote: [{ open: [1, null], high: [2, 2], low: [0.5, 1], close: [1.5, 1.5], volume: [null, 5] }] },
  });
  assert.deepEqual(candles, [{ t: 100000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 }]);
});

test("Kite timestamps parse IST exchange times and never fall back to now", () => {
  const ist = Date.parse("2026-10-01T15:30:00+05:30");
  assert.equal(parseKiteTimestamp("2026-10-01 15:30:00"), ist);
  assert.equal(parseKiteTimestamp("2026-10-01T15:30:00+0530"), ist);
  assert.equal(parseKiteTimestamp("2026-10-01T10:00:00Z"), ist);
  assert.equal(parseKiteTimestamp(ist / 1000), ist);
  assert.equal(parseKiteTimestamp(ist), ist);
  assert.equal(parseKiteTimestamp("not a time"), null);
  assert.equal(parseKiteTimestamp(undefined), null);
  assert.equal(parseKiteTimestamp(0), null);
});
