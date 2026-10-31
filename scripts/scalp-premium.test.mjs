import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_COSTS, FUTURES_COSTS, costInPoints } from "../src/lib/scalp/backtest.ts";
import { trendFollow } from "../src/lib/scalp/holds.ts";
import {
  DEFAULT_CONDOR, DEFAULT_STRADDLE, actualExpiry, backtestCondor, backtestStraddle, bsPrice, condorStrikes, dayStats, overnightShare, scheduledExpiry, shortLegCost, tradingYears,
} from "../src/lib/scalp/premium.ts";

const DAY = 86_400_000;
const at = (d, hhmm) => Date.parse(`${d}T${hhmm}:00+05:30`);

test("Black-Scholes matches put-call parity and a known value", () => {
  const [s, k, t, v, r] = [24_000, 24_000, 5 / 252, 0.14, 0.065];
  const call = bsPrice("CE", s, k, t, v, r);
  const put = bsPrice("PE", s, k, t, v, r);
  assert.ok(Math.abs(call - put - (s - k * Math.exp(-r * t))) < 1e-6);
  // ATM straddle ≈ 0.8 × S × σ × √T.
  assert.ok(Math.abs(call + put - 0.8 * s * v * Math.sqrt(t)) < 15, `${call + put}`);
  assert.ok(bsPrice("CE", 25_000, 24_000, 0, v) > 999);
});

test("expiry calendar follows the NSE day changes and holidays", () => {
  assert.equal(scheduledExpiry("NIFTY", "2025-08-25"), "2025-08-28");
  assert.equal(scheduledExpiry("NIFTY", "2025-09-03"), "2025-09-09");
  assert.equal(scheduledExpiry("NIFTY", "2026-10-06"), "2026-10-06");
  assert.equal(scheduledExpiry("BANKNIFTY", "2024-11-11"), "2024-11-13");
  assert.equal(scheduledExpiry("BANKNIFTY", "2025-01-10"), "2025-01-30");
  assert.equal(scheduledExpiry("BANKNIFTY", "2025-08-29"), "2025-09-30");
  assert.equal(scheduledExpiry("BANKNIFTY", "2026-10-06"), "2026-10-27");
  assert.equal(actualExpiry("NIFTY", "2025-08-25", ["2025-08-25", "2025-08-26", "2025-08-27", "2025-08-29"]), "2025-08-27");
});

test("trading-time years count whole sessions plus the rest of today", () => {
  const t = at("2026-10-05", "09:30");
  assert.equal(tradingYears(t, "2026-10-05", "2026-10-06", 1, 0.4), (1 + 0.6 * 360 / 375) / 252);
  assert.equal(tradingYears(at("2026-10-06", "15:15"), "2026-10-06", "2026-10-06", 0, 0.4), 0.6 * 15 / 375 / 252);
});

test("overnight share is gap variance over total variance", () => {
  const bars = [100, 101, 100, 101].map((c, i) => ({ t: i * DAY, open: i ? (c + [0, 100, 101, 100][i]) / 2 : c, high: c, low: c, close: c, volume: 0 }));
  const share = overnightShare(bars);
  assert.ok(share > 0.2 && share < 0.3, `${share}`);
});

test("short leg costs charge STT on the sale and stamp duty on the buy-back", () => {
  const c = DEFAULT_COSTS.NIFTY;
  const cost = shortLegCost(c, 100, 0);
  const expected = 40 + 100 * 65 * (c.exchangePct + c.sttSellPct) + (100 * 65 * c.sebiPerCrore) / 1e7
    + (40 + 100 * 65 * c.exchangePct + (100 * 65 * c.sebiPerCrore) / 1e7) * c.gstPct + 2 * c.slippagePerSide * 65;
  assert.ok(Math.abs(cost - expected) < 1e-9);
});

function flatDay(day, level, vix = 14, move = 0) {
  const spot = [], v = [];
  for (let m = 0; m < 375; m++) {
    const t = at(day, "09:15") + m * 60_000;
    const p = level + (move * m) / 374;
    spot.push({ t, open: p, high: p + 1, low: p - 1, close: p, volume: 0 });
    v.push({ t, open: vix, high: vix, low: vix, close: vix, volume: 0 });
  }
  return { spot, vix: v };
}

test("straddle keeps decay on a quiet day and stops the losing leg on a trend day", () => {
  const input = (d) => ({ index: "NIFTY", strikeStep: 50, spot: d.spot, vix: d.vix, ivRatio: () => 1, overnight: 0.3 });
  const quiet = backtestStraddle(input(flatDay("2026-10-01", 24_000)), DEFAULT_STRADDLE, DEFAULT_COSTS.NIFTY);
  assert.equal(quiet.length, 2);
  assert.ok(quiet.every((t) => t.reason === "eod" && t.points > 0));
  assert.equal(quiet[0].exitAt, at("2026-10-01", "15:15"));
  const trend = backtestStraddle(input(flatDay("2026-10-01", 24_000, 14, 300)), DEFAULT_STRADDLE, DEFAULT_COSTS.NIFTY);
  const call = trend.find((t) => t.side === "CE");
  assert.equal(call.reason, "stop");
  assert.ok(Math.abs(call.exit - call.entry * 1.25) < 1e-6);
  assert.ok(trend.find((t) => t.side === "PE").points > 0);
});

