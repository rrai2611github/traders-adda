import assert from "node:assert/strict";
import { test } from "node:test";
import { simulate } from "../src/lib/backtest/simulate.ts";
import { toSeries } from "../src/lib/backtest/history.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";

const DAY_MS = 86_400_000;
const START_DAY = 20_000;

/** A small market: each stock is a list of [open, high, low, close] bars starting on the first calendar day. */
function market(stocks, { turn = 100, breadth = 70 } = {}) {
  const series = new Map();
  let length = 0;
  for (const [symbol, bars] of Object.entries(stocks)) {
    length = Math.max(length, bars.length);
    // 06:00 UTC is 11:30 IST, comfortably inside the same IST day.
    const rows = bars.map(([o, h, l, c], i) => [(START_DAY + i) * DAY_MS + 6 * 3_600_000, o, h, l, c, 1_000_000]);
    series.set(symbol, toSeries(symbol, rows, 1));
  }
  const calendar = Int32Array.from({ length }, (_, i) => START_DAY + i);
  const position = new Map(Array.from(calendar, (d, i) => [d, i]));
  const history = { series, calendar, position, candleCount: 0 };
  const derived = {
    turn: new Map([...series].map(([s, x]) => [s, new Float32Array(x.n).fill(turn)])),
    rs: new Map([...series].map(([s, x]) => [s, new Uint8Array(x.n).fill(90)])),
    breadth50: new Float32Array(length).fill(breadth),
    breadth200: new Float32Array(length).fill(breadth),
  };
  return { history, derived };
}

const flat = (price, n) => Array.from({ length: n }, () => [price, price, price, price]);
const settings = (over = {}) => ({
  ...DEFAULT_SETTINGS,
  stop: { kind: "percent", percent: 10 },
  exit: { kind: "target", r: 2 },
  costPercent: 0,
  capital: 1_000_000,
  maxPositions: 5,
  sizing: { kind: "risk", riskPercent: 1 },
  positionCapPercent: 50,
  turnoverLimitPercent: 0,
  breadthMin: 0,
  maxHoldDays: 0,
  maxNewPerDay: 5,
  ...over,
});
const candidate = (symbol, pos, i, rs = 90) => ({ symbol, pos, i, rs, pivot: null });
const run = (m, s, cands, from = 0, to = null) => simulate(m.history, m.derived, s, cands, from, to ?? m.history.calendar.length - 1);

test("buys the open after the signal and sells at the target: 2R is two times the amount risked", () => {
  // Flat at 100, then the day after the signal opens at 100, rises, and trades up to 125 (the target is 120).
  const m = market({ AAA: [...flat(100, 5), [100, 105, 99, 104], [104, 125, 103, 124]] });
  const out = run(m, settings(), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades.length, 1);
  const t = out.trades[0];
  assert.equal(t.entryPrice, 100);
  assert.equal(t.exitPrice, 120);
  assert.equal(t.exitReason, "target");
  // 1% of 10,00,000 at risk, 10 a share: 1,000 shares; +20 each.
  assert.equal(t.quantity, 1000);
  assert.equal(t.pnl, 20_000);
  assert.ok(Math.abs(t.r - 2) < 1e-9);
});

test("the entry never uses the signal day's close: it is the next session's open", () => {
  const m = market({ AAA: [...flat(100, 4), [100, 100, 100, 100], [103, 104, 102, 103], [103, 104, 102, 103]] });
  const out = run(m, settings({ exit: { kind: "stop" } }), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades[0].entryPrice, 103);
});

test("a gap below the stop sells at the open, a loss bigger than one R", () => {
  const m = market({ AAA: [...flat(100, 5), [100, 101, 99, 100], [80, 85, 79, 82]] });
  const out = run(m, settings(), [candidate("AAA", 4, 4)]);
  const t = out.trades[0];
  assert.equal(t.exitReason, "stop");
  assert.equal(t.exitPrice, 80);
  assert.ok(t.r < -1.5, `R was ${t.r}`);
});

test("an intraday stop sells at the stop price, exactly one R", () => {
  const m = market({ AAA: [...flat(100, 5), [100, 101, 95, 99], [99, 100, 88, 90]] });
  const out = run(m, settings(), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades[0].exitPrice, 90);
  assert.ok(Math.abs(out.trades[0].r + 1) < 1e-9);
});

