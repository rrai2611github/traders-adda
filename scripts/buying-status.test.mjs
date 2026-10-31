import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyBuyingStatus, splitFailedChecks } from "../src/lib/screen/buyingStatus.ts";

const checks = (failed = []) => [
  "breadth", "liquid", "rs", "trend", "score", "risk", "pattern",
].map((key) => ({ key, label: key, pass: !failed.includes(key) }));

test("reserves Buy-ready for a complete pass", () => {
  assert.equal(classifyBuyingStatus(checks()).key, "buy-ready");
  assert.equal(classifyBuyingStatus(checks()).rating, 100);
});

test("keeps a breadth-only failure as a strong watch", () => {
  const result = classifyBuyingStatus(checks(["breadth"]));
  assert.equal(result.key, "watch");
  assert.match(result.detail, /breadth/);
});

test("degrades incomplete setups without allowing RS alone to imply a buy", () => {
  assert.equal(classifyBuyingStatus(checks(["risk", "pattern"])).key, "avoid");
  assert.equal(classifyBuyingStatus(checks(["breadth", "trend", "score", "risk"])).key, "avoid");
});

test("separates the market-wide breadth gate from stock-specific failures", () => {
  assert.deepEqual(splitFailedChecks(checks(["breadth", "rs"])), { stock: ["rs"], breadth: true });
  assert.deepEqual(splitFailedChecks(checks(["breadth"])), { stock: [], breadth: true });
  assert.deepEqual(splitFailedChecks(checks()), { stock: [], breadth: false });
});