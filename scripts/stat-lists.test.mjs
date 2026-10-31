import test from "node:test";
import assert from "node:assert/strict";
import { STAT_TITLES, statItems } from "../src/lib/screen/statLists.ts";

const row = (symbol, over = {}) => ({ symbol, name: `${symbol} Ltd`, price: 100, changePercent: 0, rs: 50, fromHigh: 20, aboveLow: 40, vs200: -5, ...over });
const rows = [
  row("UP1", { changePercent: 3.2, rs: 95, fromHigh: 1.2, vs200: 30 }),
  row("UP2", { changePercent: 0.4, rs: 82, fromHigh: 4.9, vs200: 12 }),
  row("DN1", { changePercent: -4.1, rs: 20, aboveLow: 2.5, vs200: -20 }),
  row("DN2", { changePercent: -0.2, rs: 85, aboveLow: 0, fromHigh: 5.1, vs200: 3 }),
  row("FLAT", { changePercent: 0, rs: null, fromHigh: null, aboveLow: null, vs200: null }),
];

test("up and down lists: gainers and losers, biggest moves first, flat stocks in neither", () => {
  assert.deepEqual(statItems("up", rows, [], []).map((i) => i.symbol), ["UP1", "UP2"]);
  assert.deepEqual(statItems("down", rows, [], []).map((i) => i.symbol), ["DN1", "DN2"]);
});

test("near high and near low: within 5%, closest first, with a plain note", () => {
  const high = statItems("nearHigh", rows, [], []);
  assert.deepEqual(high.map((i) => i.symbol), ["UP1", "UP2"]);
  assert.equal(high[0].note, "1.2% under its high");
  const low = statItems("nearLow", rows, [], []);
  assert.deepEqual(low.map((i) => i.symbol), ["DN2", "DN1"]);
  assert.equal(low[0].note, "At its 52-week low");
  assert.equal(low[1].note, "2.5% over its low");
});

test("RS 80+ and above the 200-day average: strongest first; unrated stocks never count", () => {
  assert.deepEqual(statItems("strong", rows, [], []).map((i) => i.symbol), ["UP1", "DN2", "UP2"]);
  const above = statItems("above200", rows, [], []);
  assert.deepEqual(above.map((i) => i.symbol), ["UP1", "DN2", "UP2"]);
  assert.equal(above[0].note, "30% above its 200-day average");
  assert.ok(!statItems("strong", rows, [], []).some((i) => i.symbol === "FLAT"));
});

test("breakouts and failed breakouts come from the events, once per stock, joined to the scan row", () => {
  const events = [
    { symbol: "UP1", name: "UP1 Ltd", price: 101, ext: 2.34 },
    { symbol: "UP1", name: "UP1 Ltd", price: 101, ext: 2.34 },
    { symbol: "GONE", name: "Gone Ltd", price: 55, why: "Closed back under its level" },
  ];
  const b = statItems("breakouts", rows, events, []);
  assert.deepEqual(b.map((i) => i.symbol), ["UP1", "GONE"]);
  assert.deepEqual([b[0].note, b[0].changePercent, b[0].rs, b[0].price], ["2.3% past its level", 3.2, 95, 101]);
  assert.deepEqual([b[1].changePercent, b[1].rs, b[1].note], [null, null, "Closed back under its level"]);
  const f = statItems("failed", rows, [], [{ symbol: "DN1", name: "DN1 Ltd", price: 99, retPct: -6.25 }]);
  assert.equal(f[0].note, "-6.3% since the breakout");
});

test("every tile has a title and a one-line explanation", () => {
  for (const key of ["up", "down", "nearHigh", "nearLow", "strong", "above200", "breakouts", "failed"]) {
    assert.ok(STAT_TITLES[key].title.length > 3 && STAT_TITLES[key].about.endsWith("."), key);
  }
  assert.deepEqual(statItems("up", [], [], []), []);
});
