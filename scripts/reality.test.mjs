import test from "node:test";
import assert from "node:assert/strict";
import { REALITY_SCENARIOS, realityVerdict, scenarioSettings } from "../src/lib/backtest/reality.ts";

const fig = (totalProfit, cagrPercent, maxDrawdownPercent = -20, avgR = 0.7) => ({ totalProfit, cagrPercent, maxDrawdownPercent, avgR });
const rows = (vals) => REALITY_SCENARIOS.map((scenario) => ({ scenario, stats: vals[scenario.key] }));

test("the four scenarios add worse fills, gapping stops, both, and a harsh case", () => {
  assert.deepEqual(REALITY_SCENARIOS.map((s) => s.key), ["fills", "gaps", "both", "harsh"]);
  assert.equal(REALITY_SCENARIOS[0].stress.slippagePercent, 1);
  assert.equal(REALITY_SCENARIOS[0].stress.gapShare, 0);
  assert.equal(REALITY_SCENARIOS[1].stress.gapShare, 0.15);
  const both = REALITY_SCENARIOS[2].stress;
  assert.deepEqual([both.slippagePercent, both.gapShare], [1, 0.15]);
  assert.ok(REALITY_SCENARIOS.every((s) => s.stress.seed === 7 && s.detail.length > 20));
});

test("a scenario keeps the rules and only adds the stress", () => {
  const base = { stop: { kind: "percent", percent: 12 }, capital: 1_000_000 };
  const s = scenarioSettings(base, REALITY_SCENARIOS[2]);
  assert.equal(s.stop.percent, 12);
  assert.equal(s.capital, 1_000_000);
  assert.equal(s.stress.gapShare, 0.15);
  assert.equal(base.stress, undefined);
});

test("verdict: holds up when the realistic bad case keeps most of the yearly return", () => {
  const v = realityVerdict(fig(400e5, 46), rows({ fills: fig(300e5, 40), gaps: fig(350e5, 44), both: fig(280e5, 38), harsh: fig(150e5, 28) }));
  assert.equal(v.tone, "good");
  assert.match(v.text, /Profitable in every case\. The realistic bad case keeps about 83% of the yearly return\. Even the harsh case keeps about 61% of it\./);
});

test("verdict: warns when the realistic bad case keeps under half, and when it keeps under three quarters", () => {
  const low = realityVerdict(fig(400e5, 46), rows({ fills: fig(190e5, 35), gaps: fig(340e5, 43), both: fig(150e5, 22), harsh: fig(50e5, 18) }));
  assert.equal(low.tone, "warn");
  assert.match(low.text, /keeps only about 48% of the yearly return\. Plan for much less/);
  const mid = realityVerdict(fig(400e5, 46), rows({ fills: fig(190e5, 35), gaps: fig(340e5, 43), both: fig(150e5, 32), harsh: fig(50e5, 20) }));
  assert.equal(mid.tone, "warn");
  assert.match(mid.text, /about 70%/);
});

test("verdict: any losing case, or a losing test, is called out plainly", () => {
  const lose = realityVerdict(fig(400e5, 46), rows({ fills: fig(300e5, 40), gaps: fig(350e5, 44), both: fig(-5e5, -1), harsh: fig(-30e5, -9) }));
  assert.equal(lose.tone, "bad");
  assert.match(lose.text, /It loses money under: both together, harsh\. Do not rely on this result\./);
  const none = realityVerdict(fig(-10e5, -3), rows({ fills: fig(-20e5, -5), gaps: fig(-20e5, -5), both: fig(-30e5, -8), harsh: fig(-40e5, -10) }));
  assert.equal(none.tone, "bad");
  assert.match(none.text, /The test itself loses money/);
});
