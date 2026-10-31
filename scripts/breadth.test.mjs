import assert from "node:assert/strict";
import { test } from "node:test";
import { movingAverageBreadth } from "../src/lib/screen/breadth.ts";

test("counts actual distance above each moving average with independent coverage", () => {
  const rows = [
    { vs50: 4, vs200: -2 },
    { vs50: 0, vs200: 1 },
    { vs50: -1, vs200: null },
    { vs50: null, vs200: 0 },
  ];
  assert.deepEqual(movingAverageBreadth(rows, "vs50"), { covered: 3, above: 2, percent: 67 });
  assert.deepEqual(movingAverageBreadth(rows, "vs200"), { covered: 3, above: 2, percent: 67 });
  assert.deepEqual(movingAverageBreadth([], "vs50"), { covered: 0, above: 0, percent: null });
});
