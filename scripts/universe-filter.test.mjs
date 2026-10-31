import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { filterRsiEdge, filterScan, filterScanners, isUniverseKey, UNIVERSE_OPTIONS } from "../src/lib/screen/universeFilter.ts";

const lists = JSON.parse(readFileSync(new URL("../src/lib/market/data/index-universes.json", import.meta.url), "utf8"));
const keep = (symbol) => ["RELIANCE", "TCS"].includes(symbol);

test("index snapshot is complete and nested", () => {
  assert.equal(lists.nifty50.length, 50);
  assert.ok(lists.nifty100.length >= 95 && lists.nifty200.length >= 190 && lists.nifty500.length >= 480);
  assert.ok(lists.fno.length >= 150);
  for (const symbol of lists.nifty50) assert.ok(lists.nifty100.includes(symbol), `${symbol} missing from Nifty 100`);
  assert.ok(lists.fno.includes("RELIANCE"));
  assert.ok(!lists.fno.includes("NIFTY"), "index underlyings are excluded");
});

test("every picker option is a valid key", () => {
  assert.deepEqual(UNIVERSE_OPTIONS.map((option) => option.key), ["all", "nifty50", "nifty100", "nifty200", "nifty500", "fno"]);
  assert.ok(isUniverseKey("fno"));
  assert.ok(!isUniverseKey("nifty1000"));
});

test("filterScan narrows rows but keeps market-wide rows for breadth", () => {
  const rows = [{ symbol: "RELIANCE" }, { symbol: "ALOKINDS" }, { symbol: "TCS" }];
  const scan = { rows, extraRows: [{ symbol: "ALOKINDS" }], feed: [{ symbol: "TCS" }] };
  const filtered = filterScan(scan, keep);
  assert.deepEqual(filtered.rows.map((row) => row.symbol), ["RELIANCE", "TCS"]);
  assert.deepEqual(filtered.marketRows, rows);
  assert.deepEqual(filtered.extraRows, []);
  assert.equal(filtered.feed.length, 1);
  assert.equal(filterScan(scan, null), scan);
  assert.deepEqual(filterScan(filtered, (s) => s === "TCS").marketRows, rows, "re-filtering keeps the original market rows");
});

test("filterScanners and filterRsiEdge narrow every list and recount totals", () => {
  const scanners = { breadth: { percent: 34 }, results: { nr7: [{ symbol: "TCS" }, { symbol: "ALOKINDS" }], fall4: [] } };
  const out = filterScanners(scanners, keep);
  assert.deepEqual(out.results.nr7.map((row) => row.symbol), ["TCS"]);
  assert.equal(out.breadth.percent, 34);

  const edge = { scanners: { bearish: { total: 2, rows: [{ symbol: "ALOKINDS" }, { symbol: "RELIANCE" }] } }, errors: {} };
  const narrowed = filterRsiEdge(edge, keep);
  assert.equal(narrowed.scanners.bearish.total, 1);
  assert.deepEqual(narrowed.scanners.bearish.rows.map((row) => row.symbol), ["RELIANCE"]);
});