test("costs are charged on both the entry and the exit", () => {
  const m = market({ AAA: [...flat(100, 5), [100, 125, 99, 124]] });
  const out = run(m, settings({ costPercent: 0.5 }), [candidate("AAA", 4, 4)]);
  const t = out.trades[0];
  const gross = t.quantity * 20;
  const costs = 0.005 * t.quantity * (100 + 120);
  assert.ok(Math.abs(t.pnl - (gross - costs)) < 1e-6);
});

test("with room for two positions, the two best RS are bought", () => {
  const bars = [...flat(100, 5), [100, 101, 99, 100], [100, 101, 99, 100]];
  const m = market({ AAA: bars, BBB: bars, CCC: bars });
  const out = run(m, settings({ maxPositions: 2, exit: { kind: "stop" } }), [candidate("AAA", 4, 4, 70), candidate("BBB", 4, 4, 95), candidate("CCC", 4, 4, 85)]);
  assert.deepEqual(out.trades.map((t) => t.symbol).sort(), ["BBB", "CCC"]);
});

test("the breadth gate blocks entries below the threshold and allows them at it", () => {
  const bars = [...flat(100, 5), [100, 101, 99, 100], [100, 101, 99, 100]];
  const blocked = run(market({ AAA: bars }, { breadth: 40 }), settings({ breadthMin: 60 }), [candidate("AAA", 4, 4)]);
  assert.equal(blocked.trades.length, 0);
  const allowed = run(market({ AAA: bars }, { breadth: 60 }), settings({ breadthMin: 60 }), [candidate("AAA", 4, 4)]);
  assert.equal(allowed.trades.length, 1);
});

test("the liquidity limit caps the size at a share of the stock's daily traded value", () => {
  const bars = [...flat(100, 5), [100, 101, 99, 100], [100, 101, 99, 100]];
  // 0.0625 Cr a day (exact in float32) is Rs 6,25,000; 10% of that is Rs 62,500, so 625 shares at Rs 100 (risk size alone would be 1,000).
  const out = run(market({ AAA: bars }, { turn: 0.0625 }), settings({ turnoverLimitPercent: 10, exit: { kind: "stop" } }), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades[0].quantity, 625);
});

test("equal-money sizing splits the account across the position limit", () => {
  const bars = [...flat(100, 5), [100, 101, 99, 100], [100, 101, 99, 100]];
  const out = run(market({ AAA: bars }), settings({ sizing: { kind: "equal" }, maxPositions: 4, positionCapPercent: 100, exit: { kind: "stop" } }), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades[0].quantity, 2500);
});

test("a position still open at the end is closed at the last close and the account settles to cash", () => {
  const m = market({ AAA: [...flat(100, 5), [100, 101, 99, 100], [100, 108, 99, 106]] });
  const out = run(m, settings({ exit: { kind: "stop" } }), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades[0].exitReason, "end");
  assert.equal(out.trades[0].exitPrice, 106);
  assert.ok(Math.abs(out.account[out.account.length - 1] - (1_000_000 + out.trades[0].pnl)) < 1e-6);
});

test("a close under the trailing average exits at the next open", () => {
  // Rising to 110, closing under the 3-day average, then opening at 100 the next day.
  const bars = [...flat(100, 5), [100, 101, 99, 100], [101, 111, 100, 110], [110, 112, 109, 111], [111, 112, 98, 100], [100, 101, 99, 100]];
  const out = run(market({ AAA: bars }), settings({ exit: { kind: "ma", type: "sma", period: 3, when: "next-open" } }), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades[0].exitReason, "trail");
  assert.equal(out.trades[0].exitPrice, 100);
});

test("a time limit sells at the close after that many sessions", () => {
  const bars = [...flat(100, 5), ...Array.from({ length: 12 }, () => [100, 102, 99, 101])];
  const out = run(market({ AAA: bars }), settings({ exit: { kind: "stop" }, maxHoldDays: 5 }), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades[0].exitReason, "time");
  assert.equal(out.trades[0].holdDays, 5);
});

