import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { horizonBuySignal, MIN_ODDS_TRADES, targetOddsLines, withPatternTargets } from "../src/lib/screen/horizonSignal.ts";

const row = {
  price: 100,
  changePercent: 1,
  turnoverCr: 20,
  rs: 90,
  vs50: 10,
  vs200: 25,
  fromHigh: 5,
  ext: 3,
  pivotPrice: 98,
  baseWk: 8,
  stage: "forming",
  exitReason: null,
  oscillatorScore: {
    score: 12,
    bearish: 1,
    levels: {
      entry: 101,
      buyZoneHigh: 103,
      stop: 96,
      target1: 111,
      target2: 116,
      riskPercent: 4.95,
      atr: 2,
      swingLow20: 95,
      swingLow50: 92,
    },
  },
};

test("short-term signal reuses the ATR and swing trade plan", () => {
  const signal = horizonBuySignal(row, "short", 60);
  assert.equal(signal.status.label, "Buy ready");
  assert.equal(signal.plan.entry, 101);
  assert.equal(signal.plan.target2, 116);
  assert.equal(signal.plan.rewardRisk2, 3);
});

test("mid-term signal uses swing structure with 2R and 3R targets", () => {
  const signal = horizonBuySignal(row, "mid", 60);
  assert.equal(signal.status.label, "Buy ready");
  assert.equal(signal.plan.rewardRisk1, 2);
  assert.equal(signal.plan.rewardRisk2, 3);
  assert.ok(signal.plan.stop < signal.plan.entry);
});

test("long-term signal uses swing structure and wider targets", () => {
  const signal = horizonBuySignal(row, "long", 60);
  assert.equal(signal.status.label, "Buy ready");
  assert.equal(signal.plan.rewardRisk1, 2.5);
  assert.equal(signal.plan.rewardRisk2, 4);
});

test("long-term signal fails when price is far below the 52-week high", () => {
  const signal = horizonBuySignal({ ...row, fromHigh: 25 }, "long", 60);
  assert.notEqual(signal.status.label, "Buy ready");
  assert.ok(signal.status.failed.includes("Within 15% of 52-week high"));
  assert.equal(signal.status.checks.find((check) => check.key === "high").pass, false);
});

test("missing swing-low history leaves the plan unavailable", () => {
  const levels = { ...row.oscillatorScore.levels, swingLow20: null };
  const signal = horizonBuySignal({ ...row, oscillatorScore: { ...row.oscillatorScore, levels } }, "mid", 60);
  assert.equal(signal.plan, null);
  assert.notEqual(signal.status.label, "Buy ready");
  assert.ok(signal.status.failed.includes("Risk at most 8%"));
});

test("mid-term stop sits below the 20-day swing low", () => {
  const signal = horizonBuySignal(row, "mid", 60);
  // 95 - 0.25 x ATR(2) = 94.5 from entry 100: 5.5% risk, targets at 2R/3R.
  assert.equal(signal.plan.stop, 94.5);
  assert.equal(signal.plan.riskPercent, 5.5);
  assert.equal(signal.plan.target1, 111);
  assert.equal(signal.plan.target2, 116.5);
  assert.match(signal.plan.stopBasis, /20-day low/);
});

test("long-term stop sits below the 50-day swing low", () => {
  const signal = horizonBuySignal(row, "long", 60);
  // 92 - 0.5 x ATR(2) = 91: 9% risk, targets at 2.5R/4R.
  assert.equal(signal.plan.stop, 91);
  assert.equal(signal.plan.riskPercent, 9);
  assert.equal(signal.plan.target2, 136);
});

test("distant support fails the risk check and hides the plan instead of capping the stop", () => {
  const levels = { ...row.oscillatorScore.levels, swingLow20: 80, swingLow50: 70 };
  const wide = { ...row, oscillatorScore: { ...row.oscillatorScore, levels } };
  const mid = horizonBuySignal(wide, "mid", 60);
  assert.equal(mid.plan, null);
  assert.equal(mid.noTrade.reason, "Risk too wide – no trade");
  assert.match(mid.noTrade.detail, /20\.\d% below entry; this horizon allows at most 8%/);
  assert.ok(mid.status.failed.includes("Risk at most 8%"));
  const long = horizonBuySignal(wide, "long", 60);
  assert.equal(long.plan, null);
  assert.match(long.noTrade.detail, /at most 10%/);
  assert.ok(long.status.failed.includes("Risk at most 10%"));
});

test("short-term plan with risk above 6% shows no targets (e.g. a volatile stock with a wide stop)", () => {
  const levels = { ...row.oscillatorScore.levels, entry: 314.3, buyZoneHigh: 321.59, stop: 277.85, target1: 387.2, target2: 423.65, riskPercent: 11.6 };
  const signal = horizonBuySignal({ ...row, price: 311.8, oscillatorScore: { ...row.oscillatorScore, levels } }, "short", 60);
  assert.equal(signal.plan, null);
  assert.equal(signal.noTrade.reason, "Risk too wide – no trade");
  assert.ok(signal.status.failed.includes("Risk at most 6%"));
});

