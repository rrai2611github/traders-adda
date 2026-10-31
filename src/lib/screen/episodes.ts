import type { Candle } from "@/lib/market/types";

/**
 * Bases, breakouts and what became of them, walked session by session.
 *
 * The model follows the method BananaPatterns publishes:
 * - a base starts at a peak and must be at least two weeks old before price
 *   can break out of it; smaller bases form inside it from each new low, up
 *   to four levels deep
 * - the pivot (the "lid") is the base's highest CLOSE, so a day whose high
 *   pokes above it but closes back under is a squat, not a breakout
 * - a breakout is the first close above a lid; it is judged on the facts of
 *   that day, not today's
 * - a breakout that closes back inside the base within 10 sessions, without
 *   ever closing above the base's highest high, was a failed poke
 * - a live breakout plays out on a close 8% under the entry, or below the
 *   50-day average once it has closed above it
 */

export const MIN_BASE_SESSIONS = 10;
export const FRESH_BREAKOUT_SESSIONS = 5;
export const STOP_LOSS_PERCENT = 8;
export const POKE_WINDOW_SESSIONS = 10;
export const MAX_LEVELS = 4;
const SESSIONS_PER_WEEK = 5;
const VOLUME_WINDOW = 50;

export type EpisodeOutcome = "live" | "played" | "rebased" | "failed";

export interface Episode {
  /** Index of the breakout session. */
  index: number;
  timestamp: number;
  pivot: number;
  /** The base's peak session; the base is quoted from the session after. */
  peak: number;
  baseStart: number;
  /** Highest high of the base it broke out of. */
  baseHigh: number;
  /** Nesting depth of that base: 1 is the outermost. */
  level: number;
  entryClose: number;
  /** Whether the 50-day trail has armed (a close above the 50DMA since entry). */
  trailOn: boolean;
  outcome: EpisodeOutcome;
  /** Session the episode ended on (exit, rebase or fall back), when it has. */
  endIndex: number | null;
  endTimestamp: number | null;
  /** Close-to-close result from entry to the end (or to today while live). */
  retPct: number;
  why: string | null;
  /** The live episode this one broke out of, for a base built mid-run. */
  parent: Episode | null;
}

export interface BaseMeasures {
  start: number;
  end: number;
  pivot: number;
  baseHigh: number;
  baseWk: number;
  baseDepth: number;
  coil: number | null;
  dry: number | null;
  /** Buying minus selling volume across the base, as a share of both (−1..1). */
  obv: number | null;
  /** Up-day volume ÷ down-day volume across the base. */
  udBase: number | null;
  /** Indices of days whose high poked above the lid but closed back under it. */
  squatIndices: number[];
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Mean true range, in price terms, of sessions `[from, to]`. Each session's
 * range reaches back to the close before it, including the first one's.
 */
export function meanTrueRange(candles: Candle[], from: number, to: number): number | null {
  const ranges: number[] = [];
  for (let i = Math.max(from, 1); i <= to; i += 1) {
    const current = candles[i];
    const previousClose = candles[i - 1].close;
    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose),
      ),
    );
  }
  return mean(ranges);
}

