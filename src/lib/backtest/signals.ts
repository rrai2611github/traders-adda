import { HOUSE_PRESETS, matchesScreen, type FactorValues } from "../screen/criteria.ts";
import { entryFacts, walkEpisodes } from "../screen/episodes.ts";
import type { Derived } from "./derive.ts";
import type { History, Series } from "./history.ts";
import type { BacktestSettings } from "./types.ts";

/** A stock that qualified on a day. The trade happens on the next session (or on this one for "at the pivot"). */
export interface Candidate {
  symbol: string;
  /** Calendar position of the signal day. */
  pos: number;
  /** Candle index of the signal day in the stock's own series. */
  i: number;
  rs: number;
  /** The lid broken, for screens. */
  pivot: number | null;
}

const MIN_PRICE = 20;
const MIN_VOLUME = 50_000;
const WARMUP = 252;

export const floorCr = (floor: BacktestSettings["floor"]) => (floor === "screen" ? 1 : 5);

/** out[i] = max (or min) of values[i-window+1..i], by a monotonic queue so a whole series costs one pass. */
export function rolling(values: Float32Array, window: number, kind: "max" | "min"): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i += 1) {
    while (tail > head && (kind === "max" ? values[queue[tail - 1]] <= values[i] : values[queue[tail - 1]] >= values[i])) tail -= 1;
    queue[tail++] = i;
    if (queue[head] <= i - window) head += 1;
    out[i] = values[queue[head]];
  }
  return out;
}

export function movingAverage(values: Float32Array, period: number): Float32Array {
  const n = values.length;
  const out = new Float32Array(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Mean true range over the last `period` candles ending at `i`; NaN with too little history. */
export function atrAt(s: Series, i: number, period = 14): number {
  if (i < period) return NaN;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k += 1) {
    const prev = s.close[k - 1];
    sum += Math.max(s.high[k] - s.low[k], Math.abs(s.high[k] - prev), Math.abs(s.low[k] - prev));
  }
  return sum / period;
}

/** Keeps only breakouts that held: the next session closes above the breakout day's close, and the buy moves to the day after. */
export function confirmCandidates(history: History, candidates: ReadonlyArray<Candidate>): Candidate[] {
  const out: Candidate[] = [];
  for (const c of candidates) {
    const s = history.series.get(c.symbol)!;
    const next = c.i + 1;
    if (next >= s.n || s.day[next] !== history.calendar[c.pos + 1]) continue;
    if (s.close[next] > s.close[c.i]) out.push({ ...c, pos: c.pos + 1, i: next });
  }
  return out;
}

/** Strong stocks in a stacked uptrend near their high, every day (the Weekly Top 5 rule). */
export function leaderCandidates(history: History, derived: Derived, settings: BacktestSettings, fromPos: number, toPos: number): Candidate[] {
  if (settings.strategy.kind !== "leaders") return [];
  const { rsMin, nearHighPercent, breakout, maxAboveSma50Percent, volumeDryUp } = settings.strategy;
  const floor = floorCr(settings.floor);
  const out: Candidate[] = [];
  for (const s of history.series.values()) {
    if (s.n <= WARMUP) continue;
    const turn = derived.turn.get(s.symbol)!;
    const rs = derived.rs.get(s.symbol)!;
    const sma50 = movingAverage(s.close, 50);
    const sma150 = movingAverage(s.close, 150);
    const sma200 = movingAverage(s.close, 200);
    const hi52 = rolling(s.high, 252, "max");
    const lo52 = rolling(s.low, 252, "min");
    const hi20 = breakout ? rolling(s.high, 20, "max") : null;
    const vol50 = breakout || volumeDryUp ? movingAverage(s.volume, 50) : null;
    const vol10 = volumeDryUp ? movingAverage(s.volume, 10) : null;
    for (let i = WARMUP; i < s.n; i += 1) {
      const pos = history.position.get(s.day[i]);
      if (pos == null || pos < fromPos || pos > toPos) continue;
      const close = s.close[i];
      if (turn[i] < floor || close < MIN_PRICE || s.volume[i] < MIN_VOLUME || rs[i] < rsMin) continue;
      if (!(close > sma50[i] && sma50[i] > sma150[i] && sma150[i] > sma200[i])) continue;
      if ((1 - close / hi52[i]) * 100 > nearHighPercent || close < lo52[i] * 1.3) continue;
      if (maxAboveSma50Percent != null && (close / sma50[i] - 1) * 100 > maxAboveSma50Percent) continue;
      if (volumeDryUp && !(vol10![i] < vol50![i])) continue;
      if (breakout && !(close > hi20![i - 1] && vol50![i - 1] > 0 && s.volume[i] >= 1.5 * vol50![i - 1])) continue;
      out.push({ symbol: s.symbol, pos, i, rs: rs[i], pivot: null });
    }
  }
  return out;
}

/** Breakouts that pass one house screen on their own breakout day, judged only on what was known then. */
export function screenCandidates(history: History, derived: Derived, settings: BacktestSettings, fromPos: number, toPos: number): Candidate[] {
  if (settings.strategy.kind !== "screen") return [];
  const spec = HOUSE_PRESETS[settings.strategy.screen];
  const floor = floorCr(settings.floor);
  const out: Candidate[] = [];
  for (const s of history.series.values()) {
    if (s.n < 60) continue;
    const turn = derived.turn.get(s.symbol)!;
    const rs = derived.rs.get(s.symbol)!;
    const candles = Array.from({ length: s.n }, (_, i) => ({ t: s.day[i] * 86_400_000, open: s.open[i], high: s.high[i], low: s.low[i], close: s.close[i], volume: s.volume[i] }));
    const vol50 = settings.minVolumeRatio ? movingAverage(s.volume, 50) : null;
    const seen = new Set<number>();
    for (const episode of walkEpisodes(candles).episodes) {
      if (episode.outcome === "failed" || seen.has(episode.index)) continue;
      const e = episode.index;
      const pos = history.position.get(s.day[e]);
      if (pos == null || pos < fromPos || pos > toPos || turn[e] < floor) continue;
      const facts = entryFacts(candles, episode);
      const values: FactorValues = {
        rs: rs[e] || null, vs50: facts.vs50, vs200: facts.vs200, fromHigh: facts.fromHigh, aboveLow: facts.aboveLow,
        turn: turn[e], mcap: null, baseWk: facts.baseWk, baseDepth: facts.baseDepth, coil: facts.coil, dry: facts.dry,
        listedWk: facts.listedWk, level: facts.level, ext: facts.ext,
      };
      if (!matchesScreen(values, spec)) continue;
      if (settings.minRs && (rs[e] || 0) < settings.minRs) continue;
      if (vol50 && !(e > 0 && vol50[e - 1] > 0 && s.volume[e] >= settings.minVolumeRatio! * vol50[e - 1])) continue;
      if (settings.maxAbove50Percent != null && !(facts.vs50 != null && facts.vs50 <= settings.maxAbove50Percent)) continue;
      seen.add(e);
      out.push({ symbol: s.symbol, pos, i: e, rs: rs[e], pivot: episode.pivot });
    }
  }
  return out;
}
