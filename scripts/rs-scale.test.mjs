import assert from "node:assert/strict";
import { test } from "node:test";
import { rankToRs, rsAmong } from "../src/lib/screen/rsScale.ts";

test("rankToRs maps the weakest to 1 and the strongest to 99", () => {
  const rs = rankToRs([5, 1, 3]);
  assert.deepEqual(rs, [99, 1, 50]);
});

test("a score above every tradable score rates 99, below every one rates 1", () => {
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(rsAmong(sorted, 100), 99);
  assert.equal(rsAmong(sorted, -100), 1);
});

test("a score equal to a tradable stock's score rates like that stock", () => {
  const scores = [10, 20, 30, 40, 50];
  const rated = rankToRs(scores);
  scores.forEach((score, i) => assert.equal(rsAmong(scores, score), rated[i]));
});

test("a score between two stocks rates between their ratings", () => {
  const scores = [10, 20, 30, 40, 50];
  const between = rsAmong(scores, 25);
  assert.ok(between > rankToRs(scores)[1] && between <= rankToRs(scores)[2], `got ${between}`);
});

test("an empty or single-stock scale does not throw", () => {
  assert.equal(rsAmong([], 5), 1);
  assert.equal(rsAmong([3], 5), 99);
  assert.equal(rsAmong([3], 1), 1);
});
