import test from "node:test";
import assert from "node:assert/strict";
import { quickRows, whyLists, yearRange } from "../src/lib/screen/quickRead.ts";

const base = { vs50: 5, vs200: 12, rs: 85, paScore: 78, rvol: 1.8, fromHigh: 3, riskFlags: [] };
const by = (rows, key) => rows.find((row) => row.key === key);

test("a strong stock reads good on every row", () => {
  const rows = quickRows(base);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((row) => row.tone === "good"), JSON.stringify(rows));
});

test("trend: above both, mixed, below both", () => {
  assert.equal(by(quickRows(base), "trend").rating, "Up");
  assert.equal(by(quickRows({ ...base, vs50: -2 }), "trend").rating, "Mixed");
  assert.equal(by(quickRows({ ...base, vs50: -2, vs200: -9 }), "trend").rating, "Down");
});

test("strength, price action, volume and distance from the high use the drawer's own cut-offs", () => {
  assert.equal(by(quickRows({ ...base, rs: 30 }), "strength").rating, "Weak");
  assert.equal(by(quickRows({ ...base, rs: 50 }), "strength").rating, "Average");
  assert.equal(by(quickRows({ ...base, paScore: 34 }), "priceAction").rating, "Weak");
  assert.equal(by(quickRows({ ...base, rvol: 0.9 }), "volume").rating, "Low");
  assert.equal(by(quickRows({ ...base, fromHigh: 15 }), "nearHigh").rating, "Close");
  assert.equal(by(quickRows({ ...base, fromHigh: 40 }), "nearHigh").tone, "bad");
});

test("missing numbers show a dash, never a made-up rating", () => {
  const rows = quickRows({ vs50: null, vs200: null, rs: null, paScore: null, rvol: null, fromHigh: null, riskFlags: null });
  assert.ok(rows.every((row) => row.rating === "—" && row.tone === "none"));
});

test("red flags: serious, caution, none", () => {
  assert.equal(by(quickRows({ ...base, riskFlags: ["high", "low"] }), "risk").rating, "Yes");
  assert.equal(by(quickRows({ ...base, riskFlags: ["medium"] }), "risk").rating, "Caution");
  assert.equal(by(quickRows(base), "risk").rating, "None");
});

test("year range finds the low and high and where the price sits", () => {
  const candles = Array.from({ length: 300 }, (_, i) => ({ high: 100 + i, low: 90 + i, close: 95 + i }));
  const range = yearRange(candles, 350);
  assert.equal(range.high, 399);
  assert.equal(range.low, 140);
  assert.ok(range.position > 80 && range.position < 90);
  assert.equal(yearRange(candles.slice(0, 5), 100), null);
});

test("why and risks lists come from passed and failed checks", () => {
  const out = whyLists(
    [{ label: "A", pass: true }, { label: "B", pass: false }, { label: "C", pass: true }],
    [{ label: "Pledge", detail: "high" }],
  );
  assert.deepEqual(out.why, ["A", "C"]);
  assert.deepEqual(out.risks, ["Pledge: high", "B"]);
});