test("tradeable plans carry no no-trade reason", () => {
  for (const horizon of ["short", "mid", "long"]) assert.equal(horizonBuySignal(row, horizon, 60).noTrade, null, horizon);
});

test("a swing low too close to entry uses the minimum ATR distance", () => {
  const levels = { ...row.oscillatorScore.levels, swingLow20: 99.5 };
  const signal = horizonBuySignal({ ...row, oscillatorScore: { ...row.oscillatorScore, levels } }, "mid", 60);
  assert.equal(signal.plan.stop, 97);
  assert.match(signal.plan.stopBasis, /ATR below entry/);
});

test("mid-term entry at a distant pivot fails the risk check", () => {
  const signal = horizonBuySignal({ ...row, pivotPrice: 130, ext: -23 }, "mid", 60);
  assert.equal(signal.plan, null);
  assert.equal(signal.noTrade.reason, "Risk too wide – no trade");
  assert.notEqual(signal.status.label, "Buy ready");
  assert.ok(signal.status.failed.includes("Risk at most 8%"));
});

test("price at or below the stop-loss is never Buy ready", () => {
  for (const horizon of ["short", "mid", "long"]) {
    const signal = horizonBuySignal({ ...row, price: 90 }, horizon, 60);
    assert.notEqual(signal.status.label, "Buy ready", horizon);
    assert.ok(signal.status.failed.includes("Price above stop-loss"), horizon);
  }
});

test("target odds lines quote the backtest hit rates and flag small samples", () => {
  const odds = { trades: 32, t1HitPercent: 34.4, t1MedianDays: 54, t2HitPercent: 28.1, t2MedianDays: 122, stopFirstPercent: 53.1, timeExitPercent: 12.5, avgR: 0.32, winPercent: 34, maxHoldSessions: 250, from: "2022-11-01", to: "2026-10-01" };
  const lines = targetOddsLines(odds);
  assert.equal(lines.t1, "T1 hit 34% of the time (median 54 trading days)");
  assert.equal(lines.t2, "T2 hit 28% within 250 trading days (median 122 trading days)");
  assert.equal(lines.stop, "Stop-loss hit first 53%");
  assert.equal(lines.sample, "32 past trades, 2022–2026 · small sample");
  assert.equal(targetOddsLines({ ...odds, trades: MIN_ODDS_TRADES, t1MedianDays: null }).t1, "T1 hit 34% of the time");
  assert.ok(!targetOddsLines({ ...odds, trades: MIN_ODDS_TRADES }).sample.includes("small sample"));
});

test("horizonBacktest.json has a Buy ready sample with hit rates for every horizon", () => {
  const data = JSON.parse(readFileSync(new URL("../src/lib/screen/horizonBacktest.json", import.meta.url), "utf8"));
  for (const h of ["short", "mid", "long"]) {
    const s = data.horizons[h].buyReady;
    assert.ok(s && s.trades > 0, h);
    for (const key of ["t1HitPercent", "t2HitPercent", "stopFirstPercent"]) assert.ok(s[key] >= 0 && s[key] <= 100, `${h} ${key}`);
    assert.ok(s.t2HitPercent <= s.t1HitPercent, `${h}: T2 needs T1 first`);
    assert.ok(data.maxHoldSessions[h] > 0);
  }
});

test("short-term targets come from the base height when there is a base", () => {
  const signal = horizonBuySignal({ ...row, baseDepth: 10 }, "short", 60);
  // Pivot 98, height 9.8: T1 = 107.8, T2 = 117.6; entry and stop are unchanged.
  assert.equal(signal.plan.entry, 101);
  assert.equal(signal.plan.stop, 96);
  assert.equal(signal.plan.target1, 107.8);
  assert.equal(signal.plan.target2, 117.6);
  assert.equal(signal.plan.rewardRisk1, 1.36);
  assert.match(signal.plan.targetBasis, /base height/);
});

test("pattern targets fall back to the 2R/3R plan without a usable base", () => {
  const plan = { entry: 101, buyZoneHigh: 103, stop: 96, target1: 111, target2: 116, riskPercent: 4.95, rewardRisk1: 2, rewardRisk2: 3 };
  assert.equal(withPatternTargets(plan, { pivotPrice: 98, baseDepth: null }), plan);
  // Height 1.96 puts T1 at 99.96, below entry.
  assert.equal(withPatternTargets(plan, { pivotPrice: 98, baseDepth: 2 }), plan);
  // Pivot above the buy zone: still deep in the base, so the old high would set far targets.
  assert.equal(withPatternTargets(plan, { pivotPrice: 120, baseDepth: 20 }), plan);
  assert.equal(horizonBuySignal({ ...row, baseDepth: 10 }, "mid", 60).plan.targetBasis, undefined);
});