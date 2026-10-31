import assert from "node:assert/strict";
import { test } from "node:test";
import { journalStats, realizedR } from "../src/lib/screen/tradeJournal.ts";

const base = {
  id: "1", symbol: "X", name: "X", horizon: "mid", source: "Test",
  entryDate: "2026-01-01", entryPrice: 100, stop: 90, target1: 120, target2: 140, quantity: 10,
};

test("realizedR is null for an open trade or a non-positive risk", () => {
  assert.equal(realizedR({ ...base, status: "open" }), null);
  assert.equal(realizedR({ ...base, status: "closed", stop: 100, exitPrice: 110 }), null);
  assert.equal(realizedR({ ...base, status: "closed", stop: 110, exitPrice: 130 }), null);
});

test("realizedR is (exit-entry)/(entry-stop) for a closed trade", () => {
  // risk = 100 - 90 = 10; reward = 120 - 100 = 20 -> 2R win
  assert.equal(realizedR({ ...base, status: "closed", exitPrice: 120 }), 2);
  // a loss closed at the stop is exactly -1R
  assert.equal(realizedR({ ...base, status: "closed", exitPrice: 90 }), -1);
});

test("journalStats counts open/closed, win rate and average R only from closed trades", () => {
  const entries = [
    { ...base, id: "1", status: "open" },
    { ...base, id: "2", status: "closed", exitPrice: 120 }, // +2R
    { ...base, id: "3", status: "closed", exitPrice: 90 },  // -1R
    { ...base, id: "4", status: "closed", exitPrice: 100 }, // 0R (flat, not a win)
  ];
  const stats = journalStats(entries);
  assert.equal(stats.open, 1);
  assert.equal(stats.closed, 3);
  assert.equal(stats.wins, 1);
  assert.equal(stats.winRate, Math.round((1 / 3) * 1000) / 10);
  assert.equal(stats.avgR, Math.round(((2 - 1 + 0) / 3) * 100) / 100);
});

test("journalStats returns nulls, not NaN, when there are no closed trades", () => {
  const stats = journalStats([{ ...base, status: "open" }]);
  assert.equal(stats.winRate, null);
  assert.equal(stats.avgR, null);
});
