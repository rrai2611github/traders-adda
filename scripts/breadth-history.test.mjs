import test from "node:test";
import assert from "node:assert/strict";
import { breadthSeries, marketMode, breadthExtreme } from "../src/lib/screen/breadthHistory.ts";

// 60 stocks, 30 days. Half trend up all the way, half trend down, so the split is exact on every day.
const stocks = (up, down, days = 30) => [
  ...Array.from({ length: up }, () => Array.from({ length: days }, (_, d) => ({ day: 1000 + d, close: 100 + d }))),
  ...Array.from({ length: down }, () => Array.from({ length: days }, (_, d) => ({ day: 1000 + d, close: 200 - d }))),
];

test("breadthSeries: share above the 10 and 20 day averages and advance/decline", () => {
  const series = breadthSeries(stocks(45, 15), 10);
  const last = series.at(-1);
  assert.equal(series.length, 10);
  assert.equal(last.above[10], 75);
  assert.equal(last.above[20], 75);
  assert.equal(last.advancing, 45);
  assert.equal(last.declining, 15);
});

test("breadthSeries: a window longer than the history is withheld, not guessed", () => {
  assert.equal(breadthSeries(stocks(45, 15)).at(-1).above[200], null);
});

test("breadthSeries: too few stocks on a day withholds the percentage", () => {
  assert.equal(breadthSeries(stocks(10, 5)).at(-1).above[20], null);
});

test("breadthSeries: a partial-feed day is not counted as a session", () => {
  const full = stocks(45, 15);
  const withStub = [...full, [{ day: 5000, close: 10 }]];
  assert.equal(breadthSeries(withStub, 5).at(-1).day, 1029);
});

test("marketMode: same thresholds as the Buy ready gate, with a size hint", () => {
  assert.equal(marketMode(65, 55).key, "risk-on");
  assert.equal(marketMode(65, 55).size, "Normal size");
  assert.equal(marketMode(52, 45).key, "selective");
  assert.equal(marketMode(35, 60).key, "risk-off");
  assert.equal(marketMode(45, 30).key, "risk-off");
  assert.equal(marketMode(null, null).key, "risk-off");
});

test("breadthExtreme: flags only the 80 and 20 bands", () => {
  assert.equal(breadthExtreme(81), "overbought");
  assert.equal(breadthExtreme(19), "oversold");
  assert.equal(breadthExtreme(50), null);
  assert.equal(breadthExtreme(null), null);
});
