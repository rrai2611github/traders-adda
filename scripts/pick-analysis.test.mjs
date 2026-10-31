import test from "node:test";
import assert from "node:assert/strict";
import { analysePick } from "../src/lib/screen/pickAnalysis.ts";
import { buildTopPicks } from "../src/lib/screen/topPicks.ts";
import { topPicksBlock } from "../src/lib/alerts/topPicksEmail.ts";

const row = (symbol, over = {}) => ({
  symbol, stage: "forming", liquid: true, series: "EQ", rs: 92, ext: -3, vs50: 12, vs200: 40, fromHigh: 4, dry: 0.7, turnoverCr: 20,
  price: 100, pivotPrice: 103, aboveLow: 80, coil: 0.5, baseWk: 10, baseDepth: 20, listedWk: 300, level: 1, mcap: 5000, ...over,
});
const pickOf = (r, top5 = []) => buildTopPicks([r], top5)[0];

test("a ready stock in a healthy market gets a buy plan with levels and an example size", () => {
  const a = analysePick(pickOf(row("AAA")), { breadth50: 62, resultsInDays: null });
  assert.equal(a.verdict, "buy");
  assert.match(a.headline, /Buy plan ready: buy on a close above ₹103/);
  assert.equal(a.plan.buy, 103);
  assert.equal(a.plan.stop, 90.64);
  assert.equal(a.plan.stopPercent, 12);
  assert.equal(a.plan.tighter.stop, 94.76);
  assert.equal(a.plan.tighter.percent, 8);
  assert.equal(a.plan.example.riskPercent, 1);
  assert.ok(a.plan.example.quantity > 0);
  assert.ok(a.why.some((l) => /under its breakout level/.test(l)));
  assert.ok(a.why.some((l) => /Volume has dried up/.test(l)));
});

test("a weak market turns a good setup into paper trading with a quarter-percent example", () => {
  const a = analysePick(pickOf(row("AAA")), { breadth50: 30, resultsInDays: null });
  assert.equal(a.verdict, "paper");
  assert.equal(a.plan.example.riskPercent, 0.25);
  assert.ok(a.watchOut.some((l) => /only 30%/.test(l)));
});

test("results within five days mean wait; within two weeks is a warning", () => {
  assert.equal(analysePick(pickOf(row("AAA")), { breadth50: 62, resultsInDays: 4 }).verdict, "wait");
  const soon = analysePick(pickOf(row("AAA")), { breadth50: 62, resultsInDays: 10 });
  assert.equal(soon.verdict, "buy");
  assert.ok(soon.watchOut.some((l) => /Results in 10 days/.test(l)));
});

test("an extended stock is never a buy and shows no plan", () => {
  const p = pickOf(row("RAN", { stage: "climbing", ext: 25 }), [{ symbol: "RAN", rs: 99, close: 100, name: "Ran Ltd", sector: null, spark: [] }]);
  const a = analysePick(p, { breadth50: 62, resultsInDays: null });
  assert.equal(a.verdict, "skip");
  assert.equal(a.plan, null);
  assert.ok(a.watchOut.some((l) => /late entry/.test(l)));
});

test("the email block has an analysed card per buyable stock and a line per stock to wait on", () => {
  const rows = [row("AAA"), row("RAN", { stage: "climbing", ext: 25 })];
  const picks = buildTopPicks(rows, [{ symbol: "RAN", rs: 99, close: 100, name: "Ran Ltd", sector: "Tech", spark: [] }])
    .map((p) => ({ ...p, analysis: analysePick(p, { breadth50: 62, resultsInDays: null }) }));
  const { html, text } = topPicksBlock({ breadth50: 62, size: { key: "full", label: "Normal size", detail: "Risk about 1%." }, picks });
  assert.match(html, /Buy on breakout/);
  assert.doesNotMatch(html, />Ready</);
  assert.doesNotMatch(html, /Why it is on the list/);
  assert.match(html, /Strong, but wait/);
  assert.ok(text.some((l) => /1\. AAA · BUY ON BREAKOUT · RS 92 · buy ₹103/.test(l)));
  assert.ok(text.some((l) => /Strong, but wait: RAN \(RS 99\): 25% past its level/.test(l)));
  assert.ok(text[0].startsWith("Market check passed"));
});

test("with nothing buyable the email says so instead of listing cards", () => {
  const { html } = topPicksBlock({ breadth50: 30, size: { key: "paper", label: "Paper trade only", detail: "Breadth is low." }, picks: [] });
  assert.match(html, /Not picking is a valid answer/);
});

