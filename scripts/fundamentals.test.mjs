import test from "node:test";
import assert from "node:assert/strict";
import { assessFundamentals, parsePledge, parseShareholding, parseYahooFundamentals } from "../src/lib/fundamentals/assess.ts";

const NOW = Date.parse("2026-10-31T00:00:00Z");
const CR = 1e7;
const q = (date, sales, profit) => ({ date, sales: sales * CR, profit: profit * CR });
// Five quarters, oldest first, ending Sep 2026.
const quarters = (latestSales, latestProfit, yearSales = 1000, yearProfit = 100) => [
  q("2025-09-30", yearSales, yearProfit), q("2025-12-31", 1000, 100), q("2026-03-31", 1000, 100), q("2026-06-30", 1000, 100), q("2026-09-30", latestSales, latestProfit),
];
const holdings = (latest, yearAgo) => [
  { date: "2026-09-30", promoter: latest }, { date: "2026-06-30", promoter: latest }, { date: "2026-03-31", promoter: latest }, { date: "2025-12-31", promoter: latest }, { date: "2025-09-30", promoter: yearAgo },
];
const input = (over = {}) => ({ quarters: quarters(1200, 130), debt: 100 * CR, equity: 1000 * CR, holdings: holdings(50, 50), pledgedPercent: 0, lender: false, now: NOW, ...over });
const tone = (report, key) => report.checks.find((c) => c.key === key)?.tone;

test("a growing company with low debt, steady owners and no pledges is strong", () => {
  const r = assessFundamentals(input());
  assert.equal(r.verdict, "strong");
  assert.equal(tone(r, "sales"), "good");
  assert.equal(tone(r, "profit"), "good");
  assert.equal(tone(r, "debt"), "good");
  assert.equal(tone(r, "pledge"), "good");
  assert.equal(r.quarterEnd, "2026-09-30");
});

test("sales growth bands: 15% good, 0% ok, below 0 warning", () => {
  assert.equal(tone(assessFundamentals(input({ quarters: quarters(1150, 100) })), "sales"), "good");
  assert.equal(tone(assessFundamentals(input({ quarters: quarters(1050, 100) })), "sales"), "ok");
  assert.equal(tone(assessFundamentals(input({ quarters: quarters(900, 100) })), "sales"), "warn");
});

test("profit: a loss warns, a swing from loss to profit is good, a big drop warns", () => {
  assert.equal(tone(assessFundamentals(input({ quarters: quarters(1200, -20) })), "profit"), "warn");
  assert.equal(tone(assessFundamentals(input({ quarters: quarters(1200, 30, 1000, -40) })), "profit"), "good");
  assert.equal(tone(assessFundamentals(input({ quarters: quarters(1200, 80) })), "profit"), "warn");
  assert.equal(tone(assessFundamentals(input({ quarters: quarters(1200, 95) })), "profit"), "ok");
});

test("falls are worded as 'down 29%', never 'down -29%', and months use three letters", () => {
  const r = assessFundamentals(input({ quarters: quarters(1200, 71) }));
  const profit = r.checks.find((c) => c.key === "profit").detail;
  assert.match(profit, /down 29% on a year earlier/);
  assert.doesNotMatch(profit, /-\d/);
  assert.match(profit, /quarter to Sep 2026/);
});

test("debt against net worth: low, moderate, high, and negative net worth", () => {
  assert.equal(tone(assessFundamentals(input({ debt: 400 * CR })), "debt"), "good");
  assert.equal(tone(assessFundamentals(input({ debt: 1200 * CR })), "debt"), "ok");
  assert.equal(tone(assessFundamentals(input({ debt: 2500 * CR })), "debt"), "warn");
  assert.equal(tone(assessFundamentals(input({ equity: -5 * CR })), "debt"), "warn");
});

test("a bank or lender is not judged on debt", () => {
  const r = assessFundamentals(input({ lender: true, debt: 90_000 * CR }));
  assert.equal(tone(r, "debt"), "unknown");
  assert.notEqual(r.verdict, "weak");
});

test("promoters selling 2 points or more in a year warns; buying 1 point or more is good; small moves are ok", () => {
  assert.equal(tone(assessFundamentals(input({ holdings: holdings(48, 51) })), "promoter"), "warn");
  assert.equal(tone(assessFundamentals(input({ holdings: holdings(52, 50.5) })), "promoter"), "good");
  assert.equal(tone(assessFundamentals(input({ holdings: holdings(50.4, 50) })), "promoter"), "ok");
});

