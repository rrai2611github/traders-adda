import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChartinkRows, parseChartinkScanToken } from "../src/lib/screen/rsiEdgeChartink.ts";

test("extracts the hidden scanner run token from Chartink HTML", () => {
  const html = '{&quot;scan_run_token&quot;:&quot;abc123def456&quot;}';
  assert.equal(parseChartinkScanToken(html), "abc123def456");
});

test("normalizes Chartink default scanner columns", () => {
  const rows = normalizeChartinkRows([{
    nsecode: "EMKAY",
    name: "Emkay Global Financial Services Limited",
    bsecode: "532737",
    "scan-column-default-close": 286.55,
    "scan-column-default-percent-change": 5.99,
    "scan-column-default-volume": 249152,
  }]);
  assert.deepEqual(rows[0], {
    symbol: "EMKAY",
    name: "Emkay Global Financial Services Limited",
    bseCode: "532737",
    price: 286.55,
    changePercent: 5.99,
    volume: 249152,
    rsi: null,
  });
});

test("normalizes custom Chartink bearish columns", () => {
  const rows = normalizeChartinkRows([{
    nsecode: "ADANIENT",
    name: "Adani Enterprises Limited",
    bsecode: "512599",
    close: 2820.2,
    "%_change": -3.3,
    volume: 1080117,
    rsi: 37.49,
  }]);
  assert.equal(rows[0].symbol, "ADANIENT");
  assert.equal(rows[0].changePercent, -3.3);
  assert.equal(rows[0].rsi, 37.49);
});

test("accepts formatted numeric values from Chartink", () => {
  const rows = normalizeChartinkRows([{
    nsecode: "TEST",
    name: "Formatted result",
    close: "1,234.50",
    "%_change": "-1.25%",
    volume: "1,23,456",
  }]);
  assert.equal(rows[0].price, 1234.5);
  assert.equal(rows[0].changePercent, -1.25);
  assert.equal(rows[0].volume, 123456);
});

test("rejects incomplete source rows instead of fabricating values", () => {
  assert.throws(
    () => normalizeChartinkRows([{ nsecode: "BROKEN", name: "Broken row" }]),
    /missing required market data/,
  );
});
