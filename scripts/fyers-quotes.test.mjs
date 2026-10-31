import test from "node:test";
import assert from "node:assert/strict";
import { FYERS_INDEX_SYMBOLS, fromFyersSymbol, normalizeFyersQuote, toFyersSymbol, tradeTime } from "../src/lib/market/providers/fyersQuotes.ts";

const base = { name: "State Bank of India", kind: "EQUITY", sector: "Financial Services" };
const row = (v, s = "ok") => ({ n: "NSE:SBIN-EQ", s, v });
const now = Date.parse("2026-10-13T05:00:00Z");

test("symbols map both ways, indices included", () => {
  assert.equal(toFyersSymbol("SBIN"), "NSE:SBIN-EQ");
  assert.equal(toFyersSymbol("SBIN", "BE"), "NSE:SBIN-BE");
  assert.equal(toFyersSymbol("BANKNIFTY"), "NSE:NIFTYBANK-INDEX");
  assert.equal(fromFyersSymbol("NSE:SBIN-EQ"), "SBIN");
  assert.equal(fromFyersSymbol("NSE:ABC-SM"), "ABC");
  for (const [app, fy] of Object.entries(FYERS_INDEX_SYMBOLS)) assert.equal(fromFyersSymbol(fy), app);
});

test("a Fyers quote row becomes the app's Quote", () => {
  const q = normalizeFyersQuote("SBIN", base, row({
    lp: 812.456, ch: 6.2, chp: 0.77, open_price: 806, high_price: 815.5, low_price: 804.1, prev_close_price: 806.25, volume: 5_234_100, tt: now / 1000 - 3,
  }), now);
  assert.deepEqual(q, {
    symbol: "SBIN", name: "State Bank of India", kind: "EQUITY", sector: "Financial Services",
    ltp: 812.46, previousClose: 806.25, change: 6.2, changePercent: 0.77, open: 806, high: 815.5, low: 804.1, volume: 5_234_100, timestamp: now - 3000,
  });
});

test("an errored row, a missing price or no previous close is refused, never invented", () => {
  assert.equal(normalizeFyersQuote("SBIN", base, row({ errmsg: "invalid symbol" }, "error"), now), null);
  assert.equal(normalizeFyersQuote("SBIN", base, row({ lp: 0, prev_close_price: 800 }), now), null);
  assert.equal(normalizeFyersQuote("SBIN", base, row({ lp: 810 }), now), null);
  assert.equal(normalizeFyersQuote("SBIN", base, {}, now), null);
});

test("change is derived when Fyers omits it, and open/high/low fall back to the last price", () => {
  const q = normalizeFyersQuote("SBIN", base, row({ lp: 810, prev_close_price: 800 }), now);
  assert.equal(q.change, 10);
  assert.equal(q.changePercent, 1.25);
  assert.deepEqual([q.open, q.high, q.low, q.volume], [810, 810, 810, 0]);
  assert.equal(q.timestamp, now, "an undated row counts as current");
});

test("trade times: Fyers' tt is the trading date, so today means fetched now and an earlier day means that day's close", () => {
  const today = Date.parse("2026-10-14T00:00:00Z") / 1000; // what Fyers sent on 14 Oct: the date at 00:00 UTC
  const nowToday = Date.parse("2026-10-14T05:00:00Z");
  assert.equal(tradeTime(today, nowToday), nowToday, "today's quote is as fresh as the fetch");
  const yesterday = Date.parse("2026-10-13T00:00:00Z") / 1000;
  assert.equal(tradeTime(yesterday, nowToday), Date.parse("2026-10-13T10:00:00Z"), "an earlier day is stamped 15:30 IST that day");
  assert.equal(tradeTime(today + 86_400 * 3, nowToday), nowToday, "a future date is clamped to now");
});

test("trade times: a tt that carries a time of day is used as it is, with IST-shifted and future stamps corrected", () => {
  assert.equal(tradeTime(now / 1000 - 10, now), now - 10_000);
  assert.equal(tradeTime(now - 10_000, now), now - 10_000);
  assert.equal(tradeTime(now / 1000 + 19_800 - 5, now), now - 5_000, "IST-shifted stamp is corrected");
  assert.equal(tradeTime(now / 1000 + 7200 + 17, now), now, "any other future time is clamped to now");
  assert.equal(tradeTime(null, now), now);
});
