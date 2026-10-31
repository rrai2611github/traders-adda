import test from "node:test";
import assert from "node:assert/strict";
import { aggregateCandles } from "../src/lib/chart/aggregate.ts";
import { autoLevels } from "../src/lib/chart/autoLevels.ts";
import { detectCandlePatterns } from "../src/lib/chart/candlePatterns.ts";
import { barIndexAt } from "../src/lib/chart/drawings.ts";
import { bollinger, classicPivots, ichimoku, sma, supertrend } from "../src/lib/chart/indicators.ts";

const DAY = 86_400_000;
// Monday 6 Jan 2025, 09:15 IST.
const MON = Date.UTC(2025, 0, 6, 3, 45);
const bar = (t, close, o = {}) => ({ t, open: o.open ?? close, high: o.high ?? close * 1.01, low: o.low ?? close * 0.99, close, volume: o.volume ?? 100 });
const weekdays = (n, start = MON) => {
  const out = [];
  for (let d = 0; out.length < n; d += 1) {
    const t = start + d * DAY;
    const wd = new Date(t + 5.5 * 3600e3).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(t);
  }
  return out;
};

test("weekly bars roll Monday–Friday in IST; monthly bars roll by calendar month", () => {
  const days = weekdays(10).map((t, i) => bar(t, 100 + i, { volume: 10 }));
  const weeks = aggregateCandles(days, "W");
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].t, days[0].t);
  assert.equal(weeks[0].open, days[0].open);
  assert.equal(weeks[0].close, days[4].close);
  assert.equal(weeks[0].high, Math.max(...days.slice(0, 5).map((d) => d.high)));
  assert.equal(weeks[0].volume, 50);
  const months = aggregateCandles(weekdays(45).map((t) => bar(t, 100)), "M");
  assert.deepEqual(months.map((m) => new Date(m.t).getUTCMonth()), [0, 1, 2]);
  assert.equal(aggregateCandles(days, "D").length, 10);
});

test("auto levels find a support tested three times and a resistance above", () => {
  const closes = [];
  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (let k = 0; k <= 10; k += 1) closes.push(100 + k);
    for (let k = 9; k >= 1; k -= 1) closes.push(100 + k);
  }
  closes.push(104, 105);
  const candles = closes.map((c, i) => bar(MON + i * DAY, c, { high: c + 0.5, low: c - 0.5 }));
  const levels = autoLevels(candles);
  const support = levels.find((l) => l.kind === "support");
  const resistance = levels.find((l) => l.kind === "resistance");
  assert.ok(support && Math.abs(support.price - 99.5) < 1, JSON.stringify(levels));
  assert.ok(support.touches >= 3);
  assert.ok(resistance && Math.abs(resistance.price - 110.5) < 1);
  assert.equal(support.flipped, false);
});

test("candle patterns: bullish engulfing after a decline, not in a flat market", () => {
  const down = Array.from({ length: 30 }, (_, i) => bar(MON + i * DAY, 200 - i * 2, { open: 200 - i * 2 + 1.5, high: 200 - i * 2 + 2, low: 200 - i * 2 - 0.5 }));
  const p = down.at(-1).close;
  const engulf = bar(MON + 30 * DAY, p + 3, { open: p - 1.5, high: p + 3.3, low: p - 1.8 });
  const hits = detectCandlePatterns([...down, engulf]);
  assert.ok(hits.some((h) => h.key === "bullEngulfing" && h.index === 30), JSON.stringify(hits.filter((h) => h.index === 30)));
  const flat = Array.from({ length: 30 }, (_, i) => bar(MON + i * DAY, 100 + (i % 2 ? 0.3 : -0.3), { open: 100, high: 101, low: 99 }));
  const flatHits = detectCandlePatterns([...flat, bar(MON + 30 * DAY, 101.5, { open: 99.2, high: 101.7, low: 99 })]);
  assert.equal(flatHits.some((h) => h.key === "bullEngulfing" && h.index === 30), false);
});

test("drawings snap to the bar that contains their time", () => {
  const bars = [{ t: 100 }, { t: 200 }, { t: 300 }];
  assert.equal(barIndexAt(bars, 50), null);
  assert.equal(barIndexAt(bars, 100), 0);
  assert.equal(barIndexAt(bars, 250), 1);
  assert.equal(barIndexAt(bars, 999), 2);
});

test("indicators: SMA, Bollinger, pivots, Supertrend and Ichimoku basics", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const bb = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  assert.equal(bb.mid[7], 5);
  assert.equal(bb.upper[7], 9);
  assert.equal(bb.lower[7], 1);
  const pv = classicPivots({ high: 110, low: 90, close: 100 });
  assert.equal(pv.p, 100);
  assert.equal(pv.r1, 110);
  assert.equal(pv.s1, 90);
  assert.equal(pv.r2, 120);
  assert.equal(pv.s3, 70);

  const up = Array.from({ length: 60 }, (_, i) => bar(MON + i * DAY, 100 + i));
  const crash = Array.from({ length: 20 }, (_, i) => bar(MON + (60 + i) * DAY, 150 - i * 4));
  const st = supertrend([...up, ...crash]);
  assert.equal(st.trend[59], 1);
  assert.ok(st.up[59] < up[59].close);
  assert.equal(st.trend[79], -1);
  assert.ok(st.down[79] > crash[19].close);

  const ichi = ichimoku(up);
  assert.equal(ichi.spanA.length, 60);
  assert.equal(ichi.futureA.length, 26);
  assert.equal(ichi.spanA[25], null);
  assert.ok(ichi.tenkan[59] > ichi.kijun[59]);
});
