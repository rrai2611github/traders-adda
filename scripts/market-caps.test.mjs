import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const universe = read("../src/lib/market/data/nse-equities.json").equities.map((e) => e.symbol);
const caps = read("../src/lib/market/data/market-caps.json");

test("market caps cover almost every listed stock", () => {
  const covered = universe.filter((s) => caps.caps[s] > 0).length;
  assert.ok(covered / universe.length >= 0.95, `only ${covered} of ${universe.length} have a market cap`);
  assert.equal(caps.count, Object.keys(caps.caps).length);
});

test("market caps are in crore rupees and sane", () => {
  assert.ok(caps.caps.RELIANCE > 1_000_000, "RELIANCE should be over ten lakh crore");
  assert.ok(caps.caps.TCS > 500_000);
  for (const [symbol, value] of Object.entries(caps.caps)) {
    assert.ok(Number.isFinite(value) && value > 0 && value < 3_000_000, `${symbol} has an implausible market cap ${value}`);
  }
});

test("every market cap belongs to a symbol in the stock list", () => {
  const known = new Set(universe);
  const stray = Object.keys(caps.caps).filter((s) => !known.has(s));
  assert.deepEqual(stray, []);
});
