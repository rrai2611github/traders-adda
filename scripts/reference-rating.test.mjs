import test from "node:test";
import assert from "node:assert/strict";
import { referenceRating, rsAgainst } from "../src/lib/screen/referenceRating.ts";

test("rsAgainst places a score on the liquid universe's 1-99 scale without changing it", () => {
  const liquid = [10, 20, 30, 40, 50];
  assert.equal(rsAgainst(5, liquid), 1);
  assert.equal(rsAgainst(60, liquid), 99);
  assert.equal(rsAgainst(30, liquid), 50);
  assert.equal(rsAgainst(35, liquid), 62);
  assert.equal(rsAgainst(null, liquid), null);
  assert.equal(rsAgainst(10, [10]), null);
  // Same scale as the liquid ranking: an equal score gets that stock's RS.
  assert.equal(rsAgainst(50, liquid), 99);
  assert.equal(rsAgainst(10, liquid), 1);
});

test("referenceRating needs at least ₹1 Cr a day and returns a PA rating", () => {
  const candles = Array.from({ length: 300 }, (_, i) => {
    const close = 100 + i * 0.3;
    return { t: i * 86_400_000, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 2e5 };
  });
  assert.equal(referenceRating("THIN", candles, 0.5, 10, [1, 2, 3]), null);
  assert.equal(referenceRating("NONE", candles, null, 10, [1, 2, 3]), null);
  const rated = referenceRating("PIX", candles, 2, 10, [1, 2, 3, 20]);
  assert.equal(rated.symbol, "PIX");
  assert.equal(rated.rs, 83);
  assert.equal(rated.paRating.status, "rated");
  assert.ok(rated.paRating.score >= 0 && rated.paRating.score <= 100);
});