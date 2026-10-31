import test from "node:test";
import assert from "node:assert/strict";
import { PA_COMPONENTS, calibrate, paGrade, paWhy, priceActionRating } from "../src/lib/screen/priceActionRating.ts";

const DAY = 86_400_000;
const START = Date.UTC(2023, 0, 2, 10, 0);
const series = (n, growth) =>
  Array.from({ length: n }, (_, i) => {
    const close = 100 * growth ** i;
    return { t: START + i * DAY, open: close * 0.999, high: close * 1.008, low: close * 0.992, close, volume: 1_000_000 };
  });

test("needs 200 sessions and at least ₹1 Cr a day", () => {
  assert.equal(priceActionRating(series(150, 1.002), 50).status, "insufficient");
  const illiquid = priceActionRating(series(300, 1.002), 0.5);
  assert.equal(illiquid.status, "illiquid");
  assert.equal(illiquid.score, null);
});

test("a steady uptrend outscores a downtrend, and components stay within their caps", () => {
  const up = priceActionRating(series(300, 1.002), 50);
  const down = priceActionRating(series(300, 0.998), 50);
  assert.equal(up.status, "rated");
  assert.ok(up.score > down.score, `${up.score} vs ${down.score}`);
  assert.ok(up.score >= 70);
  for (const r of [up, down]) {
    assert.equal(r.components.length, PA_COMPONENTS.length);
    for (const c of r.components) assert.ok(c.points >= 0 && c.points <= c.max + 1e-9, `${c.key} ${c.points}`);
    assert.ok(r.score >= 0 && r.score <= 100);
  }
});

test("thin turnover costs up to 12 points", () => {
  const liquid = priceActionRating(series(300, 1.002), 50);
  const thin = priceActionRating(series(300, 1.002), 1.5);
  const deduction = thin.deductions.find((d) => d.label.startsWith("Thin"));
  assert.ok(deduction && deduction.points < 0 && deduction.points >= -12);
  assert.ok(thin.raw < liquid.raw);
  assert.equal(liquid.deductions.length, 0);
});

test("calibration is piecewise linear and clamped; grades follow the bands", () => {
  const knots = [[0, 0], [40, 50], [100, 100]];
  assert.equal(calibrate(-5, knots), 0);
  assert.equal(calibrate(20, knots), 25);
  assert.equal(calibrate(70, knots), 75);
  assert.equal(calibrate(120, knots), 100);
  assert.deepEqual([90, 85, 84, 70, 50, 35, 34].map(paGrade), ["A+", "A+", "A", "A", "B", "C", "D"]);
});

test("stats are null unless rated, and describe the same trend the components scored", () => {
  const unrated = priceActionRating(series(150, 1.002), 50);
  assert.equal(unrated.stats, null);
  assert.deepEqual(paWhy(unrated), []);

  const up = priceActionRating(series(300, 1.002), 50);
  assert.ok(up.stats);
  assert.equal(up.stats.aboveEma200, true);
  assert.equal(up.stats.emaStackBullish, true);
  // A steady grind up for 300 sessions sits at its 52-week high.
  assert.ok(up.stats.rangePosition > 0.95, String(up.stats.rangePosition));
  assert.ok(up.stats.fromHigh52 < 5, String(up.stats.fromHigh52));

  const down = priceActionRating(series(300, 0.998), 50);
  assert.equal(down.stats.aboveEma200, false);
});

test("paWhy always grounds its lines in the rated stock's own stats, never a fixed template", () => {
  const up = priceActionRating(series(300, 1.002), 50);
  const lines = paWhy(up);
  assert.ok(lines.length >= 4);
  assert.ok(lines.some((l) => l.includes("EMA stack")));
  assert.ok(lines.some((l) => l.includes("52-week high")));
  assert.ok(lines.some((l) => l.includes("ATR")));

  const down = priceActionRating(series(300, 0.998), 50);
  const downLines = paWhy(down);
  assert.ok(downLines.some((l) => l.includes("below the 200 EMA")));
});
