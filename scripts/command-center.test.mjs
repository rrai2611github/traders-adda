import test from "node:test";
import assert from "node:assert/strict";
import {
  groupScanBySector,
  marketRegime,
  nearestBuyIdeas,
  rankBuyIdeas,
  rankShortIdeas,
  sessionChanges,
} from "../src/lib/screen/commandCenter.ts";

const base = {
  key: "X",
  symbol: "X",
  name: "X Ltd",
  sector: "Information Technology",
  price: 100,
  changePercent: 1,
  turnoverCr: 20,
  rs: 90,
  vs50: 10,
  vs200: 25,
  fromHigh: 5,
  ext: 3,
  pivotPrice: 98,
  baseWk: 8,
  stage: "forming",
  exitReason: null,
  oscillatorScore: {
    score: 12,
    bearish: 1,
    levels: { entry: 101, buyZoneHigh: 103, stop: 96, target1: 111, target2: 116, riskPercent: 4.95, atr: 2, swingLow20: 96, swingLow50: 93 },
  },
};

const row = (overrides) => ({ ...base, ...overrides, key: overrides.symbol ?? base.symbol });

test("regime is risk-on only with broad 50- and 200-day participation", () => {
  const strong = Array.from({ length: 10 }, (_, i) => row({ symbol: `S${i}`, vs50: i < 7 ? 5 : -5, vs200: i < 6 ? 5 : -5 }));
  assert.equal(marketRegime(strong).key, "risk-on");
  const mixed = Array.from({ length: 10 }, (_, i) => row({ symbol: `M${i}`, vs50: i < 5 ? 5 : -5, vs200: i < 5 ? 5 : -5 }));
  assert.equal(marketRegime(mixed).key, "selective");
  const weak = Array.from({ length: 10 }, (_, i) => row({ symbol: `W${i}`, vs50: i < 3 ? 5 : -5 }));
  assert.equal(marketRegime(weak).key, "risk-off");
  assert.equal(marketRegime([]).key, "risk-off");
});

test("buy ideas keep Buy ready and drop failing and illiquid names; weak breadth turns them into Watch", () => {
  const ready = row({ symbol: "READY", rs: 80 });
  const failing = row({ symbol: "FAIL", rs: 99, vs200: -1 });
  const illiquid = row({ symbol: "THIN", turnoverCr: 1 });
  const ideas = rankBuyIdeas([failing, illiquid, ready], "short", 60);
  assert.deepEqual(ideas.map((idea) => idea.row.symbol), ["READY"]);
  assert.equal(ideas[0].signal.status.key, "buy-ready");
  const weakDay = rankBuyIdeas([failing, illiquid, ready], "short", 40);
  assert.deepEqual(weakDay.map((idea) => [idea.row.symbol, idea.signal.status.key]), [["READY", "watch"]]);
});

test("buy ideas of the same status rank by RS", () => {
  const ideas = rankBuyIdeas([row({ symbol: "RS75", rs: 75 }), row({ symbol: "RS95", rs: 95 }), row({ symbol: "RS85", rs: 85 })], "short", 60);
  assert.deepEqual(ideas.map((idea) => idea.row.symbol), ["RS95", "RS85", "RS75"]);
});

test("passing-breadth comparison changes only breadth checks across horizons, without mutating normal results", () => {
  const rows = [
    row({ symbol: "STRONG" }),
    row({ symbol: "RISK", riskFlags: [{ severity: "high", label: "Climax", detail: "High risk" }] }),
    row({ symbol: "FAIL", rs: 10, vs200: -1 }),
    row({ symbol: "THIN", turnoverCr: 1 }),
  ];
  for (const horizon of ["short", "mid", "long"]) {
    const normal = rankBuyIdeas(rows, horizon, 30);
    const comparison = rankBuyIdeas(rows, horizon, 100);
    assert.deepEqual(normal.map(idea => [idea.row.symbol, idea.signal.status.key]), [["STRONG", "watch"], ["RISK", "watch"]]);
    assert.deepEqual(comparison.map(idea => [idea.row.symbol, idea.signal.status.key]), [["STRONG", "buy-ready"], ["RISK", "watch"]]);
    for (const idea of comparison) {
      const baseline = normal.find(item => item.row.symbol === idea.row.symbol);
      assert.deepEqual(idea.signal.plan, baseline.signal.plan);
      assert.deepEqual(idea.signal.status.checks.filter(check => check.key !== "breadth"), baseline.signal.status.checks.filter(check => check.key !== "breadth"));
    }
    assert.deepEqual(rankBuyIdeas(rows, horizon, 30), normal);
    assert.equal(rankBuyIdeas(rows, horizon, null)[0].signal.status.key, "watch");
  }
});

test("nearest buy ideas only surface near-miss setups with a plan", () => {
  const developing = row({ symbol: "DEV", rs: 80, vs50: 2, vs200: 5, oscillatorScore: { ...base.oscillatorScore, score: 6 } });
  const weak = row({ symbol: "WEAK", rs: 60, vs50: 2, vs200: -3, oscillatorScore: { ...base.oscillatorScore, score: 6 } });
  const nearest = nearestBuyIdeas([weak, developing, { ...developing, key: "THIN", symbol: "THIN", turnoverCr: 1 }], "short", 30);
  assert.deepEqual(nearest.map((idea) => idea.row.symbol), ["DEV"]);
  assert.equal(nearest[0].signal.status.key, "avoid");
  assert.equal(rankBuyIdeas([developing], "short", 30).length, 0);
});

test("short ideas require bearish evidence", () => {
  const bearish = row({
    symbol: "BEAR", rs: 10, vs50: -8, vs200: -15, changePercent: -2, stage: null,
    oscillatorScore: { score: 1, bearish: 12, levels: null },
  });
  const ideas = rankShortIdeas([bearish, row({ symbol: "BULL" })], 40);
  assert.deepEqual(ideas.map((idea) => idea.row.symbol), ["BEAR"]);
  assert.equal(ideas[0].status.key, "short-ready");
});

test("sectors need at least three members and sort by average move", () => {
  const rows = [
    row({ symbol: "A", sector: "Information Technology", changePercent: 2 }),
    row({ symbol: "B", sector: "Information Technology", changePercent: 1 }),
    row({ symbol: "C", sector: "Information Technology", changePercent: 0 }),
    row({ symbol: "D", sector: "Healthcare", changePercent: 5 }),
  ];
  const sectors = groupScanBySector(rows);
  assert.equal(sectors.length, 1);
  assert.equal(sectors[0].total, 3);
  assert.equal(sectors[0].avgChange, 1);
});

test("session changes dedupe breakouts and split failures", () => {
  const event = (type, symbol, volumeRatio = null) => ({ type, symbol, name: symbol, price: 110, pivot: 100, screens: ["VCP"], volumeRatio });
  const changes = sessionChanges([
    event("breakout", "A", 1.5),
    event("inner_breakout", "A", 1.5),
    event("breakout", "B", 3),
    event("failed_poke", "C"),
    event("played_out", "D"),
    event("squat", "E"),
  ]);
  assert.deepEqual(changes.breakouts.map((item) => item.symbol), ["B", "A"]);
  assert.deepEqual(changes.failed.map((item) => item.symbol), ["C"]);
  assert.deepEqual(changes.exits.map((item) => item.symbol), ["D"]);
});
