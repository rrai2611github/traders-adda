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

import { isHeatingUp } from "../src/lib/screen/movers.ts";

const hot = { changePercent: 6, rvol: { ratio: 2.4 }, fromHigh: 4, vs50: 8, vs200: 20 };

test("heating up needs a big-volume jump near the high with the trend up", () => {
  assert.equal(isHeatingUp(hot), true);
  assert.equal(isHeatingUp({ ...hot, changePercent: 2.9 }), false);
  assert.equal(isHeatingUp({ ...hot, rvol: { ratio: 1.9 } }), false);
  assert.equal(isHeatingUp({ ...hot, fromHigh: 12 }), false);
  assert.equal(isHeatingUp({ ...hot, vs50: -1 }), false);
  assert.equal(isHeatingUp({ ...hot, vs200: -1 }), false);
});

test("missing numbers never make a stock heat up", () => {
  assert.equal(isHeatingUp({ changePercent: 6 }), false);
  assert.equal(isHeatingUp({ ...hot, rvol: null }), false);
  assert.equal(isHeatingUp({ ...hot, fromHigh: null }), false);
});
