import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConfluence,
  confluenceLevel,
  rankConfluence,
  stockConfluence,
} from "../src/lib/screen/confluence.ts";

const row = (symbol, overrides = {}) => ({ key: symbol, symbol, screens: [], stage: null, ...overrides });
const osc = (verdict, score = 10) => ({ score, verdict, freshJump: false });
const scanners = (results, mode = "eod") => ({ mode, results });
const rsiEdge = (scanners) => ({ scanners });

test("overlapping Core Setups count as one family", () => {
  const c = stockConfluence("AAA", row("AAA", { screens: ["VCP", "Flat base"], stage: "breakout" }), [], null, null);
  assert.equal(c.signals.length, 2);
  assert.deepEqual(c.bull, ["Core Setups"]);
});

test("played-out Core Setups are muted", () => {
  const c = stockConfluence("AAA", row("AAA", { screens: ["VCP"], stage: "played-out" }), [], null, null);
  assert.equal(c.signals[0].tone, "muted");
  assert.deepEqual(c.bull, []);
});

test("below-floor triggers are muted and fall4 is neutral", () => {
  const c = stockConfluence("AAA", null, [], scanners({
    range: [{ symbol: "AAA", passesFloor: false }],
    fall4: [{ symbol: "AAA", passesFloor: true }],
  }), null);
  assert.deepEqual(c.signals.map((s) => s.tone).sort(), ["muted", "neutral"]);
  assert.deepEqual(c.bull, []);
});

test("bearish RSI Edge against bullish setup is a conflict and excluded from ranking", () => {
  const map = buildConfluence(
    { rows: [row("AAA", { screens: ["VCP"], stage: "breakout", oscillatorScore: osc("strong") })], extraRows: [] },
    null,
    rsiEdge({ bearish: { rows: [{ symbol: "AAA" }] } }),
  );
  const c = map.get("AAA");
  assert.equal(c.conflict, true);
  assert.deepEqual(c.bull, ["Core Setups", "Oscillators"]);
  assert.deepEqual(c.bear, ["RSI Edge"]);
  assert.equal(rankConfluence(map, "bull").length, 0);
});

test("confluenceLevel thresholds", () => {
  assert.equal(confluenceLevel(0).key, "none");
  assert.equal(confluenceLevel(1).key, "single");
  assert.equal(confluenceLevel(2).key, "confirmed");
  assert.equal(confluenceLevel(3).key, "high");
  assert.equal(confluenceLevel(5).key, "high");
});

test("buildConfluence merges extra rows, triggers and RSI Edge, then ranks", () => {
  const map = buildConfluence(
    {
      rows: [row("AAA", { oscillatorScore: osc("bullish") }), row("BBB", { oscillatorScore: osc("bearish", 3) })],
      extraRows: [row("AAA", { screens: ["Cup"], stage: "forming" })],
    },
    scanners({ nr7: [{ symbol: "AAA", passesFloor: true }, { symbol: "AAA", passesFloor: true }] }),
    rsiEdge({ "daily-bullish": { rows: [{ symbol: "AAA" }, { symbol: "CCC" }] }, bearish: { rows: [{ symbol: "BBB" }] } }),
  );
  const aaa = map.get("AAA");
  assert.deepEqual(aaa.bull, ["Core Setups", "Oscillators", "Trade Triggers", "RSI Edge"]);
  assert.equal(aaa.signals.filter((s) => s.family === "Trade Triggers").length, 1, "duplicate trigger hits dedupe");
  assert.deepEqual(rankConfluence(map, "bull").map((c) => c.symbol), ["AAA"]);
  assert.deepEqual(rankConfluence(map, "bear").map((c) => c.symbol), ["BBB"]);
  assert.deepEqual(map.get("CCC").bull, ["RSI Edge"]);
});
