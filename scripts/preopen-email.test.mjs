import test from "node:test";
import assert from "node:assert/strict";
import { buildPreOpenEmail, preOpenSlotKey } from "../src/lib/alerts/preOpenEmailFormat.ts";
import { buildIndexAnalysis } from "../src/lib/market/indexAnalysis.ts";

/** Epoch ms for an IST wall-clock time. */
const ist = (iso) => Date.parse(`${iso}+05:30`);

test("pre-open includes completed index scenarios in HTML and text without changing picks", () => {
  const candles = Array.from({ length: 240 }, (_, i) => ({
    t: Date.UTC(2025, 0, i + 1), open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i, volume: 0,
  }));
  const analysis = buildIndexAnalysis(candles, "NIFTY50");
  const input = brief({ indexContext: {
    mode: "completed", source: "yahoo", analysis: { NIFTY50: analysis },
    niftyBreadth: null, leadership: "BANKNIFTY <check>", volatility: "VIX unavailable.",
    unavailable: ["Bank history"],
  } });
  const { html, text } = buildPreOpenEmail(input, table([]), "", Date.now());
  assert.match(html, /Index outlook/);
  assert.match(html, /BANKNIFTY &lt;check&gt;/);
  assert.match(html, /Index outlook/);
  assert.match(text, /Nifty constituent breadth unavailable/);
  assert.match(text, /Bullish: Reclaim and hold/);
  assert.match(text, /Bearish: Lose/);
  assert.match(text, /Bank history/);
  assert.match(text, /No stock is Buy ready/);
});

