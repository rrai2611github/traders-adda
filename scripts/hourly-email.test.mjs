import test from "node:test";
import assert from "node:assert/strict";
import { buildHourlyEmail, emailSlotKey } from "../src/lib/alerts/hourlyEmailFormat.ts";
import { buildEmailTableSvg, renderEmailTablePng } from "../src/lib/alerts/emailImage.ts";
import { topConfluence, withConfluence } from "../src/lib/alerts/hourlyConfluence.ts";

const atIst = (value) => Date.parse(`${value}+05:30`);

test("hourly email slots start at 09:15 and stop when NSE closes", () => {
  assert.equal(emailSlotKey(atIst("2026-09-28T09:14:00")), null);
  assert.equal(emailSlotKey(atIst("2026-09-28T09:15:00")), "2026-09-28:0");
  assert.equal(emailSlotKey(atIst("2026-09-28T10:14:59")), "2026-09-28:0");
  assert.equal(emailSlotKey(atIst("2026-09-28T10:15:00")), "2026-09-28:1");
  assert.equal(emailSlotKey(atIst("2026-09-28T15:29:59")), "2026-09-28:6");
  assert.equal(emailSlotKey(atIst("2026-09-28T15:30:00")), null);
});

const baseRow = {
  n: 1, source: "Trend Pullback + Relative Leader", name: "A & B", close: 100, changePercent: 1, status: "buy",
  statusLabel: "Buy ready", note: "Pharma", entry: 101, buyZoneHigh: 103, stop: 95, riskPercent: 5.94,
  target1: 113, target2: 119, rs: 90, pa: { score: 94, grade: "A+" }, score: 11,
};
const baseTable = {
  brand: "Traders Adda", day: "28 Sept 2026", scanned: 2300, breadth: 55, healthy: true, summary: "",
  rows: [], watch: [], empty: [], footer: ["Not advice."],
};
const listed = (symbol, source = "Trend Pullback") => ({ symbol, name: symbol, source });

test("hourly email repeats the full Buy ready list with a status for every row", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...baseRow, n: i + 1, symbol: `S${i + 1}`, source: "NR7 <Live>" }));
  const table = { ...baseTable, rows };
  const previous = { buy: [listed("S1"), listed("OLD")], watch: [] };
  const email = buildHourlyEmail(table, atIst("2026-09-28T10:15:00"), previous);
  assert.equal(email.hasChanges, true);
  assert.match(email.subject, /9 new swing Buy ready/);
  assert.match(email.text, /RS 90 · PA 94 A\+ · Osc 11\.0/);
  assert.match(email.text, /BUY READY NOW \(10 · 9 new\)/);
  assert.match(email.text, /^1\. \[Unchanged\] S1 /m);
  assert.match(email.text, /^10\. \[New\] S10 /m);
  assert.doesNotMatch(email.text, /S11/);
  assert.match(email.text, /- \[Removed\] OLD · no longer Buy ready, do not enter/);
  assert.match(email.html, /Buy above/);
  assert.match(email.html, />S1<?[\s\S]*?>Unchanged<[\s\S]*S2[\s\S]*?>New</);
  assert.match(email.html, /<s>OLD<\/s>[\s\S]*?>Removed<[\s\S]*no longer Buy ready/);
  assert.match(email.html, /NR7 &lt;Live&gt;/);
  assert.match(email.html, /src="cid:traders-adda-logo"/);
  assert.match(email.html, /TRADE[\s\S]*LEARN[\s\S]*ANALYSE[\s\S]*GROW TOGETHER/);
  assert.match(email.html, /Stop loss[\s\S]*>₹95<\/div>\s*<div[^>]*>−5\.9%</);
  assert.doesNotMatch(email.html, /cid:traders-adda-top10/);
  assert.match(email.text, /incomplete/);
  for (const body of [email.html, email.text]) {
    assert.match(body, /How to trade these swing setups|HOW TO TRADE THESE SWING SETUPS/);
    assert.match(body, /Swing trade/);
    assert.match(body, /not intraday/i);
  }
});