test("a stock is not bought twice while it is held", () => {
  const bars = [...flat(100, 5), ...Array.from({ length: 6 }, () => [100, 101, 99, 100])];
  const out = run(market({ AAA: bars }), settings({ exit: { kind: "stop" } }), [candidate("AAA", 4, 4), candidate("AAA", 5, 5), candidate("AAA", 6, 6)]);
  assert.equal(out.trades.length, 1);
});

test("money in trades is the value of open positions at each close, and nothing once they are sold", () => {
  // Bought at the open of day 5 (100), closes at 104 then hits the 2R target (120) on day 6.
  const m = market({ AAA: [...flat(100, 5), [100, 105, 99, 104], [104, 125, 103, 124], [124, 125, 123, 124]] });
  const out = run(m, settings(), [candidate("AAA", 4, 4)]);
  assert.equal(out.deployed.length, out.account.length);
  assert.equal(out.deployed[4], 0);
  assert.equal(out.deployed[5], 1000 * 104);
  assert.equal(out.deployed[6], 0);
  assert.ok(out.account.every((v, i) => v >= out.deployed[i]));
});

test("break-even: after a close well above the buy price, a fall back to the buy price exits flat instead of at the original stop", () => {
  const bars = [...flat(100, 5), [100, 101, 99, 100], [100, 113, 100, 112], [112, 113, 99, 100], [100, 101, 99, 100]];
  const plain = run(market({ AAA: bars }), settings({ exit: { kind: "stop" } }), [candidate("AAA", 4, 4)]);
  const be = run(market({ AAA: bars }), settings({ exit: { kind: "stop" }, breakEvenAfterPercent: 10 }), [candidate("AAA", 4, 4)]);
  assert.equal(plain.trades[0].exitReason, "end");
  assert.equal(be.trades[0].exitReason, "stop");
  assert.equal(be.trades[0].exitPrice, 100);
  assert.ok(Math.abs(be.trades[0].r) < 1e-9);
});

test("time stop: a stock that has not gained enough after the set sessions is sold at that close", () => {
  const bars = [...flat(100, 5), ...Array.from({ length: 12 }, () => [100, 102, 99, 101])];
  const out = run(market({ AAA: bars }), settings({ exit: { kind: "stop" }, timeStop: { days: 6, minGainPercent: 3 } }), [candidate("AAA", 4, 4)]);
  assert.equal(out.trades[0].exitReason, "time");
  assert.equal(out.trades[0].holdDays, 6);
  const gained = run(market({ AAA: [...flat(100, 5), [100, 101, 99, 100], ...Array.from({ length: 10 }, () => [105, 106, 104, 105])] }), settings({ exit: { kind: "stop" }, timeStop: { days: 6, minGainPercent: 3 } }), [candidate("AAA", 4, 4)]);
  assert.notEqual(gained.trades[0].exitReason, "time");
});

test("drawdown brake: new positions are sized down while the account is below its peak", () => {
  // AAA is bought, then falls 8% (account down ~4%); BBB is bought on that day with the brake on.
  const a = [...flat(100, 5), [100, 100, 100, 100], [92, 92, 92, 92], [92, 92, 92, 92]];
  const b = [...flat(100, 7), [100, 100, 100, 100], [100, 100, 100, 100]];
  const m = () => market({ AAA: a, BBB: b });
  const cands = [candidate("AAA", 4, 4), candidate("BBB", 6, 6)];
  const normal = run(m(), settings({ stop: { kind: "percent", percent: 20 }, exit: { kind: "stop" }, sizing: { kind: "equal" }, maxPositions: 2, positionCapPercent: 100 }), cands);
  const braked = run(m(), settings({ stop: { kind: "percent", percent: 20 }, exit: { kind: "stop" }, sizing: { kind: "equal" }, maxPositions: 2, positionCapPercent: 100, drawdownBrake: { percent: 3, factor: 0.5 } }), cands);
  const q = (out) => out.trades.find((t) => t.symbol === "BBB").quantity;
  assert.equal(q(braked), Math.floor(q(normal) * 0.5));
});

