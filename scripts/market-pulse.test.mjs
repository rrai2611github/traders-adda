import test from "node:test";
import assert from "node:assert/strict";
import { marketPulse } from "../src/lib/screen/marketPulse.ts";

const regime = (overrides) => ({
  key: "selective",
  label: "Selective",
  guidance: "",
  breadth50: 55,
  breadth200: 55,
  advancing: 50,
  declining: 50,
  total: 100,
  ...overrides,
});
const sectors = [
  { sector: "IT", advancing: 8, total: 10, avgChange: 2, turnoverCr: 1 },
  { sector: "Pharma", advancing: 6, total: 10, avgChange: 1, turnoverCr: 1 },
  { sector: "Metals", advancing: 2, total: 10, avgChange: -2, turnoverCr: 1 },
];
const counts = { buyReady: 3, shortReady: 1 };

test("no breadth means a no-data pulse that stands aside", () => {
  const pulse = marketPulse(regime({ breadth50: null, breadth200: null, total: 0, advancing: 0, declining: 0 }), [], counts);
  assert.equal(pulse.score, null);
  assert.equal(pulse.mood, "no-data");
  assert.equal(pulse.stance, "Stand aside");
  assert.equal(pulse.inputs, 0);
});

test("score is the weighted mean of available inputs", () => {
  const pulse = marketPulse(regime({ breadth50: 70, breadth200: 60, advancing: 50, declining: 50 }), sectors, counts);
  assert.equal(pulse.score, Math.round(70 * 0.4 + 60 * 0.3 + 50 * 0.3));
  assert.equal(pulse.inputs, 3);
  const partial = marketPulse(regime({ breadth50: 40, breadth200: null, total: 0, advancing: 0, declining: 0 }), [], counts);
  assert.equal(partial.score, 40);
  assert.equal(partial.inputs, 1);
});

test("stance follows the regime and names leading or lagging sectors", () => {
  const on = marketPulse(regime({ key: "risk-on", label: "Risk-on", breadth50: 70, breadth200: 60 }), sectors, counts);
  assert.equal(on.stance, "Press longs");
  assert.match(on.tapeFavours, /IT and Pharma/);
  assert.equal(marketPulse(regime({ breadth50: 55 }), sectors, counts).stance, "Be selective");
  assert.equal(marketPulse(regime({ breadth50: 45 }), sectors, counts).stance, "Build watchlist");
  const off = marketPulse(regime({ key: "risk-off", label: "Risk-off", breadth50: 30, breadth200: 30, advancing: 30, declining: 70 }), sectors, counts);
  assert.equal(off.stance, "Defend capital");
  assert.match(off.tapeFavours, /F&O shorts in weak Metals/);
  assert.equal(off.mood, "bearish");
});

test("counter-trend days are called out", () => {
  const bounce = marketPulse(regime({ key: "risk-off", label: "Risk-off", breadth50: 30, breadth200: 30, advancing: 70, declining: 30 }), sectors, counts);
  assert.match(bounce.meaning, /bounce \(70% advancing\).*don't chase/);
  const dip = marketPulse(regime({ key: "risk-on", label: "Risk-on", breadth50: 70, breadth200: 60, advancing: 30, declining: 70 }), sectors, counts);
  assert.match(dip.meaning, /dip \(30% advancing\)/);
});