test("a company with no promoter group is neutral and has no pledge check", () => {
  const r = assessFundamentals(input({ holdings: [{ date: "2026-09-30", promoter: 0 }] }));
  assert.equal(tone(r, "promoter"), "ok");
  assert.equal(r.checks.some((c) => c.key === "pledge"), false);
});

test("pledged shares: none good, a little ok, above 10% warns", () => {
  assert.equal(tone(assessFundamentals(input({ pledgedPercent: 3.85 })), "pledge"), "ok");
  assert.equal(tone(assessFundamentals(input({ pledgedPercent: 18 })), "pledge"), "warn");
  assert.equal(tone(assessFundamentals(input({ pledgedPercent: null })), "pledge"), "unknown");
});

test("verdict counts warnings: one is mixed, two is weak", () => {
  assert.equal(assessFundamentals(input({ pledgedPercent: 30 })).verdict, "mixed");
  const two = assessFundamentals(input({ pledgedPercent: 30, quarters: quarters(900, 100) }));
  assert.equal(two.verdict, "weak");
  assert.match(two.headline, /2 warning signs/);
});

test("results older than about 200 days are not judged", () => {
  const stale = [q("2025-12-31", 1000, 100), q("2026-03-31", 1000, 100)];
  const r = assessFundamentals(input({ quarters: stale }));
  assert.equal(tone(r, "sales"), "unknown");
  assert.equal(tone(r, "profit"), "unknown");
  assert.match(r.checks[0].detail, /too old/);
});

test("with almost nothing known the verdict is unknown, not strong", () => {
  const r = assessFundamentals({ quarters: [], debt: null, equity: null, holdings: [], pledgedPercent: null, lender: false, now: NOW });
  assert.equal(r.verdict, "unknown");
  assert.equal(r.quarterEnd, null);
});

test("Yahoo's timeseries is parsed into oldest-first quarters plus the latest year's debt and net worth", () => {
  const row = (asOfDate, raw) => ({ asOfDate, periodType: "3M", reportedValue: { raw } });
  const json = { timeseries: { result: [
    { meta: { type: ["quarterlyNetIncome"] }, quarterlyNetIncome: [row("2026-06-30", 5e8), row("2026-03-31", 4e8)] },
    { meta: { type: ["quarterlyTotalRevenue"] }, quarterlyTotalRevenue: [row("2026-03-31", 9e9), row("2026-06-30", 1e10)] },
    { meta: { type: ["annualTotalDebt"] }, annualTotalDebt: [row("2025-03-31", 1), row("2026-03-31", 8e9)] },
    { meta: { type: ["annualStockholdersEquity"] }, annualStockholdersEquity: [row("2026-03-31", 3e10)] },
  ] } };
  const p = parseYahooFundamentals(json);
  assert.deepEqual(p.quarters.map((x) => x.date), ["2026-03-31", "2026-06-30"]);
  assert.equal(p.quarters[1].sales, 1e10);
  assert.equal(p.quarters[1].profit, 5e8);
  assert.equal(p.debt, 8e9);
  assert.equal(p.equity, 3e10);
  assert.deepEqual(parseYahooFundamentals(null), { quarters: [], debt: null, equity: null });
  assert.deepEqual(parseYahooFundamentals({ timeseries: { result: [] } }).quarters, []);
});

test("NSE shareholding rows are read newest first and bad rows are dropped", () => {
  const rows = [
    { date: "30-JUN-2026", pr_and_prgrp: "50.48" },
    { date: "30-SEP-2026", pr_and_prgrp: "50.44" },
    { date: "bad", pr_and_prgrp: "10" },
    { date: "31-MAR-2026", pr_and_prgrp: "-" },
  ];
  assert.deepEqual(parseShareholding(rows), [{ date: "2026-09-30", promoter: 50.44 }, { date: "2026-06-30", promoter: 50.48 }]);
  assert.deepEqual(parseShareholding("nope"), []);
});

test("NSE pledge data gives the percent of promoter shares pledged", () => {
  assert.equal(parsePledge({ data: [{ percSharesPledged: "3.85", shp: "30-Sep-2026" }] }), 3.85);
  assert.equal(parsePledge({ data: [] }), null);
  assert.equal(parsePledge(null), null);
});
