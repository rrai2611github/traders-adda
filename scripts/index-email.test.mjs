import test from "node:test";
import assert from "node:assert/strict";
import { buildIndexEmailSection, buildIndexEmailSnapshot } from "../src/lib/alerts/indexEmailFormat.ts";
import { buildHourlyEmail, emailSlotKey } from "../src/lib/alerts/hourlyEmailFormat.ts";

const now = Date.parse("2026-10-05T11:15:00+05:30");
const analysis = {
  asOf: Date.parse("2026-10-01T09:15:00+05:30"), close: 100,
  summary: "Mixed <daily> trend.", dailyTrend: "Mixed", weeklyTrend: "Weak", provisional: false,
  nearbySupport: { price: 90, label: "day low" }, nearbyResistance: { price: 110, label: "day high" },
  scenarios: { bullish: "Reclaim 110.", bearish: "Lose 90.", range: "Wait between 90 and 110." },
  rankedLevels: [{ price: 110, strength: "Major", side: "Resistance" }],
};
const context = (overrides = {}) => ({
  mode: "live", source: "yahoo", generatedAt: now, membershipAsOf: "2026-10-03",
  analysis: { NIFTY50: { ...analysis, provisional: true } },
  quotes: { NIFTY50: { ltp: 112, timestamp: now - 10_000 } },
  historyCoverage: { NIFTY50: { stale: false, session: "2026-10-05" } },
  breadthAsOf: now - 20_000,
  breadthByIndex: { NIFTY50: {
    asOf: "2026-10-05", direction: "Improving", change50pp: 10, comparisonCoverage: 50,
    current: { total: 50, coverage50: 50, above50: 40 },
  } },
  leadership: "BANKNIFTY <check>", volatility: "India VIX risk context.", unavailable: [],
  ...overrides,
});
const completed = context({ mode: "completed", analysis: { NIFTY50: analysis } });
const previous = {
  source: "yahoo", day: "2026-10-05", membershipAsOf: "2026-10-03", sentAt: now - 3_600_000,
  indices: { NIFTY50: { price: 100, quoteAt: now - 3_610_000, breadth50: 30, coverage50: 50, total: 50, breadthSession: "2026-10-05" } },
};

test("hourly compares fresh emailed snapshots with frozen morning levels, not moving live levels", () => {
  const live = context({ analysis: { NIFTY50: { ...analysis, nearbyResistance: { price: 120, label: "changed" } } } });
  const section = buildIndexEmailSection({
    context: live, completed, previous,
    savedPlans: [{ symbol: "NIFTY50", tradingDate: "2026-10-05", source: "yahoo", createdAt: now - 8_100_000, analysis }],
  }, now);
  for (const body of [section.html, section.text.join("\n")]) {
    assert.match(body, /frozen pre-open plan/);
    assert.match(body, /\+12\.0% since last/);
    assert.match(body, /S 90|Support<\/div><div[^>]*>90</);
    assert.match(body, /R 110|Resistance<\/div><div[^>]*>110</);
    assert.match(body, /Above R · weak breadth/);
    assert.match(body, /Caution: Nifty above resistance on weak breadth/);
    assert.match(body, /\+10pp since last/);
    assert.match(body, /not exchange-verified real time/);
    assert.match(body, /not hourly candles/);
  }
  assert.match(section.html, /BANKNIFTY &lt;check&gt;/);
});

test("missing saved morning outlook uses labelled previous-close references, never a fake morning plan", () => {
  const text = buildIndexEmailSection({ context: context(), completed }, now).text.join("\n");
  assert.match(text, /no saved pre-open plan; levels from previous close/);
  assert.doesNotMatch(text, /since last/);
  assert.doesNotMatch(text, /frozen pre-open plan/);
});

test("fresh session quotes show actual day change and daily range without inventing hourly bars", () => {
  const live = context({ quotes: { NIFTY50: {
    ltp: 112, previousClose: 100, open: 102, low: 101, high: 115, timestamp: now - 10_000,
  } } });
  const section = buildIndexEmailSection({ context: live, completed }, now);
  const text = section.text.join("\n");
  assert.match(text, /^Nifty 112 · \+12\.0% today/m);
  assert.match(text, /^Nifty \+12\.0% today, above morning resistance\./m);
  assert.match(section.html, /Day 101–115/);
  assert.match(text, /not hourly candles/);
});

test("stale, future, wrong-day or unchanged quote times cannot generate price comparison", () => {
  for (const timestamp of [now - 600_000, now + 1, now - 86_400_000, previous.indices.NIFTY50.quoteAt]) {
    const live = context({ quotes: { NIFTY50: { ltp: 112, timestamp } } });
    const text = buildIndexEmailSection({ context: live, completed, previous }, now).text.join("\n");
    assert.doesNotMatch(text, /\+12\.0% since last/);
    assert.doesNotMatch(text, /Above resistance|Above R/);
    assert.equal(buildIndexEmailSnapshot(live, now).indices.NIFTY50.price, null);
  }
});

