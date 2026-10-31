import test from "node:test";
import assert from "node:assert/strict";
import { dashboardMetricRows } from "../src/lib/screen/dashboardMetrics.ts";
import { movingAverageBreadth } from "../src/lib/screen/breadth.ts";
import { marketRegime } from "../src/lib/screen/commandCenter.ts";

const rows = [
  { symbol: "UP", vs50: 2, vs200: -1, changePercent: 3 },
  { symbol: "AT", vs50: 0, vs200: 0, changePercent: 0 },
  { symbol: "DOWN", vs50: -1, vs200: 2, changePercent: -1 },
  { symbol: "MISSING", vs50: null, vs200: NaN, changePercent: NaN },
  { symbol: "INVALID", vs50: Infinity, vs200: null, changePercent: Infinity },
];

test("breadth drilldowns match covered numerator and include equality, not invalid values", () => {
  for (const [metric, key] of [["above50", "vs50"], ["above200", "vs200"]]) {
    const matches = dashboardMetricRows(metric, rows, [], []);
    assert.equal(matches.length, movingAverageBreadth(rows, key).above);
    assert.equal(matches.some(row => row.symbol === "AT"), true);
    assert.equal(matches.some(row => ["MISSING", "INVALID"].includes(row.symbol)), false);
  }
});

test("advancing list matches market regime and excludes flat and invalid changes", () => {
  const matches = dashboardMetricRows("advancing", rows, [], []);
  assert.deepEqual(matches.map(row => row.symbol), ["UP"]);
  assert.equal(matches.length, marketRegime(rows).advancing);
});

test("research drilldowns use exact input candidates, exclude watch and preserve ranking", () => {
  const buy = [
    { row: rows[2], signal: { status: { key: "buy-ready" } } },
    { row: rows[1], signal: { status: { key: "watch" } } },
    { row: rows[0], signal: { status: { key: "buy-ready" } } },
  ];
  const short = [{ row: rows[2], status: { key: "short-ready" } }];
  assert.deepEqual(dashboardMetricRows("buyReady", rows, buy, short).map(row => row.symbol), ["DOWN", "UP"]);
  assert.deepEqual(dashboardMetricRows("shortReady", rows, buy, short).map(row => row.symbol), ["DOWN"]);
  assert.deepEqual(dashboardMetricRows("buyReady", rows, [], short), []);
  assert.deepEqual(dashboardMetricRows("above50", [], buy, short), []);
});