test("hourly watch table lists every stock with Added, Unchanged and Removed status", () => {
  const table = {
    ...baseTable,
    breadth: 30,
    healthy: false,
    watch: [
      { ...baseRow, status: "watch", symbol: "KEEP" },
      { ...baseRow, status: "watch", n: 2, symbol: "NEWONE<", source: "Swing Trading SPECIAL" },
    ],
  };
  const previous = { buy: [], watch: [listed("KEEP"), listed("GONE")] };
  const { html, text, subject, hasChanges } = buildHourlyEmail(table, atIst("2026-09-28T11:15:00"), previous);
  assert.equal(hasChanges, true);
  assert.match(subject, /watch list changed/);
  assert.match(html, /Strong stocks on watch — do not buy yet[\s\S]*KEEP[\s\S]*?>Unchanged<[\s\S]*NEWONE&lt;[\s\S]*?>Added<[\s\S]*<s>GONE<\/s>[\s\S]*?>Removed</);
  assert.match(html, /Weak market \(breadth 30%, needs 50%\+\): wait\./);
  assert.doesNotMatch(html, /<s>KEEP/);
  assert.match(text, /^2\. \[Added\] NEWONE< · CMP ₹100 \(\+1\.00%\) · Swing Trading SPECIAL · trigger ₹101 · SL ₹95 \(−5\.9%\) · T1 ₹113 · T2 ₹119 · RS 90$/m);
  assert.match(text, /^1\. \[Unchanged\] KEEP /m);
  assert.match(text, /- \[Removed\] GONE · dropped off the watch list/);
  assert.doesNotMatch(html + text, /How to trade these swing setups|HOW TO TRADE/);
});

test("a stock moving from watch to Buy ready is a new buy, not a watch drop", () => {
  const table = { ...baseTable, rows: [{ ...baseRow, symbol: "UP" }] };
  const { html, text } = buildHourlyEmail(table, atIst("2026-09-28T11:15:00"), { buy: [], watch: [listed("UP")] });
  assert.match(html, /Buy ready now[\s\S]*UP[\s\S]*?>New</);
  assert.match(text, /\[New\] UP /);
  assert.doesNotMatch(text, /\[Removed\] UP/);
});

test("hourly email reports no change when the lists match the last email", () => {
  const table = { ...baseTable, rows: [{ ...baseRow, symbol: "A" }], watch: [{ ...baseRow, status: "watch", symbol: "W" }] };
  const email = buildHourlyEmail(table, atIst("2026-09-28T12:15:00"), { buy: [listed("A")], watch: [listed("W")] });
  assert.equal(email.hasChanges, false);
  assert.match(email.subject, /no change/);
  assert.match(email.html, /No change this hour/);
  assert.match(email.text, /^1\. \[Unchanged\] A /m);
  assert.match(email.text, /^1\. \[Unchanged\] W /m);
  assert.doesNotMatch(email.text, /\[(New|Added|Removed)\]/);
});
test("email image SVG escapes content and renders to a PNG", async () => {
  const table = {
    brand: "Traders & Adda",
    day: "28 Sept 2026",
    scanned: 2300,
    breadth: 40,
    healthy: false,
    summary: "Watch <only>",
    rows: [{
      n: 1, source: "NR7 <Live>", symbol: "AAA", name: "A & B", close: 100, changePercent: 1,
      status: "watch", statusLabel: "Wait: breadth", note: "Passes all but breadth", entry: 101,
      buyZoneHigh: 103, stop: 95, riskPercent: 5.94, target1: 113, target2: 119, rs: 90, score: 11,
    }],
    empty: [],
    footer: [],
  };
  const svg = buildEmailTableSvg(table, atIst("2026-09-28T10:15:00"));
  assert.match(svg, /Traders &amp; Adda/);
  assert.match(svg, /NR7 &lt;Live&gt;/);
  assert.match(svg, /A &amp; B/);
  const png = await renderEmailTablePng(table, atIst("2026-09-28T10:15:00"));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.length > 10_000);
});

