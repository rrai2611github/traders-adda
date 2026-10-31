import test from "node:test";
import assert from "node:assert/strict";
import { buildHourlyEmail } from "../src/lib/alerts/hourlyEmailFormat.ts";
import { buildPreOpenEmail } from "../src/lib/alerts/preOpenEmailFormat.ts";
import { entryState } from "../src/lib/alerts/entryState.ts";

const at = (iso) => Date.parse(`${iso}+05:30`);
const baseRow = {
  n: 1, source: "Trend Pullback", symbol: "AAA", name: "AAA Ltd", close: 105, signalClose: 100, changePercent: 2.5, status: "buy",
  statusLabel: "Buy ready", note: "Pharma", entry: 101, buyZoneHigh: 103, stop: 95, riskPercent: 5.9, target1: 113, target2: 119, rs: 90, pa: null, score: 11,
};
const table = (extra = {}) => ({
  brand: "Traders Adda", day: "14 Oct 2026", scanned: 2300, breadth: 55, healthy: true, summary: "", rows: [], watch: [], empty: [], footer: ["Not advice."], ...extra,
});
const source = (extra = {}) => ({ label: "Fyers live quotes · Yahoo history", at: at("2026-10-14T11:15:05"), live: true, refreshed: true, covered: 2, total: 2, ...extra });

test("hourly email: the latest price, where it sits against the trigger, and when and where prices were fetched", () => {
  const rows = [
    { ...baseRow, entryState: entryState(105, 101, 103) },
    { ...baseRow, n: 2, symbol: "BBB", close: 99, entryState: entryState(99, 101, 103) },
  ];
  const { html, text } = buildHourlyEmail(table({ rows, priceSource: source() }), at("2026-10-14T11:15:30"), null);
  assert.match(html, /Now above the skip level, do not chase/);
  assert.match(html, /2\.0% below the trigger/);
  assert.match(text, /AAA · CMP ₹105 \(\+2\.50%\) · now above the skip level, do not chase/);
  // Where the prices came from is not shown: it means nothing to a reader.
  assert.doesNotMatch(text, /Prices fetched|Yahoo|Fyers live quotes/);
  assert.doesNotMatch(html, /Prices fetched|Yahoo|Fyers live quotes/);
});

test("hourly email: when the live refresh fails it says the prices come from the scan", () => {
  const { text, html } = buildHourlyEmail(table({ rows: [baseRow], priceSource: source({ refreshed: false, live: false, covered: 0 }) }), at("2026-10-14T11:15:30"), null);
  assert.match(text, /Live price refresh failed: prices are from the latest scan/);
  assert.match(html, /Live price refresh failed/);
  assert.doesNotMatch(text, /now above|trigger reached|below the trigger/);
});

test("hourly email: stocks that kept their scan price are counted", () => {
  const { text } = buildHourlyEmail(table({ rows: [baseRow], priceSource: source({ covered: 1, total: 3 }) }), at("2026-10-14T11:15:30"), null);
  assert.match(text, /2 of 3 stocks kept their scan price/);
});

const brief = () => ({
  generatedAt: 0, sessionLabel: "Tue, 13 Oct",
  bias: { key: "flat", label: "Flat", score: 0, summary: "", components: [] },
  cues: [], levels: [], ideas: [], unavailable: [],
});

test("pre-open email: before the open the price is labelled as the last price and carries the entry note", () => {
  const rows = [{ ...baseRow, close: 102, changePercent: 1.2, entryState: entryState(102, 101, 103) }];
  const ps = source({ live: false, label: "Fyers live quotes · Yahoo history", at: at("2026-10-14T09:00:10") });
  const { html, text } = buildPreOpenEmail(brief(), table({ rows, priceSource: ps }), "", at("2026-10-14T09:00:30"));
  assert.match(html, />LAST PRICE</);
  assert.match(html, /Trigger reached/);
  assert.match(text, /1\. AAA · LAST PRICE ₹102 · trigger reached/);
  assert.doesNotMatch(text, /Prices fetched|Yahoo|Fyers live quotes/);
  const live = buildPreOpenEmail(brief(), table({ rows, priceSource: source() }), "", at("2026-10-14T09:00:30"));
  assert.match(live.html, />CMP</);
});
