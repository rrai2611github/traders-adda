import test from "node:test";
import assert from "node:assert/strict";
import {
  stage2Flags, sectorStage2Series, bandOf, matchesSectorFilter, NO_SECTOR_FILTER, sortSectors, sectorSummary, windowResult, stage2SectorOf,
} from "../src/lib/screen/sectorStage2.ts";
import { inStage2Trend } from "../src/lib/screen/stage2Bases.ts";

const DAY = 86400e3;
const candle = (i, close) => ({ t: i * DAY, open: close, high: close + 1, low: close - 1, close, volume: 200_000 });
const bars = (closes, start = 0) => closes.map((close, i) => ({ day: start + i, close }));
const rising = (n, from = 100, step = 0.5) => Array.from({ length: n }, (_, i) => from + i * step);
const falling = (n, from = 300, step = 0.5) => Array.from({ length: n }, (_, i) => from - i * step);

test("no verdict until there is enough history, then a steady climb is Stage 2", () => {
  const flags = stage2Flags(rising(300));
  assert.equal(flags.slice(0, 219).every((f) => f === null), true); // 200-day average 20 sessions ago needs 220 closes
  assert.equal(flags[219], true);
  assert.equal(flags.at(-1), true);
  assert.equal(stage2Flags(falling(300)).at(-1), false);
});

test("the daily flag agrees with the Bases scanner's inStage2Trend on every session", () => {
  // A trend that rises, rolls over and recovers, so the flag actually changes.
  const closes = [...rising(260, 100, 0.6), ...falling(60, 256, 1.5), ...rising(80, 166, 1)];
  const flags = stage2Flags(closes);
  let changes = 0;
  for (let i = 230; i < closes.length; i++) {
    const expected = inStage2Trend(closes.slice(0, i + 1).map((c, k) => candle(k, c)));
    assert.equal(flags[i], expected, `session ${i}`);
    if (i > 230 && flags[i] !== flags[i - 1]) changes++;
  }
  assert.ok(changes >= 1, "the series should include a regime change");
});

test("sector share, market share and the change since the first session", () => {
  const up = bars(rising(300));
  const down = bars(falling(300));
  const stocks = [
    ...Array.from({ length: 3 }, () => ({ sector: "Alpha", bars: up })),
    ...Array.from({ length: 1 }, () => ({ sector: "Alpha", bars: down })),
    ...Array.from({ length: 4 }, () => ({ sector: "Beta", bars: down })),
    { sector: null, bars: up }, // no sector: counts in the market, in no sector
  ];
  const r = sectorStage2Series(stocks, 10);
  assert.equal(r.days.length, 10);
  const alpha = r.sectors.find((s) => s.sector === "Alpha");
  const beta = r.sectors.find((s) => s.sector === "Beta");
  assert.equal(alpha.names, 4);
  assert.equal(alpha.inStage2, 3);
  assert.equal(alpha.now, 75);
  assert.equal(beta.now, 0);
  assert.equal(r.marketNames, 9);
  assert.equal(r.marketNow, 44.4); // 4 of 9
  assert.equal(alpha.vsMarket, 30.6);
  assert.equal(alpha.band, "green");
  assert.equal(beta.band, "red");
  assert.equal(alpha.change, 0);
  assert.deepEqual(r.sectors.map((s) => s.sector), ["Alpha", "Beta"]); // best share first
});

test("a sector with too few scored stocks is left out, and a thin day is withheld", () => {
  const up = bars(rising(300));
  const r = sectorStage2Series([{ sector: "Tiny", bars: up }, { sector: "Tiny", bars: up }, ...Array.from({ length: 3 }, () => ({ sector: "Ok", bars: up }))], 5);
  assert.deepEqual(r.sectors.map((s) => s.sector), ["Ok"]);
  assert.equal(r.market.at(-1), 100);
});

test("a partial-feed day with few stocks is not treated as a session", () => {
  const full = Array.from({ length: 10 }, () => ({ sector: "A", bars: bars(rising(300)) }));
  const extra = { sector: "A", bars: [...bars(rising(300)), { day: 300, close: 999 }] }; // only one stock traded on day 300
  const r = sectorStage2Series([...full, extra], 5);
  assert.equal(r.days.includes(300), false);
});

test("bands, filters, sorting and the summary", () => {
  assert.equal(bandOf(19.9), "red");
  assert.equal(bandOf(20), "amber");
  assert.equal(bandOf(40), "green");
  const rows = [
    { sector: "A", names: 30, inStage2: 18, share: [], now: 60, change: 5, vsMarket: 25, band: "green" },
    { sector: "B", names: 4, inStage2: 1, share: [], now: 25, change: -8, vsMarket: -10, band: "amber" },
    { sector: "C", names: 12, inStage2: 1, share: [], now: 8, change: 1, vsMarket: -27, band: "red" },
  ];
  assert.deepEqual(rows.filter((r) => matchesSectorFilter(r, { ...NO_SECTOR_FILTER, minNames: 10 })).map((r) => r.sector), ["A", "C"]);
  assert.deepEqual(rows.filter((r) => matchesSectorFilter(r, { ...NO_SECTOR_FILTER, trend: "losing" })).map((r) => r.sector), ["B"]);
  assert.deepEqual(rows.filter((r) => matchesSectorFilter(r, { ...NO_SECTOR_FILTER, market: "above" })).map((r) => r.sector), ["A"]);
  assert.deepEqual(sortSectors(rows, "change").map((r) => r.sector), ["A", "C", "B"]);
  assert.deepEqual(sortSectors(rows, "names").map((r) => r.sector), ["A", "C", "B"]);
  const text = sectorSummary(rows, 35, "Over 60 sessions");
  assert.match(text, /A \(60%\).*against 35\.0% for the whole market/);
  assert.match(text, /A gained most \(\+5\.0 points\) and B lost most \(-8\.0\)/);
  assert.equal(sectorSummary([], null, "x"), "No sector has enough scored stocks to read yet.");
});

test("a shorter window recomputes the change from its own first session", () => {
  const result = {
    days: [1, 2, 3, 4], market: [10, 20, 30, 40], marketNow: 40, marketNames: 9,
    sectors: [{ sector: "A", names: 5, inStage2: 4, share: [null, 20, 50, 80], now: 80, change: 60, vsMarket: 40, band: "green" }],
  };
  const w = windowResult(result, 2);
  assert.deepEqual(w.days, [3, 4]);
  assert.deepEqual(w.market, [30, 40]);
  assert.equal(w.sectors[0].change, 30); // 80 - 50
  assert.equal(windowResult(result, 99).sectors[0].change, 60); // clamped to what exists; first value is the 20
  assert.equal(result.sectors[0].change, 60); // original untouched
});

test("hand-written sector labels fold onto the NSE sector, and unknown labels are not guessed", () => {
  const known = new Set(["Financial Services", "Healthcare", "Information Technology", "Oil Gas & Consumable Fuels"]);
  assert.equal(stage2SectorOf("Financials", known), "Financial Services");
  assert.equal(stage2SectorOf("Financial Services", known), "Financial Services");
  assert.equal(stage2SectorOf("Pharma", known), "Healthcare");
  assert.equal(stage2SectorOf("IT", known), "Information Technology");
  assert.equal(stage2SectorOf("Energy", known), "Oil Gas & Consumable Fuels");
  assert.equal(stage2SectorOf("Electronics", known), null); // not an NSE sector, no alias
  assert.equal(stage2SectorOf("Unclassified", known), null);
  assert.equal(stage2SectorOf(undefined, known), null);
  assert.equal(stage2SectorOf("  ", known), null);
});