test("verified Bank breadth and direction replace the old unavailable-membership message", () => {
  const participation = {
    current: { above50: 50, coverage50: 14, total: 14 },
    direction: "Improving", change50pp: 7.14, comparisonCoverage: 14, asOf: "2026-10-01",
  };
  const { html, text } = buildPreOpenEmail(brief({ indexContext: {
    mode: "completed", source: "yahoo", analysis: {}, breadthByIndex: { BANKNIFTY: participation },
    leadership: "Leadership unavailable.", volatility: "VIX unavailable.", unavailable: [],
  } }), table([]), "", Date.now());
  // The detailed completed-session breadth lines stay in the text body; the HTML shows the outlook cards.
  assert.match(text, /Bank Nifty above 50 DMA: 50% \(14\/14/);
  assert.match(text, /improving, \+7\.1pp over 5 sessions \(same 14 members\)/);
  assert.doesNotMatch(text, /Bank Nifty constituent breadth unavailable/);
  assert.match(html, /Index outlook/);
});

const brief = (overrides = {}) => ({
  generatedAt: 0,
  sessionLabel: "Tue, 29 Sep",
  bias: {
    key: "mild-up",
    label: "Mildly positive start",
    score: 0.31,
    summary: "Derived opening bias of +0.31% from the overnight tape. GIFT Nifty is not available from our data sources, so this is computed, not quoted.",
    components: [],
  },
  cues: [
    {
      title: "US overnight",
      source: "Last completed US session.",
      lines: [{ label: "S&P 500", value: "7,670.84", changePercent: -0.17, inverseTone: false }],
    },
    {
      title: "Commodities",
      source: "Front-month futures.",
      lines: [{ label: "Brent crude", value: "$96.29/bbl", changePercent: -6.14, inverseTone: true }],
    },
  ],
  levels: [
    {
      key: "nifty",
      label: "Nifty 50",
      close: 22716,
      changePercent: -0.28,
      pivot: 22680,
      support1: 22606,
      support2: 22496,
      resistance1: 22790,
      resistance2: 22863,
      zone: "22,600 – 22,800",
    },
  ],
  ideas: [],
  unavailable: [],
  ...overrides,
});

const table = (rows = []) => ({
  brand: "Traders Adda",
  day: "Tue, 29 Sep 2026",
  scanned: 2327,
  breadth: 52,
  healthy: true,
  summary: "2 Buy-ready ideas.",
  rows,
  empty: [],
  footer: ["Scanned on the completed session."],
});

const row = (n, symbol) => ({
  n,
  source: "Range breakout",
  symbol,
  name: `${symbol} Limited`,
  close: 100,
  changePercent: 1.2,
  status: "buy",
  statusLabel: "Buy ready",
  note: "All checks passed",
  entry: 101,
  buyZoneHigh: 104,
  stop: 96,
  riskPercent: 4.9,
  target1: 111,
  target2: 121,
  rs: 88,
  score: 14,
});

test("the slot opens at 09:00 IST and closes at the 09:15 open", () => {
  assert.equal(preOpenSlotKey(ist("2026-09-30T08:59:00")), null);
  assert.equal(preOpenSlotKey(ist("2026-09-30T09:00:00")), "2026-09-30:preopen");
  assert.equal(preOpenSlotKey(ist("2026-09-30T09:14:59")), "2026-09-30:preopen");
  assert.equal(preOpenSlotKey(ist("2026-09-30T09:15:00")), null);
  assert.equal(preOpenSlotKey(ist("2026-09-30T14:00:00")), null);
});

test("the slot never opens on a weekend or a fixed holiday", () => {
  // 3 October 2026 is a Saturday; 2 October is Gandhi Jayanti.
  assert.equal(preOpenSlotKey(ist("2026-10-03T09:05:00")), null);
  assert.equal(preOpenSlotKey(ist("2026-10-04T09:05:00")), null);
  assert.equal(preOpenSlotKey(ist("2026-10-02T09:05:00")), null);
});

test("the slot key changes each trading day so one send happens per day", () => {
  assert.equal(preOpenSlotKey(ist("2026-09-30T09:01:00")), "2026-09-30:preopen");
  assert.equal(preOpenSlotKey(ist("2026-10-01T09:01:00")), "2026-10-01:preopen");
});

test("the simulated-session dev flag cannot silence the 09:00 send", () => {
  const prior = process.env.MARKET_FORCE_LIVE;
  process.env.MARKET_FORCE_LIVE = "1";
  try {
    assert.equal(preOpenSlotKey(ist("2026-09-30T09:05:00")), "2026-09-30:preopen");
    // It must still refuse to send on a non-trading day.
    assert.equal(preOpenSlotKey(ist("2026-10-03T09:05:00")), null);
  } finally {
    if (prior === undefined) delete process.env.MARKET_FORCE_LIVE;
    else process.env.MARKET_FORCE_LIVE = prior;
  }
});

test("the subject carries the bias, the idea count and the session", () => {
  const { subject } = buildPreOpenEmail(brief(), table([row(1, "TCS"), row(2, "INFY")]), "Selective", ist("2026-09-30T09:00:00"));
  assert.match(subject, /pre-open/);
  assert.match(subject, /Mildly positive start \(\+0\.31%\)/);
  assert.match(subject, /2 swing Buy ready/);
  assert.match(subject, /Tue, 29 Sep/);
});

test("the email states the numbers are final, not a live-candle preview", () => {
  const { html, text } = buildPreOpenEmail(brief(), table([row(1, "TCS")]), "Selective", 0);
  assert.match(html, /Levels and ideas are final/);
  assert.match(text, /Levels and ideas are final/);
  // The hourly email's intraday caveat must not leak into the pre-open one.
  assert.doesNotMatch(html, /candle is incomplete/);
});

test("both bodies carry the derived-bias and not-option-OI disclaimers", () => {
  const { html, text } = buildPreOpenEmail(brief(), table([row(1, "TCS")]), "Selective", 0);
  for (const body of [html, text]) {
    assert.match(body, /GIFT Nifty/);
    assert.match(body, /not investment advice/);
  }
  assert.match(html, /not OI walls/);
  assert.match(text, /not option OI/);
});

test("an empty idea list says watchlist day instead of showing a table", () => {
  const { html, text, subject } = buildPreOpenEmail(brief(), table([]), "Risk-off", 0);
  assert.match(subject, /no Buy ready stocks/);
  assert.match(html, /No stock is Buy ready on yesterday/);
  assert.doesNotMatch(html + text, /Strong-watch/);
  assert.match(html, /watchlist day, not an entry day/);
  assert.match(text, /Watchlist day, not an entry day/);
  assert.doesNotMatch(html, /<thead>/);
});

test("idea rows render the full plan", () => {
  const { html, text } = buildPreOpenEmail(brief(), table([row(1, "TCS")]), "Selective", 0);
  assert.match(html, /TCS/);
  assert.match(html, /₹101/);
  assert.match(html, /₹96/);
  assert.match(text, /Buy > ₹101 \(skip > ₹104\) · SL ₹96 \(−4\.9%\) · T1 ₹111 · T2 ₹121 · RS 88/);
});

test("a stop wider than 6% is flagged, a normal stop is not", () => {
  const wide = { ...row(1, "TFCILTD"), riskPercent: 10 };
  const wideMail = buildPreOpenEmail(brief(), table([wide]), "", 0);
  assert.match(wideMail.html, /−10\.0% ⚠/);
  assert.match(wideMail.text, /−10\.0%\) ⚠ wide/);

  const normal = buildPreOpenEmail(brief(), table([row(1, "TCS")]), "", 0);
  assert.doesNotMatch(normal.html, /⚠/);
  assert.doesNotMatch(normal.text, /⚠/);
});

