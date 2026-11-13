import test from "node:test";
import assert from "node:assert/strict";
import { collectHourlyDevelopments, detectHourlyDevelopments, withoutPreviouslySentEvents } from "../src/lib/alerts/hourlyIntraday.ts";

const ist = (value) => Date.parse(`${value}+05:30`);
const sessionDay = "2026-09-28";
const priorDay = [{
  t: ist("2026-09-25T09:15:00"),
  open: 100, high: 110, low: 90, close: 100, volume: 1000,
}];
const hourly = [
  { t: ist(`${sessionDay}T09:15:00`), open: 100, high: 105, low: 95, close: 100, volume: 100 },
  { t: ist(`${sessionDay}T10:15:00`), open: 100, high: 112, low: 100, close: 111, volume: 100 },
];

test("reports confirmed prior-day-high and hourly-VWAP closes with bar-close time", () => {
  const result = detectHourlyDevelopments("AAA", hourly, priorDay, ist(`${sessionDay}T11:16:00`));
  assert.equal(result.available, true);
  assert.equal(result.stale, false);
  assert.deepEqual(result.events.map((event) => event.kind), ["prior-high-cross", "vwap-reclaim"]);
  assert.ok(result.events.every((event) => event.eventAt === ist(`${sessionDay}T11:15:00`)));
  assert.ok(result.events.every((event) => event.close === 111));
});

test("does not call an incomplete hourly bar a cross", () => {
  const result = detectHourlyDevelopments("AAA", hourly, priorDay, ist(`${sessionDay}T10:45:00`));
  assert.deepEqual(result.events, []);
  assert.equal(result.available, false);
  assert.equal(result.stale, false);
});

test("marks old completed hourly bars stale and ignores them", () => {
  const result = detectHourlyDevelopments("AAA", hourly, priorDay, ist(`${sessionDay}T12:31:00`));
  assert.deepEqual(result.events, []);
  assert.equal(result.stale, true);
  assert.equal(result.available, false);
});

test("does not claim coverage without prior daily levels or two hourly bars", () => {
  const now = ist(`${sessionDay}T11:16:00`);
  assert.equal(detectHourlyDevelopments("AAA", hourly, [], now).available, false);
  assert.equal(detectHourlyDevelopments("AAA", hourly.slice(1), priorDay, now).available, false);
});

test("checks only current-session candidates and keeps failures visible in coverage", async () => {
  const now = ist(`${sessionDay}T11:16:00`);
  const result = await collectHourlyDevelopments([
    { symbol: "AAA", dailyCandles: priorDay },
    { symbol: "BBB", dailyCandles: priorDay },
  ], now, async (symbol) => {
    if (symbol === "BBB") throw new Error("provider unavailable");
    return hourly;
  });
  assert.equal(result.status, "partial");
  assert.equal(result.checked, 1);
  assert.equal(result.unavailable, 1);
  assert.equal(result.events.length, 2);
});

test("does not fetch or label data as live when the market is closed", async () => {
  const result = await collectHourlyDevelopments(
    [{ symbol: "AAA", dailyCandles: priorDay }],
    ist(`${sessionDay}T16:00:00`),
    async () => {
      throw new Error("must not fetch");
    },
  );
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /Market is closed/);
});

test("suppresses previously emailed events but preserves their coverage state", () => {
  const summary = {
    status: "available",
    checked: 1,
    stale: 0,
    unavailable: 0,
    events: [
      { symbol: "AAA", kind: "prior-high-cross", eventAt: 1, close: 111, level: 110, eventKey: "sent" },
      { symbol: "BBB", kind: "vwap-reclaim", eventAt: 1, close: 111, level: 105, eventKey: "new" },
    ],
  };
  const filtered = withoutPreviouslySentEvents(summary, new Set(["sent"]));
  assert.deepEqual(filtered.summary.events.map((event) => event.eventKey), ["new"]);
  assert.deepEqual(filtered.eventKeys, ["new"]);
  assert.equal(filtered.summary.checked, 1);
});