export function smaSeries(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Shape of the base spanning `[start, end]` against lid `pivot`. */
export function measureBase(
  candles: Candle[],
  start: number,
  end: number,
  pivot: number,
  baseHigh: number,
): BaseMeasures | null {
  const base = candles.slice(start, end + 1);
  // Quoted from the session after the peak, a just-born base spans one
  // session fewer than MIN_BASE_SESSIONS.
  if (base.length < MIN_BASE_SESSIONS - 1 || pivot <= 0) return null;

  const lowestLow = Math.min(...base.map((c) => c.low));
  // The first half takes the odd session, as the reference splits it.
  const half = Math.ceil(base.length / 2);
  const firstHalf = base.slice(0, half);
  const secondHalf = base.slice(half);
  const atrFirst = meanTrueRange(candles, start, start + half - 1);
  const atrSecond = meanTrueRange(candles, start + half, end);
  const volumeFirst = mean(firstHalf.map((c) => c.volume));
  const volumeSecond = mean(secondHalf.map((c) => c.volume));

  let upVolume = 0;
  let downVolume = 0;
  const squatIndices: number[] = [];
  for (let i = start; i <= end; i += 1) {
    const candle = candles[i];
    const previous = i > 0 ? candles[i - 1] : null;
    if (previous) {
      if (candle.close > previous.close) upVolume += candle.volume;
      else if (candle.close < previous.close) downVolume += candle.volume;
    }
    if (candle.high > pivot && candle.close <= pivot) squatIndices.push(i);
  }
  const bothSides = upVolume + downVolume;

  return {
    start,
    end,
    pivot,
    baseHigh,
    baseWk: base.length / SESSIONS_PER_WEEK,
    baseDepth: ((pivot - lowestLow) / pivot) * 100,
    coil: atrFirst && atrSecond && atrFirst > 0 ? atrSecond / atrFirst : null,
    dry: volumeFirst && volumeSecond && volumeFirst > 0 ? volumeSecond / volumeFirst : null,
    obv: bothSides > 0 ? (upVolume - downVolume) / bothSides : null,
    udBase: downVolume > 0 ? upVolume / downVolume : null,
    squatIndices,
  };
}

/**
 * The 8% stop is live from entry; the 50-day trail only arms on the first
 * close above the 50DMA, so a breakout from under it runs on the stop alone.
 */
function exitReason(episode: Episode, close: number, ma50: number | null): string | null {
  if (!episode.trailOn && ma50 != null && close > ma50) episode.trailOn = true;
  if (close <= episode.entryClose * (1 - STOP_LOSS_PERCENT / 100)) return `hit the ${STOP_LOSS_PERCENT}% stop`;
  if (episode.trailOn && ma50 != null && close < ma50) return "closed below its 50-day line";
  return null;
}

/**
 * When a breakout would have exited if it were judged on its own: a close 8% under its entry, or under the 50-day average
 * once it has closed above it. The walk ends an earlier breakout ("rebased") when a later one begins; BananaPatterns keeps
 * holding each breakout to its own exit, so an old breakout that never stopped out is still climbing.
 */
export function independentExit(candles: Candle[], episode: Episode, ma50: (number | null)[]): { index: number; why: string } | null {
  let trailOn = ma50[episode.index] != null && candles[episode.index].close > (ma50[episode.index] as number);
  for (let j = episode.index + 1; j < candles.length; j += 1) {
    const close = candles[j].close;
    const average = ma50[j];
    if (!trailOn && average != null && close > average) trailOn = true;
    if (close <= episode.entryClose * (1 - STOP_LOSS_PERCENT / 100)) return { index: j, why: `hit the ${STOP_LOSS_PERCENT}% stop` };
    if (trailOn && average != null && close < average) return { index: j, why: "closed below its 50-day line" };
  }
  return null;
}

export interface BaseState {
  /** First session after the peak, the date a base is quoted "since". */
  start: number;
  peak: number;
  /** The lid: highest close since the peak. */
  pivot: number;
  baseHigh: number;
  /** 1 is the outermost base; each base nested inside it is one level deeper. */
  level: number;
}

export interface EpisodeWalk {
  /** Every breakout in the history, failed pokes included. */
  episodes: Episode[];
  /** The breakout still in force today, if any. */
  live: Episode | null;
  /** The innermost base being built now that is old enough to break out of. */
  base: BaseState | null;
  /** Every born base being built now, outermost first (level 1 down to the innermost); `base` is the last of these. */
  bases: BaseState[];
}

interface Level {
  peak: number;
  lid: number;
  high: number;
  highClose: number;
  low: number;
}

interface PendingPoke {
  at: number;
  episodes: Episode[];
  snapshot: Level[];
  interrupted: Episode | null;
  pivot: number;
  baseHigh: number;
  cleared: boolean;
}

/**
 * Replays the history one session at a time, tracking up to `MAX_LEVELS`
 * bases nested inside each other.
 *
 * Level 1 begins at a peak. Until a base is `MIN_BASE_SESSIONS` old a higher
 * close moves its peak; once born the peak is fixed. Whenever a level makes a
 * new low, whatever was nested in it is discarded and a fresh inner base
 * starts from that low. A close above any born lid is a breakout from that
 * level (and from every born level inside it whose lid it also clears); the
 * newest breakout rebases the one before. A breakout that closes back under
 * its pivot within `POKE_WINDOW_SESSIONS` without ever closing above the
 * base's highest high was a failed poke: the bases resume as if it never
 * happened and the run it interrupted, if any, is back in force.
 */
export function walkEpisodes(candles: Candle[]): EpisodeWalk {
  const n = candles.length;
  const episodes: Episode[] = [];
  if (n < MIN_BASE_SESSIONS + 2) return { episodes, live: null, base: null, bases: [] };

  const ma50 = smaSeries(candles, 50);
  const bornAt = (level: Level, at: number) => at - level.peak >= MIN_BASE_SESSIONS;
  const fresh = (at: number): Level => ({
    peak: at,
    lid: candles[at].close,
    high: candles[at].high,
    highClose: candles[at].close,
    low: candles[at].low,
  });
  const include = (level: Level, at: number) => {
    const candle = candles[at];
    level.lid = Math.max(level.lid, candle.close);
    level.high = Math.max(level.high, candle.high);
    level.highClose = Math.max(level.highClose, candle.close);
    level.low = Math.min(level.low, candle.low);
  };
  const end = (episode: Episode, at: number, outcome: EpisodeOutcome, why: string | null) => {
    episode.outcome = outcome;
    episode.endIndex = at;
    episode.endTimestamp = candles[at].t;
    episode.retPct = (candles[at].close / episode.entryClose - 1) * 100;
    episode.why = why;
  };

  let levels: Level[] = [fresh(0)];
  let live: Episode | null = null;
  let pending: PendingPoke | null = null;

  // A session with no breakout: extend every level, move unborn peaks, and
  // restart the nest under any level that just made a new low.
  const absorb = (at: number) => {
    const candle = candles[at];
    for (let k = 0; k < levels.length; k += 1) {
      const level = levels[k];
      if (!bornAt(level, at) && candle.close > level.highClose) {
        levels[k] = fresh(at);
        levels = levels.slice(0, k + 1);
        return;
      }
      const newLow = candle.low < level.low;
      include(level, at);
      if (newLow) {
        levels = levels.slice(0, k + 1);
        if (k + 1 < MAX_LEVELS) levels.push(fresh(at));
        return;
      }
    }
  };

  for (let e = 1; e < n; e += 1) {
    const candle = candles[e];

    if (pending && e > pending.at) {
      if (e - pending.at > POKE_WINDOW_SESSIONS) {
        pending = null;
      } else {
        if (candle.close > pending.baseHigh) pending.cleared = true;
        if (!pending.cleared && candle.close <= pending.pivot) {
          const poke: PendingPoke = pending;
          pending = null;
          for (const episode of poke.episodes) end(episode, e, "failed", "closed back inside the base");
          levels = poke.snapshot;
          for (let j = poke.at; j <= e; j += 1) for (const level of levels) include(level, j);
          live = null;
          const parent = poke.interrupted;
          if (parent && parent.outcome === "rebased") {
            parent.outcome = "live";
            parent.endIndex = null;
            parent.endTimestamp = null;
            parent.why = null;
            live = parent;
            for (let j = poke.at + 1; j <= e; j += 1) {
              const why = exitReason(parent, candles[j].close, ma50[j]);
              if (why) {
                end(parent, j, "played", why);
                live = null;
                break;
              }
            }
          }
          continue;
        }
      }
    }

    if (live && e > live.index) {
      const why = exitReason(live, candle.close, ma50[e]);
      if (why) {
        end(live, e, "played", why);
        live = null;
      }
    }

    const outer = levels.findIndex((level) => bornAt(level, e) && candle.close > level.lid);
    if (outer < 0) {
      absorb(e);
      continue;
    }

    const snapshot = levels.map((level) => ({ ...level }));
    const interrupted = live;
    const opened: Episode[] = [];
    for (let k = levels.length - 1; k >= outer; k -= 1) {
      const level = levels[k];
      if (!bornAt(level, e) || candle.close <= level.lid) continue;
      const episode: Episode = {
        index: e,
        timestamp: candle.t,
        pivot: level.lid,
        peak: level.peak,
        baseStart: Math.min(level.peak + 1, e - 1),
        baseHigh: level.high,
        level: k + 1,
        entryClose: candle.close,
        outcome: "live",
        endIndex: null,
        endTimestamp: null,
        retPct: 0,
        why: null,
        parent: null,
        trailOn: ma50[e] != null && candle.close > (ma50[e] as number),
      };
      if (live) {
        end(live, e, "rebased", null);
        episode.parent = live;
      }
      episodes.push(episode);
      opened.push(episode);
      live = episode;
    }
    const outerLevel = levels[outer];
    pending = {
      at: e,
      episodes: opened,
      snapshot,
      interrupted,
      pivot: outerLevel.lid,
      baseHigh: outerLevel.high,
      cleared: candle.close > outerLevel.high,
    };
    levels = levels.slice(0, outer);
    levels.push(fresh(e));
  }

  if (live) live.retPct = (candles[n - 1].close / live.entryClose - 1) * 100;
  // Every born level counts: a stock can sit in a short inner base and a year-long outer one at the same time.
  const bases: BaseState[] = [];
  levels.forEach((level, k) => {
    if (bornAt(level, n - 1)) bases.push({ start: level.peak + 1, peak: level.peak, pivot: level.lid, baseHigh: level.high, level: k + 1 });
  });
  const base = bases.length ? bases[bases.length - 1] : null;
  return { episodes, live, base, bases };
}

/** Facts as they stood on a breakout day, the snapshot screens judge it on. */
export interface EntryFacts {
  rs: number | null;
  vs50: number | null;
  vs200: number | null;
  fromHigh: number | null;
  aboveLow: number | null;
  baseWk: number | null;
  baseDepth: number | null;
  coil: number | null;
  dry: number | null;
  obv: number | null;
  listedWk: number;
  level: number | null;
  /** Where the prior close sat against the lid; never positive. */
  ext: number | null;
  volumeRatio: number | null;
  closeInRange: number | null;
}

export function entryFacts(candles: Candle[], episode: Episode): EntryFacts {
  const e = episode.index;
  const candle = candles[e];
  const upTo = candles.slice(0, e + 1);
  const ma = (period: number) =>
    upTo.length >= period ? mean(upTo.slice(-period).map((c) => c.close)) : null;
  const ma50 = ma(50);
  const ma200 = ma(200);
  const year = upTo.slice(-252);
  const high52 = Math.max(...year.map((c) => c.high));
  const low52 = Math.min(...year.map((c) => c.low));
  const base = measureBase(candles, episode.baseStart, e - 1, episode.pivot, episode.baseHigh);
  const avgVolume = mean(candles.slice(Math.max(0, e - VOLUME_WINDOW), e).map((c) => c.volume));
  const range = candle.high - candle.low;
  const priorClose = candles[e - 1]?.close;

  return {
    rs: null,
    vs50: ma50 ? ((candle.close - ma50) / ma50) * 100 : null,
    vs200: ma200 ? ((candle.close - ma200) / ma200) * 100 : null,
    fromHigh: high52 > 0 ? ((high52 - candle.close) / high52) * 100 : null,
    aboveLow: low52 > 0 ? ((candle.close - low52) / low52) * 100 : null,
    baseWk: base?.baseWk ?? null,
    baseDepth: base?.baseDepth ?? null,
    coil: base?.coil ?? null,
    dry: base?.dry ?? null,
    obv: base?.obv ?? null,
    listedWk: (e + 1) / SESSIONS_PER_WEEK,
    level: episode.level,
    ext: priorClose != null ? Math.min(0, ((priorClose - episode.pivot) / episode.pivot) * 100) : null,
    volumeRatio: avgVolume && avgVolume > 0 ? candle.volume / avgVolume : null,
    closeInRange: range > 0 ? (candle.close - candle.low) / range : null,
  };
}