test("hourly email shows each stock's scanner confluence without changing the lists", () => {
  const table = {
    ...baseTable,
    rows: [{ ...baseRow, symbol: "NEWB" }, { ...baseRow, n: 2, symbol: "OLDB" }],
    watch: [{ ...baseRow, status: "watch", symbol: "WADD" }, { ...baseRow, status: "watch", n: 2, symbol: "WSAME" }, { ...baseRow, status: "watch", n: 3, symbol: "WMIX" }],
  };
  const confluence = new Map([
    ["NEWB", { symbol: "NEWB", signals: [], bull: ["Core Setups", "Oscillators", "Trade Triggers"], bear: [], conflict: false }],
    ["WSAME", { symbol: "WSAME", signals: [], bull: ["Trade Triggers"], bear: [], conflict: false }],
    ["WMIX", { symbol: "WMIX", signals: [], bull: ["Core Setups"], bear: ["RSI Edge"], conflict: true }],
  ]);
  const tagged = withConfluence(table, confluence, 5);
  assert.deepEqual(tagged.rows.map((r) => r.symbol), ["NEWB", "OLDB"]);
  assert.deepEqual(tagged.watch.map((r) => r.symbol), ["WADD", "WSAME", "WMIX"]);
  assert.equal(table.rows[0].confluence, undefined);
  const { html, text } = buildHourlyEmail(tagged, atIst("2026-09-28T11:15:00"), { buy: [listed("OLDB")], watch: [listed("WSAME"), listed("WMIX")] });
  assert.match(html, /NEWB[\s\S]*RS 90 · 3\/5 scanners/);
  assert.match(html, /WADD[\s\S]*RS 90 · 0\/5 scanners/);
  assert.match(text, /Osc 11\.0 · 3\/5 scanners/);
  assert.match(text, /\[Unchanged\] OLDB .*\n.*· 0\/5 scanners$/m);
  assert.match(text, /\[Unchanged\] WSAME .*· 1\/5 scanners$/m);
  assert.match(text, /\[Unchanged\] WMIX .*· scanners disagree$/m);
  for (const body of [html, text]) assert.match(body, /never changes the list/);
});

test("hourly email adds a top-10 bullish confluence research list with status", () => {
  const bull = (symbol, bull, extra = {}) => [symbol, {
    symbol, bull, bear: [], conflict: false,
    signals: bull.map((family) => ({ family, label: `${family} hit`, tone: "bull" })), ...extra,
  }];
  const confluence = new Map([
    bull("TWO", ["Core Setups", "Oscillators"]),
    bull("THREE", ["Core Setups", "Oscillators", "Trade Triggers"]),
    bull("ILLIQ", ["Core Setups", "Oscillators", "Trade Triggers"]),
    bull("ONE", ["Core Setups"]),
    bull("MIXED", ["Core Setups", "Oscillators"], { bear: ["RSI Edge"], conflict: true }),
    ...Array.from({ length: 12 }, (_, i) => bull(`F${String(i).padStart(2, "0")}`, ["RPCI", "Trade Triggers"])),
  ]);
  const scan = (symbol, turnoverCr = 50) => ({
    symbol, name: `${symbol} Ltd`, price: 250, changePercent: 1.25, rs: 88, turnoverCr,
    paRating: { status: "rated", score: 81 },
  });
  const scanRows = [...confluence.keys()].map((s) => scan(s, s === "ILLIQ" ? 2 : 50));
  const tagged = withConfluence({ ...baseTable, rows: [{ ...baseRow, symbol: "A" }] }, confluence, 5, scanRows);
  const symbols = tagged.bullConfluence.map((idea) => idea.symbol);
  assert.equal(symbols.length, 10, "only the 10 strongest are listed");
  assert.equal(symbols[0], "THREE");
  assert.ok(!symbols.includes("ILLIQ") && !symbols.includes("ONE") && !symbols.includes("MIXED"));
  assert.deepEqual(topConfluence(confluence, 5, scanRows, 3).map((i) => i.symbol), ["THREE", "F00", "F01"]);

  const previous = { buy: [listed("A")], watch: [], confluence: ["THREE", "GONEIDEA"] };
  const { html, text, hasChanges } = buildHourlyEmail(tagged, atIst("2026-09-28T11:15:00"), previous);
  assert.equal(hasChanges, false, "confluence changes alone do not count as a stock-list change");
  assert.match(html, /Bullish confluence — where the scanners agree[\s\S]*not a buy/i);
  assert.match(html, /THREE[\s\S]*?>Unchanged<[\s\S]*3\/5[\s\S]*F00[\s\S]*?>New</);
  assert.match(html, /Dropped out of the list:[\s\S]*GONEIDEA/);
  assert.match(text, /BULLISH CONFLUENCE — WHERE THE SCANNERS AGREE \(10, NOT A BUY\)/);
  assert.match(text, /^1\. \[Unchanged\] THREE · 3\/5 families \(Core Setups, Oscillators, Trade Triggers\) .*₹250 \(\+1\.25%\) · RS 88 · PA 81$/m);
  assert.match(text, /^2\. \[New\] TWO|^2\. \[New\] F00/m);
  assert.match(text, /NOT A BUY/);
});

test("pre-open style tables are untouched: no confluence section without confluence data", () => {
  const { html, text } = buildHourlyEmail({ ...baseTable, rows: [{ ...baseRow, symbol: "A" }] }, atIst("2026-09-28T11:15:00"), null);
  assert.doesNotMatch(html + text, /Bullish confluence|BULLISH CONFLUENCE/);
  assert.match(text, /\[New\] A /);
});

