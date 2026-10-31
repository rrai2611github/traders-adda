import test from "node:test";
import assert from "node:assert/strict";
import { dataFreshness, expectedLastSession, needsCatchUp, sessionsBehind } from "../src/lib/market/freshness.ts";
import { alertKey, liveAlerts, unsentAlerts } from "../src/lib/positions/liveWatch.ts";

const at = (iso) => Date.parse(`${iso}+05:30`);

test("the session whose candle should be on file: today only after 19:00, weekends fall back to Friday", () => {
  assert.equal(expectedLastSession(at("2026-11-02T10:00:00")), "2026-10-30"); // Monday morning
  assert.equal(expectedLastSession(at("2026-11-02T19:30:00")), "2026-11-02"); // Monday evening
  assert.equal(expectedLastSession(at("2026-11-02T18:00:00")), "2026-10-30"); // still inside the grace period
  assert.equal(expectedLastSession(at("2026-10-31T10:00:00")), "2026-10-30"); // Saturday
  assert.equal(expectedLastSession(at("2026-11-01T22:00:00")), "2026-10-30"); // Sunday night
  assert.equal(expectedLastSession(at("2026-11-02T17:00:00"), 16 * 60 + 45), "2026-11-02");
});

test("sessions behind counts trading days only", () => {
  assert.equal(sessionsBehind("2026-10-30", "2026-10-30"), 0);
  assert.equal(sessionsBehind("2026-10-30", "2026-11-02"), 1);
  assert.equal(sessionsBehind("2026-10-28", "2026-10-30"), 2);
  assert.equal(sessionsBehind("2026-10-29", "2026-11-03"), 3);
  assert.equal(sessionsBehind(null, "2026-10-30"), 99);
});

test("fresh data is ok; old data is stale with a plain message; a refresh that ran means a market holiday, not a failure", () => {
  const ok = dataFreshness({ lastCandleDay: "2026-10-30", refreshedDay: "2026-10-30", now: at("2026-11-02T10:00:00") });
  assert.deepEqual([ok.state, ok.behind], ["ok", 0]);
  const stale = dataFreshness({ lastCandleDay: "2026-10-30", refreshedDay: "2026-10-30", now: at("2026-11-03T10:00:00") });
  assert.deepEqual([stale.state, stale.behind, stale.expected], ["stale", 1, "2026-11-02"]);
  assert.match(stale.message, /Price data is 1 session old \(latest 2026-10-30\)/);
  assert.match(stale.message, /npm run refresh-data/);
  // The refresh ran on Monday and found no new candle: the market was shut.
  const holiday = dataFreshness({ lastCandleDay: "2026-10-30", refreshedDay: "2026-11-02", now: at("2026-11-03T10:00:00") });
  assert.equal(holiday.state, "ok");
  const never = dataFreshness({ lastCandleDay: null, refreshedDay: null, now: at("2026-11-03T10:00:00") });
  assert.equal(never.state, "stale");
  assert.match(never.message, /missing/);
});

test("catch-up refresh: only when finished sessions are missing, and at most once an hour", () => {
  const tue = at("2026-11-03T10:00:00");
  const base = { lastCandleDay: "2026-10-30", refreshedDay: "2026-10-30", lastRunAt: null, now: tue };
  assert.equal(needsCatchUp(base), true);
  assert.equal(needsCatchUp({ ...base, lastRunAt: tue - 30 * 60_000 }), false);
  assert.equal(needsCatchUp({ ...base, lastRunAt: tue - 61 * 60_000 }), true);
  assert.equal(needsCatchUp({ ...base, lastCandleDay: "2026-11-02" }), false);
  assert.equal(needsCatchUp({ ...base, lastCandleDay: null }), false);
  // A refresh already ran on Monday after the close and found nothing new: Monday was a market holiday, so do not keep retrying.
  assert.equal(needsCatchUp({ ...base, refreshedDay: "2026-11-02" }), false);
  // Monday 17:00: the 16:45 grace has passed, so Monday's candle is expected and missing.
  assert.equal(needsCatchUp({ ...base, now: at("2026-11-02T17:00:00") }), true);
  assert.equal(needsCatchUp({ ...base, now: at("2026-11-02T16:00:00") }), false);
});

