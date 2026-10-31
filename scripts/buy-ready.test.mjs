import test from "node:test";
import assert from "node:assert/strict";
import { BUY_READY_RULES, SCORE_CHECKED, assessBuyReady, buyCheckLabels, extraPickFailures, scannerPlan } from "../src/lib/screen/buyReady.ts";
import { alertPicks, backtestSentence, buildAlertTable, buildScannerAlert, shortName, topScannerPick } from "../src/lib/alerts/scannerAlert.ts";
import { splitMessage, escapeHtml } from "../src/lib/alerts/telegram.ts";
import { SCANNER_KEYS } from "../src/lib/screen/chartinkScans.ts";

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 6, 10, 0);
const candles = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + i * 0.2;
  return { t: START + i * DAY, open: close - 0.3, high: close + 1, low: close - 1, close, volume: 1_000_000 };
});
const last = candles.at(-1);
const goodCtx = {
  breadthPercent: 60, passesFloor: true, rs: 85, score: 11, vs50: 4, vs200: 12, aboveEma21: 3, atr: 2, candles,
};
const hit = (values) => ({ symbol: "TEST", candleTimestamp: last.t, close: last.close, changePercent: 0.5, volume: 1e6, values });
const nr7Hit = hit({ nr7High: last.high, nr7Low: last.high - 0.5, brokeHigh: false, brokeLow: false });

test("all checks passing makes a hit Buy-ready", () => {
  const r = assessBuyReady("nr7", nr7Hit, goodCtx);
  assert.equal(r.buyReady, true);
  assert.equal(r.setupReady, true);
  assert.equal(r.passed, r.checks.length);
});

test("weak breadth keeps the setup but pauses the buy", () => {
  const r = assessBuyReady("nr7", nr7Hit, { ...goodCtx, breadthPercent: 41 });
  assert.equal(r.buyReady, false);
  assert.equal(r.setupReady, true);
});

test("each common check can block a buy", () => {
  for (const [patch, key] of [
    [{ rs: 50 }, "rs"], [{ score: 7 }, "score"], [{ vs200: -1 }, "trend"], [{ aboveEma21: 12 }, "notExtended"], [{ passesFloor: false }, "liquid"],
  ]) {
    const r = assessBuyReady("nr7", nr7Hit, { ...goodCtx, ...patch });
    assert.equal(r.setupReady, false, key);
    assert.equal(r.checks.find((c) => c.key === key).pass, false, key);
  }
});

test("oscillator score applies only to breakout-type scanners", () => {
  for (const key of SCANNER_KEYS) {
    assert.equal(buyCheckLabels(key).some((c) => c.key === "score"), SCORE_CHECKED.has(key), key);
  }
  const swing = assessBuyReady("swing", hit({ fromHigh: -5 }), { ...goodCtx, score: 3 });
  assert.equal(swing.buyReady, true);
});

test("pattern plan: NR7 stop below the NR7 low but at least 1 ATR from entry", () => {
  const p = scannerPlan("nr7", nr7Hit, candles, 2);
  assert.equal(p.entry, +last.high.toFixed(2));
  assert.ok(p.entry - p.stop >= 2 - 1e-9);
  assert.ok(Math.abs(p.target1 - (p.entry + 2 * (p.entry - p.stop))) < 0.02);
  assert.ok(p.highWinStop < p.stop && p.highWinTarget > p.entry);
});

test("risk above the cap fails the risk check", () => {
  const r = assessBuyReady("nr7", hit({ nr7High: last.high, nr7Low: last.high * 0.9, brokeLow: false }), { ...goodCtx, atr: 10 });
  assert.ok(r.plan.riskPercent > BUY_READY_RULES.maxRiskPercent);
  assert.equal(r.checks.find((c) => c.key === "risk").pass, false);
});

const row = (symbol, readiness, rs = 80) => ({ ...nr7Hit, symbol, name: `${symbol} <Ltd>`, rs, score: 11, price: 1, livePercent: null, turnoverCr: 10, passesFloor: true, readiness });
const extraPlan = { entry: 100, buyZoneHigh: 102, stop: 95, target1: 110, target2: 115, riskPercent: 5, highWinTarget: 102.5, highWinStop: 90, basis: "" };
const extraPick = (symbol, failed = []) => ({ symbol, name: `${symbol} Ltd`, close: 99, changePercent: 1, rs: 90, score: 12, note: "Testing pivot", plan: extraPlan, failed });
const payloadWith = (breadth, rowsByKey) => ({
  updatedAt: 0, sessionDateKey: "2026-09-25", candleTimestamp: last.t, scanned: 100,
  breadth: { percent: breadth, above: breadth, covered: 100 },
  results: Object.fromEntries(SCANNER_KEYS.map((k) => [k, rowsByKey[k] ?? []])),
});

