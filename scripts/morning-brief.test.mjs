import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMorningBrief,
  cueSections,
  formatMorningBriefText,
  indexLevels,
  levelStep,
  openingBias,
  previousSession,
} from "../src/lib/screen/morningBrief.ts";

const cue = (key, label, group, changePercent, extra = {}) => ({
  key,
  label,
  group,
  price: 100,
  previousClose: 100 / (1 + changePercent / 100),
  changePercent,
  asOf: 0,
  ...extra,
});

test("opening bias weights the overnight tape and inverts crude and the rupee", () => {
  const up = openingBias([cue("sp500", "S&P 500", "us", 1), cue("nikkei", "Nikkei 225", "asia", 1)]);
  assert.equal(up.key, "strong-up");
  assert.equal(up.label, "Positive start likely");
  assert.equal(up.score, 1);

  // Crude up 1% is a headwind, so it must drag an otherwise flat tape negative.
  const oil = openingBias([cue("brent", "Brent crude", "commodity", 2)]);
  assert.equal(oil.score, -2);
  assert.equal(oil.key, "strong-down");

  const rupee = openingBias([cue("usdinr", "USD/INR", "currency", 1)]);
  assert.equal(rupee.score, -1);
});

test("weighted score renormalises over the cues that loaded", () => {
  // sp500 weight 3, kospi weight 1 => (2*3 + -2*1) / 4 = 1
  const bias = openingBias([cue("sp500", "S&P 500", "us", 2), cue("kospi", "Kospi", "asia", -2)]);
  assert.equal(bias.score, 1);
  assert.equal(bias.components.length, 2);
});

test("cues outside the bias table are ignored by the bias but still shown", () => {
  const cues = [cue("gold", "Gold", "commodity", 3), cue("indiavix", "India VIX", "india", 5, { inverseTone: true })];
  const bias = openingBias(cues);
  assert.equal(bias.score, null);
  assert.equal(bias.label, "No overnight data");
  assert.match(bias.summary, /No global cues loaded/);
  const sections = cueSections(cues);
  assert.deepEqual(sections.map((section) => section.title), ["Commodities", "India"]);
});

test("cue lines are structured and carry the headwind flag", () => {
  const [commodities, india] = cueSections([
    cue("gold", "Gold", "commodity", 3, { price: 4200, prefix: "$", suffix: "/oz" }),
    cue("indiavix", "India VIX", "india", 5, { price: 13.3, inverseTone: true }),
  ]);
  assert.deepEqual(commodities.lines, [{ label: "Gold", value: "$4,200/oz", changePercent: 3, inverseTone: false }]);
  assert.equal(india.lines[0].inverseTone, true);
});

test("bias bands cover flat and mild moves", () => {
  assert.equal(openingBias([cue("sp500", "S&P 500", "us", 0.05)]).key, "flat");
  assert.equal(openingBias([cue("sp500", "S&P 500", "us", 0.3)]).key, "mild-up");
  assert.equal(openingBias([cue("sp500", "S&P 500", "us", -0.3)]).key, "mild-down");
});

test("bias summary always says the call is derived, never quoted", () => {
  const bias = openingBias([cue("sp500", "S&P 500", "us", 1)]);
  assert.match(bias.summary, /GIFT Nifty is not available/);
  assert.match(bias.summary, /computed, not quoted/);
});

test("index levels are classic floor pivots off the previous range", () => {
  const levels = indexLevels({ key: "nifty", label: "Nifty 50", close: 22800, high: 23000, low: 22600, priorClose: 22500 });
  const pivot = (23000 + 22600 + 22800) / 3;
  assert.equal(levels.pivot, pivot);
  assert.equal(levels.resistance1, 2 * pivot - 22600);
  assert.equal(levels.support1, 2 * pivot - 23000);
  assert.equal(levels.resistance2, pivot + 400);
  assert.equal(levels.support2, pivot - 400);
  assert.ok(Math.abs(levels.changePercent - (300 / 22500) * 100) < 1e-9);
});

test("level rounding step widens with the index", () => {
  assert.equal(levelStep(72000), 100);
  assert.equal(levelStep(22800), 50);
  assert.equal(levelStep(1500), 25);
  assert.equal(levelStep(120), 5);
  const levels = indexLevels({ key: "sensex", label: "Sensex", close: 72500, high: 72800, low: 72100, priorClose: 72000 });
  for (const bound of levels.zone.split(" – ")) {
    assert.equal(Number(bound.replace(/,/g, "")) % 100, 0);
  }
});

test("a zero prior close does not produce a non-finite change", () => {
  const levels = indexLevels({ key: "x", label: "X", close: 100, high: 110, low: 90, priorClose: 0 });
  assert.equal(levels.changePercent, 0);
});

const day = (dateIso, high, low, close) => ({ t: Date.parse(dateIso), high, low, close });

test("previousSession takes the last completed candle and the close before it", () => {
  const candles = [
    day("2026-09-28T10:00:00+05:30", 100, 95, 98),
    day("2026-09-29T10:00:00+05:30", 105, 99, 104),
  ];
  const session = previousSession(candles, { key: "nifty", label: "Nifty 50" });
  assert.deepEqual(session, { key: "nifty", label: "Nifty 50", close: 104, high: 105, low: 99, priorClose: 98 });
});

test("an in-progress session is excluded so levels never use a half-formed bar", () => {
  const candles = [
    day("2026-09-28T10:00:00+05:30", 100, 95, 98),
    day("2026-09-29T10:00:00+05:30", 105, 99, 104),
    day("2026-09-30T10:00:00+05:30", 106, 103, 105),
  ];
  const session = previousSession(candles, { key: "nifty", label: "Nifty 50", excludeDateKey: "2026-09-30" });
  assert.equal(session.close, 104);
  assert.equal(session.priorClose, 98);
});

test("previousSession returns null without usable candles", () => {
  assert.equal(previousSession([], { key: "n", label: "N" }), null);
  assert.equal(previousSession([day("2026-09-29T10:00:00+05:30", 10, 5, 0)], { key: "n", label: "N" }), null);
});

test("the brief carries unavailable feeds instead of hiding them", () => {
  const brief = buildMorningBrief({
    generatedAt: 0,
    sessionLabel: "Tue, 30 Sep",
    cues: [cue("sp500", "S&P 500", "us", 0.8)],
    sessions: [{ key: "nifty", label: "Nifty 50", close: 22800, high: 23000, low: 22600, priorClose: 22500 }],
    ideas: [{ symbol: "TCS", name: "TCS", statusLabel: "Buy-ready", rating: 88, entry: 100, stop: 95, target: 115 }],
    unavailable: ["Hang Seng"],
  });
  assert.deepEqual(brief.unavailable, ["Hang Seng"]);
  assert.equal(brief.levels.length, 1);
  assert.equal(brief.bias.key, "strong-up");

  const text = formatMorningBriefText(brief);
  assert.match(text, /derived, not GIFT Nifty/);
  assert.match(text, /US overnight: S&P 500 100 \(\+0\.80%\)/);
  assert.match(text, /not option OI/);
  assert.match(text, /TCS — Buy-ready 88%/);
  assert.match(text, /Unavailable: Hang Seng/);
  assert.match(text, /not investment advice/);
});
