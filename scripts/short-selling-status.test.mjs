import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyShortSellingStatus,
  currentScanShortSellingStatus,
} from "../src/lib/screen/shortSellingStatus.ts";

const bearishRow = {
  changePercent: -2,
  turnoverCr: 50,
  rs: 20,
  vs50: -8,
  vs200: -12,
  stage: "forming",
  oscillatorScore: { bearish: 11 },
};

test("all bearish checks produce Short ready", () => {
  const status = currentScanShortSellingStatus(bearishRow, 35);
  assert.equal(status.label, "Short ready");
  assert.equal(status.rating, 100);
});

test("a bullish trend prevents a strong-short status", () => {
  const status = currentScanShortSellingStatus({ ...bearishRow, vs50: 4, vs200: 7 }, 35);
  assert.equal(status.label, "Avoid");
  assert.equal(status.rating, 75);
  assert.deepEqual(status.failed, ["Below 50-day average", "Below 200-day average"]);
});

test("ratings below half are marked avoid short", () => {
  const status = classifyShortSellingStatus([
    { key: "one", label: "One", pass: true },
    { key: "two", label: "Two", pass: false },
    { key: "three", label: "Three", pass: false },
  ]);
  assert.equal(status.label, "Avoid");
  assert.equal(status.rating, 33);
});