test("hourly email without confluence data has no scanner tags or footnote", () => {
  const table = { ...baseTable, rows: [{ ...baseRow, symbol: "A" }] };
  const { html, text } = buildHourlyEmail(table, atIst("2026-09-28T11:15:00"), { buy: [], watch: [] });
  assert.doesNotMatch(html + text, /\/5 scanners|n\/5 scanners/);
});
const bottomedPick = (symbol) => ({
  symbol, name: `${symbol} Ltd <x>`, tier: "deep", close: 80, fromHighPercent: 58.2, lowPrice: 55, lowAgeSessions: 44, offLowPercent: 45.5,
  higherLow: 75, ema20: 78, ema50: 85, aboveEma50: false, volumeRatio: 1.2, rsi14: 55, rsiDivergence: true, stop: 73.6, target: 92.8, rs: 40, turnoverCr: 12,
});

test("hourly email lists deep-base bottomed-out stocks as an experimental, non-buy section", () => {
  const table = { ...baseTable, bottomedOut: [bottomedPick("AAA"), bottomedPick("BBB")] };
  const previous = { buy: [], watch: [], bottomed: ["AAA", "OLD"] };
  const email = buildHourlyEmail(table, atIst("2026-09-28T10:15:00"), previous);
  assert.match(email.text, /BOTTOMED OUT — DEEP BASE \(2 · EXPERIMENTAL, NOT A BUY\)/);
  assert.match(email.text, /^1\. \[Unchanged\] AAA · CMP ₹80 · −58% from high/m);
  assert.match(email.text, /^2\. \[New\] BBB /m);
  assert.match(email.text, /No longer on the list: OLD/);
  assert.match(email.html, /Bottomed out — deep base/);
  assert.match(email.html, /AAA Ltd &lt;x&gt;/);
  assert.doesNotMatch(email.subject, /bottom/i);
  // Loaded but empty: the section still appears so the reader knows it was checked.
  const quiet = buildHourlyEmail({ ...baseTable, bottomedOut: [] }, atIst("2026-09-28T10:15:00"), { buy: [], watch: [] });
  assert.match(quiet.text, /BOTTOMED OUT — DEEP BASE \(0 /);
  assert.match(quiet.text, /No bottomed-out stock right now\./);
  // Scan unavailable: no section.
  assert.doesNotMatch(buildHourlyEmail(baseTable, atIst("2026-09-28T10:15:00"), null).text, /BOTTOMED OUT/);
});

test("hourly email shows sector heat, hottest first, and leaves it out without data", () => {
  const sectorHeat = [
    { sector: "Banks", changePercent: 1.4, above50Percent: 72.4, advancing: 18, total: 22 },
    { sector: "IT <Tech>", changePercent: -1.2, above50Percent: null, advancing: 3, total: 20 },
  ];
  const email = buildHourlyEmail({ ...baseTable, sectorHeat }, atIst("2026-09-28T10:15:00"), null);
  assert.match(email.text, /SECTOR HEAT — TOP 2, HOTTEST FIRST\nBanks: \+1\.40% avg move · 72% above 50D · 18\/22 advancing\nIT <Tech>: −1\.20% avg move · — above 50D · 3\/20 advancing/);
  assert.match(email.html, /Sector heat/);
  assert.match(email.html, /IT &lt;Tech&gt;/);
  assert.doesNotMatch(buildHourlyEmail(baseTable, atIst("2026-09-28T10:15:00"), null).text, /SECTOR HEAT/);
});

test("confluence list keeps the 10 strongest (families, then RS + price action) and shows buy-above, SL and targets", () => {
  const bull = (symbol, families) => [symbol, { symbol, bull: families, bear: [], conflict: false, signals: families.map((family) => ({ family, label: `${family} hit`, tone: "bull" })) }];
  const confluence = new Map([
    bull("WEAK2", ["Core Setups", "Oscillators"]),
    bull("STRONG2", ["Core Setups", "Oscillators"]),
    bull("TOP3", ["Core Setups", "Oscillators", "Trade Triggers"]),
    ...Array.from({ length: 10 }, (_, i) => bull(`M${i}`, ["RPCI", "Trade Triggers"])),
  ]);
  const row = (symbol, rs, pa) => ({ symbol, name: symbol, price: 100, changePercent: 1, rs, turnoverCr: 50, paRating: { status: "rated", score: pa } });
  const rows = [...confluence.keys()].map((s) => (s === "WEAK2" ? row(s, 60, 40) : s === "STRONG2" ? row(s, 95, 95) : row(s, 80, 80)));
  const ideas = topConfluence(confluence, 5, rows, 10);
  assert.equal(ideas.length, 10);
  assert.deepEqual(ideas.slice(0, 2).map((i) => i.symbol), ["TOP3", "STRONG2"]);
  assert.ok(!ideas.some((i) => i.symbol === "WEAK2"), "the weakest 2-family stock is cut");

  const plan = { entry: 101, stop: 95, riskPercent: 5.94, target1: 113, target2: 119 };
  const withPlan = ideas.map((i, n) => (n === 0 ? { ...i, plan } : i));
  const email = buildHourlyEmail({ ...baseTable, bullConfluence: withPlan }, atIst("2026-09-28T10:15:00"), null);
  assert.match(email.text, /TOP3 .*Buy > ₹101 · SL ₹95 \(−5\.9%\) · T1 ₹113 · T2 ₹119/);
  assert.match(email.html, /Buy above[\s\S]*Stop loss[\s\S]*Target/);
  assert.match(email.html, />₹101<[\s\S]*>₹95<[\s\S]*>₹113</);
  assert.doesNotMatch(email.text, /STRONG2 .*Buy >/);
});

test("with no deep base the bottomed-out section lists early-base stocks, labelled watch only", () => {
  const early = { ...bottomedPick("EARLY1"), tier: "early", fromHighPercent: 41.2 };
  const email = buildHourlyEmail({ ...baseTable, bottomedOut: [early] }, atIst("2026-09-28T10:15:00"), null);
  assert.match(email.text, /BOTTOMED OUT — EARLY BASE \(1 · NO DEEP BASE TODAY, WATCH ONLY, NOT A BUY\)/);
  assert.match(email.text, /^1\. \[New\] EARLY1 · CMP ₹80 · −41% from high/m);
  assert.match(email.html, /Bottomed out — early base/);
  assert.match(email.html, /no deep base today · watch only/);
  // A deep stock keeps the deep wording.
  const deep = buildHourlyEmail({ ...baseTable, bottomedOut: [bottomedPick("DEEP1")] }, atIst("2026-09-28T10:15:00"), null);
  assert.match(deep.text, /BOTTOMED OUT — DEEP BASE \(1 · EXPERIMENTAL, NOT A BUY\)/);
});

test("the hourly email carries the tested-setup section, what is new since the last update, and labels the older scanner lists", () => {
  const pick = (symbol, tag = "broke") => ({ symbol, name: `${symbol} Ltd`, sector: null, tag, rs: 95, price: 100, ext: 1.5, analysis: { verdict: "paper", status: "Paper trade", headline: "x", why: [], watchOut: [], plan: { buy: 100, stop: 92, stopPercent: 8, exit: "e", targets: null, steadier: { stop: 88, percent: 12, note: "n" }, example: null }, checklist: [], chips: ["Uptrend"], flags: [] } });
  const setup = { breadth50: 30, size: { key: "paper", label: "Paper trade only", detail: "Breadth is low." }, nifty: { above: false, percent: -4.9 }, picks: [pick("AAA"), pick("BBB"), pick("CCC", "extended")] };
  const table = { ...baseTable, rows: [{ ...baseRow, symbol: "UP" }] };
  const previous = { buy: [], watch: [], setup: ["AAA", "OLD"] };
  const mail = buildHourlyEmail(table, Date.parse("2026-10-20T11:00:00+05:30"), previous, undefined, setup);
  assert.match(mail.subject, /2 on the tested setup \(1 new\)/);
  assert.match(mail.html, /Tested setup — Top picks now/);
  assert.match(mail.html, /Since the last update: new BBB; no longer listed OLD\./);
  assert.match(mail.text, /TESTED SETUP — TOP PICKS NOW/);
  assert.match(mail.text, /The older scanner ideas below use a separate, stricter rule set./);
  assert.ok(mail.html.indexOf("Tested setup — Top picks now") < mail.html.indexOf("Buy ready now"));
  const first = buildHourlyEmail(table, Date.parse("2026-10-20T11:00:00+05:30"), null, undefined, setup);
  assert.doesNotMatch(first.html, /Since the last update/);
  const without = buildHourlyEmail(table, Date.parse("2026-10-20T11:00:00+05:30"), previous);
  assert.doesNotMatch(without.html, /Tested setup/);
  assert.doesNotMatch(without.text, /older, separate rule set/);
});
