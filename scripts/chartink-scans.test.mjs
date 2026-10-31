import test from "node:test";
import assert from "node:assert/strict";
import { SCANNER_KEYS, SCANNERS, benchmarkCloses, runScanners } from "../src/lib/screen/chartinkScans.ts";
import { ema } from "../src/lib/screen/oscillators.ts";

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 6, 10, 0);
const settled = { dateKey: "2099-01-01", progress: 1 };

const bar = (t, close, { open = close * 0.998, high = close * 1.01, low = close * 0.99, volume = 1_000_000 } = {}) =>
  ({ t, open, high, low, close, volume });

// A steady uptrend: every moving average is stacked and the 21 EMA is never crossed.
const base = (n = 260) => Array.from({ length: n }, (_, i) => bar(START + i * DAY, 100 * 1.002 ** i));
const append = (candles, ...specs) => {
  const out = [...candles];
  for (const [close, opts] of specs) out.push(bar(out.at(-1).t + DAY, close, opts));
  return out;
};
const run = (candles, meta) => runScanners("TEST", candles, meta, settled);
const last = (candles) => candles.at(-1).close;

test("every scanner has a definition, a clause and a menu label", () => {
  assert.equal(SCANNER_KEYS.length, 14);
  for (const key of SCANNER_KEYS) {
    assert.equal(SCANNERS[key].key, key);
    assert.ok(SCANNERS[key].clause.length > 20, key);
    assert.ok(SCANNERS[key].menuLabel, key);
  }
});

test("steady uptrend trips only the swing screener", () => {
  assert.deepEqual(Object.keys(run(base())), ["swing"]);
});

test("swing: needs the close within 20% of the 52-week high and a known mcap above 2000 cr", () => {
  assert.ok(run(base(), { marketCapCr: 5000 }).swing);
  assert.equal(run(base(), { marketCapCr: 1500 }).swing, undefined);
  const c = base();
  assert.equal(run(append(c, [last(c) * 0.75])).swing, undefined);
});

test("range: wide bullish day that holds above yesterday's close", () => {
  const c = base();
  const p = last(c);
  const hit = run(append(c, [p * 1.045, { open: p * 1.001, low: p * 0.999, high: p * 1.05 }])).range;
  assert.ok(hit);
  assert.ok(hit.values.rangeVsPrior > 2);
  assert.equal(run(append(c, [p * 1.001, { open: p * 1.04, low: p * 0.999, high: p * 1.05 }])).range, undefined);
});

test("nr7: yesterday is the narrowest of the last 7 sessions in a stacked uptrend", () => {
  const c = base();
  const p = last(c) * 1.002;
  const withNr7 = append(c, [p, { high: p * 1.001, low: p * 0.999 }], [p * 1.01]);
  const hit = run(withNr7).nr7;
  assert.ok(hit);
  assert.equal(hit.values.brokeHigh, true);
  assert.equal(run(base()).nr7, undefined);
});

test("fall4: four lower highs and lows then a higher high above the 200 EMA", () => {
  const c = base();
  const p = last(c);
  const falls = [1, 2, 3, 4].map((k) => [p * 0.985 ** k]);
  const down = append(c, ...falls);
  const hit = run(append(down, [last(down) * 1.012])).fall4;
  assert.ok(hit);
  assert.ok(hit.values.fallPercent < 0);
  assert.equal(run(append(down, [last(down) * 0.99])).fall4, undefined);
});

test("up3: at least 3% on each of three sessions", () => {
  const c = base();
  const p = last(c);
  assert.ok(run(append(c, [p * 1.04], [p * 1.04 ** 2], [p * 1.04 ** 3])).up3);
  assert.equal(run(append(c, [p * 1.04], [p * 1.04 * 1.02], [p * 1.04 * 1.02 * 1.04])).up3, undefined);
});

test("ema21: crosses back above after closing below", () => {
  const c = base();
  const p = last(c);
  const hit = run(append(c, [p * 0.9], [p * 1.02])).ema21;
  assert.ok(hit);
  assert.ok(hit.values.vsEma21 > 0);
  assert.equal(run(append(c, [p * 0.9], [p * 0.91])).ema21, undefined);
});

test("inside: Chartink's open-higher, close-lower rule, flagging true inside bars", () => {
  const c = base();
  const p = c.at(-1);
  const hit = run(append(c, [p.close * 0.999, { open: p.open * 1.001, high: p.high * 0.999, low: p.low * 1.001 }])).inside;
  assert.ok(hit);
  assert.equal(hit.values.trueInside, true);
  assert.equal(run(append(c, [p.close * 1.001, { open: p.open * 1.001 }])).inside, undefined);
});

