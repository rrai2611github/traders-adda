import test from "node:test";
import assert from "node:assert/strict";
import { latestCompletedMonth, measureMonthlySetups } from "../src/lib/screen/monthlySetups.ts";
import { istDateKey } from "../src/lib/market/marketHours.ts";
import { isMonthlyRegularSession } from "../src/lib/market/monthlyCalendar.ts";

const now = Date.parse("2026-10-03T12:00:00+05:30");
function history(count = 36, overrides = {}) {
  const bars = [];
  for (let i = 0; i < count; i++) {
    const month = new Date(Date.UTC(2026, 9 - count + i, 1));
    const year = month.getUTCFullYear(), number = month.getUTCMonth();
    for (let day = 1; day <= new Date(Date.UTC(year, number + 1, 0)).getUTCDate(); day++) {
      const t = Date.UTC(year, number, day, 3, 45);
      if (isMonthlyRegularSession(t)) bars.push({ t, open: 80, high: 110, low: 60, close: 90, volume: 1000, ...(overrides[i] ?? {}) });
    }
  }
  return bars;
}

test("breakout strictly exceeds preceding 12 highs; current October candle never confirms September", () => {
  const bars = history(36, { 35: { high: 125, close: 120 } });
  const confirmed = measureMonthlySetups(bars, now);
  assert.equal(confirmed.issue, null);
  assert.equal(confirmed.setup.signalMonth, "2026-09");
  assert.equal(confirmed.setup.breakout.level, 110);
  assert.ok(Math.abs(confirmed.setup.breakout.distancePercent - (120 / 110 - 1) * 100) < 1e-8);
  assert.equal(typeof confirmed.setup.dmi.adx, "number");
  const current = { t: Date.parse("2026-10-01T09:15:00+05:30"), open: 120, high: 200, low: 100, close: 190, volume: 1000 };
  const withLive = measureMonthlySetups([...bars, current], now).setup;
  assert.deepEqual(withLive.breakout, confirmed.setup.breakout);
  assert.equal(withLive.provisional.aboveBreakout, true);
  assert.equal(withLive.provisional.month, "2026-10");
  assert.equal(measureMonthlySetups(history(36, { 35: { close: 110 } }), now).setup.breakout, null);
});

test("compression uses most recent mother with two full inside months; equality counts", () => {
  const bars = history(36, {
    33: { high: 110, low: 60, close: 85 },
    34: { high: 100, low: 65, close: 90 },
    35: { high: 100, low: 65, close: 90 },
  });
  const setup = measureMonthlySetups(bars, now).setup;
  assert.equal(setup.compression.motherMonth, "2026-07");
  assert.equal(setup.compression.insideMonths, 2);
  assert.equal(setup.compression.upsideProjection, 160);
  assert.equal(setup.compression.downsideProjection, 10);
  const live = { t: Date.parse("2026-10-01T09:15:00+05:30"), open: 100, high: 125, low: 95, close: 120, volume: 1000 };
  const provisional = measureMonthlySetups([...bars, live], now).setup;
  assert.equal(provisional.compression.motherMonth, "2026-07");
  assert.equal(provisional.provisional.rangePosition, "Above");
});

test("a single inside month is insufficient; outside wick invalidates compression", () => {
  const bars = history(36, { 35: { high: 115, close: 90 } });
  assert.equal(measureMonthlySetups(bars, now).setup.compression, null);
  const single = history(36, { 34: { high: 130 }, 35: { high: 115 } });
  assert.equal(measureMonthlySetups(single, now).setup.compression, null);
});

test("partial initial month discarded; at least 13 complete months required", () => {
  const bars = history(14);
  const firstMonth = istDateKey(bars[0].t).slice(0, 7);
  const trimmed = bars.filter((bar, i) => i !== 0);
  const result = measureMonthlySetups(trimmed, now);
  assert.equal(result.setup.completedMonths, 13);
  assert.equal(firstMonth, "2025-08");
  assert.match(measureMonthlySetups(history(12), now).issue, /13/);
  assert.equal(measureMonthlySetups(history(13), now).setup.dmi.adx, null);
});

test("stale history, missing month, missing final boundary and malformed data are explicit", () => {
  const bars = history();
  assert.match(measureMonthlySetups(bars.filter(bar => istDateKey(bar.t).slice(0, 7) !== "2026-09"), now).issue, /unavailable/);
  assert.match(measureMonthlySetups(bars.filter(bar => istDateKey(bar.t).slice(0, 7) !== "2026-07"), now).issue, /missing month/);
  assert.match(measureMonthlySetups(bars.slice(0, -1), now).issue, /Incomplete/);
  assert.match(measureMonthlySetups([...bars, bars.at(-1)], now).issue, /Duplicate/);
  assert.match(measureMonthlySetups([{ ...bars[0], volume: NaN }, ...bars.slice(1)], now).issue, /volume/);
  assert.match(measureMonthlySetups([{ ...bars[0], high: 1 }, ...bars.slice(1)], now).issue, /Invalid/);
  assert.match(measureMonthlySetups(bars, now, now + 1).issue, /future-dated merged quote/);
  assert.match(measureMonthlySetups(bars, now, NaN).issue, /Invalid/);
});

test("month confirms at final trading-session close, respects weekends and configured holidays", () => {
  assert.equal(latestCompletedMonth(Date.parse("2024-03-28T15:30:00+05:30")), "2024-03");
  assert.equal(latestCompletedMonth(Date.parse("2025-03-28T15:30:00+05:30")), "2025-03");
  assert.equal(latestCompletedMonth(Date.parse("2026-03-30T15:30:00+05:30")), "2026-03");
  assert.equal(latestCompletedMonth(Date.parse("2026-10-30T15:29:00+05:30")), "2026-09");
  assert.equal(latestCompletedMonth(Date.parse("2026-10-30T15:30:00+05:30")), "2026-10");
  assert.match(measureMonthlySetups(history(), now, Date.parse("2026-09-30T15:29:00+05:30")).issue, /pre-close/);
  assert.equal(measureMonthlySetups(history(), now, Date.parse("2026-09-30T15:30:00+05:30")).issue, null);
  const previous = process.env.MARKET_HOLIDAYS;
  process.env.MARKET_HOLIDAYS = [previous, "2026-10-30"].filter(Boolean).join(",");
  try {
    assert.equal(latestCompletedMonth(Date.parse("2026-10-29T15:30:00+05:30")), "2026-10");
  } finally {
    if (previous === undefined) delete process.env.MARKET_HOLIDAYS;
    else process.env.MARKET_HOLIDAYS = previous;
  }
});

test("genuine Muhurat and special-session candles remain in monthly OHLC", () => {
  const bars = history(36, { 35: { high: 160, close: 155 } });
  bars.push({ t: Date.parse("2025-10-21T18:00:00+05:30"), open: 90, high: 150, low: 75, close: 140, volume: 1000 });
  bars.sort((a, b) => a.t - b.t);
  const result = measureMonthlySetups(bars, now);
  assert.equal(result.issue, null);
  assert.equal(result.setup.completedMonths, 36);
  assert.equal(result.setup.breakout.level, 150);
});