test("add-on: a winner that closes +10% gets half its size again at the next open, and the profit counts both lots", () => {
  // Buy 1,000 at 100 (1% risk, 10% stop). Close 112 on day 5 (+12%), add 500 at the next open (112), end at 130.
  const bars = [...flat(100, 5), [100, 101, 99, 100], [100, 113, 100, 112], [112, 131, 111, 130]];
  const plain = run(market({ AAA: bars }), settings({ exit: { kind: "stop" } }), [candidate("AAA", 4, 4)]);
  const added = run(market({ AAA: bars }), settings({ exit: { kind: "stop" }, addOn: { afterPercent: 10, fraction: 0.5 } }), [candidate("AAA", 4, 4)]);
  assert.equal(plain.trades[0].quantity, 1000);
  assert.equal(plain.trades[0].pnl, 30_000);
  assert.equal(added.trades[0].quantity, 1500);
  assert.equal(added.trades[0].pnl, 1000 * 30 + 500 * 18);
  assert.ok(Math.abs(added.trades[0].r - 39_000 / (1000 * 10)) < 1e-9);
});

test("positions still held on the last day are reported with their stop, exit level and marked value", () => {
  const bars = [...flat(100, 5), [100, 101, 99, 100], [100, 108, 99, 106]];
  const out = run(market({ AAA: bars }), settings({ exit: { kind: "ma", type: "sma", period: 3, when: "close" }, addOn: { afterPercent: 20, fraction: 1 } }), [candidate("AAA", 4, 4)]);
  assert.equal(out.openAtEnd.length, 1);
  const p = out.openAtEnd[0];
  assert.equal(p.symbol, "AAA");
  assert.equal(p.entryPrice, 100);
  assert.equal(p.last, 106);
  assert.equal(p.stop, 90);
  assert.equal(p.added, false);
  assert.equal(p.addAt, 120);
  assert.ok(p.exitLevel > 100 && p.exitLevel < 106);
  // 1,000 shares bought at 100 and marked at 106: cash 900,000 + 1,000 × 106.
  assert.ok(Math.abs(out.markedValue - 1_006_000) < 1e-6);
});

test("a buy is skipped when the cash left allows less than half the size the rules want", () => {
  // Two stocks signal on the same day. Equal sizing wants 2,500 shares of each at 100 (quarter of the account);
  // the cap lets the first take 40%, leaving 60% of cash, which still covers the second in full.
  const bars = [...flat(100, 5), [100, 101, 99, 100], [100, 101, 99, 100]];
  const m = () => market({ AAA: bars, BBB: bars });
  const s = (over) => settings({ sizing: { kind: "equal" }, maxPositions: 2, positionCapPercent: 100, exit: { kind: "stop" }, ...over });
  assert.equal(run(m(), s({}), [candidate("AAA", 4, 4, 95), candidate("BBB", 4, 4, 90)]).trades.length, 2);
  // With almost all the cash already spent (a 90% account-wide commitment first), the second is only a sliver and is skipped.
  const big = settings({ sizing: { kind: "equal" }, maxPositions: 1, positionCapPercent: 100, exit: { kind: "stop" }, maxNewPerDay: 5 });
  const out = run(m(), { ...big, maxPositions: 5 }, [candidate("AAA", 4, 4, 95)]);
  assert.equal(out.trades.length, 1);
});

import { parseSettings } from "../src/lib/backtest/validate.ts";

test("reality check, slippage: every entry and exit is a little worse, so the same trade earns less", () => {
  const m = market({ AAA: [...flat(100, 5), [100, 125, 99, 124]] });
  const plain = run(m, settings(), [candidate("AAA", 4, 4)]).trades[0];
  const worse = run(m, settings({ stress: { slippagePercent: 1, gapShare: 0, gapLossPercent: 25, seed: 1 } }), [candidate("AAA", 4, 4)]).trades[0];
  assert.ok(Math.abs(worse.entryPrice - 101) < 1e-9, `entry ${worse.entryPrice}`);
  // The target is measured from the slipped entry (101, risk 10.1, target 121.2), then the sale itself is 1% worse.
  assert.ok(Math.abs(worse.exitPrice - 121.2 * 0.99) < 1e-6, `exit ${worse.exitPrice}`);
  assert.ok(worse.pnl < plain.pnl);
});