test("trendFollow flips on average crosses, charges monthly rolls, and buy-and-hold is one trade", () => {
  const closes = [...Array.from({ length: 60 }, (_, i) => 100 + i), ...Array.from({ length: 60 }, (_, i) => 160 - 2 * i)];
  const bars = closes.map((c, i) => ({ t: Date.parse("2026-01-01T00:00:00+05:30") + i * DAY, open: c, high: c, low: c, close: c, volume: 0 }));
  const plan = { mode: "longShort", fast: 5, slow: 20, carryPctYear: 0 };
  const trades = trendFollow(bars, plan, FUTURES_COSTS.NIFTY);
  assert.deepEqual(trades.map((t) => t.side), ["CE", "PE"]);
  assert.equal(trades[0].reason, "time");
  assert.equal(trades[1].reason, "eod");
  const raw = trades[0].exit - trades[0].entry;
  const rolls = 2; // entered in January, flipped in March
  assert.ok(Math.abs(trades[0].points - (raw - rolls * costInPoints(FUTURES_COSTS.NIFTY, trades[0].entry))) < 1e-9);
  assert.equal(trendFollow(bars, { ...plan, mode: "buyHold" }, FUTURES_COSTS.NIFTY).length, 1);
  assert.deepEqual(trendFollow(bars, { ...plan, mode: "longOnly" }, FUTURES_COSTS.NIFTY).map((t) => t.side), ["CE"]);
});

test("condor strikes sit outside ATM with wings beyond the shorts", () => {
  assert.deepEqual(condorStrikes(24_010, 50, 0.005, 0.005), { shortCall: 24_150, shortPut: 23_900, longCall: 24_250, longPut: 23_750 });
  assert.deepEqual(condorStrikes(24_010, 50, 0, 0.01), { shortCall: 24_000, shortPut: 24_000, longCall: 24_250, longPut: 23_750 });
  assert.deepEqual(condorStrikes(24_000, 50, 0.001, 0.001), { shortCall: 24_000, shortPut: 24_000, longCall: 24_050, longPut: 23_950 });
});

test("condor keeps decay on a quiet day, stops at 1× credit on a trend day, and the wings cap the loss", () => {
  const input = (d) => ({ index: "NIFTY", strikeStep: 50, spot: d.spot, vix: d.vix, ivRatio: () => 1, overnight: 0.3 });
  const quiet = backtestCondor(input(flatDay("2026-10-01", 24_000)), DEFAULT_CONDOR, DEFAULT_COSTS.NIFTY);
  assert.deepEqual(quiet.map((t) => t.side), ["CE", "PE"]);
  assert.ok(quiet.every((t) => t.reason === "eod") && quiet[0].points + quiet[1].points > 0);
  const credit = (ts) => ts[0].entry + ts[1].entry;
  const kept = (ts) => ts[0].points + ts[1].points;
  const trend = backtestCondor(input(flatDay("2026-10-06", 24_000, 14, 400)), DEFAULT_CONDOR, DEFAULT_COSTS.NIFTY);
  assert.ok(trend.every((t) => t.reason === "stop"));
  assert.ok(Math.abs(kept(trend) + credit(trend)) < 1e-6, `${kept(trend)} vs ${credit(trend)}`);
  const open = backtestCondor(input(flatDay("2026-10-01", 24_000, 14, 1_000)), { ...DEFAULT_CONDOR, stopX: Infinity }, DEFAULT_COSTS.NIFTY);
  assert.ok(-kept(open) <= 120 - credit(open) + 1e-6, "loss is at most the wing width minus the credit");
  const net = quiet[0].netRs + quiet[1].netRs;
  assert.deepEqual(dayStats([...quiet, ...trend]), { days: 2, winDays: net > 0 ? 1 : 0, worstDay: Math.min(net, trend[0].netRs + trend[1].netRs), bestDay: Math.max(net, trend[0].netRs + trend[1].netRs) });
});

test("condor held to expiry spans sessions; the IV ÷ realised filter skips cheap days", () => {
  const mon = flatDay("2026-10-05", 24_000), tue = flatDay("2026-10-06", 24_000);
  const input = { index: "NIFTY", strikeStep: 50, spot: [...mon.spot, ...tue.spot], vix: [...mon.vix, ...tue.vix], ivRatio: () => 1, overnight: 0.3 };
  const held = backtestCondor(input, { ...DEFAULT_CONDOR, hold: "expiry", stopX: Infinity }, DEFAULT_COSTS.NIFTY);
  assert.equal(held.length, 2);
  assert.equal(held[0].day, "2026-10-05");
  assert.equal(held[0].exitAt, at("2026-10-06", "15:15"));
  const rv = (v) => ({ ...input, realisedVol: () => v });
  const plan = { ...DEFAULT_STRADDLE, minIvOverRv: 1.2 };
  assert.equal(backtestStraddle(rv(0.10), plan, DEFAULT_COSTS.NIFTY).length, 4, "14% IV vs 10% realised passes");
  assert.equal(backtestStraddle(rv(0.13), plan, DEFAULT_COSTS.NIFTY).length, 0, "14% IV vs 13% realised is skipped");
  assert.equal(backtestStraddle(input, plan, DEFAULT_COSTS.NIFTY).length, 0, "no realised reading means no trade");
});
