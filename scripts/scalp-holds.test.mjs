import test from "node:test";
import assert from "node:assert/strict";
import { FUTURES_COSTS, backtestSignals, roundTripCost } from "../src/lib/scalp/backtest.ts";
import { atr, backtestSwing, breakout20Signals, rsi, rsi2Signals, simulateSwing, sma, trendHoldSignals } from "../src/lib/scalp/holds.ts";

const DAY = 86_400_000;
const start = Date.parse("2026-01-01T00:00:00+05:30");
const day = (i, close, { open = close, high = close + 5, low = close - 5 } = {}) => ({ t: start + i * DAY, open, high, low, close, volume: 0 });
const days = (closes) => closes.map((c, i) => day(i, c));
const plan = { stopAtr: 1.5, maxDays: 3, exitOnSma5: false, carryPctYear: 0 };

test("futures round trip for one Nifty lot near 24,000 costs about ₹1,050", () => {
  const cost = roundTripCost(FUTURES_COSTS.NIFTY, 24_000);
  assert.ok(cost > 1_000 && cost < 1_100, `cost ${cost}`);
  assert.ok(roundTripCost(FUTURES_COSTS.NIFTY, 12_000) < cost);
});

test("sma, rsi and atr basics", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const up = rsi(days([1, 2, 3, 4, 5]), 2);
  assert.equal(up[1], null);
  assert.equal(up[2], 100);
  const r = rsi(days([10, 11, 10, 9, 8]), 2);
  assert.ok(r[4] < 20, `rsi ${r[4]}`);
  const a = atr(days([100, 100, 100]), 2);
  assert.deepEqual(a, [null, 10, 10]);
});

test("breakout20Signals flags a close beyond the prior 20-day range", () => {
  const closes = [...Array(20).fill(100), 106, 100, 94];
  const signals = breakout20Signals(days(closes));
  assert.deepEqual(signals, [{ i: 20, side: "CE" }, { i: 22, side: "PE" }]);
});

test("rsi2Signals buys a sharp dip above the 200-day average", () => {
  const closes = [...Array.from({ length: 205 }, (_, i) => 100 + i), 300, 290, 280];
  const signals = rsi2Signals(days(closes));
  assert.ok(signals.some((s) => s.side === "CE" && s.i >= 206), JSON.stringify(signals));
  assert.ok(signals.every((s) => s.side === "CE"));
});

test("simulateSwing enters next open, stops on the day's range and exits on day 3", () => {
  const bars = days([100, 100, 100, 100, 100, 100]);
  const atrs = bars.map(() => 10);
  const smas = bars.map(() => null);
  const timed = simulateSwing(bars, { i: 0, side: "CE" }, plan, atrs, smas);
  assert.equal(timed.reason, "time");
  assert.equal(timed.exitAt, bars[3].t);
  const falling = [day(0, 100), day(1, 100), day(2, 95, { low: 80 }), day(3, 100)];
  const stopped = simulateSwing(falling, { i: 0, side: "CE" }, plan, atrs, smas);
  assert.equal(stopped.reason, "stop");
  assert.equal(stopped.exit, 85);
  const gapped = [day(0, 100), day(1, 100), day(2, 70, { open: 75, low: 65 })];
  assert.equal(simulateSwing(gapped, { i: 0, side: "CE" }, plan, atrs, smas).exit, 75);
});

test("simulateSwing mean-reversion exit takes the first close beyond the 5-day average", () => {
  const bars = days([100, 100, 104, 108]);
  const t = simulateSwing(bars, { i: 0, side: "CE" }, { ...plan, exitOnSma5: true }, bars.map(() => 10), [null, 101, 102, 103]);
  assert.equal(t.reason, "target");
  assert.equal(t.exitAt, bars[2].t);
  assert.equal(t.points, 4);
});

test("backtestSwing charges carry to longs, credits shorts, and skips overlapping signals", () => {
  const bars = days(Array(30).fill(10_000));
  const costs = FUTURES_COSTS.NIFTY;
  const detect = () => [{ i: 14, side: "CE" }, { i: 15, side: "PE" }, { i: 18, side: "PE" }];
  const trades = backtestSwing(bars, detect, { ...plan, carryPctYear: 7.3 }, costs);
  assert.deepEqual(trades.map((t) => t.side), ["CE", "PE"]);
  // Held 2 calendar days at 10,000 with 7.3%/yr carry = 4 points.
  assert.ok(Math.abs(trades[0].points + 4) < 1e-9, `long points ${trades[0].points}`);
  assert.ok(Math.abs(trades[1].points - 4) < 1e-9, `short points ${trades[1].points}`);
  assert.ok(Math.abs(trades[0].netRs - (trades[0].grossRs - roundTripCost(costs, 10_000))) < 1e-9);
});

test("intraday hold runs to the 15:15 square-off with no target", () => {
  const at = (d, hhmm) => Date.parse(`${d}T${hhmm}:00+05:30`);
  const prev = Array.from({ length: 375 }, (_, i) => ({ t: at("2026-10-05", "09:15") + i * 60_000, open: 100, high: 100.5, low: 99.5, close: 100, volume: 100 }));
  const closes = [...Array(30).fill(100), ...Array.from({ length: 345 }, (_, i) => 100 + (i + 1) * 0.5)];
  const today = closes.map((c, i) => ({ t: at("2026-10-06", "09:15") + i * 60_000, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 100 }));
  const fut = today.map((b) => ({ ...b, open: b.open + 50, high: b.high + 50, low: b.low + 50, close: b.close + 50 }));
  const trades = backtestSignals(
    { spot: [...prev, ...today], fut },
    trendHoldSignals,
    { stopPoints: 30, rewardRisk: Infinity, timeStopMin: 1_000, squareOffMin: 15 * 60 + 15 },
    FUTURES_COSTS.NIFTY,
  );
  assert.equal(trades.length, 1);
  assert.equal(trades[0].reason, "eod");
  assert.equal(trades[0].exitAt, at("2026-10-06", "15:15"));
  assert.ok(trades[0].points > 100);
});
