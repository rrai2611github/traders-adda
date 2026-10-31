import { test } from "node:test";
import assert from "node:assert/strict";
import { alertTableToText, alertToPlainText, COLUMNS } from "../src/lib/alerts/alertImage.ts";

const row = (n, extra = {}) => ({
  n, source: "NR7 Narrow Range", symbol: `S${n}`, name: "Some Co", close: 100, changePercent: 1.2, status: "watch",
  statusLabel: "Wait: breadth", note: "Passes all but market breadth", entry: 101, buyZoneHigh: 103, stop: 95, riskPercent: 5.94,
  target1: 113, target2: 119, rs: 90, score: 10.3, ...extra,
});
const table = {
  brand: "Traders Adda", day: "Fri, 25 Sept, 2026", scanned: 2304, breadth: 41, healthy: false,
  summary: "Buy signals paused", rows: [row(1), row(2, { riskPercent: 8.2 })], empty: ["Inside Bar"], footer: ["Not investment advice."],
};

test("table text lists every row numbered, with levels and wide-SL flag", () => {
  const text = alertTableToText(table);
  assert.match(text, /Traders Adda · Daily Scanner Picks/);
  assert.match(text, /^1\. S1 \(NR7 Narrow Range\) · Wait: breadth$/m);
  assert.match(text, /Buy > ₹101 · SL ₹95 \(−5\.9%\) · T1 ₹113 · T2 ₹119/);
  assert.match(text, /^2\. S2/m);
  assert.match(text, /\(−8\.2%\) ⚠/);
  assert.match(text, /No pick today: Inside Bar/);
});

test("table columns render every level and plain text strips markup", () => {
  const r = row(1);
  const cells = Object.fromEntries(COLUMNS.map((c) => [c.title, c.main(r)]));
  assert.equal(cells["Buy above"], "₹101");
  assert.equal(cells["Stop loss"], "₹95");
  assert.equal(COLUMNS.find((c) => c.title === "Target 1 (2R)").sub(r), "+11.9%");
  assert.equal(alertToPlainText("<b>A &amp; B</b>"), "A & B");
});
