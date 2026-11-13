import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCREENER_FILTER, matchesScreener, sortScreenerRows, toScreenerCsv, toTradingViewList,
  parseSavedScans, upsertSavedScan, removeSavedScan, MAX_SAVED_SCANS,
} from "../src/lib/screen/stockScreener.ts";

const row = (over = {}) => ({
  symbol: "AAA", name: "Alpha Ltd", sector: "Healthcare", liquid: true, price: 100, changePercent: 1, rs: 80, vs50: 5, vs200: 12,
  fromHigh: 4, turnoverCr: 40, mcap: 5000, stage: "forming", baseWk: 8, baseDepth: 15, ...over,
});
const f = (over = {}) => ({ ...DEFAULT_SCREENER_FILTER, ...over });

test("the default filter hides thin stocks but nothing else", () => {
  assert.equal(matchesScreener(row(), f()), true);
  assert.equal(matchesScreener(row({ liquid: false }), f()), false);
  assert.equal(matchesScreener(row({ liquid: false }), f({ liquidOnly: false })), true);
});

test("search matches symbol or name, case-insensitively", () => {
  assert.equal(matchesScreener(row(), f({ search: "alph" })), true);
  assert.equal(matchesScreener(row(), f({ search: "aaa" })), true);
  assert.equal(matchesScreener(row(), f({ search: "zzz" })), false);
});

test("numeric floors and ceilings are inclusive, and a missing value fails a set bound", () => {
  assert.equal(matchesScreener(row({ rs: 80 }), f({ minRs: 80 })), true);
  assert.equal(matchesScreener(row({ rs: 79 }), f({ minRs: 80 })), false);
  assert.equal(matchesScreener(row({ rs: null }), f({ minRs: 1 })), false);
  assert.equal(matchesScreener(row({ rs: null }), f()), true); // no bound set, so a blank is fine
  assert.equal(matchesScreener(row({ fromHigh: 10 }), f({ maxFromHigh: 10 })), true);
  assert.equal(matchesScreener(row({ fromHigh: -10.5 }), f({ maxFromHigh: 10 })), false); // stored sign is ignored
  assert.equal(matchesScreener(row({ turnoverCr: 24 }), f({ minTurnoverCr: 25 })), false);
  assert.equal(matchesScreener(row({ mcap: 100 }), f({ minMcapCr: 500 })), false);
});

test("sector and stage must match exactly", () => {
  assert.equal(matchesScreener(row(), f({ sector: "Healthcare", stage: "forming" })), true);
  assert.equal(matchesScreener(row(), f({ sector: "Energy" })), false);
  assert.equal(matchesScreener(row({ stage: null }), f({ stage: "forming" })), false);
});

test("sorting works across numbers and text, and blanks sink in both directions", () => {
  const rows = [row({ symbol: "B", rs: 50 }), row({ symbol: "A", rs: null }), row({ symbol: "C", rs: 90 })];
  assert.deepEqual(sortScreenerRows(rows, { key: "rs", dir: "desc" }).map((r) => r.symbol), ["C", "B", "A"]);
  assert.deepEqual(sortScreenerRows(rows, { key: "rs", dir: "asc" }).map((r) => r.symbol), ["B", "C", "A"]);
  assert.deepEqual(sortScreenerRows(rows, { key: "symbol", dir: "asc" }).map((r) => r.symbol), ["A", "B", "C"]);
  assert.equal(rows[0].symbol, "B"); // input untouched
});

test("CSV has a header, quotes awkward text and neutralises spreadsheet formulas", () => {
  const csv = toScreenerCsv([row({ name: 'Smith, "Jones" & Co', symbol: "S&J" }), row({ name: "=SUM(A1)", rs: null })]).split("\n");
  assert.equal(csv[0].startsWith("Symbol,Name,Sector,Price"), true);
  assert.ok(csv[1].includes('"Smith, ""Jones"" & Co"'));
  assert.ok(csv[2].includes("'=SUM(A1)"));
  assert.equal(csv[2].split(",")[5], ""); // a blank RS stays blank, not "null"
});

test("TradingView list is comma-separated NSE symbols", () => {
  assert.equal(toTradingViewList([{ symbol: "TCS" }, { symbol: "M&M" }]), "NSE:TCS,NSE:M&M");
  assert.equal(toTradingViewList([]), "");
});

test("saved scans survive bad storage and keep only valid fields", () => {
  assert.deepEqual(parseSavedScans(null), []);
  assert.deepEqual(parseSavedScans("not json"), []);
  assert.deepEqual(parseSavedScans('{"a":1}'), []);
  const parsed = parseSavedScans(JSON.stringify([
    { name: " Leaders ", filter: { minRs: 80, stage: "forming", sector: 7, liquidOnly: false, search: 3 } },
    { name: "", filter: {} },
    { filter: {} },
    null,
  ]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Leaders");
  assert.equal(parsed[0].filter.minRs, 80);
  assert.equal(parsed[0].filter.stage, "forming");
  assert.equal(parsed[0].filter.sector, null); // wrong type dropped
  assert.equal(parsed[0].filter.search, "");
  assert.equal(parsed[0].filter.liquidOnly, false);
  assert.equal(parseSavedScans(JSON.stringify([{ name: "x", filter: { stage: "bogus" } }]))[0].filter.stage, null);
});

test("saving under an existing name replaces it, newest first, and the list is capped", () => {
  let list = [];
  list = upsertSavedScan(list, { name: "One", filter: f({ minRs: 1 }) });
  list = upsertSavedScan(list, { name: "Two", filter: f() });
  list = upsertSavedScan(list, { name: "one", filter: f({ minRs: 9 }) });
  assert.deepEqual(list.map((s) => s.name), ["one", "Two"]);
  assert.equal(list[0].filter.minRs, 9);
  assert.deepEqual(upsertSavedScan(list, { name: "   ", filter: f() }).map((s) => s.name), ["one", "Two"]);
  for (let i = 0; i < 30; i++) list = upsertSavedScan(list, { name: `s${i}`, filter: f() });
  assert.equal(list.length, MAX_SAVED_SCANS);
  assert.deepEqual(removeSavedScan(list, "s29").some((s) => s.name === "s29"), false);
});