test("price comparisons reject a different provider or previous trading day", () => {
  for (const baseline of [{ ...previous, source: "kite" }, { ...previous, day: "2026-10-01" }]) {
    assert.doesNotMatch(buildIndexEmailSection({ context: context(), completed, previous: baseline }, now).text.join("\n"), /\+12\.0% since last/);
  }
});

test("delayed or incomplete breadth and changed membership never imply hourly improvement", () => {
  const current = context();
  const partial = context({ breadthByIndex: { NIFTY50: { ...current.breadthByIndex.NIFTY50, current: { total: 50, coverage50: 49, above50: 40 } } } });
  for (const live of [partial, context({ breadthAsOf: now - 120_000 }), context({ membershipAsOf: "new-membership" })]) {
    assert.doesNotMatch(buildIndexEmailSection({ context: live, previous }, now).text.join("\n"), /\+10pp since last/);
  }
  assert.equal(buildIndexEmailSnapshot(context({ breadthAsOf: now - 120_000 }), now).indices.NIFTY50.breadth50, null);
});

test("pre-open covers all four indexes with completed scenarios and explicit missing history", () => {
  const section = buildIndexEmailSection({ context: completed }, now);
  for (const name of ["Nifty", "Bank Nifty", "Nifty IT", "Midcap 100"]) assert.ok(section.text.includes(name));
  assert.match(section.text.join("\n"), /Bullish: Reclaim 110/);
  assert.match(section.text.join("\n"), /Trend history unavailable today/);
  assert.match(section.html, /Mixed &lt;daily&gt; trend/);
});

test("unchanged stock lists still render an hourly index email, including feed outages", () => {
  const table = { brand: "Traders Adda", rows: [], watch: [], footer: [], breadth: 30 };
  for (const indexes of [{ context: context(), completed }, { context: null, error: "Index feed <failed>" }]) {
    const email = buildHourlyEmail(table, now, { buy: [], watch: [] }, indexes);
    assert.equal(email.hasChanges, false);
    assert.match(email.subject, /index update · stock lists unchanged/);
    assert.match(email.html, /Hourly index analysis/);
    assert.match(email.text, /HOURLY INDEX ANALYSIS/);
  }
  const unavailable = buildIndexEmailSection({ context: null, error: "Index feed <failed>" }, now);
  assert.match(unavailable.html, /Index feed &lt;failed&gt;/);
});

test("hourly schedule excludes actual holidays, weekends and simulated sessions", () => {
  assert.equal(emailSlotKey(Date.parse("2026-10-03T11:15:00+05:30")), null);
  assert.equal(emailSlotKey(Date.parse("2026-10-02T11:15:00+05:30")), null);
  const prior = process.env.MARKET_FORCE_LIVE;
  process.env.MARKET_FORCE_LIVE = "1";
  try { assert.equal(emailSlotKey(now), null); }
  finally {
    if (prior === undefined) delete process.env.MARKET_FORCE_LIVE;
    else process.env.MARKET_FORCE_LIVE = prior;
  }
});

test("mock index sources never produce customer analysis or persisted price baselines", () => {
  const mock = context({ source: "mock" });
  assert.equal(buildIndexEmailSnapshot(mock, now), null);
  const output = buildIndexEmailSection({ context: mock, completed, previous }, now);
  assert.match(output.text.join("\n"), /Simulated index data is not included/);
  assert.doesNotMatch(output.html, /112|Above resistance/);
});

import { hourlyIndexRead, completedHourlyBars } from "../src/lib/market/indexHourly.ts";

const HR = 3_600_000;
/** 40 sessions of 09:15..15:15 bars ending the day before `now`'s session, drifting by `step` per bar. */
function hourlyBars(step, end = Date.parse("2026-10-05T15:15:00+05:30")) {
  const bars = [];
  for (let day = 0; bars.length < 140; day++) {
    const d = new Date(end - day * 24 * HR);
    if ([0, 6].includes(new Date(d.getTime() + 19_800_000).getUTCDay())) continue;
    for (let h = 0; h <= 6; h++) bars.unshift({ t: end - day * 24 * HR - h * HR, open: 0, high: 0, low: 0, close: 0, volume: 0 });
  }
  return bars.slice(-140).map((b, i) => {
    const close = 20000 + i * step;
    return { ...b, open: close - step / 2, high: close + 20, low: close - 20, close };
  });
}

test("hourly index read: trend, 20-hour EMA, RSI and the two-session hourly range", () => {
  const closed = Date.parse("2026-10-05T16:00:00+05:30");
  const up = hourlyIndexRead(hourlyBars(50), closed, false);
  assert.equal(up.trend, "Constructive");
  assert.equal(up.aboveEma20, true);
  assert.ok(up.rsi14 > 70);
  assert.equal(up.position, "above");
  assert.deepEqual(up.lastThree, ["up", "up", "up"]);
  const down = hourlyIndexRead(hourlyBars(-50), closed, false);
  assert.equal(down.trend, "Weak");
  assert.equal(down.position, "below");
  assert.equal(hourlyIndexRead(hourlyBars(50).slice(-20), closed, false), null);
});

