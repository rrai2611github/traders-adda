import test from "node:test";
import assert from "node:assert/strict";
import { buildSectorHeatmap, formatHeatValue, heatLevel } from "../src/lib/screen/sectorHeatmap.ts";

const row = (symbol, sector, changePercent, extra = {}) => ({
  symbol, name: symbol, sector, changePercent, vs50: null, rs: null, turnoverCr: 10, ...extra,
});

test("groups by macro sector, skips small and unclassified sectors, largest traded value first", () => {
  const rows = [
    row("A", "Information Technology", 1, { turnoverCr: 5 }),
    row("B", "IT", 3, { turnoverCr: 5 }),
    row("C", "Information Technology", -1, { turnoverCr: 5 }),
    row("D", "Financial Services", -2, { turnoverCr: 100 }),
    row("E", "Financial Services", -1, { turnoverCr: 50 }),
    row("F", "Financial Services", 0.5, { turnoverCr: 1 }),
    row("G", "Tiny", 5),
    row("H", undefined, 5),
  ];
  const sectors = buildSectorHeatmap(rows, "change");
  assert.deepEqual(sectors.map((s) => s.sector), ["Financial Services", "Information Technology"]);
  assert.equal(sectors[1].value, 1);
  assert.equal(sectors[1].advancing, 2);
  assert.deepEqual(sectors[0].members.map((m) => m.symbol), ["D", "E", "F"]);
});

test("a stock listed twice counts once", () => {
  const rows = [row("A", "Energy", 1), row("A", "Energy", 1), row("B", "Energy", 1), row("C", "Energy", 1)];
  assert.equal(buildSectorHeatmap(rows, "change")[0].total, 3);
});

test("vs50 is the share above the 50-day line and RS is the median", () => {
  const rows = [
    row("A", "Energy", 0, { vs50: 4, rs: 90 }),
    row("B", "Energy", 0, { vs50: -2, rs: 40 }),
    row("C", "Energy", 0, { vs50: 1, rs: 70 }),
    row("D", "Energy", 0, { vs50: null, rs: null }),
  ];
  assert.equal(Math.round(buildSectorHeatmap(rows, "vs50")[0].value), 67);
  assert.equal(buildSectorHeatmap(rows, "rs")[0].value, 70);
});

test("heat levels are symmetric around each scale's centre", () => {
  assert.equal(heatLevel("change", 0.1, "sector"), 0);
  assert.equal(heatLevel("change", 1.2, "sector"), 2);
  assert.equal(heatLevel("change", -2.5, "stock"), -3);
  assert.equal(heatLevel("vs50", 72, "sector"), 2);
  assert.equal(heatLevel("vs50", -12, "stock"), -3);
  assert.equal(heatLevel("rs", 20, "sector"), -3);
  assert.equal(heatLevel("rs", null, "sector"), 0);
});

test("values format by metric and scope", () => {
  assert.equal(formatHeatValue("change", 1.234, "sector"), "+1.23%");
  assert.equal(formatHeatValue("vs50", 66.7, "sector"), "67%");
  assert.equal(formatHeatValue("vs50", -3.21, "stock"), "-3.2%");
  assert.equal(formatHeatValue("rs", 81.5, "sector"), "82");
  assert.equal(formatHeatValue("rs", null, "stock"), "—");
});
