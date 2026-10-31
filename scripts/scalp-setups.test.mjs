import test from "node:test";
import assert from "node:assert/strict";
import { backtestSignals, DEFAULT_COSTS } from "../src/lib/scalp/backtest.ts";
import { fiveMinute, pdhPdlSignals, trend5mSignals, vwapPullbackSignals } from "../src/lib/scalp/setups.ts";

const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+05:30`);
const bar = (t, close, { open = close, high = close + 0.5, low = close - 0.5, volume = 100 } = {}) => ({ t, open, high, low, close, volume });
const series = (day, start, closes, extra) => closes.map((c, i) => bar(at(day, start) + i * 60_000, c, extra?.(i, c)));
const PREV = "2026-10-05";
const DAY = "2026-10-06";

test("fiveMinute buckets from 09:15 and flags complete bars", () => {
  const five = fiveMinute(series(DAY, "09:15", [1, 2, 3, 4, 5, 6, 7]));
  assert.equal(five.length, 2);
  assert.deepEqual([five[0].open, five[0].close, five[0].high, five[0].complete], [1, 5, 5.5, true]);
  assert.equal(five[0].lastT, at(DAY, "09:19"));
  assert.equal(five[1].complete, false);
});

test("pdhPdlSignals fires once when the close crosses yesterday's high with futures above VWAP", () => {
  const prev = series(PREV, "09:15", Array(60).fill(100)); // high 100.5
  const today = series(DAY, "09:15", [...Array(30).fill(100), 100.4, 101, 100.2, 101.2]);
  const futUp = series(DAY, "09:15", [...Array(30).fill(100), 101, 102, 102, 103]);
  const signals = pdhPdlSignals({ spot: [...prev, ...today], fut: futUp });
  assert.deepEqual(signals, [{ t: at(DAY, "09:46"), side: "CE" }]);
  const futDown = series(DAY, "09:15", [...Array(30).fill(100), 99, 98, 98, 97]);
  assert.deepEqual(pdhPdlSignals({ spot: [...prev, ...today], fut: futDown }), []);
});

test("pdhPdlSignals ignores breaks before 09:30", () => {
  const prev = series(PREV, "09:15", Array(60).fill(100));
  const today = series(DAY, "09:15", [100, 101, 101]);
  const fut = series(DAY, "09:15", [100, 102, 103]);
  assert.deepEqual(pdhPdlSignals({ spot: [...prev, ...today], fut }), []);
});

test("vwapPullbackSignals buys a dip to VWAP in an uptrend", () => {
  const prev = series(PREV, "14:00", Array(90).fill(100));
  // Steady climb from 09:15, then at 10:00 futures dip to VWAP and close back above it.
  const closes = Array.from({ length: 50 }, (_, i) => 100 + i * 0.2);
  const today = series(DAY, "09:15", closes, (i, c) => (i === 45 ? { open: c - 0.3 } : {}));
  const futCloses = closes.map((c) => c + 50);
  const fut = series(DAY, "09:15", futCloses, (i, c) => ({ volume: 100, low: i === 45 ? 140 : c - 0.5 }));
  const signals = vwapPullbackSignals({ spot: [...prev, ...today], fut });
  assert.ok(signals.length >= 1, "expected a pullback signal");
  assert.equal(signals[0].side, "CE");
  assert.equal(signals[0].t, at(DAY, "10:00"));
});

test("trend5mSignals fires on a 5-minute EMA cross with futures agreeing", () => {
  const prev = series(PREV, "09:15", Array(375).fill(100));
  const flat = Array(30).fill(100); // 09:15-09:44
  const rally = Array.from({ length: 30 }, (_, i) => 100 + (i + 1) * 0.5); // from 09:45
  const today = series(DAY, "09:15", [...flat, ...rally]);
  const fut = series(DAY, "09:15", [...flat, ...rally].map((c) => c + 50));
  const signals = trend5mSignals({ spot: [...prev, ...today], fut });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].side, "CE");
  assert.equal(signals[0].t, at(DAY, "09:49"));
});

test("backtestSignals skips signals while a trade is still open", () => {
  const prev = series(PREV, "09:15", Array(10).fill(100));
  const today = series(DAY, "10:00", Array(30).fill(100));
  const detect = () => [{ t: at(DAY, "10:00"), side: "CE" }, { t: at(DAY, "10:05"), side: "CE" }, { t: at(DAY, "10:12"), side: "PE" }];
  const trades = backtestSignals({ spot: [...prev, ...today] }, detect, { stopPoints: 20, rewardRisk: 1.5, timeStopMin: 10 }, DEFAULT_COSTS.NIFTY);
  assert.deepEqual(trades.map((t) => [t.side, t.reason]), [["CE", "time"], ["PE", "time"]]);
});