test("the plan carries the targets with an honest note, and the email shows them", () => {
  const p = pickOf(row("AAA"));
  const a = analysePick(p, { breadth50: 62, resultsInDays: null });
  assert.equal(a.plan.targets.t1, 119.48);
  assert.equal(a.plan.targets.t1Percent, 16);
  assert.equal(a.plan.targets.t2Percent, 24);
  assert.match(a.plan.targets.note, /1 trade in 6/);
  const { html, text } = topPicksBlock({ breadth50: 62, size: { key: "full", label: "Normal size", detail: "Risk about 1%." }, picks: [{ ...p, analysis: a }] });
  assert.match(html, /Target/);
  assert.ok(text.some((l) => /target ₹119\.5 \(\+16%\) \/ ₹127\.7 \(\+24%\)/.test(l)));
});

test("a Nifty under its 200-day average is a note, not a block, and the plan carries the tighter-stop option (and no add-on: it added nothing in the corrected test)", () => {
  const p = pickOf(row("AAA"));
  const below = analysePick(p, { breadth50: 62, resultsInDays: null, niftyAbove200: false, niftyPercent: -3.1 });
  assert.equal(below.verdict, "buy");
  assert.ok(below.watchOut.some((l) => /Nifty 50 is 3\.1% under its 200-day average\. That is not part of the rule/.test(l)));
  // The Nifty note is not a reason to wait: it never appears among the pick's flags.
  assert.ok(!below.flags.some((flag) => /Nifty/.test(flag)));
  // Weak breadth still turns the same pick into paper trading, whatever the Nifty does.
  assert.equal(analysePick(p, { breadth50: 30, resultsInDays: null, niftyAbove200: true, niftyPercent: 4 }).verdict, "paper");
  const above = analysePick(p, { breadth50: 62, resultsInDays: null, niftyAbove200: true, niftyPercent: 4 });
  assert.equal(above.verdict, "buy");
  assert.equal(above.plan.addOn, undefined);
  assert.equal(above.plan.tighter.stop, 94.76);
  assert.match(above.plan.exit, /50-day average/);
  assert.doesNotMatch(above.plan.exit, /100/);
});

test("the email's one-line summary is about breadth only: the Nifty under its 200-day average no longer stops real buys", () => {
  const p = pickOf(row("AAA"));
  const picks = [{ ...p, analysis: analysePick(p, { breadth50: 62, resultsInDays: null, niftyAbove200: false, niftyPercent: -3.1 }) }];
  const { html, text } = topPicksBlock({ breadth50: 62, size: { key: "full", label: "Normal size", detail: "Risk about 1%." }, nifty: { above: false, percent: -3.1 }, picks });
  assert.doesNotMatch(text[0], /200-day average/);
  assert.doesNotMatch(text[0], /Paper trade only/);
  const weak = topPicksBlock({ breadth50: 20, size: { key: "paper", label: "Paper trade only", detail: "Breadth is low." }, nifty: { above: true, percent: 4 }, picks: [{ ...p, analysis: analysePick(p, { breadth50: 20, resultsInDays: null, niftyAbove200: true, niftyPercent: 4 }) }] });
  assert.match(weak.text[0], /20% of stocks are above their 50-day average/);
  assert.match(weak.text[0], /Paper trade only/);
  assert.match(html, /Blue sky or Multi-year breakout/);
});

test("the setup needs 35% breadth, not 50%: at 40% a good setup is a buy, at 30% it is paper trading", () => {
  const p = pickOf(row("AAA"));
  assert.equal(analysePick(p, { breadth50: 40, resultsInDays: null }).verdict, "buy");
  const low = analysePick(p, { breadth50: 30, resultsInDays: null });
  assert.equal(low.verdict, "paper");
  assert.ok(low.watchOut.some((l) => /needs 35%/.test(l)));
});

test("the email's summary line follows the same market check", () => {
  const p = pickOf(row("AAA"));
  const make = (breadth50) => topPicksBlock({ breadth50, size: { key: "paper", label: "x", detail: "y" }, nifty: { above: true, percent: 2 }, picks: [{ ...p, analysis: analysePick(p, { breadth50, resultsInDays: null, niftyAbove200: true, niftyPercent: 2 }) }] });
  assert.match(make(40).text[0], /^Market check passed/);
  assert.match(make(30).text[0], /^Market check not passed: .*Paper trade only/);
});

test("the email's caveat tells readers the backtest only covers stocks listed today", () => {
  const p = pickOf(row("AAA"));
  const picks = [{ ...p, analysis: analysePick(p, { breadth50: 62, resultsInDays: null }) }];
  const { text, html } = topPicksBlock({ breadth50: 62, size: { key: "full", label: "Normal size", detail: "Risk about 1%." }, nifty: null, picks });
  assert.match(text.join("\n"), /The history only includes stocks listed today, so real results are likely lower\./);
  assert.match(html, /stocks listed today/);
});
