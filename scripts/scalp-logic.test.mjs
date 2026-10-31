import test from "node:test";
import assert from "node:assert/strict";
import {
  ema, futuresSymbol, latestSession, openingRange, orbSignals, parseCandles, parseChain, pickLeg, previousSession, vwap,
} from "../src/lib/scalp/scalpLogic.ts";

const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+05:30`);
const bar = (t, close, volume = 0, spread = 0.5) => ({ t, open: close, high: close + spread, low: close - spread, close, volume });
const minutes = (day, start, count) => {
  const base = at(day, start);
  return Array.from({ length: count }, (_, i) => base + i * 60_000);
};

const PREV = "2026-10-05";
const DAY = "2026-10-06";

/**
 * Flat previous day at 100, a 09:15–09:29 range of 99.5–100.5, a drift toward
 * the range edge from 09:30, then the 09:35 close crossing it. `dir` −1 mirrors it.
 */
function session(dir = 1, tail = []) {
  const prev = minutes(PREV, "14:30", 60).map((t) => bar(t, 100));
  const orb = minutes(DAY, "09:15", 15).map((t) => bar(t, 100));
  const drift = minutes(DAY, "09:30", 5).map((t, i) => bar(t, 100 + dir * 0.1 * (i + 1)));
  const breakout = [bar(at(DAY, "09:35"), 100 + dir * 0.9)];
  const rest = tail.map((close, i) => bar(at(DAY, "09:36") + i * 60_000, 100 + dir * close));
  return [...prev, ...orb, ...drift, ...breakout, ...rest];
}

test("ema seeds with a simple average then smooths", () => {
  const out = ema([1, 2, 3, 4].map((c, i) => bar(i * 60_000, c)), 3);
  assert.deepEqual(out, [null, null, 2, 3]);
});

test("vwap resets each IST day and is null without volume", () => {
  const bars = [
    bar(at(PREV, "15:28"), 10, 100), bar(at(PREV, "15:29"), 20, 100),
    bar(at(DAY, "09:15"), 50, 0), bar(at(DAY, "09:16"), 40, 10),
  ];
  assert.deepEqual(vwap(bars), [10, 15, null, 40]);
});

test("latest and previous session split on IST days", () => {
  const bars = session();
  assert.equal(latestSession(bars)[0].t, at(DAY, "09:15"));
  assert.deepEqual(previousSession(bars), { high: 100.5, low: 99.5, close: 100 });
});

test("opening range covers the first 15 minutes only", () => {
  const range = openingRange(session(), 15, at(DAY, "09:40"));
  assert.deepEqual(range, { high: 100.5, low: 99.5, endsAt: at(DAY, "09:30"), complete: true });
  const forming = openingRange(minutes(DAY, "09:15", 5).map((t) => bar(t, 100)), 15, at(DAY, "09:20"));
  assert.equal(forming.complete, false);
});

test("orbSignals flags a CE setup when the close crosses the range high with EMAs aligned", () => {
  const signals = orbSignals({ spot: session(1) }, { stopPoints: 20 });
  assert.equal(signals.length, 1);
  const [s] = signals;
  assert.equal(s.t, at(DAY, "09:35"));
  assert.equal(s.side, "CE");
  assert.equal(s.entry, 100.9);
  assert.equal(s.stop, 80.9);
  assert.equal(s.target, 130.9);
  assert.ok(s.reasons.includes("futures VWAP n/a"));
  assert.ok(s.reasons.includes("CE VWAP n/a"));
});

test("orbSignals mirrors to a PE setup on a downside break", () => {
  const [s] = orbSignals({ spot: session(-1) }, { stopPoints: 20 });
  assert.equal(s.side, "PE");
  assert.equal(s.stop, s.entry + 20);
  assert.equal(s.target, s.entry - 30);
});

test("futures below VWAP vetoes a CE setup; above confirms it", () => {
  const spot = session(1);
  const fut = (lastClose) => [bar(at(DAY, "09:15"), 200, 1000), bar(at(DAY, "09:35"), lastClose, 10)];
  assert.equal(orbSignals({ spot, fut: fut(150) }, { stopPoints: 20 }).length, 0);
  const [s] = orbSignals({ spot, fut: fut(250) }, { stopPoints: 20 });
  assert.ok(s.reasons.includes("Futures above VWAP"));
});

test("option leg below its own VWAP vetoes the setup", () => {
  const spot = session(1);
  const ce = [bar(at(DAY, "09:15"), 80, 1000), bar(at(DAY, "09:35"), 60, 10)];
  assert.equal(orbSignals({ spot, ce }, { stopPoints: 20 }).length, 0);
});

test("no setups at or after the last entry minute", () => {
  assert.equal(orbSignals({ spot: session(1) }, { stopPoints: 20, lastEntryMin: 9 * 60 + 35 }).length, 0);
});

test("cooldown and the daily cap limit repeat setups", () => {
  // Falls back inside the range at 09:36, crosses again at 09:37.
  const spot = session(1, [0.3, 1.2]);
  assert.equal(orbSignals({ spot }, { stopPoints: 20 }).length, 1);
  assert.equal(orbSignals({ spot }, { stopPoints: 20, cooldownMin: 0 }).length, 2);
  assert.equal(orbSignals({ spot }, { stopPoints: 20, cooldownMin: 0, maxPerDay: 1 }).length, 1);
});

const chainData = {
  callOi: 0,
  putOi: 0,
  expiryData: [
    { date: "07-10-2026", expiry: Date.parse("2026-10-07T15:30:00+05:30") / 1000, expiry_flag: "W" },
    { date: "29-09-2026", expiry: Date.parse("2026-09-29T15:30:00+05:30") / 1000, expiry_flag: "M" },
    { date: "27-10-2026", expiry: Date.parse("2026-10-27T15:30:00+05:30") / 1000, expiry_flag: "M" },
  ],
  indiavixData: { ltp: 13.4 },
  optionsChain: [
    { symbol: "NSE:NIFTY50-INDEX", option_type: "", strike_price: -1, ltp: 25040 },
    ...[24900, 25000, 25100].flatMap((strike) => [
      { symbol: `NSE:NIFTY2610${strike}CE`, option_type: "CE", strike_price: strike, ltp: 100, oi: strike === 25100 ? 900 : 300, oich: 10, volume: 5 },
      { symbol: `NSE:NIFTY2610${strike}PE`, option_type: "PE", strike_price: strike, ltp: 90, oi: strike === 24900 ? 1200 : 400, oich: -5, volume: 5 },
    ]),
  ],
};

test("parseChain reads spot, ATM, OI totals, PCR, max-OI strikes and VIX", () => {
  const chain = parseChain(chainData);
  assert.equal(chain.spot, 25040);
  assert.equal(chain.atm, 25000);
  assert.deepEqual(chain.strikes, [24900, 25000, 25100]);
  assert.equal(chain.callOi, 1500);
  assert.equal(chain.putOi, 2000);
  assert.equal(Math.round(chain.pcr * 100) / 100, 1.33);
  assert.equal(chain.maxCallOiStrike, 25100);
  assert.equal(chain.maxPutOiStrike, 24900);
  assert.equal(chain.vix, 13.4);
  assert.equal(parseChain(null).atm, null);
});

test("pickLeg moves out of the money per side and clamps at the edges", () => {
  const chain = parseChain(chainData);
  assert.equal(pickLeg(chain, "CE", 0).strike, 25000);
  assert.equal(pickLeg(chain, "CE", 1).strike, 25100);
  assert.equal(pickLeg(chain, "PE", 1).strike, 24900);
  assert.equal(pickLeg(chain, "PE", -1).strike, 25100);
  assert.equal(pickLeg(chain, "CE", 5).strike, 25100);
});

test("futuresSymbol uses the first monthly expiry not yet passed", () => {
  const { expiries } = parseChain(chainData);
  assert.equal(futuresSymbol("NIFTY", expiries, at(DAY, "10:00")), "NSE:NIFTY26OCTFUT");
  assert.equal(futuresSymbol("BANKNIFTY", expiries, at("2026-09-29", "10:00")), "NSE:BANKNIFTY26SEPFUT");
  assert.equal(futuresSymbol("NIFTY", [], at(DAY, "10:00")), null);
});

test("parseCandles converts seconds to ms, sorts and drops bad rows", () => {
  const bars = parseCandles([[200, 1, 2, 0.5, 1.5, 10], [100, 1, 2, 0.5, 1.5], ["x"], [300, 1, 0.5, 2, 1, 1]]);
  assert.deepEqual(bars.map((b) => b.t), [100_000, 200_000]);
  assert.equal(bars[0].volume, 0);
  assert.deepEqual(parseCandles(undefined), []);
});