test("alert uses only curated trading scanners, escapes names, and includes the plan", () => {
  const ready = assessBuyReady("leader", nr7Hit, goodCtx);
  const p = payloadWith(60, { leader: [row("AAA", ready, 70), row("BBB", ready, 90)], fall4: [row("BBB", ready, 90), row("AAA", ready, 70)], inside: [row("HIDDEN", ready, 99)] });
  const picks = alertPicks(p, "buyReady");
  assert.deepEqual(picks.map((x) => x.row.symbol).sort(), ["AAA", "BBB"]);
  assert.equal(topScannerPick(p.results.leader, new Set()).symbol, "BBB");
  assert.equal(topScannerPick(p.results.fall4, new Set(["BBB"])).symbol, "AAA");
  const text = buildScannerAlert(p, { from: "2022-10-14", to: "2026-09-25", trades: 100, winRate: 80, avgR: 0 });
  assert.match(text, /Buy ready: <b>2<\/b>/);
  assert.match(text, /<b>1\. Relative Leader<\/b>/);
  assert.match(text, /<b>2\. 4-Day Fall &amp; Reversal<\/b>/);
  assert.match(text, /Traders Adda · Daily Scanner Picks/);
  assert.match(text, /No pick today: All-Time High/);
  assert.doesNotMatch(text, /Inside Bar|Swing Trading SPECIAL/);
  assert.match(text, /BBB<\/b> · BBB &lt;Ltd&gt;/);
  assert.match(text, /SL <b>₹/);
  assert.match(text, /not investment advice/);
  // The reversal section shows AAA, not BBB again.
  assert.match(text.slice(text.indexOf("4-Day Fall")), /^4-Day Fall &amp; Reversal<\/b>[^\n]*\n<b>AAA/);
  assert.match(text, /No pick today: [^\n]*RPCI \(approx\.\), Oscillator buy-watch/);
});

test("alert sends no buy calls when breadth is weak, only a watch list", () => {
  const setupOnly = assessBuyReady("leader", nr7Hit, { ...goodCtx, breadthPercent: 41 });
  const text = buildScannerAlert(payloadWith(41, { leader: [row("AAA", setupOnly)] }), null);
  assert.match(text, /No new buys/);
  assert.match(text, /Watch<\/b>: waiting for market breadth/);
  assert.doesNotMatch(text, /🟢 <b>Buy ready/);
});

test("alert lists RPCI and Oscillator picks and title-cases upper-case names", () => {
  const extra = (symbol) => ({ ...extraPick(symbol), name: "SKY GOLD AND DIAMONDS LIMITED" });
  const p = { ...payloadWith(60, {}), extras: { rpci: { total: 4, top: [extra("RRR")] }, oscillator: { total: 2, top: [extra("OOO")] } } };
  const text = buildScannerAlert(p, null);
  assert.match(text, /<b>1\. RPCI \(approx\.\)<\/b> · <i>4 set-ups/);
  assert.match(text, /<b>RRR<\/b> · Sky Gold And Diamonds · ₹99/);
  assert.match(text, /<b>2\. Oscillator buy-watch<\/b>/);
  assert.match(text, /<b>OOO<\/b>/);
  assert.equal(shortName("Divi's Laboratories Limited"), "Divi's Laboratories");
  assert.equal(shortName("NTPC LIMITED"), "NTPC");
});

test("alert table has the same numbered picks as the message", () => {
  const ready = assessBuyReady("leader", nr7Hit, goodCtx);
  const p = payloadWith(60, { leader: [row("AAA", ready, 70), row("BBB", ready, 90)], fall4: [row("BBB", ready, 90), row("AAA", ready, 70)] });
  const t = buildAlertTable(p, null);
  assert.deepEqual(t.rows.map((r) => [r.n, r.symbol, r.source, r.status]), [[1, "BBB", "Relative Leader", "buy"], [2, "AAA", "4-Day Fall & Reversal", "buy"]]);
  assert.equal(t.brand, "Traders Adda");
  assert.ok(t.rows[0].stop < t.rows[0].entry && t.rows[0].target2 > t.rows[0].target1);
  assert.ok(t.empty.includes("RPCI (approx.)"));
});

test("recommendation table includes only Buy-ready rows", () => {
  const ready = assessBuyReady("leader", nr7Hit, goodCtx);
  const strongWatch = assessBuyReady("leader", nr7Hit, { ...goodCtx, breadthPercent: 41 });
  const developing = assessBuyReady("leader", nr7Hit, { ...goodCtx, vs200: -1 });
  const p = payloadWith(60, {
    leader: [row("READY", ready, 90)],
    fall4: [row("WATCH", strongWatch, 85)],
    ath: [row("DEVELOPING", developing, 99)],
    inside: [row("HIDDEN", ready, 99)],
  });
  const t = buildAlertTable(p, null, { recommendationsOnly: true });
  assert.deepEqual(t.rows.map((r) => [r.symbol, r.statusLabel]), [["READY", "Buy ready"]]);
  assert.ok(t.rows.every((r) => r.status === "buy"));
});

