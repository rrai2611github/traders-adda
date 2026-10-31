import test from "node:test";
import assert from "node:assert/strict";
import { measureTop5, rankTop5, top5Size } from "../src/lib/screen/weeklyTop5.ts";

const DAY = 86_400_000;
const series = (n, price) => Array.from({ length: n }, (_, i) => {
  const close = price(i);
  return { t: i * DAY, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 };
});

test("a steady uptrend near its high passes with a stop 2 ATR below and a 3R target", () => {
  const c = series(300, (i) => 100 + i * 0.5);
  const m = measureTop5(c);
  assert.ok(m);
  const risk = m.close - m.stop;
  assert.ok(risk > 0);
  assert.ok(Math.abs((m.target - m.close) - 3 * risk) < 0.02);
  assert.ok(m.fromHighPercent < 2);
});

test("a downtrend fails the stacked-average rule", () => {
  assert.equal(measureTop5(series(300, (i) => 400 - i * 0.5)), null);
});

test("a stock more than 25% below its high fails", () => {
  const c = series(300, (i) => (i < 260 ? 100 + i : 360 - (i - 260) * 4));
  assert.equal(measureTop5(c), null);
});

test("too little history, a penny price or thin volume fails", () => {
  assert.equal(measureTop5(series(200, (i) => 100 + i)), null);
  assert.equal(measureTop5(series(300, (i) => 5 + i * 0.01)), null);
  const thin = series(300, (i) => 100 + i * 0.5).map((k) => ({ ...k, volume: 100 }));
  assert.equal(measureTop5(thin), null);
});

test("a stop wider than 12% is rejected", () => {
  const wild = series(300, (i) => 100 + i * 0.5).map((k) => ({ ...k, high: k.close * 1.2, low: k.close * 0.85 }));
  assert.equal(measureTop5(wild), null);
});

test("ranking: highest RS first, scanner count only breaks ties", () => {
  const p = (symbol, rs, scanners) => ({ symbol, rs, scanners });
  const sorted = [p("B", 90, 1), p("A", 90, 3), p("C", 95, 0), p("D", 85, null)].sort(rankTop5).map((x) => x.symbol);
  assert.deepEqual(sorted, ["C", "A", "B", "D"]);
});

test("size follows the breadth gate the backtest found", () => {
  assert.equal(top5Size(65).key, "full");
  assert.equal(top5Size(60).key, "full");
  assert.equal(top5Size(55).key, "quarter");
  assert.equal(top5Size(30).key, "paper");
  assert.equal(top5Size(null).key, "paper");
});
