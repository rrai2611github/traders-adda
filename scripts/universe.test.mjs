import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const universe = read("../src/lib/market/data/nse-equities.json");
const caps = read("../src/lib/market/data/market-caps.json");

test("every stock has a series and only EQ and BE are listed", () => {
  const series = new Set(universe.equities.map((e) => e.series));
  assert.deepEqual([...series].sort(), ["BE", "EQ"]);
});

test("the counts in the file match its rows", () => {
  assert.equal(universe.count, universe.equities.length);
  assert.equal(universe.counts.EQ + universe.counts.BE, universe.count);
  assert.equal(universe.equities.filter((e) => e.series === "BE").length, universe.counts.BE);
  assert.ok(universe.counts.EQ > 2000 && universe.counts.BE > 100);
});

test("symbols are unique", () => {
  const symbols = universe.equities.map((e) => e.symbol);
  assert.equal(new Set(symbols).size, symbols.length);
});

test("market caps cover almost every regular stock", () => {
  const regular = universe.equities.filter((e) => e.series === "EQ");
  const covered = regular.filter((e) => caps.caps[e.symbol] > 0).length;
  assert.ok(covered / regular.length >= 0.95, `only ${covered} of ${regular.length} regular stocks have a market cap`);
});
