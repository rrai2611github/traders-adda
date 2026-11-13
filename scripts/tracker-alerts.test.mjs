import test from "node:test";
import assert from "node:assert/strict";
import { dailyTrackerAlerts, observeTrackerDay, trackerStopAlerts, deliverTrackerAlerts } from "../src/lib/backtest/trackerAlerts.ts";

const now = Date.parse("2026-11-11T12:00:00+05:30");
const holding = { symbol: "TEST", entryDay: "2026-11-11", entryPrice: 100, quantity: 10, stop: 88 };
const result = {
  data: { lastDay: "2026-11-11" },
  trades: [{ ...holding, exitDay: "2026-11-11", exitPrice: 105, pnl: 50, exitReason: "end" }],
  openPositions: [holding],
  pending: { breadthOk: true, niftyOk: null, signals: [{ symbol: "NEXT", close: 100, stop: 88, quantity: 20 }] },
};
const quote = { symbol: "TEST", ltp: 87, timestamp: now - 1000, tradeTimestamp: now - 1000, timestampBasis: "trade", source: "fyers" };

test("daily records deduplicate open buys, exclude end marks, and label candidates as unexecuted", () => {
  const alerts = dailyTrackerAlerts(result);
  assert.equal(alerts.length, 2);
  assert.match(alerts[0].subject, /Practice buy recorded/);
  assert.match(alerts[1].lines.join(" "), /Not bought yet/);
  const exit = dailyTrackerAlerts({ ...result, trades: [{ ...result.trades[0], exitReason: "stop" }] });
  assert.equal(exit.filter(a => a.key.startsWith("exit:")).length, 1);
  assert.equal(dailyTrackerAlerts({ ...result, pending: { ...result.pending, breadthOk: false } }).length, 1);
});

test("initial activation and changed configuration baseline without historical emails", () => {
  const state = observeTrackerDay(null, "a", result);
  assert.deepEqual(state.pending, []);
  assert.deepEqual(observeTrackerDay(state, "b", result).pending, []);
  assert.equal(observeTrackerDay(state, "a", result), state);
});

test("new daily result queues once and preserves failed events across later days and restarts", () => {
  const state = observeTrackerDay(null, "a", { ...result, data: { lastDay: "2026-11-10" } });
  const next = observeTrackerDay(state, "a", result);
  assert.equal(next.pending.length, 2);
  assert.equal(observeTrackerDay(JSON.parse(JSON.stringify(next)), "a", result).pending.length, 2);
  const later = observeTrackerDay(next, "a", { ...result, data: { lastDay: "2026-11-12" } });
  assert.equal(later.pending.length, 3);
});

test("stop warnings reject stale, missing, simulated and unverified quotes, accepting only actual recent observations", () => {
  assert.equal(trackerStopAlerts(result, [quote], now, "2026-11-11").alerts.length, 1);
  for (const q of [
    { ...quote, ltp: 89 }, { ...quote, ltp: NaN }, { ...quote, source: "mock" },
    { ...quote, tradeTimestamp: null, timestampBasis: "session" },
    { ...quote, tradeTimestamp: now - 120001 }, { ...quote, tradeTimestamp: now + 1 },
  ]) assert.equal(trackerStopAlerts(result, [q], now, "2026-11-11").alerts.length, 0);
  assert.equal(trackerStopAlerts(result, [], now, "2026-11-11").blocked.length, 1);
  assert.match(trackerStopAlerts(result, [quote], now, "2026-11-11").alerts[0].lines.join(" "), /NOT an executed exit/);
});

test("SMTP failures retain pending events; successes checkpoint separately and avoid resending", async () => {
  const state = { version: 1, generation: "a", observedDay: "2026-11-11", sent: [], pending: dailyTrackerAlerts(result) };
  let saved;
  assert.equal(await deliverTrackerAlerts(state, async () => false, () => assert.fail()), false);
  assert.equal(state.pending.length, 2);
  let calls = 0;
  assert.equal(await deliverTrackerAlerts(state, async () => ++calls === 1, s => { saved = structuredClone(s); }), false);
  assert.equal(saved.sent.length, 1);
  assert.equal(saved.pending.length, 1);
  assert.equal(await deliverTrackerAlerts(saved, async () => true, () => {}), true);
  assert.equal(saved.pending.length, 0);
  assert.equal(saved.sent.length, 2);
});