test("reality check, gaps: with every stop gapping, a stop-out loses the set percent of the buy price, far more than one R", () => {
  const m = market({ AAA: [...flat(100, 5), [100, 101, 95, 99], [99, 100, 88, 90]] });
  const gap = { slippagePercent: 0, gapShare: 1, gapLossPercent: 30, seed: 3 };
  const t = run(m, settings({ stress: gap }), [candidate("AAA", 4, 4)]).trades[0];
  assert.equal(t.exitReason, "stop");
  assert.ok(Math.abs(t.exitPrice - 70) < 1e-9, `exit ${t.exitPrice}`);
  assert.ok(t.r < -2.5, `R ${t.r}`);
  // No gap share: the stop fills at the stop, exactly one R.
  const none = run(m, settings({ stress: { ...gap, gapShare: 0, slippagePercent: 0.0001 } }), [candidate("AAA", 4, 4)]).trades[0];
  assert.ok(Math.abs(none.r + 1) < 1e-3);
});

test("reality check, gaps: a stop that already gapped worse than the set loss keeps its own worse price", () => {
  const m = market({ AAA: [...flat(100, 5), [100, 101, 99, 100], [60, 62, 58, 61]] });
  const t = run(m, settings({ stress: { slippagePercent: 0, gapShare: 1, gapLossPercent: 30, seed: 3 } }), [candidate("AAA", 4, 4)]).trades[0];
  assert.equal(t.exitPrice, 60);
});

test("reality check: the same seed picks the same stops every time, and a share of 0.5 hits some but not all", () => {
  const bars = (i) => [...flat(100, 5 + i * 0), [100, 101, 95, 99], [99, 100, 88, 90]];
  const names = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`S${i}`, bars(i)]));
  const cands = Object.keys(names).map((s) => candidate(s, 4, 4));
  const stress = { slippagePercent: 0, gapShare: 0.5, gapLossPercent: 30, seed: 11 };
  const a = run(market(names), settings({ stress, maxPositions: 20, maxNewPerDay: 20, positionCapPercent: 10 }), cands).trades.map((t) => Math.round(t.exitPrice));
  const b = run(market(names), settings({ stress, maxPositions: 20, maxNewPerDay: 20, positionCapPercent: 10 }), cands).trades.map((t) => Math.round(t.exitPrice));
  assert.deepEqual(a, b);
  assert.ok(a.includes(70) && a.includes(90), `exits ${a.join(",")}`);
});

test("stress settings from the browser are clamped, and absent or zero stress adds nothing", () => {
  assert.equal(parseSettings({}).stress, undefined);
  assert.equal(parseSettings({ stress: { slippagePercent: 0, gapShare: 0 } }).stress, undefined);
  const s = parseSettings({ stress: { slippagePercent: 99, gapShare: 9, gapLossPercent: 1, seed: -4 } }).stress;
  assert.deepEqual(s, { slippagePercent: 5, gapShare: 0.5, gapLossPercent: 5, seed: 1 });
  assert.deepEqual(parseSettings({ stress: { slippagePercent: 1 } }).stress, { slippagePercent: 1, gapShare: 0, gapLossPercent: 25, seed: 7 });
});

test("sector limit: at most N open positions in one sector, best RS first; unknown sectors are not limited", () => {
  const up = [...flat(100, 5), [100, 101, 99, 100], [100, 101, 99, 100]];
  const m = market({ AAA: up, BBB: up, CCC: up, DDD: up });
  const sectors = { AAA: "Banks", BBB: "Banks", CCC: "Banks", DDD: null };
  const sectorOf = (symbol) => sectors[symbol] ?? null;
  const cands = [candidate("AAA", 4, 4, 95), candidate("BBB", 4, 4, 90), candidate("CCC", 4, 4, 85), candidate("DDD", 4, 4, 80)];
  const bought = (over) => simulate(m.history, m.derived, settings(over), cands, 0, m.history.calendar.length - 1, sectorOf).trades.map((t) => t.symbol).sort();
  assert.deepEqual(bought({}), ["AAA", "BBB", "CCC", "DDD"]);
  assert.deepEqual(bought({ maxPerSector: 2 }), ["AAA", "BBB", "DDD"]);
  assert.deepEqual(bought({ maxPerSector: 1 }), ["AAA", "DDD"]);
  assert.equal(parseSettings({ maxPerSector: 3 }).maxPerSector, 3);
  assert.equal(parseSettings({ maxPerSector: 0 }).maxPerSector, undefined);
  assert.equal(parseSettings({}).maxPerSector, undefined);
});
