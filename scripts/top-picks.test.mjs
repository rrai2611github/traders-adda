import test from "node:test";
import assert from "node:assert/strict";
import { buildTopPicks } from "../src/lib/screen/topPicks.ts";

const row = (symbol, over = {}) => ({ symbol, stage: "forming", liquid: true, series: "EQ", rs: 92, ext: -3, vs50: 5, vs200: 30, fromHigh: 4, dry: 0.7, turnoverCr: 20, price: 100, pivotPrice: 103, aboveLow: 80, coil: 0.5, baseWk: 10, baseDepth: 20, listedWk: 300, level: 1, mcap: 5000, ...over });
const top = (symbol, rs = 99) => ({ symbol, rs, close: 100, name: `${symbol} Ltd`, sector: "Tech", spark: [1, 2, 3] });
const tags = (picks) => picks.map((p) => `${p.symbol}:${p.tag}`);

test("just-broke-out stocks lead, then the ones still under their level, then the stocks to wait on", () => {
  const rows = [
    row("RDY"),
    row("BRK", { stage: "breakout", ext: 2, pivotPrice: 98 }),
    row("RAN", { stage: "climbing", ext: 25 }),
    row("FAR", { stage: "forming", ext: -15 }),
  ];
  const picks = buildTopPicks(rows, [top("RAN"), top("FAR", 97), top("RDY")]);
  assert.deepEqual(tags(picks), ["BRK:broke", "RDY:ready", "FAR:watch", "RAN:extended"]);
});

test("buy and stop levels: the breakout level for ready stocks, the price for just-broke-out ones; none for the rest", () => {
  const picks = buildTopPicks([row("RDY"), row("BRK", { stage: "breakout", ext: 2, price: 200 }), row("RAN", { stage: "climbing", ext: 25 })], [top("RAN")]);
  const by = Object.fromEntries(picks.map((p) => [p.symbol, p]));
  assert.equal(by.RDY.buy, 103);
  assert.equal(by.RDY.stop, 90.64);
  assert.equal(by.BRK.buy, 200);
  assert.equal(by.BRK.stop, 176);
  // The targets stay at the +16% and +24% price levels the 10-year test counted, whatever the stop.
  assert.equal(by.RDY.target1, 119.48);
  assert.equal(by.RDY.target2, 127.72);
  assert.equal(by.BRK.target1, 232);
  assert.equal(by.BRK.target2, 248);
  assert.equal(by.RAN.buy, null);
  assert.equal(by.RAN.stop, null);
});

test("a stock is listed once even if it is in the Top 5 and the ready list", () => {
  const picks = buildTopPicks([row("RDY")], [top("RDY")]);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].spark.length, 3);
});

test("weak, thin, trade-for-trade or too-far-past stocks never become buyable", () => {
  const rows = [
    row("WEAK", { stage: "breakout", ext: 2, rs: 60 }), row("THIN", { stage: "breakout", ext: 2, turnoverCr: 1 }),
    row("T2T", { stage: "breakout", ext: 2, series: "BE" }), row("PAST", { stage: "breakout", ext: 9 }),
  ];
  assert.deepEqual(buildTopPicks(rows, []), []);
});

test("a Top 5 stock missing from the scan is shown as watch with no levels", () => {
  const [p] = buildTopPicks([], [top("NEW")]);
  assert.equal(p.tag, "watch");
  assert.equal(p.buy, null);
  assert.equal(p.ext, null);
});

test("targets sit 2R and 3R above the buy price, measured from the 8% stop; none for stocks to wait on", () => {
  const picks = buildTopPicks([row("RDY"), row("RAN", { stage: "climbing", ext: 25 })], [top("RAN")]);
  const by = Object.fromEntries(picks.map((p) => [p.symbol, p]));
  // buy 103, stop 94.76, risk 8.24
  assert.equal(by.RDY.target1, 119.48);
  assert.equal(by.RDY.target2, 127.72);
  assert.equal(by.RAN.target1, null);
  assert.equal(by.RAN.target2, null);
});

test("a breakout only becomes buyable when it passes Blue sky or Multi-year breakouts; others are not listed", () => {
  // Not a first-level base and a short base: matches neither tested screen.
  const none = row("NOPE", { stage: "breakout", ext: 2, level: 3, baseWk: 10, vs200: 30 });
  assert.deepEqual(buildTopPicks([none], []), []);
  const multi = row("MULTI", { stage: "breakout", ext: 2, level: 3, baseWk: 60 });
  const [p] = buildTopPicks([multi], []);
  assert.equal(p.tag, "broke");
  assert.ok(p.screens.includes("Multi-year breakouts"));
});
