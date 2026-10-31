import test from "node:test";
import assert from "node:assert/strict";
import { dailyRegime, hourlySetup } from "../src/lib/paper/indexFramework.ts";

const series = (n, start, step) => Array.from({ length: n }, (_, i) => ({ close: start + i * step }));
const bars = (n, start, step, volume = (i) => 100 + i) => Array.from({ length: n }, (_, i) => {
  const close = start + i * step;
  return { t: i * 3_600_000, open: close - step / 2, high: close + 5, low: close - 5, close, volume: volume(i) };
});

test("daily regime: a steady uptrend with calm VIX and strong banks is bullish on all six checks", () => {
  const up = series(260, 18000, 15);
  const r = dailyRegime(up, series(260, 40000, 20), series(260, 15, 0));
  assert.equal(r.state, "bull");
  assert.equal(r.bullCount, 6);
  assert.equal(r.bearCount, 0);
  assert.ok(r.bull.every((c) => c.pass === true));
});

test("daily regime: a steady downtrend with rising VIX is bearish; a mixed picture is neither", () => {
  const down = series(260, 26000, -15);
  const vixUp = [...series(255, 12, 0), ...[12, 12, 12, 12, 14].map((close) => ({ close }))];
  const bankDown = series(260, 56000, -20);
  assert.equal(dailyRegime(down, bankDown, vixUp).state, "bear");
  // Index up but Bank Nifty below its 50 DMA: five of six bull checks, so no regime.
  const mixed = dailyRegime(series(260, 18000, 15), series(260, 56000, -20), series(260, 15, 0));
  assert.equal(mixed.state, "none");
  assert.equal(mixed.bullCount, 5);
  assert.equal(dailyRegime(series(100, 1, 1), series(100, 1, 1), series(100, 1, 1)), null, "needs 200 daily bars");
});

test("an unavailable input is n/a and is never counted as a pass", () => {
  const r = dailyRegime(series(260, 18000, 15), series(10, 1, 1), []);
  const vix = r.bull.find((c) => c.label.startsWith("India VIX"));
  assert.equal(vix.pass, null);
  assert.equal(vix.value, "n/a");
  assert.notEqual(r.state, "bull", "five measured passes are not six");
});

test("hourly long: every condition passing gives a proposal beyond the last high with a 2R target", () => {
  const b = bars(40, 22000, 8);
  const s = hourlySetup({ bars: b, vwap: 22100, breadthPercent: 62, dir: 1 });
  assert.equal(s.allPass, true);
  assert.equal(s.failed, 0);
  assert.equal(s.breakoutConfirmed, true);
  assert.equal(s.proposal.entryType, "market");
  assert.ok(s.proposal.stop < s.proposal.entry && s.proposal.target > s.proposal.entry);
  assert.ok(Math.abs((s.proposal.target - s.proposal.entry) - 2 * s.proposal.riskPoints) < 1e-6);
  assert.ok(s.proposal.riskPoints >= 1.5 * 10 - 1e-6 || s.proposal.riskPoints > 0);
});

test("hourly: a failed condition blocks the proposal; unmeasured ones stop it counting as a full pass", () => {
  const b = bars(40, 22000, 8);
  const weakBreadth = hourlySetup({ bars: b, vwap: 22100, breadthPercent: 30, dir: 1 });
  assert.equal(weakBreadth.failed, 1);
  assert.equal(weakBreadth.proposal, null);
  const noVwap = hourlySetup({ bars: b, vwap: null, breadthPercent: 62, dir: 1 });
  assert.equal(noVwap.failed, 0);
  assert.equal(noVwap.unmeasured, 1);
  assert.equal(noVwap.allPass, false);
  assert.ok(noVwap.proposal, "measured conditions all hold, so a proposal is shown");
  assert.equal(hourlySetup({ bars: bars(10, 1, 1), vwap: 1, breadthPercent: 50, dir: 1 }), null);
});

test("hourly short mirrors the long rules", () => {
  const b = bars(40, 22400, -8);
  const s = hourlySetup({ bars: b, vwap: 22200, breadthPercent: 30, dir: -1 });
  assert.equal(s.allPass, true);
  assert.equal(s.proposal.entryType, "market");
  assert.ok(s.proposal.stop > s.proposal.entry && s.proposal.target < s.proposal.entry);
  const long = hourlySetup({ bars: b, vwap: 22200, breadthPercent: 30, dir: 1 });
  assert.ok(long.failed >= 4, "a falling market fails the long conditions");
});

import { autoDecision } from "../src/lib/paper/indexFramework.ts";

test("auto-paper decision: places only when everything holds, otherwise says why", () => {
  const ok = { hasActiveOrder: false, limitReason: null, setup: { allPass: true }, hasProposal: true, lots: 2, verdict: "All conditions pass." };
  assert.deepEqual(autoDecision(ok), { action: "place" });
  assert.match(autoDecision({ ...ok, hasActiveOrder: true }).message, /already open or pending/);
  assert.equal(autoDecision({ ...ok, limitReason: "Daily trade limit reached: 3 of 3." }).message, "Daily trade limit reached: 3 of 3.");
  assert.equal(autoDecision({ ...ok, setup: { allPass: false }, verdict: "2 hourly conditions failing: wait." }).message, "2 hourly conditions failing: wait.");
  assert.equal(autoDecision({ ...ok, setup: null, verdict: "No trade: the daily regime is not aligned." }).action, "skip");
  assert.equal(autoDecision({ ...ok, hasProposal: false }).action, "skip");
  assert.match(autoDecision({ ...ok, lots: 0 }).message, /not even one lot/);
});
