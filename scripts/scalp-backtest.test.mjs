import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COSTS, backtestOrb, byMonth, costInPoints, roundTripCost, sessionsByDay, simulateTrade, summarize, verdictOf,
} from "../src/lib/scalp/backtest.ts";

const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+05:30`);
const bar = (t, close, { open = close, high = close + 0.5, low = close - 0.5 } = {}) => ({ t, open, high, low, close, volume: 0 });
const run = (day, start, closes) => closes.map((c, i) => bar(at(day, start) + i * 60_000, c));
const opts = { stopPoints: 20, rewardRisk: 1.5, timeStopMin: 10, squareOffMin: 15 * 60 + 20 };

test("round-trip cost for one Nifty lot is about ₹131 and ≈4 index points", () => {
  const cost = roundTripCost(DEFAULT_COSTS.NIFTY);
  assert.ok(cost > 120 && cost < 140, `cost ${cost}`);
  assert.ok(Math.abs(costInPoints(DEFAULT_COSTS.NIFTY) - cost / (0.5 * 65)) < 1e-9);
});

test("sessionsByDay drops bars outside 09:15–15:29 IST and groups by day", () => {
  const bars = [
    bar(at("2026-10-05", "09:14"), 1), bar(at("2026-10-05", "09:15"), 2), bar(at("2026-10-05", "15:29"), 3),
    bar(at("2026-10-05", "15:35"), 4), bar(at("2026-10-06", "09:15"), 5),
  ];
  const days = sessionsByDay(bars);
  assert.deepEqual(days.map((d) => [d.day, d.bars.map((b) => b.close)]), [["2026-10-05", [2, 3]], ["2026-10-06", [5]]]);
});

test("simulateTrade enters at the next open and hits the target", () => {
  const s = [bar(at("2026-10-06", "10:00"), 100), bar(at("2026-10-06", "10:01"), 105, { open: 101 }), bar(at("2026-10-06", "10:02"), 140, { open: 106, high: 140 })];
  const trade = simulateTrade(s, s[0].t, "CE", opts);
  assert.equal(trade.entry, 101);
  assert.equal(trade.reason, "target");
  assert.equal(trade.exit, 131);
  assert.equal(trade.points, 30);
});

test("simulateTrade assumes the stop first when a bar touches both, and fills gaps at the open", () => {
  const both = [bar(at("2026-10-06", "10:00"), 100), bar(at("2026-10-06", "10:01"), 100, { open: 100, high: 140, low: 70 })];
  const t1 = simulateTrade(both, both[0].t, "CE", opts);
  assert.equal(t1.reason, "stop");
  assert.equal(t1.points, -20);
  const gap = [bar(at("2026-10-06", "10:00"), 100), bar(at("2026-10-06", "10:01"), 100), bar(at("2026-10-06", "10:02"), 120, { open: 125, high: 126, low: 119 })];
  const t2 = simulateTrade(gap, gap[0].t, "PE", opts);
  assert.equal(t2.reason, "stop");
  assert.equal(t2.exit, 125);
  assert.equal(t2.points, -25);
});

test("simulateTrade exits on the time stop and before square-off", () => {
  const flat = run("2026-10-06", "10:00", Array(15).fill(100));
  const t = simulateTrade(flat, flat[0].t, "CE", opts);
  assert.equal(t.reason, "time");
  assert.equal(t.exitAt, flat[10].t);
  const late = run("2026-10-06", "15:15", Array(10).fill(100));
  const e = simulateTrade(late, late[0].t, "CE", opts);
  assert.equal(e.reason, "eod");
  assert.equal(e.exitAt, at("2026-10-06", "15:20"));
  assert.equal(simulateTrade(late, at("2026-10-06", "15:20"), "CE", opts), null);
});

test("backtestOrb finds the breakout, prices it per lot and nets costs", () => {
  const prev = run("2026-10-05", "14:30", Array(60).fill(100));
  const orb = run("2026-10-06", "09:15", Array(15).fill(100));
  const drift = run("2026-10-06", "09:30", [100.1, 100.2, 100.3, 100.4, 100.5]);
  const breakout = [bar(at("2026-10-06", "09:35"), 100.9)];
  const after = run("2026-10-06", "09:36", [101, 110, 125, 130.6, 135, 135]);
  const trades = backtestOrb(
    { spot: [...prev, ...orb, ...drift, ...breakout, ...after] },
    { stopPoints: 20, useFutVwap: false },
    DEFAULT_COSTS.NIFTY,
  );
  assert.equal(trades.length, 1);
  const [t] = trades;
  assert.equal(t.side, "CE");
  assert.equal(t.entry, 101);
  assert.equal(t.reason, "target");
  assert.equal(t.grossRs, 30 * 0.5 * 65);
  assert.ok(Math.abs(t.netRs - (t.grossRs - roundTripCost(DEFAULT_COSTS.NIFTY))) < 1e-9);
});

const trade = (day, netRs) => ({ day, side: "CE", signalAt: 0, entryAt: 0, entry: 0, exitAt: 0, exit: 0, reason: "time", points: 0, grossRs: netRs, netRs });

test("summarize computes win rate, profit factor and drawdown", () => {
  const s = summarize([trade("2026-01-01", 100), trade("2026-01-02", -50), trade("2026-01-03", -100), trade("2026-02-01", 30)]);
  assert.equal(s.trades, 4);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.totalNet, -20);
  assert.ok(Math.abs(s.profitFactor - 130 / 150) < 1e-9);
  assert.equal(s.maxDrawdown, 150);
  assert.deepEqual(byMonth([trade("2026-01-01", 100), trade("2026-02-01", 30)]).map((m) => [m.month, m.net]), [["2026-01", 100], ["2026-02", 30]]);
});

test("verdictOf needs enough trades, a positive average and both halves positive", () => {
  assert.equal(verdictOf([trade("2026-01-01", 10)]).label, "Too few trades");
  const losing = Array.from({ length: 120 }, (_, i) => trade("2026-01-01", i % 2 ? 50 : -80));
  assert.equal(verdictOf(losing).label, "No edge after costs");
  const lopsided = [...Array(60).fill(0).map(() => trade("2026-01-01", 100)), ...Array(60).fill(0).map(() => trade("2026-01-01", -10))];
  assert.equal(verdictOf(lopsided).label, "Not consistent");
  const good = Array.from({ length: 120 }, (_, i) => trade("2026-01-01", i % 3 ? 60 : -50));
  assert.equal(verdictOf(good).edge, true);
});
