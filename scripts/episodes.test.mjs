import assert from "node:assert/strict";
import { test } from "node:test";
import { measureBase, walkEpisodes } from "../src/lib/screen/episodes.ts";

const DAY = 86_400_000;

/** Candles from [close, high?, volume?, low?] tuples; high defaults to close + 0.5%, low to close − 1%. */
function candles(rows) {
  return rows.map((row, i) => {
    const [close, high = close * 1.005, volume = 1000, low = close * 0.99] = Array.isArray(row) ? row : [row];
    return { t: i * DAY, open: close, high, low, close, volume };
  });
}

// A wide peak day (high 110, close 100, low 96) followed by a quiet base that
// never undercuts it, with a 60-day
// rising run-up underneath so the 50-day average sits below the base.
const runUp = Array.from({ length: 60 }, (_, i) => 60 + i * 0.6);
const peakAndBase = [[100, 110, 1000, 96], ...Array.from({ length: 20 }, () => 98)];
/** Breakouts from the base under test, ignoring any inside the run-up. */
const fromBase = (episodes) => episodes.filter((e) => e.index > runUp.length);

test("the pivot is the base's highest close, not its highest high", () => {
  const series = candles([...runUp, ...peakAndBase]);
  const { base } = walkEpisodes(series);
  assert.equal(base.peak, runUp.length);
  // Quoted from the session after the peak.
  assert.equal(base.start, runUp.length + 1);
  assert.equal(base.level, 1);
  assert.equal(base.pivot, 100);
  assert.equal(base.baseHigh, 110);
});

test("a close above the lid is a breakout, and a running stock reports it once", () => {
  const series = candles([...runUp, ...peakAndBase, 101, 103, 105, 107, 109]);
  const { episodes, live } = walkEpisodes(series);
  assert.equal(fromBase(episodes).length, 1);
  assert.equal(live.index, runUp.length + peakAndBase.length);
  assert.equal(live.pivot, 100);
  assert.equal(live.outcome, "live");
});

test("a high above the lid that closes back under is a squat", () => {
  const series = candles([...runUp, [100, 110], 98, 98, [99, 104], ...Array.from({ length: 17 }, () => 98)]);
  const start = runUp.length;
  const measured = measureBase(series, start, series.length - 1, 100, 110);
  // The peak day itself and the later poke both qualify.
  assert.deepEqual(measured.squatIndices, [start, start + 3]);
});

test("a breakout that closes back inside within 10 sessions is a failed poke", () => {
  const series = candles([...runUp, ...peakAndBase, 101, 99, 98, 98]);
  const { live } = walkEpisodes(series);
  const episodes = fromBase(walkEpisodes(series).episodes);
  assert.equal(live, null);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].outcome, "failed");
});

test("a breakout that gives back 8% plays out at the stop, dated", () => {
  const series = candles([...runUp, ...peakAndBase, 101, [120, 121], 92]);
  const walk = walkEpisodes(series);
  const { live } = walk;
  const episodes = fromBase(walk.episodes);
  assert.equal(live, null);
  assert.equal(episodes[0].outcome, "played");
  assert.match(episodes[0].why, /8% stop/);
  assert.equal(episodes[0].endIndex, series.length - 1);
  assert.ok(Math.abs(episodes[0].retPct - (92 / 101 - 1) * 100) < 1e-9);
});

test("up/down volume, net is the buying share minus the selling share", () => {
  const rows = [[99, 100, 1000]];
  for (let i = 0; i < 12; i += 1) rows.push(i % 2 ? [99, 100, 1000] : [100, 101, 3000]);
  const series = candles(rows);
  const measured = measureBase(series, 0, series.length - 1, 100, 101);
  // Six up days of 3000 against six down days of 1000.
  assert.ok(Math.abs(measured.obv - (18000 - 6000) / 24000) < 1e-9);
  assert.ok(Math.abs(measured.udBase - 3) < 1e-9);
});

