import test from "node:test";
import assert from "node:assert/strict";
import { openingBiasWithGift } from "../src/lib/screen/morningBrief.ts";
import { buildHourlyEmail } from "../src/lib/alerts/hourlyEmailFormat.ts";
import { buildPreOpenEmail } from "../src/lib/alerts/preOpenEmailFormat.ts";
import { buildIndexEmailSection } from "../src/lib/alerts/indexEmailFormat.ts";

const derived = (score) => ({ key: "strong-down", label: "Weak start likely", score, summary: "Derived opening bias ... GIFT Nifty is not available from our data sources, so this is computed, not quoted.", components: [{ label: "S&P 500", raw: score, effect: score, weight: 3, note: "n" }] });

test("a quoted GIFT Nifty gap sets the opening call; the overnight tape is quoted beside it", () => {
  const up = openingBiasWithGift(derived(-1.39), 1.38);
  assert.equal(up.label, "Positive start likely");
  assert.equal(up.score, 1.38);
  assert.match(up.summary, /GIFT Nifty is \+1\.38% against the last Nifty close/);
  assert.match(up.summary, /overnight global tape alone reads −1\.39%/);
  assert.match(up.summary, /open against the global mood/);
  assert.doesNotMatch(up.summary, /not available/);
  assert.equal(up.components.length, 1);
});

test("GIFT and the tape agreeing says nothing about disagreement; a small gap is flat", () => {
  const agree = openingBiasWithGift(derived(-0.9), -0.6);
  assert.equal(agree.label, "Weak start likely");
  assert.doesNotMatch(agree.summary, /against the global mood/);
  assert.equal(openingBiasWithGift(derived(-0.9), 0.05).label, "Flat, range-bound open");
});

test("without a usable GIFT quote the derived bias is returned unchanged", () => {
  const bias = derived(-0.4);
  assert.equal(openingBiasWithGift(bias, null), bias);
  assert.equal(openingBiasWithGift(bias, undefined), bias);
  assert.equal(openingBiasWithGift(bias, Number.NaN), bias);
});

const baseRow = {
  n: 1, source: "Trend Pullback", name: "Dup Ltd", close: 100, changePercent: 1, status: "buy", statusLabel: "Buy ready", note: "Pharma",
  entry: 101, buyZoneHigh: 103, stop: 97, riskPercent: 3.96, target1: 111, target2: 117, rs: 90, pa: { score: 94, grade: "A+" }, score: 11,
};
const baseTable = { brand: "Traders Adda", day: "20 Oct 2026", scanned: 2300, breadth: 55, healthy: true, summary: "", rows: [], watch: [], empty: [], footer: ["Not advice."] };
const pick = (symbol, tag = "broke") => ({ symbol, name: `${symbol} Ltd`, sector: null, tag, rs: 95, price: 100, ext: 1.5, analysis: { verdict: "paper", status: "Paper trade", headline: "x", why: [], watchOut: [], plan: { buy: 100, stop: 92, stopPercent: 8, exit: "e", targets: null, steadier: { stop: 88, percent: 12, note: "n" }, example: null }, checklist: [], chips: ["Uptrend"], flags: [] } });
const setup = { breadth50: 30, size: { key: "paper", label: "Paper trade only", detail: "Breadth is low." }, nifty: { above: false, percent: -4.9 }, picks: [pick("DUP"), pick("WAITING", "extended")] };
const at = Date.parse("2026-10-20T11:00:00+05:30");

test("hourly: a stock in Top picks gets no second buy/stop in Buy ready or Watch; other stocks keep theirs", () => {
  const table = {
    ...baseTable,
    rows: [{ ...baseRow, symbol: "DUP" }, { ...baseRow, n: 2, symbol: "ONLYOLD", stop: 95, entry: 205 }],
    watch: [{ ...baseRow, status: "watch", symbol: "DUP", entry: 333, stop: 321 }],
  };
  const mail = buildHourlyEmail(table, at, null, undefined, setup);
  assert.match(mail.text, /1\. \[[^\]]+\] DUP[^\n]*\n   Trade plan: see Top picks above · RS 90/);
  assert.match(mail.text, /2\. \[[^\]]+\] ONLYOLD[^\n]*\n   Buy > ₹205/);
  assert.doesNotMatch(mail.text, /trigger ₹333/);
  assert.match(mail.text, /DUP[^\n]*· Trade plan: see Top picks above · RS 90/);
  assert.match(mail.html, /Trade plan: see Top picks above/);
  assert.doesNotMatch(mail.html, /₹333/);
  // Without a Top picks section nothing is hidden.
  const plain = buildHourlyEmail(table, at, null);
  assert.match(plain.text, /Buy > ₹101/);
  assert.doesNotMatch(plain.text, /see Top picks above/);
});

