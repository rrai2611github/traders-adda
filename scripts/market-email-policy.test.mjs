import test from "node:test";
import assert from "node:assert/strict";
import { emailSlotKey } from "../src/lib/alerts/hourlyEmailFormat.ts";
import { preOpenSlotKey } from "../src/lib/alerts/preOpenEmailFormat.ts";
import { getActiveSession, getMarketStatus } from "../src/lib/market/marketHours.ts";
import { MarketEmailBlockedError, marketEmailBlockReason, marketEmailCalendarWarning, requireMarketEmailDay } from "../src/lib/alerts/marketEmailPolicy.ts";

const ist = (value) => Date.parse(`${value}+05:30`);

function withCalendarEnv(values, check) {
  const previous = { MARKET_HOLIDAYS: process.env.MARKET_HOLIDAYS, MARKET_FORCE_LIVE: process.env.MARKET_FORCE_LIVE };
  Object.assign(process.env, { MARKET_HOLIDAYS: "", MARKET_FORCE_LIVE: "0" }, values);
  try { check(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("holiday and weekend checks block both scheduled slots and normal manual sends", () => {
  withCalendarEnv({}, () => {
    for (const day of ["2026-03-03", "2026-10-02", "2026-11-07", "2026-11-08", "2026-11-10", "2026-11-24"]) {
      assert.equal(preOpenSlotKey(ist(`${day}T09:05:00`)), null, day);
      assert.equal(emailSlotKey(ist(`${day}T10:15:00`)), null, day);
      assert.throws(() => requireMarketEmailDay(ist(`${day}T10:15:00`)), MarketEmailBlockedError);
    }
    const holiday = ist("2026-11-10T10:15:00");
    assert.equal(getMarketStatus(holiday).phase, "HOLIDAY");
    assert.equal(getActiveSession(holiday).dateKey, "2026-11-09");
    assert.equal(getMarketStatus(holiday).nextTransition, ist("2026-11-11T09:15:00"));
  });
});

test("ad hoc closures supplement rather than replace the built-in NSE calendar", () => {
  withCalendarEnv({ MARKET_HOLIDAYS: " 2026-11-11,2026-11-12 " }, () => {
    for (const day of ["2026-11-10", "2026-11-11", "2026-11-12"]) {
      assert.equal(preOpenSlotKey(ist(`${day}T09:05:00`)), null);
      assert.equal(emailSlotKey(ist(`${day}T10:15:00`)), null);
      assert.throws(() => requireMarketEmailDay(ist(`${day}T10:15:00`)), /holiday/);
    }
  });
});

test("simulation cannot enable normal sends, including on an otherwise valid trading day", () => {
  withCalendarEnv({ MARKET_FORCE_LIVE: "1" }, () => {
    const tradingDay = ist("2026-11-11T10:15:00");
    assert.equal(emailSlotKey(tradingDay), null);
    assert.throws(() => requireMarketEmailDay(tradingDay), /simulated/);
    assert.throws(() => requireMarketEmailDay(ist("2026-11-10T10:15:00")), /holiday/);
  });
});

test("normal trading-day manual sends retain their ability to bypass the slot window", () => {
  withCalendarEnv({}, () => {
    for (const clock of ["08:00:00", "09:05:00", "10:15:00", "20:00:00"]) {
      const now = ist(`2026-11-11T${clock}`);
      assert.doesNotThrow(() => requireMarketEmailDay(now));
      assert.equal(marketEmailBlockReason(now), null);
    }
    assert.equal(preOpenSlotKey(ist("2026-11-11T09:05:00")), "2026-11-11:preopen");
    assert.equal(emailSlotKey(ist("2026-11-11T10:15:00")), "2026-11-11:1");
    assert.equal(emailSlotKey(ist("2026-11-11T20:00:00")), null);
  });
});

test("calendar coverage uses the IST year and warns beyond the published dates", () => {
  assert.equal(marketEmailCalendarWarning(ist("2026-12-31T23:59:59")), null);
  assert.match(marketEmailCalendarWarning(ist("2027-01-01T00:00:00")), /not 2027/);
  assert.match(marketEmailCalendarWarning(ist("2023-12-31T23:59:59")), /not 2023/);
});
