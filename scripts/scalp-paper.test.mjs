import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_COSTS } from "../src/lib/scalp/backtest.ts";
import { chainDate, priceDay, replayLeg, summarizePaper } from "../src/lib/scalp/paperStraddle.ts";
import { shortLegCost } from "../src/lib/scalp/premium.ts";

const DAY = "2026-10-05";
const at = (hhmm) => Date.parse(`${DAY}T${hhmm}:00+05:30`);
const minute = (i) => at("09:15") + i * 60_000;

/** One option's session: `price(i)` per minute from 09:15, high = price + `wick`. */
function bars(price, { wick = 0.5, upTo = 374 } = {}) {
  return Array.from({ length: upTo + 1 }, (_, i) => {
    const p = price(i);
    return { t: minute(i), open: p, high: p + wick, low: p - wick, close: p, volume: 10 };
  });
}

test("a quiet leg is sold at the 09:20 open and bought back at the 15:15 open", () => {
  const leg = replayLeg(bars((i) => 100 - i * 0.1), DAY);
  assert.equal(leg.status, "close");
  assert.equal(leg.soldAt, at("09:20"));
  assert.equal(leg.sold, 99.5);
  assert.equal(leg.boughtAt, at("15:15"));
  assert.ok(Math.abs(leg.bought - (100 - 360 * 0.1)) < 1e-9);
});

test("a leg is stopped at 25% above the sale, or at the open when it gaps past", () => {
  const rising = replayLeg(bars((i) => (i < 5 ? 100 : 100 + (i - 5) * 0.4)), DAY);
  assert.equal(rising.status, "stop");
  assert.equal(rising.bought, 125);
  const gap = replayLeg(bars((i) => (i < 30 ? 100 : 140)), DAY);
  assert.equal(gap.status, "stop");
  assert.equal(gap.bought, 140);
  assert.equal(gap.boughtAt, minute(30));
});

test("a leg stays open, marked at the last close, before 15:15", () => {
  const leg = replayLeg(bars((i) => 100 - i * 0.05, { upTo: 120 }), DAY);
  assert.equal(leg.status, "open");
  assert.equal(leg.bought, null);
  assert.ok(Math.abs(leg.mark - (100 - 120 * 0.05)) < 1e-9);
  assert.equal(replayLeg(bars(() => 100, { upTo: 3 }), DAY), null);
});

test("day P&L and summary use real prices, costs and the model comparison", () => {
  const c = DEFAULT_COSTS.NIFTY;
  const legs = [
    { side: "CE", symbol: "x", sold: 100, soldAt: 0, bought: 60, boughtAt: 1, status: "close", mark: 60, modelSold: 110 },
    { side: "PE", symbol: "y", sold: 90, soldAt: 0, bought: 112.5, boughtAt: 1, status: "stop", mark: 112.5, modelSold: 90 },
  ];
  const day = priceDay(legs, c);
  assert.equal(day.grossRs, (40 - 22.5) * 65);
  assert.ok(Math.abs(day.netRs - (day.grossRs - shortLegCost(c, 100, 60) - shortLegCost(c, 90, 112.5))) < 1e-9);
  const record = (d, netRs, status = "closed") => ({ index: "NIFTY", day: d, expiry: d, strike: 1, spotAtEntry: 1, vixAtEntry: 1, status, legs, grossRs: netRs, netRs, updatedAt: 0 });
  const s = summarizePaper([record("2026-10-01", 500), record("2026-10-02", -800), record("2026-10-05", 200), record("2026-10-06", 999, "open")]);
  assert.equal(s.closedDays, 3);
  assert.equal(s.winDays, 2);
  assert.equal(s.netRs, -100);
  assert.equal(s.maxDrawdown, 800);
  assert.equal(s.stops, 3);
  assert.ok(Math.abs(s.realToModel - (100 / 110 + 1) / 2) < 1e-9);
  assert.equal(chainDate("06-10-2026"), "2026-10-06");
});