test("recommendations are ranked by RS and renumbered", () => {
  const ready = assessBuyReady("leader", nr7Hit, goodCtx);
  const p = payloadWith(60, { leader: [row("LOW", ready, 72)], fall4: [row("HIGH", ready, 95)] });
  assert.deepEqual(buildAlertTable(p, null).rows.map((r) => r.symbol), ["LOW", "HIGH"]);
  const recs = buildAlertTable(p, null, { recommendationsOnly: true });
  assert.deepEqual(recs.rows.map((r) => [r.n, r.symbol]), [[1, "HIGH"], [2, "LOW"]]);
  assert.deepEqual(alertPicks(p, "buyReady").map((x) => x.row.symbol), ["HIGH", "LOW"]);
});

test("recommendations are empty on a weak-breadth day, extras included", () => {
  const strongWatch = assessBuyReady("leader", nr7Hit, { ...goodCtx, breadthPercent: 41 });
  const paA = { status: "rated", score: 84, grade: "A", label: "", raw: 80, components: [], deductions: [] };
  const strong = { ...row("WATCH", strongWatch), turnoverCr: 120, sector: "Pharma", paRating: paA };
  const thin = { ...row("THIN", strongWatch), paRating: paA };
  const p = {
    ...payloadWith(41, { leader: [strong, thin], swing: [{ ...strong, symbol: "SWNG" }] }),
    extras: { rpci: { total: 1, top: [extraPick("RRR")] }, oscillator: { total: 0, top: [] } },
  };
  const t = buildAlertTable(p, null, { recommendationsOnly: true });
  assert.deepEqual(t.rows, []);
  // Strong stocks waiting for the market: every scanner, quality-gated, labelled Watch, never RPCI/Oscillator.
  assert.deepEqual(t.watch.map((r) => [r.symbol, r.status, r.statusLabel]).sort(), [["SWNG", "watch", "Watch"], ["WATCH", "watch", "Watch"]]);
  assert.ok(t.watch.every((r) => r.note === "Pharma"));
  assert.equal(buildAlertTable(p, null).watch, undefined);
});

test("RPCI and Oscillator picks must pass the Buy-ready checks", () => {
  const good = { rs: 85, vs50: 3, vs200: 10, aboveEma21: 4, riskPercent: 5 };
  assert.deepEqual(extraPickFailures(good), []);
  assert.deepEqual(extraPickFailures({ ...good, rs: 40 }), ["rs"]);
  assert.deepEqual(extraPickFailures({ ...good, vs200: -2 }), ["trend"]);
  assert.deepEqual(extraPickFailures({ ...good, aboveEma21: 12 }), ["notExtended"]);
  assert.deepEqual(extraPickFailures({ ...good, riskPercent: 10 }), ["risk"]);
  assert.deepEqual(extraPickFailures({ rs: null, vs50: null, vs200: null, aboveEma21: null, riskPercent: 5 }), ["rs", "trend", "notExtended"]);

  const wide = extraPick("WIDE", ["risk"]);
  const ok = extraPick("OKAY");
  const p = { ...payloadWith(60, {}), extras: { rpci: { total: 2, top: [wide, ok] }, oscillator: { total: 1, top: [extraPick("OSC", ["rs"])] } } };

  const recs = buildAlertTable(p, null, { recommendationsOnly: true });
  assert.deepEqual(recs.rows.map((r) => [r.symbol, r.status]), [["OKAY", "buy"]]);
  assert.ok(recs.empty.includes("Oscillator buy-watch"));

  const all = buildAlertTable(p, null);
  const osc = all.rows.find((r) => r.symbol === "OSC");
  assert.equal(osc.status, "weak");
  assert.match(osc.note, /^Fails: RS < 70/);

  const text = buildScannerAlert(p, null);
  assert.match(text, /OKAY<\/b>[^\n]*\n🟢 <b>Buy ready/);
  assert.match(text, /OSC<\/b>[^\n]*\n⚪ <b>Avoid<\/b>: fails RS &lt; 70/);
});

test("the backtest line reports the T1/T2 exit honestly", () => {
  const weak = backtestSentence({ from: "2022-10-14", to: "2026-09-25", trades: 1192, winRate: 37.2, avgR: -0.05, costPercent: 0.25, recent: { from: "2025-10-16", trades: 622, avgR: 0.11 } });
  assert.match(weak, /1,192 trades · 37.2% winners · avg −0\.05R per trade after 0\.25% costs/);
  assert.match(weak, /since 2025-10-16: \+0\.11R over 622 trades/);
  assert.match(weak, /No proven edge yet/);
  const strong = backtestSentence({ from: "a", to: "b", trades: 500, winRate: 45, avgR: 0.3 });
  assert.doesNotMatch(strong, /No proven edge/);
});

test("long messages split under Telegram's limit on block boundaries", () => {
  const blocks = Array.from({ length: 50 }, (_, i) => `block ${i} `.repeat(20));
  const parts = splitMessage(blocks.join("\n\n"), 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join("\n\n"), blocks.join("\n\n"));
  assert.equal(escapeHtml("a<b>&"), "a&lt;b&gt;&amp;");
});
