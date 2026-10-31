import assert from "node:assert/strict";
import { test } from "node:test";
import { computePositionSize, DEFAULT_RISK_PERCENT } from "../src/lib/screen/positionSize.ts";

test("sizes to the 1% risk budget when capital allows it", () => {
  // Risk budget = 5,00,000 * 1% = 5,000. Per-share risk = 425 - 399.97 = 25.03.
  const size = computePositionSize({ accountSize: 500_000, entry: 425, stop: 399.97 });
  assert.equal(size.quantity, Math.floor(5_000 / 25.03));
  assert.equal(size.tooSmall, false);
  assert.equal(size.capitalCapped, false);
  assert.ok(size.riskAmount <= size.riskBudget);
  assert.ok(size.capitalRequired <= 500_000);
});

test("caps by available capital when the risk budget would buy more shares than the account can afford", () => {
  // Risk budget = 5,000 * 1% = 50, per-share risk = 1 -> the risk budget alone would buy 50 shares,
  // but the account can only afford 5 shares at ₹1,000 each.
  const size = computePositionSize({ accountSize: 5_000, entry: 1_000, stop: 999 });
  assert.equal(size.quantity, 5);
  assert.equal(size.capitalCapped, true);
});

test("zero quantity when the stop is not below entry, or the account can't afford one share", () => {
  assert.equal(computePositionSize({ accountSize: 500_000, entry: 100, stop: 100 }).tooSmall, true);
  assert.equal(computePositionSize({ accountSize: 500_000, entry: 100, stop: 110 }).tooSmall, true);
  assert.equal(computePositionSize({ accountSize: 50, entry: 10_000, stop: 9_500 }).tooSmall, true);
});

test("a custom risk percent scales the budget", () => {
  const size = computePositionSize({ accountSize: 1_000_000, entry: 200, stop: 190, riskPercent: 2 });
  assert.equal(size.riskBudget, 20_000);
  assert.notEqual(DEFAULT_RISK_PERCENT, 2);
});
