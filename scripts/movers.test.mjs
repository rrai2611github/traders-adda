import test from "node:test";
import assert from "node:assert/strict";
import { topMovers } from "../src/lib/screen/movers.ts";

const row = (symbol, changePercent, price = 100) => ({ symbol, price, changePercent });

test("gainers are the biggest risers, losers the biggest fallers", () => {
  const { gainers, losers } = topMovers([row("A", 1), row("B", 5), row("C", -2), row("D", -6), row("E", 3)], 2);
  assert.deepEqual(gainers.map((r) => r.symbol), ["B", "E"]);
  assert.deepEqual(losers.map((r) => r.symbol), ["D", "C"]);
});

test("a flat or missing move is never a gainer or a loser", () => {
  const { gainers, losers } = topMovers([row("A", 0), row("B", NaN), row("C", 2, NaN), row("D", -1)]);
  assert.deepEqual(gainers, []);
  assert.deepEqual(losers.map((r) => r.symbol), ["D"]);
});

test("a quiet day with fewer movers than asked for returns what exists", () => {
  assert.equal(topMovers([row("A", 1)], 5).gainers.length, 1);
  assert.deepEqual(topMovers([]), { gainers: [], losers: [] });
});
