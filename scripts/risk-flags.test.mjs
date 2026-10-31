import test from "node:test";
import assert from "node:assert/strict";
import { expectedVolumeShare, relativeVolume, riskFlags } from "../src/lib/screen/riskFlags.ts";
import { classifyBuyingStatus, withRiskFlags } from "../src/lib/screen/buyingStatus.ts";

const DAY = 86_400_000;
// 03:45 UTC = 09:15 IST, so each candle lands on its own IST trading day.
const T0 = Date.UTC(2026, 0, 1, 3, 45);
const candle = (i, close, volume = 1000, open = close) => ({ t: T0 + i * DAY, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume });
const flat = (n, close = 100, volume = 1000) => Array.from({ length: n }, (_, i) => candle(i, close, volume));
const dateKey = (t) => new Date(t + 19_800_000).toISOString().slice(0, 10);

test("expected volume share follows the intraday curve", () => {
  assert.equal(expectedVolumeShare(0), 0);
  assert.equal(expectedVolumeShare(0.5), 0.5);
  assert.equal(expectedVolumeShare(1), 1);
  assert.ok(Math.abs(expectedVolumeShare(0.15) - 0.2) < 1e-9);
});

test("completed session RVOL is last volume over the prior 50-session average", () => {
  const candles = [...flat(60), candle(60, 100, 3000)];
  const rvol = relativeVolume(candles, { dateKey: "2099-01-01", progress: 1, isLive: false });
  assert.deepEqual(rvol, { ratio: 3, projected: false });
});

test("live RVOL is projected with the volume curve and hidden very early", () => {
  const candles = [...flat(60), candle(60, 100, 500)];
  const key = dateKey(candles[60].t);
  const mid = relativeVolume(candles, { dateKey: key, progress: 0.5, isLive: true });
  assert.equal(mid.projected, true);
  assert.ok(Math.abs(mid.ratio - 1) < 1e-9);
  assert.equal(relativeVolume(candles, { dateKey: key, progress: 0.02, isLive: true }), null);
  assert.equal(relativeVolume(flat(10), { dateKey: key, progress: 1, isLive: false }), null);
});

test("gap-up that gives back half the gap is a high-severity flag", () => {
  const candles = [...flat(20), candle(20, 101, 1000, 104)];
  const flags = riskFlags(candles, { vs50: 5, turnoverCr: 50 });
  assert.deepEqual(flags.map((f) => [f.key, f.severity]), [["gap-fade", "high"]]);
  const held = riskFlags([...flat(20), candle(20, 105, 1000, 104)], { vs50: 5, turnoverCr: 50 });
  assert.equal(held.length, 0);
});

test("climax run replaces the extended caution", () => {
  const candles = [...flat(20), ...Array.from({ length: 10 }, (_, i) => candle(20 + i, 100 + (i + 1) * 3))];
  const flags = riskFlags(candles, { vs50: 30, turnoverCr: 50 });
  assert.deepEqual(flags.map((f) => f.key), ["climax-run"]);
  assert.deepEqual(riskFlags(flat(30), { vs50: 30, turnoverCr: 50 }).map((f) => f.key), ["extended"]);
});

test("thin liquidity and light-volume breakouts are cautions", () => {
  const flags = riskFlags(flat(30), { vs50: 5, turnoverCr: 6, stage: "breakout", breakoutVolume: 0.9 });
  assert.deepEqual(flags.map((f) => [f.key, f.severity]), [["thin-liquidity", "caution"], ["light-breakout", "caution"]]);
});

test("high flags cap Buy ready at Watch without changing the rating", () => {
  const ready = classifyBuyingStatus([{ key: "a", label: "A", pass: true }]);
  const high = [{ key: "climax-run", label: "Climax run", severity: "high", detail: "" }];
  const caution = [{ key: "extended", label: "Extended", severity: "caution", detail: "" }];
  const capped = withRiskFlags(ready, high);
  assert.equal(capped.key, "watch");
  assert.equal(capped.rating, 100);
  assert.match(capped.detail, /climax run/);
  assert.equal(withRiskFlags(ready, caution).key, "buy-ready");
  assert.equal(withRiskFlags(ready, undefined), ready);
});
