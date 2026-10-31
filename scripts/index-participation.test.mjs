import test from "node:test";
import assert from "node:assert/strict";
import { buildIndexParticipation } from "../src/lib/market/indexParticipation.ts";
import { rankIndexLevels } from "../src/lib/market/indexLevelRanking.ts";
import { expectedIndexSession, indexHistoryIssue, isIndexContextCacheFresh } from "../src/lib/market/indexDataQuality.ts";
import { INDEX_MEMBERSHIP_SOURCES, parseIndexMembers } from "./index-membership-import.mjs";

const bars = (values) => values.map((close, i) => ({
  t: Date.UTC(2026, 0, i + 1), open: close, close, high: close + 1, low: close - 1, volume: 0,
}));

test("expected sessions distinguish pre-open, forming daily and completed history", () => {
  const at = (clock) => Date.parse(`2026-10-05T${clock}+05:30`);
  assert.equal(expectedIndexSession("live", at("09:00:00")), "2026-10-01");
  assert.equal(expectedIndexSession("live", at("09:15:00")), "2026-10-05");
  assert.equal(expectedIndexSession("completed", at("15:29:59")), "2026-10-01");
  assert.equal(expectedIndexSession("completed", at("15:30:00")), "2026-10-05");
  assert.equal(expectedIndexSession("completed", Date.parse("2026-10-03T12:00:00+05:30")), "2026-10-01");
});

test("cached missing breadth invalidates immediately when the shared snapshot becomes ready", () => {
  assert.equal(isIndexContextCacheFresh(1000, null, null, 2000), true);
  assert.equal(isIndexContextCacheFresh(1000, null, 1500, 2000), false);
  assert.equal(isIndexContextCacheFresh(1000, 1500, 1700, 2000), false);
  assert.equal(isIndexContextCacheFresh(1000, 1500, 1500, 61_000), false);
  assert.equal(isIndexContextCacheFresh(1000, 1500, 1500, 999), false);
});

test("invalid, future and duplicate OHLC history is explicit", () => {
  const history = bars([100, 101]);
  const now = history.at(-1).t;
  assert.equal(indexHistoryIssue(history, now), null);
  assert.match(indexHistoryIssue([...history, history.at(-1)], now), /Duplicate/);
  assert.match(indexHistoryIssue([{ ...history[0], high: 50 }], now), /Invalid/);
  assert.match(indexHistoryIssue([{ ...history[0], close: NaN }], now), /Invalid/);
  assert.match(indexHistoryIssue(history, history[0].t), /Future/);
});

test("breadth direction compares the same cohort five index sessions earlier", () => {
  const rising = bars([...Array(55).fill(100), ...Array(5).fill(110)]);
  const falling = bars([...Array(55).fill(100), ...Array(5).fill(90)]);
  const histories = new Map([["A", rising], ["B", rising], ["C", rising], ["D", falling], ["SHORT", rising.slice(-20)]]);
  const result = buildIndexParticipation(histories, ["A", "B", "C", "D", "SHORT"], rising);
  assert.equal(result.comparisonCoverage, 4);
  assert.equal(result.change50pp, 75);
  assert.equal(result.direction, "Improving");
  assert.equal(result.current.coverage50, 4);
  assert.equal(result.current.covered, 5);
});

test("insufficient common coverage or missing exact session does not create a trend", () => {
  const rising = bars([...Array(55).fill(100), ...Array(5).fill(110)]);
  const result = buildIndexParticipation(new Map([["A", rising], ["B", rising.slice(0, -1)]]), ["A", "B"], rising);
  assert.equal(result.current.covered, 1);
  assert.equal(result.direction, "Unavailable");
  assert.equal(result.change50pp, null);
});

test("ranking uses independent references, not duplicate pivots or proximity as win probability", () => {
  const ranked = rankIndexLevels([
    { label: "Confirmed swing high", price: 110 },
    { label: "Confirmed swing high", price: 110 },
    { label: "Last completed week high", price: 110.1 },
    { label: "Last completed day high", price: 101 },
  ], 100, 1);
  assert.equal(ranked[0].strength, "Major");
  assert.equal(ranked[0].score, 7);
  assert.equal(ranked[0].references.length, 2);
  assert.equal(ranked.at(-1).strength, "Minor");
  assert.equal(ranked.at(-1).side, "Resistance");
});

test("clusters do not chain into an arbitrarily wide zone", () => {
  const result = rankIndexLevels([100,100.1,100.2].map((price) => ({ price, label: "Last completed day high" })), 100, 1);
  assert.equal(result.length, 2);
  assert.ok(result.every((level) => level.high - level.low <= 0.15));
});

test("a zone spanning current price is not labelled entirely support or resistance", () => {
  const result = rankIndexLevels([
    { price: 99.98, label: "Last completed day low" },
    { price: 100.04, label: "Last completed week high" },
  ], 100, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].side, "At price");
});

test("official CSV parsing handles quoted commas and refuses incomplete or duplicate imports", () => {
  const csv = 'Company Name,Industry,Symbol,Series,ISIN Code\n"A, Ltd",IT,TCS,EQ,123\nB,IT,INFY,EQ,456';
  assert.deepEqual(parseIndexMembers(csv, { min: 2, max: 2 }), ["INFY","TCS"]);
  assert.throws(() => parseIndexMembers(csv, INDEX_MEMBERSHIP_SOURCES.NIFTYIT), /count/);
  assert.throws(() => parseIndexMembers(csv.replace("INFY", "TCS"), { min: 2, max: 2 }), /Duplicate/);
  assert.throws(() => parseIndexMembers("<html>error</html>", { min: 2, max: 2 }), /Symbol/);
});
