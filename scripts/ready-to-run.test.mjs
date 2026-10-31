import test from "node:test";
import assert from "node:assert/strict";
import { readyToRun } from "../src/lib/screen/readyToRun.ts";

const ok = { symbol: "AAA", stage: "forming", liquid: true, series: "EQ", rs: 92, ext: -3, vs50: 5, vs200: 30, fromHigh: 4, dry: 0.7, turnoverCr: 20 };
const names = (rows) => readyToRun(rows).map((r) => r.row.symbol);

test("a strong, quiet stock just under its breakout level qualifies", () => {
  const [r] = readyToRun([ok]);
  assert.equal(r.row.symbol, "AAA");
  assert.equal(r.underPivot, 3);
  assert.equal(r.quiet, true);
});

test("stocks that have already broken out, are weak, thin, trade-for-trade or far under the level are left out", () => {
  const rows = [
    { ...ok, symbol: "RAN", ext: 4 }, { ...ok, symbol: "CLIMB", stage: "climbing" }, { ...ok, symbol: "WEAK", rs: 60 },
    { ...ok, symbol: "THIN", turnoverCr: 1 }, { ...ok, symbol: "T2T", series: "BE" }, { ...ok, symbol: "FAR", ext: -12 },
    { ...ok, symbol: "DOWN", vs50: -2 }, { ...ok, symbol: "NOTLIQ", liquid: false }, { ...ok, symbol: "LOWHIGH", fromHigh: 30 },
  ];
  assert.deepEqual(names(rows), []);
});

test("quiet stocks come first, then higher RS, and a stock is listed once", () => {
  const rows = [
    { ...ok, symbol: "LOUD", rs: 99, dry: 1.4 }, { ...ok, symbol: "QUIET1", rs: 88 }, { ...ok, symbol: "QUIET2", rs: 95 }, { ...ok, symbol: "QUIET2", rs: 95 },
  ];
  assert.deepEqual(names(rows), ["QUIET2", "QUIET1", "LOUD"]);
});

test("missing data never qualifies", () => {
  assert.deepEqual(names([{ ...ok, ext: null }, { ...ok, symbol: "B", rs: null }, { ...ok, symbol: "C", turnoverCr: null }]), []);
});
