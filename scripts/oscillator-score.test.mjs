import test from "node:test";
import assert from "node:assert/strict";
import { OSCILLATOR_COUNT, OSCILLATOR_DEFS, scoreOscillators, scoreVerdict } from "../src/lib/screen/oscillatorScore.ts";

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 5, 10, 0);
const settled = { dateKey: "2099-01-01", progress: 1 };
// Closes near the top of each day's range on rising volume: accumulation.
const series = (n, step) => {
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    price *= i % 3 === 0 ? 1 - step / 2 : 1 + step;
    const spread = price * 0.01;
    const close = +price.toFixed(2);
    return {
      t: START + i * DAY,
      open: close - (step > 0 ? spread / 2 : -spread / 2),
      high: close + (step > 0 ? spread * 0.2 : spread),
      low: close - (step > 0 ? spread : spread * 0.2),
      close,
      volume: 1_000_000 + i * 1000,
    };
  });
};

test("there are exactly 15 oscillators", () => {
  assert.equal(OSCILLATOR_COUNT, 15);
  assert.equal(new Set(OSCILLATOR_DEFS.map((d) => d.key)).size, 15);
});

test("verdict bands", () => {
  assert.equal(scoreVerdict(15), "strong");
  assert.equal(scoreVerdict(11), "strong");
  assert.equal(scoreVerdict(10), "bullish");
  assert.equal(scoreVerdict(8), "bullish");
  assert.equal(scoreVerdict(7), "neutral");
  assert.equal(scoreVerdict(5), "neutral");
  assert.equal(scoreVerdict(4), "bearish");
});

test("short history is not scored", () => {
  assert.equal(scoreOscillators(series(59, 0.01), settled), null);
});

test("an accelerating uptrend scores high and a downtrend scores low", () => {
  const up = series(120, 0.01);
  for (let i = 115; i < 120; i++) { // push the last sessions up harder so rising-value rules fire
    const c = up[i];
    const lift = 1 + (i - 114) * 0.012;
    Object.assign(c, { close: c.close * lift, high: c.high * lift, low: c.low * lift, open: c.open * lift });
  }
  const bull = scoreOscillators(up, settled);
  assert.ok(bull);
  assert.equal(bull.votes.length, 15);
  assert.equal(bull.values.length, 15);
  assert.equal(bull.bullish + bull.neutral + bull.bearish, 15);
  assert.ok(bull.score >= 11, `bull score ${bull.score} votes ${bull.votes}`);
  assert.equal(bull.verdict, "strong");

  const bear = scoreOscillators(series(120, -0.01), settled);
  assert.ok(bear);
  assert.ok(bear.score <= 4, `bear score ${bear.score} votes ${bear.votes}`);
  assert.ok(bear.bearish >= 8, `bearish ${bear.bearish}`);
});

test("the running session is excluded until complete", () => {
  const candles = series(80, 0.01);
  const lastDay = new Date(candles[79].t + 19_800_000).toISOString().slice(0, 10);
  const live = scoreOscillators(candles, { dateKey: lastDay, progress: 0.4 });
  assert.equal(live.candleTimestamp, candles[78].t);
});

test("a fresh score jump is flagged only when the score just entered the strong band", () => {
  // Downtrend, then a sharp rally: the score crosses into >= 11 during the rally.
  const candles = series(100, -0.004);
  let price = candles.at(-1).close;
  for (let i = 0; i < 12; i++) {
    price *= 1.01 + i * 0.005;
    const close = +price.toFixed(2);
    candles.push({ t: START + (100 + i) * DAY, open: close * 0.985, high: close * 1.002, low: close * 0.98, close, volume: 3_000_000 + i * 50_000 });
  }
  const scores = candles.map((_, k) => (k < 60 ? null : scoreOscillators(candles.slice(0, k + 1), settled)));
  let flagged = 0;
  for (let k = 63; k < candles.length; k++) {
    const s = scores[k];
    let enteredInside = false;
    for (let j = k; j > k - 3; j--) {
      if (scores[j].score < 11) break;
      if (scores[j - 1].score < 11) { enteredInside = true; break; }
    }
    assert.equal(s.freshJump, enteredInside, `k=${k} scores=${scores.slice(k - 3, k + 1).map((x) => x.score)}`);
    if (s.freshJump) {
      flagged++;
      assert.ok(s.jumpTimestamp != null);
      assert.equal(s.scoreBefore, scores[k - 3].score);
    } else {
      assert.equal(s.jumpTimestamp, null);
    }
  }
  assert.ok(flagged > 0, `rally never produced a fresh jump: ${scores.slice(95).map((x) => x.score)}`);
});

test("a long steady strong score is not a fresh jump", () => {
  const up = series(160, 0.01);
  const scores = [157, 158, 159].map((k) => scoreOscillators(up.slice(0, k + 1), settled).score);
  const s = scoreOscillators(up, settled);
  if (scores.every((v) => v >= 11) && scoreOscillators(up.slice(0, 157), settled).score >= 11) {
    assert.equal(s.freshJump, false);
  }
  assert.equal(typeof s.freshJump, "boolean");
});

test("the score is the 3-day average of daily scores", () => {
  const up = series(120, 0.01);
  const s = scoreOscillators(up, settled);
  assert.equal(s.dailyScores.length, 3);
  assert.equal(s.todayScore, s.bullish);
  assert.equal(s.dailyScores[2], s.todayScore);
  const mean = Math.round((s.dailyScores.reduce((a, b) => a + b, 0) / 3) * 10) / 10;
  assert.equal(s.score, mean);
  const yesterday = scoreOscillators(up.slice(0, -1), settled);
  assert.deepEqual(s.dailyScores.slice(0, 2), yesterday.dailyScores.slice(1));
});