test("hourly: only buyable Top picks (ready or just broke) claim the plan", () => {
  const table = { ...baseTable, rows: [{ ...baseRow, symbol: "WAITING" }] };
  const mail = buildHourlyEmail(table, at, null, undefined, setup);
  assert.match(mail.text, /Buy > ₹101/);
  assert.doesNotMatch(mail.text, /WAITING[^\n]*\n   Trade plan: see Top picks above/);
});

const brief = () => ({
  generatedAt: 0, sessionLabel: "Tue, 20 Oct",
  bias: { key: "mild-up", label: "Mildly positive start", score: 0.31, summary: "s", components: [] },
  cues: [], levels: [], ideas: [], unavailable: [],
});

test("pre-open: the older Buy ready and watch lists point to Top picks for a stock that is in it", () => {
  const table = { ...baseTable, rows: [{ ...baseRow, symbol: "DUP" }, { ...baseRow, n: 2, symbol: "ONLYOLD", entry: 205 }], watch: [{ ...baseRow, status: "watch", symbol: "DUP", entry: 333, stop: 321, rs: 77 }] };
  const mail = buildPreOpenEmail(brief(), table, "", at, null, null, null, setup);
  assert.match(mail.text, /1\. DUP[^\n]*\n   Trade plan: see Top picks above · RS 90/);
  assert.match(mail.text, /2\. ONLYOLD[^\n]*\n   Buy > ₹205/);
  assert.match(mail.text, /DUP[^\n]*· RS 77 · Trade plan: see Top picks above/);
  assert.doesNotMatch(mail.text, /trigger ₹333/);
  assert.match(mail.html, /See Top picks/);
  assert.doesNotMatch(mail.html, /₹333/);
  const plain = buildPreOpenEmail(brief(), table, "", at);
  assert.doesNotMatch(plain.text, /see Top picks above/);
});

const analysis = (over = {}) => ({ asOf: Date.parse("2026-10-29T12:00:00+05:30"), dailyTrend: "Mixed", weeklyTrend: "Mixed", summary: "Mixed daily trend.", scenarios: { bullish: "Reclaim and hold 22961.95 (last completed day high).", bearish: "Lose 22776.10 (swing high).", range: "Between 22776.10 and 22961.95, wait." }, rankedLevels: [], ...over });
const completed = (over = {}) => ({
  mode: "completed", source: "yahoo", generatedAt: Date.parse("2026-10-31T00:35:00+05:30"), breadthAsOf: null, leadership: "Leadership comparison unavailable.", volatility: "VIX ok.",
  analysis: { NIFTY50: analysis() }, historyCoverage: { NIFTY50: { stale: true, reason: "Latest candle is 2026-10-29; expected 2026-10-30." } }, breadthByIndex: {}, unavailable: [], ...over,
});

test("completed-session text: levels are whole numbers, and a stale index gets one plain warning", () => {
  const text = buildIndexEmailSection({ context: completed() }, at).text.join("\n");
  assert.match(text, /Reclaim and hold 22,962 \(last completed day high\)/);
  assert.match(text, /Between 22,776 and 22,962, wait\./);
  assert.doesNotMatch(text, /22961\.95/);
  assert.match(text, /⚠ Verify before use\. Latest candle is 2026-10-29; expected 2026-10-30\./);
  assert.doesNotMatch(text, /STALE HISTORY/);
  assert.doesNotMatch(text, /Completed candle session/);
});

test("per-index data gaps are not repeated as a list of codes; other gaps are named in words", () => {
  const gaps = ["NIFTY50 current-session history", "NIFTYMIDCAP analysis", "Overnight global cues"];
  const note = buildIndexEmailSection({ context: completed({ unavailable: gaps }) }, at).text.join("\n");
  assert.match(note, /Not available: Overnight global cues\./);
  assert.doesNotMatch(note, /NIFTY50 current-session|NIFTYMIDCAP|Unavailable:/);
  const quiet = buildIndexEmailSection({ context: completed({ unavailable: gaps.slice(0, 2) }) }, at).text.join("\n");
  assert.doesNotMatch(quiet, /Not available:/);
  const vix = buildIndexEmailSection({ context: completed({ unavailable: ["INDIAVIX quote"] }) }, at).text.join("\n");
  assert.match(vix, /Not available: India VIX quote\./);
});