test("hourly bars: the forming hour and Yahoo's off-grid quote bar are never used", () => {
  const bars = hourlyBars(10);
  const lastStart = bars.at(-1).t; // 15:15 bar
  const live = Date.parse("2026-10-05T14:30:00+05:30");
  const midday = completedHourlyBars(bars.filter((b) => b.t <= live), live, true);
  assert.equal(midday.at(-1).t, Date.parse("2026-10-05T13:15:00+05:30"), "the 14:15 bar is still forming at 14:30");
  const quoteBar = { t: lastStart + 14 * 60_000, open: 1, high: 1, low: 1, close: 1, volume: 0 };
  const after = completedHourlyBars([...bars, quoteBar], lastStart + 2 * HR, false);
  assert.equal(after.at(-1).t, lastStart);
});

test("hourly index analysis shows in the hourly email, per index and in the takeaway", () => {
  const closed = Date.parse("2026-10-05T16:00:00+05:30");
  const hourly = { NIFTY50: hourlyIndexRead(hourlyBars(-50), closed, false), BANKNIFTY: null };
  const { html, text } = buildIndexEmailSection({ context: context(), completed, previous, hourly }, now);
  const joined = text.join("\n");
  assert.match(joined, /On the hourly chart Nifty is weak \(below its 20-hour EMA, RSI \d+/);
  assert.match(joined, /Hourly Weak · RSI [\d.]+ · below 20 EMA · ↑↑↑|Hourly Weak · RSI [\d.]+ · below 20 EMA · [↑↓]{3}/);
  assert.match(html, /Hourly Weak/);
  const without = buildIndexEmailSection({ context: context(), completed, previous }, now).text.join("\n");
  assert.doesNotMatch(without, /On the hourly chart|Hourly Weak/);
  assert.match(without, /hourly candles unavailable/);
});

test("each index is a card: bias badge, price, support/resistance/20 DMA/50 DMA boxes and a plan for today", () => {
  const closed = Date.parse("2026-10-05T16:00:00+05:30");
  const weak = hourlyIndexRead(hourlyBars(-50), closed, false);
  const live = context({
    analysis: { NIFTY50: { ...analysis, dailyTrend: "Weak", weeklyTrend: "Weak", sma20: 130, sma50: 140, provisional: true } },
    quotes: { NIFTY50: { ltp: 95, previousClose: 100, high: 101, low: 94, timestamp: now - 10_000 } },
  });
  const section = buildIndexEmailSection({ context: live, completed, hourly: { NIFTY50: weak } }, now);
  assert.match(section.html, />Bearish</);
  for (const label of ["Support", "Resistance", "20 DMA", "50 DMA", "Plan for today"]) assert.match(section.html, new RegExp(label));
  assert.match(section.html, />130</);
  const text = section.text.join("\n");
  assert.match(text, /Bias Bearish/);
  assert.match(text, /Plan for today: Bias stays bearish while Nifty trades below its 20-day average \(130\)\. A close above 110 on improving breadth would shift it to neutral/);
  assert.match(text, /A break below 90 opens the way to a lower range\./);
  // No saved levels at all: no invented plan.
  const bare = buildIndexEmailSection({ context: context({ analysis: {} }) }, now).text.join("\n");
  assert.match(bare, /No morning support\/resistance levels are available today, so no plan levels are shown\./);
  assert.doesNotMatch(bare, /Plan for today/);
  // It must not claim no index broke its morning levels when there are none to break.
  assert.doesNotMatch(bare, /No index has broken its morning levels/);
  assert.doesNotMatch(buildIndexEmailSection({ context: context({ analysis: {} }) }, now).html, /Levels n\/a/);
});

test("bias is neutral between the levels and when strength is contradicted by weak breadth", () => {
  const section = buildIndexEmailSection({ context: context({ quotes: { NIFTY50: { ltp: 100, previousClose: 99, timestamp: now - 10_000 } } }), completed }, now);
  assert.match(section.html, />Neutral</);
  assert.match(section.text.join("\n"), /Nifty is between 90 and 110\. Above 110 turns the bias constructive; below 90 turns it weak\./);
  // Above resistance but only 40% of members above their 50 DMA: capped at Neutral.
  const above = buildIndexEmailSection({ context: context({ analysis: { NIFTY50: { ...analysis, dailyTrend: "Constructive", weeklyTrend: "Constructive" } } }), completed }, now);
  assert.match(above.text.join("\n"), /Bias Neutral/);
});

test("neutral plan matches where price actually is against its levels", () => {
  const below = context({ analysis: { NIFTY50: { ...analysis, weeklyTrend: "Mixed", provisional: true } }, quotes: { NIFTY50: { ltp: 80, previousClose: 82, timestamp: now - 10_000 } } });
  const text = buildIndexEmailSection({ context: below, completed }, now).text.join("\n");
  assert.match(text, /Plan for today: .*Nifty has slipped below its support at 90\./);
  assert.doesNotMatch(text, /Nifty is between 90 and 110/);
});