test("the status pill separates Buy ready from Watch", () => {
  const ready = buildPreOpenEmail(brief(), table([row(1, "TCS")]), "", 0).html;
  assert.match(ready, /#15803d">Buy ready/);

  const watching = { ...row(1, "TCS"), status: "watch", statusLabel: "Watch" };
  const watchHtml = buildPreOpenEmail(brief(), table([watching]), "", 0).html;
  assert.match(watchHtml, /#0369a1">Watch/);
});

test("watch stocks get their own do-not-buy section, never counted as buys", () => {
  const watching = { ...row(1, "PAYTM"), status: "watch", statusLabel: "Watch", entry: 1220, stop: 1160, target1: 1300, target2: 1380, note: "Financial Services" };
  const weak = { ...table([]), breadth: 36, healthy: false, watch: [watching] };
  const { html, text, subject } = buildPreOpenEmail(brief(), weak, "Risk-off", 0);
  assert.match(subject, /no Buy ready stocks · 1 on watch/);
  assert.match(html, /No stock is Buy ready on yesterday/);
  assert.match(html, /Strong stocks on watch[\s\S]*DO NOT BUY YET/);
  assert.match(html, /Weak market \(breadth 36%, needs 50%\+\): wait\./);
  assert.match(html, /Trigger/);
  assert.match(text, /STRONG STOCKS WAITING FOR THE MARKET — DO NOT BUY/);
  assert.match(text, /PAYTM · Financial Services · Range breakout · trigger ₹1,220 · SL ₹1,160 \(−4\.9%\) · T1 ₹1,300 \(\+6\.6%\) · T2 ₹1,380 \(\+13\.1%\)/);
  assert.match(html, /PAYTM[\s\S]*Range breakout/);
  assert.match(html, /Stop loss[\s\S]*>₹1,160<\/div>\s*<div[^>]*>−4\.9%</);
  assert.match(html, /src="cid:traders-adda-logo"/);
  assert.doesNotMatch(text, /Buy > ₹1,220/);
  // Full levels, but no trading-rules box for watch stocks.
  assert.doesNotMatch(html + text, /How to trade these swing setups|HOW TO TRADE/);

  const none = buildPreOpenEmail(brief(), table([row(1, "TCS")]), "", 0);
  assert.doesNotMatch(none.html + none.text, /do not buy/i);
});

test("stocks are labelled as swing trades with the trading rules, never intraday", () => {
  const withPlan = { ...table([row(1, "TCS")]), footer: ["Buy only above the trigger; skip if it opens above the limit.", "Scanned."] };
  const { html, text } = buildPreOpenEmail(brief(), withPlan, "", 0);
  for (const body of [html, text]) {
    assert.match(body, /Swing trade/);
    assert.match(body, /Not intraday, not long-term/);
    assert.match(body, /within 3 trading days/);
    assert.match(body, /after 30 trading days/);
    assert.doesNotMatch(body, /Buy only above the trigger/);
  }
  assert.match(text, /1\. TCS · CMP ₹100 · Swing trade · Range breakout/);
  assert.match(html, /How to trade these swing setups/);

  const empty = buildPreOpenEmail(brief(), table([]), "", 0);
  assert.doesNotMatch(empty.html, /How to trade these swing setups/);
});

test("headwind cues are coloured red when they rise and green when they fall", () => {
  const rising = brief({
    cues: [{ title: "Commodities", source: "", lines: [{ label: "Brent crude", value: "$104", changePercent: 3, inverseTone: true }] }],
  });
  assert.match(buildPreOpenEmail(rising, table([]), "", 0).html, /<b style="color:#b91c1c">\+3\.00%/);
  // The default brief has crude falling 6.14%, which is a tailwind.
  assert.match(buildPreOpenEmail(brief(), table([]), "", 0).html, /<b style="color:#15803d">−6\.14%/);
});

test("unavailable feeds are named in both bodies", () => {
  const partial = brief({ unavailable: ["Hang Seng", "Sensex levels"] });
  const { html, text } = buildPreOpenEmail(partial, table([]), "", 0);
  assert.match(html, /Unavailable this morning: Hang Seng, Sensex levels/);
  assert.match(text, /Unavailable this morning: Hang Seng, Sensex levels/);
});

test("stock names and cue labels are HTML-escaped", () => {
  const evil = brief({
    cues: [{ title: "US <script>", source: "", lines: [{ label: "S&P 500", value: "1", changePercent: 1, inverseTone: false }] }],
  });
  const { html } = buildPreOpenEmail(evil, table([]), "", 0);
  assert.match(html, /S&amp;P 500/);
  assert.doesNotMatch(html, /<script>/);
});

test("52-week-high breakouts show only when breadth is healthy", () => {
  const hb = {
    screened: 82,
    niftyReturn65Percent: 2.4,
    breakouts: [{
      symbol: "WELSPUNLIV", name: "Welspun Living", close: 239.2, baseHigh: 236.5, baseRangePercent: 12.1, tightBase: true,
      fromHighPercent: -2.3, return65Percent: 44.7, volumeRatio: 3.56, ema21: 224.8, rs: 91,
    }],
  };
  const now = ist("2026-10-05T09:00:00");
  const shown = buildPreOpenEmail(brief(), table(), "Selective", now, hb);
  assert.match(shown.html, /52-week-high breakouts/);
  assert.match(shown.html, /experimental/);
  assert.match(shown.html, /WELSPUNLIV/);
  assert.match(shown.html, /Tight base/);
  assert.match(shown.html, /Exit below[\s\S]*21 EMA close/);
  assert.match(shown.text, /1\. WELSPUNLIV · Swing trade/);
  assert.match(shown.subject, /1 52W breakout ·/);

  const weak = buildPreOpenEmail(brief(), { ...table(), breadth: 30, healthy: false }, "Risk-off", now, hb);
  assert.doesNotMatch(weak.html, /WELSPUNLIV/);
  assert.doesNotMatch(weak.text, /WELSPUNLIV/);
  // A section that only says "hidden today" is noise, so the experimental list is simply left out.
  assert.doesNotMatch(weak.html, /Hidden today|52-week-high breakouts/);
  assert.doesNotMatch(weak.text, /Hidden today|52-WEEK-HIGH/);
  assert.doesNotMatch(weak.subject, /52W/);

  const none = buildPreOpenEmail(brief(), table(), "Selective", now, null);
  assert.doesNotMatch(none.html, /52-week-high/);
});

import { buildMarketOutlook } from "../src/lib/screen/marketOutlook.ts";

test("pre-open shows the market outlook, the GIFT Nifty comparison and per-index outlook cards", () => {
  const b = brief({ bias: { key: "mild-down", label: "Mildly negative start", score: -0.9, summary: "x", components: [] } });
  const outlook = buildMarketOutlook({
    gift: { price: 22730, changePercent: 1.2, changePoints: 270, asOf: ist("2026-10-05T08:55:00"), source: "TradingView <test>" },
    bias: b.bias, cues: [{ key: "nasdaq", label: "Nasdaq", group: "us", price: 1, previousClose: 1, changePercent: -1, asOf: 0 }],
    levels: b.levels, indexes: { NIFTY50: { dailyTrend: "Weak", weeklyTrend: "Weak", breadth50: 20 } },
  });
  const { html, text, subject } = buildPreOpenEmail(b, table([]), "", ist("2026-10-05T09:00:00"), null, outlook);
  assert.match(subject, /pre-open · Bearish outlook · GIFT \+0.06% ·/);
  assert.match(html, /Bearish outlook for today/);
  assert.match(html, /Market outlook[\s\S]*Bearish[\s\S]*Score −/);
  assert.match(html, /GIFT NIFTY VS GLOBAL CUES[\s\S]*22,730/);
  assert.match(html, /flat \(\+0.06%\) while the global tone is negative/);
  assert.match(html, /GIFT-implied open ≈ 22,730/);
  assert.match(html, /TradingView &lt;test&gt;/);
  for (const name of ["Nifty", "Bank Nifty", "Nifty IT", "Midcap 100"]) assert.match(html, new RegExp(`>${name}<`));
  assert.match(text, /MARKET OUTLOOK: BEARISH/);
  assert.match(text, /GIFT NIFTY VS GLOBAL CUES/);
  assert.match(text, /^Bank Nifty: /m);

  const noGift = buildPreOpenEmail(b, table([]), "", 0, null, buildMarketOutlook({ gift: null, bias: b.bias, cues: [], levels: b.levels, indexes: {} }));
  assert.match(noGift.html, /GIFT Nifty is unavailable this morning/);
  assert.doesNotMatch(noGift.subject, /GIFT/);
});

test("with Top picks, the pre-open email leads with today's action and labels the older scanner sections as a separate rule set", async () => {
  const { buildPreOpenEmail } = await import("../src/lib/alerts/preOpenEmailFormat.ts");
  const topPicks = {
    breadth50: 30, size: { key: "paper", label: "Paper trade only", detail: "Breadth is low." }, nifty: { above: false, percent: -4.9 },
    picks: [{ symbol: "AAA", name: "AAA Ltd", sector: null, tag: "broke", rs: 95, price: 100, ext: 1.2, analysis: { verdict: "paper", status: "Paper trade", headline: "x", why: [], watchOut: [], plan: { buy: 100, stop: 92, stopPercent: 8, exit: "e", targets: null, steadier: { stop: 88, percent: 12, note: "n" }, example: null }, checklist: [], chips: ["Uptrend"], flags: [] } }],
  };
  const early = buildPreOpenEmail(brief(), table([]), "", Date.parse("2026-10-20T09:00:00+05:30"), null, null, null, topPicks);
  assert.doesNotMatch(early.html, /New in this email/);
  assert.match(early.html, /Today(&#39;|')s action/);
  assert.match(early.text, /^TODAY'S ACTION: Do not buy today/m);
  assert.match(early.subject, /^Traders Adda · No new buys \(market weak\) · pre-open /);
  assert.match(early.html, /The older scanner ideas below use a separate, stricter rule set\./);
  assert.match(early.text, /The older scanner ideas below use a separate, stricter rule set\./);
  assert.ok(early.html.indexOf("action") < early.html.indexOf("The older scanner ideas below"));
  const later = buildPreOpenEmail(brief(), table([]), "", Date.parse("2026-11-05T09:00:00+05:30"), null, null, null, topPicks);
  assert.doesNotMatch(later.html, /New in this email/);
  assert.match(later.html, /The older scanner ideas below/);
  const without = buildPreOpenEmail(brief(), table([]), "", Date.parse("2026-10-20T09:00:00+05:30"));
  assert.doesNotMatch(without.html, /older scanner ideas below/);
});