test("rsidiv: RSI rises two sessions while highs fall", () => {
  const c = base();
  const p = last(c);
  const down = append(c, [p * 0.97], [p * 0.95], [p * 0.93, { high: p * 1.02 }]);
  const d = last(down);
  const hit = run(append(down, [d * 1.005, { high: p * 1.0 }], [d * 1.01, { high: p * 0.99 }])).rsidiv;
  assert.ok(hit);
  assert.ok(hit.values.rsiChange2d > 0);
  assert.equal(run(append(down, [d * 1.005, { high: p * 1.0 }], [d * 1.01, { high: p * 1.01 }])).rsidiv, undefined);
});

test("today's unfinished candle is ignored", () => {
  const c = base();
  const p = last(c);
  const withUp3 = append(c, [p * 1.04], [p * 1.04 ** 2], [p * 1.04 ** 3]);
  const liveDay = new Date(withUp3.at(-1).t + 5.5 * 3600e3).toISOString().slice(0, 10);
  assert.equal(runScanners("TEST", withUp3, {}, { dateKey: liveDay, progress: 0.5 }).up3, undefined);
  assert.ok(runScanners("TEST", withUp3, {}, { dateKey: liveDay, progress: 1 }).up3);
});

test("high52: closes above the prior 52-week high on 1.5x volume", () => {
  const c = base();
  const p = last(c);
  const hit = run(append(c, [p * 1.03, { volume: 2_000_000 }])).high52;
  assert.ok(hit);
  assert.ok(hit.values.volumeRatio >= 1.5);
  assert.equal(run(append(c, [p * 1.03, { volume: 1_000_000 }])).high52, undefined);
});

test("pullback20: stage-2 stock dips to a rising 20 EMA and holds it", () => {
  const rally = append(base(), ...[1, 2, 3, 4].map((k) => [last(base()) * 1.02 ** k]));
  const k = 2 / 21;
  const prev = ema(rally.map((x) => x.close), 20).at(-1);
  const close = (1.005 * prev * (1 - k)) / (1 - 1.005 * k);
  const e = (close / 1.005);
  const hit = run(append(rally, [close, { open: close, low: e * 0.998, high: close * 1.01 }])).pullback20;
  assert.ok(hit);
  assert.ok(hit.values.vsEma20 >= 0);
  assert.equal(run(append(rally, [close, { open: close, low: e * 1.03, high: close * 1.04 }])).pullback20, undefined);
});

test("leader: RS line at a 52-week high needs RS 90+ and the benchmark", () => {
  const c = append(base(), [last(base()) * 1.01]);
  const benchmark = benchmarkCloses(c.map((x) => ({ ...x, close: 100 })));
  assert.ok(run(c, { rs: 95, benchmark }).leader);
  assert.equal(run(c, { rs: 80, benchmark }).leader, undefined);
  assert.equal(run(c, { rs: 95 }).leader, undefined);
});

test("ath: close above all history with RSI 60-75, only on 500+ sessions", () => {
  const wave = (n) => Array.from({ length: n }, (_, i) => bar(START + i * DAY, 100 * 1.0015 ** i * (1 + 0.02 * Math.sin(i / 3))));
  const c = wave(560);
  const top = Math.max(...c.map((x) => x.high));
  const hit = run(append(c, [top * 1.005, { high: top * 1.01 }])).ath;
  assert.ok(hit, JSON.stringify(run(append(c, [top * 1.005, { high: top * 1.01 }]))));
  const short = wave(300);
  const shortTop = Math.max(...short.map((x) => x.high));
  assert.equal(run(append(short, [shortTop * 1.005, { high: shortTop * 1.01 }])).ath, undefined);
});

test("pocket: up-day volume beats every down day of the last 10 sessions", () => {
  const c = base();
  const p = last(c);
  const dips = append(c, [p * 0.995, { volume: 1_500_000 }], [p * 0.99, { volume: 1_500_000 }]);
  const hit = run(append(dips, [p * 1.004, { volume: 2_000_000, high: p * 1.006 }])).pocket;
  assert.ok(hit);
  assert.ok(hit.values.volumeVsDown > 1);
  assert.equal(run(append(dips, [p * 1.004, { volume: 1_400_000, high: p * 1.006 }])).pocket, undefined);
});