test("the 50-day trail only arms after a close above the 50DMA", () => {
  // A long shelf at 130 keeps the 50-day average above a breakout from 98.
  const shelf = Array.from({ length: 60 }, () => 130);
  const series = candles([...shelf, ...peakAndBase, 101, 103, 104]);
  const { live } = walkEpisodes(series);
  assert.ok(live, "still live: under the 50DMA it runs on the 8% stop alone");
  assert.equal(live.trailOn, false);
  assert.equal(live.outcome, "live");
});

test("a base built inside a deeper decline is an inner level", () => {
  const shelf = Array.from({ length: 60 }, () => 130);
  const series = candles([...shelf, ...peakAndBase, 101]);
  const { live } = walkEpisodes(series);
  assert.equal(live.level, 2);
  assert.equal(live.pivot, 100);
});

test("walkEpisodes returns every born base, outermost first, ending with the innermost", () => {
  // A drift, a sharp drop, then a quiet stretch: the outer base spans everything since the peak and a smaller base
  // forms inside it from the new low.
  const outer = [[100, 105, 1000, 99], ...Array.from({ length: 30 }, (_, i) => 98 - (i % 3)), ...Array.from({ length: 5 }, (_, i) => 90 - i), ...Array.from({ length: 25 }, (_, i) => 86 + (i % 4))];
  const { bases, base } = walkEpisodes(candles([...runUp, ...outer]));
  assert.ok(bases.length >= 2, `expected a nested base, got ${bases.length}`);
  assert.deepEqual(bases.map((b) => b.level), bases.map((_, i) => bases[0].level + i));
  assert.equal(base, bases[bases.length - 1]);
  assert.ok(bases[0].start <= bases[bases.length - 1].start, "the outer base starts no later than the inner one");
});

test("with too little history there are no bases", () => {
  assert.deepEqual(walkEpisodes(candles([100, 101, 102])).bases, []);
});

test("independentExit agrees with the walk's own exit for a breakout that was never rebased", async () => {
  const { independentExit, smaSeries } = await import("../src/lib/screen/episodes.ts");
  // Breakout, a run, then a drop that gives back more than 8% of the entry.
  const series = candles([...runUp, ...peakAndBase, 101, 103, 105, 107, 109, 111, 113, 112, 108, 102, 96, 92]);
  const { episodes } = walkEpisodes(series);
  const played = fromBase(episodes).find((e) => e.outcome === "played");
  assert.ok(played, "the walk ends the breakout");
  const exit = independentExit(series, played, smaSeries(series, 50));
  assert.equal(exit.index, played.endIndex);
  assert.equal(exit.why, played.why);
});

test("a breakout judged on its own keeps holding after a later breakout rebased it", async () => {
  const { independentExit, smaSeries } = await import("../src/lib/screen/episodes.ts");
  // A first breakout that keeps climbing, then a second base and breakout above it. The walk rebases the first; on its own
  // exit rule it never stopped out.
  const climb = [101, 103, 105, 107, 109, 111, 113, 115, 117, 119];
  const second = [[120, 125, 1000, 118], ...Array.from({ length: 12 }, () => 119), 122, 124];
  const series = candles([...runUp, ...peakAndBase, ...climb, ...second]);
  const { episodes } = walkEpisodes(series);
  const first = fromBase(episodes)[0];
  assert.ok(first);
  assert.equal(independentExit(series, first, smaSeries(series, 50)), null);
});

test("a breakout that falls through its own 8% stop exits on that session", async () => {
  const { independentExit, smaSeries } = await import("../src/lib/screen/episodes.ts");
  const series = candles([...runUp, ...peakAndBase, 101, 103, 105, 107, 109, 111, 113, 105, 98, 92]);
  const { episodes } = walkEpisodes(series);
  const first = fromBase(episodes)[0];
  const exit = independentExit(series, first, smaSeries(series, 50));
  assert.ok(exit);
  assert.match(exit.why, /8% stop/);
  assert.equal(exit.index, series.length - 1);
});