const NOW = at("2026-11-03T11:00:00");
const h = (over = {}) => ({ id: "a", symbol: "ABC", qty: 10, buyPrice: 100, buyDate: "2026-10-20", stop: 88, ...over });
const q = (ltp, ageMs = 30_000) => ({ ltp, timestamp: NOW - ageMs });
const quotes = (obj) => new Map(Object.entries(obj));

test("a price at or under the stop is the rule firing", () => {
  const items = [{ holding: h(), sma50: 95 }];
  const hit = liveAlerts(items, quotes({ ABC: q(87.5) }), NOW, false);
  assert.equal(hit.length, 1);
  assert.deepEqual([hit[0].kind, hit[0].price, hit[0].level], ["stop", 87.5, 88]);
  assert.match(hit[0].text, /ABC is trading at ₹87\.5, at or under your ₹88 stop\. The rules say you are out/);
  assert.equal(liveAlerts(items, quotes({ ABC: q(88) }), NOW, false)[0].kind, "stop");
  assert.deepEqual(liveAlerts(items, quotes({ ABC: q(88.05) }), NOW, false), []);
});

test("under the 50-day average is only a late-session heads-up, and the stop takes priority", () => {
  const items = [{ holding: h(), sma50: 95 }];
  assert.deepEqual(liveAlerts(items, quotes({ ABC: q(93) }), NOW, false), []);
  const late = liveAlerts(items, quotes({ ABC: q(93) }), NOW, true);
  assert.equal(late[0].kind, "below-50dma");
  assert.match(late[0].text, /The rule acts only if it closes there/);
  assert.equal(liveAlerts(items, quotes({ ABC: q(80) }), NOW, true).length, 1);
  assert.equal(liveAlerts(items, quotes({ ABC: q(80) }), NOW, true)[0].kind, "stop");
  assert.deepEqual(liveAlerts([{ holding: h(), sma50: null }], quotes({ ABC: q(93) }), NOW, true), []);
});

test("stale, missing, invalid or future prices and closed positions never alert", () => {
  const items = [{ holding: h(), sma50: 95 }];
  assert.deepEqual(liveAlerts(items, quotes({ ABC: q(50, 6 * 60_000) }), NOW, true), []);
  assert.deepEqual(liveAlerts(items, quotes({}), NOW, true), []);
  assert.deepEqual(liveAlerts(items, quotes({ ABC: { ltp: 0, timestamp: NOW } }), NOW, true), []);
  assert.deepEqual(liveAlerts(items, quotes({ ABC: { ltp: Number.NaN, timestamp: NOW } }), NOW, true), []);
  assert.deepEqual(liveAlerts(items, quotes({ ABC: { ltp: 50, timestamp: NOW + 10 * 60_000 } }), NOW, true), []);
  const sold = { holding: h({ sold: { date: "2026-11-01", price: 90, reason: "own-call" } }), sma50: 95 };
  assert.deepEqual(liveAlerts([sold], quotes({ ABC: q(50) }), NOW, true), []);
});

test("an alert is sent once a day per position and kind", () => {
  const items = [{ holding: h({ id: "a" }), sma50: 95 }, { holding: h({ id: "b", symbol: "XYZ" }), sma50: 95 }];
  const alerts = liveAlerts(items, quotes({ ABC: q(80), XYZ: q(80) }), NOW, true);
  assert.equal(alerts.length, 2);
  assert.equal(alertKey(alerts[0]), "a:stop");
  assert.deepEqual(unsentAlerts(alerts, ["a:stop"]).map((a) => a.symbol), ["XYZ"]);
  assert.deepEqual(unsentAlerts(alerts, ["a:stop", "b:stop"]), []);
  // A different kind for the same position is a new alert.
  assert.equal(unsentAlerts(alerts, ["a:below-50dma"]).length, 2);
});
