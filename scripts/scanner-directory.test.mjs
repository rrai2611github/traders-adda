import test from "node:test";
import assert from "node:assert/strict";
import { SCANNER_DIRECTORY, TRADING_STYLES, directoryCounts } from "../src/lib/screen/scannerDirectory.ts";
import { VISIBLE_SCANNER_KEYS } from "../src/lib/screen/chartinkScans.ts";
import { RSI_EDGE_SCAN_KEYS } from "../src/lib/screen/rsiEdgeSource.ts";

const row = (symbol, overrides = {}) => ({ key: symbol, symbol, screens: [], stage: null, rpciApprox: null, oscillatorScore: null, ...overrides });

test("directory lists exactly the visible scanners, each with a rule and style", () => {
  const triggers = SCANNER_DIRECTORY.filter((entry) => entry.source.kind === "trigger").map((entry) => entry.source.key);
  assert.deepEqual(triggers, VISIBLE_SCANNER_KEYS);
  const edges = SCANNER_DIRECTORY.filter((entry) => entry.source.kind === "rsi-edge").map((entry) => entry.source.key);
  assert.deepEqual(edges, RSI_EDGE_SCAN_KEYS);
  assert.equal(new Set(SCANNER_DIRECTORY.map((entry) => entry.id)).size, SCANNER_DIRECTORY.length);
  for (const entry of SCANNER_DIRECTORY) {
    assert.ok(entry.rule.length > 20, entry.id);
    assert.ok(TRADING_STYLES[entry.horizon], entry.id);
  }
});

test("counts are null until each source loads", () => {
  const counts = directoryCounts(null, null, null);
  for (const entry of SCANNER_DIRECTORY) assert.equal(counts.get(entry.id).count, null, entry.id);
});

test("Core Setups count unique active symbols across primary and extra rows, excluding played-out", () => {
  const scan = {
    rows: [row("AAA", { screens: ["VCP"], stage: "breakout" }), row("BBB", { screens: ["VCP"], stage: "played-out" })],
    extraRows: [row("AAA", { screens: ["VCP"], stage: "breakout" }), row("CCC", { screens: ["VCP", "Blue sky"], stage: "forming" })],
  };
  const counts = directoryCounts(scan, null, null);
  assert.deepEqual(counts.get("screen-vcp"), { count: 2, detail: "1 fresh breakout" });
  assert.equal(counts.get("screen-blue-sky").count, 1);
  assert.equal(counts.get("screen-ipo").count, 0);
});

test("RPCI and oscillator counts", () => {
  const scan = {
    rows: [
      row("AAA", { rpciApprox: { stage: "breakout" }, oscillatorScore: { score: 12, freshJump: true } }),
      row("BBB", { rpciApprox: { stage: "forming" }, oscillatorScore: { score: 10.9, freshJump: false } }),
    ],
  };
  const counts = directoryCounts(scan, null, null);
  assert.deepEqual(counts.get("rpci"), { count: 2, detail: "1 confirmed breakout" });
  assert.equal(counts.get("oscillator-strong").count, 1);
  assert.equal(counts.get("oscillator-fresh").count, 1);
});

test("Trade Triggers count liquid hits only; RSI Edge failures stay unavailable", () => {
  const scanners = { results: { range: [{ symbol: "AAA", passesFloor: true }, { symbol: "BBB", passesFloor: false }], nr7: [], fall4: [], rsidiv: [] } };
  const rsiEdge = {
    scanners: { "daily-bullish": { rows: [{ symbol: "AAA" }, { symbol: "AAA" }, { symbol: "BBB" }] }, bearish: { rows: [{ symbol: "ZZZ" }] } },
    errors: { bearish: "timeout" },
  };
  const counts = directoryCounts(null, scanners, rsiEdge);
  assert.deepEqual(counts.get("trigger-range"), { count: 1, detail: "+1 below liquidity floor" });
  assert.equal(counts.get("trigger-nr7").count, 0);
  assert.equal(counts.get("rsi-edge-daily-bullish").count, 2);
  assert.equal(counts.get("rsi-edge-weekly-bullish").count, null);
  assert.deepEqual(counts.get("rsi-edge-bearish"), { count: null, detail: "Chartink source unavailable" });
});
