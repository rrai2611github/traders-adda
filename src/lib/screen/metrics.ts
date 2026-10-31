import type { Candle } from "@/lib/market/types";
import type { FactorValues } from "./criteria";
import { rankToRs, rsAmong } from "./rsScale";
import {
  FRESH_BREAKOUT_SESSIONS,
  MIN_BASE_SESSIONS,
  entryFacts,
  measureBase,
  walkEpisodes,
  type BaseMeasures,
  type EntryFacts,
  type Episode,
} from "./episodes";

/**
 * Derives the BananaPatterns factor set from daily candles.
 *
 * Definitions follow the tooltips shipped in the source bundle:
 * - turnover is the MEDIAN day's traded value over 50 sessions, so a single
 *   frantic day cannot make a thin stock look liquid
 * - `coil` and `dry` compare the base's second half against its first
 * - `ext` is the live position against the pivot, negative until it clears
 * - the pivot is the base's highest close (see `episodes.ts`)
 */

/** Names you can actually trade: the gate every screen runs behind. */
export const LIQUIDITY_FLOOR = { mcapCr: 300, turnoverCr: 5 };

/**
 * The wider floor the Core Setups screens and the breakout record use (BananaPatterns lists anything above ₹1 Cr a day
 * and ₹300 Cr). Everything that trades off the scan (breadth, Today's Picks, the Weekly Top 5, Buy ready, scanners) keeps
 * `LIQUIDITY_FLOOR`, so loosening the screens never moves a trading signal.
 */
export const SCREEN_FLOOR = { mcapCr: 300, turnoverCr: 1 };

const SESSIONS_PER_WEEK = 5;
const TURNOVER_WINDOW = 50;
/** Episodes older than this are not listed (covers a full calendar year). */
const RECENT_SESSIONS = 300;

export type Stage = "forming" | "breakout" | "climbing" | "played-out";

export interface EpisodeWithFacts {
  episode: Episode;
  entry: EntryFacts;
}

export interface FormingBaseInfo {
  /** Nesting level (1 is outermost). */
  level: number;
  base: BaseMeasures;
  /** Failed pokes inside this base. */
  pokes: number;
}

export interface StockMetrics extends FactorValues {
  symbol: string;
  price: number;
  changePercent: number;
  /** The lid of the base the stage is measured against, in rupees. */
  pivotPrice: number | null;
  ma50: number | null;
  ma200: number | null;
  high52w: number | null;
  low52w: number | null;
  /** Median traded value over the last 50 sessions, in rupees crore. */
  turnoverCr: number | null;
  passesFloor: boolean;
  /** Clears the wider `SCREEN_FLOOR`; the screens and the breakout record list these, the trading signals do not. */
  passesScreenFloor: boolean;
  /** Primary stage: a live breakout outranks a base being built inside it. */
  stage: Stage | null;
  /** The base being built right now, when there is one. */
  formingBase: BaseMeasures | null;
  /** Nesting level of the base being built right now (1 is outermost). */
  formingLevel: number | null;
  /** Every base being built right now, innermost first; the first matches `formingBase`. */
  formingBases: FormingBaseInfo[];
  /** Failed pokes inside the base being built right now. */
  formingPokes: number;
  /** The breakout still in force, with the facts it was judged on. */
  live: EpisodeWithFacts | null;
  /** Every breakout in the walked window that was not a failed poke. */
  episodes: EpisodeWithFacts[];
  /** Failed pokes in the walked window. */
  failedPokes: Episode[];
  /** Up/down volume, net, across the base the stage is measured against. */
  obv: number | null;
  /** Up-day ÷ down-day volume across that base. */
  udBase: number | null;
  /** Today's volume against the 50-day average, as a ratio. */
  volumeRatio: number | null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function movingAverage(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  return mean(candles.slice(-period).map((c) => c.close));
}

export interface MetricsInput {
  symbol: string;
  candles: Candle[];
  /** Live price; falls back to the last close outside market hours. */
  price?: number;
  changePercent?: number;
  marketCapCr?: number;
  /** False for trade-for-trade stocks: the screens list them, but they never count as tradable. Default true. */
  tradable?: boolean;
}

/**
 * Computes every screen input for one stock. RS is left null here because it is
 * a cross-sectional rank; `assignRsRatings` fills it once the whole universe
 * has been measured.
 */
export function computeMetrics(input: MetricsInput): StockMetrics | null {
  const { candles, symbol } = input;
  if (candles.length < 20) return null;

  const n = candles.length;
  const lastClose = candles[n - 1].close;
  const price = input.price ?? lastClose;
  if (!Number.isFinite(price) || price <= 0) return null;

  const ma50 = movingAverage(candles, 50);
  const ma200 = movingAverage(candles, 200);

  const yearWindow = candles.slice(-252);
  const high52w = Math.max(...yearWindow.map((c) => c.high));
  const low52w = Math.min(...yearWindow.map((c) => c.low));

  const turnoverCr = median(
    candles.slice(-TURNOVER_WINDOW).map((c) => (c.close * c.volume) / 1e7),
  );

  const marketCapCr = input.marketCapCr ?? null;
  const passesFloor =
    input.tradable !== false &&
    (marketCapCr == null || marketCapCr >= LIQUIDITY_FLOOR.mcapCr) &&
    turnoverCr != null &&
    turnoverCr >= LIQUIDITY_FLOOR.turnoverCr;

  const passesScreenFloor =
    (marketCapCr == null || marketCapCr >= SCREEN_FLOOR.mcapCr) &&
    turnoverCr != null &&
    turnoverCr >= SCREEN_FLOOR.turnoverCr;

  // Only names the screens can list get the full replay; nothing downstream shows the rest.
  const walk = passesScreenFloor ? walkEpisodes(candles) : { episodes: [], live: null, base: null, bases: [] };
  const withFacts = (episode: Episode): EpisodeWithFacts => ({ episode, entry: entryFacts(candles, episode) });
  // Only recent history is ever shown or screened; older episodes keep their
  // place in a run (via parent) without needing their own facts.
  const episodes = walk.episodes
    .filter((e) => e.outcome !== "failed" && (e.index >= n - RECENT_SESSIONS || e === walk.live))
    .map(withFacts);
  const failedPokes = walk.episodes.filter((e) => e.outcome === "failed" && e.index >= n - RECENT_SESSIONS);
  const live = walk.live ? episodes.find((e) => e.episode === walk.live) ?? null : null;

  let formingBase: BaseMeasures | null = null;
  let formingLevel: number | null = null;
  if (passesScreenFloor) {
    const current = walk.base;
    if (current && (!live || current.start >= live.episode.index)) {
      formingBase = measureBase(candles, current.start, n - 1, current.pivot, current.baseHigh);
      if (formingBase) formingLevel = current.level;
    }
  }
  // Every base being built, innermost first, for screens that any one base can satisfy (a stock in a short inner base may
  // also sit in a year-long outer one).
  const formingBases: FormingBaseInfo[] = [];
  if (passesScreenFloor) {
    for (const current of [...walk.bases].reverse()) {
      // Under a live breakout only bases that still hold a lid above today's price count: one built since the breakout, or an
      // outer base the run has not yet cleared (a stock climbing out of a short base can still be forming a multi-year one).
      if (live && current.start < live.episode.index && current.pivot <= price) continue;
      const measures = measureBase(candles, current.start, n - 1, current.pivot, current.baseHigh);
      if (!measures) continue;
      formingBases.push({
        level: current.level,
        base: measures,
        pokes: failedPokes.filter((e) => e.index >= measures.start).length,
      });
    }
  }
  const formingPokes = formingBase
    ? failedPokes.filter((e) => e.index >= (formingBase as BaseMeasures).start).length
    : 0;

  let stage: Stage | null = null;
  if (live) {
    stage = n - 1 - live.episode.index < FRESH_BREAKOUT_SESSIONS ? "breakout" : "climbing";
  } else if (formingBase) {
    stage = "forming";
  }

  // Base facts follow the primary stage: the live breakout's base, else the
  // base being built.
  const liveBase = live
    ? measureBase(candles, live.episode.baseStart, live.episode.index - 1, live.episode.pivot, live.episode.baseHigh)
    : null;
  const base = liveBase ?? formingBase;
  const pivotPrice = live ? live.episode.pivot : formingBase?.pivot ?? null;

  const avgVolume = mean(candles.slice(-TURNOVER_WINDOW - 1, -1).map((c) => c.volume));

  return {
    symbol,
    price,
    changePercent: input.changePercent ?? 0,
    rs: null,
    vs50: ma50 ? ((price - ma50) / ma50) * 100 : null,
    vs200: ma200 ? ((price - ma200) / ma200) * 100 : null,
    fromHigh: high52w > 0 ? ((high52w - price) / high52w) * 100 : null,
    aboveLow: low52w > 0 ? ((price - low52w) / low52w) * 100 : null,
    turn: turnoverCr,
    mcap: marketCapCr,
    baseWk: base?.baseWk ?? null,
    baseDepth: base?.baseDepth ?? null,
    coil: base?.coil ?? null,
    dry: base?.dry ?? null,
    listedWk: n / SESSIONS_PER_WEEK,
    level: live ? live.episode.level : formingLevel,
    ext: pivotPrice ? ((price - pivotPrice) / pivotPrice) * 100 : null,
    pivotPrice,
    ma50,
    ma200,
    high52w,
    low52w,
    turnoverCr,
    passesFloor,
    passesScreenFloor,
    stage,
    formingBase,
    formingLevel,
    formingBases,
    formingPokes,
    live,
    episodes,
    failedPokes,
    obv: base?.obv ?? null,
    udBase: base?.udBase ?? null,
    volumeRatio: avgVolume && avgVolume > 0 ? candles[n - 1].volume / avgVolume : null,
  };
}

/** Sessions a base must span before it is announced as born. */
export const BASE_BORN_SESSIONS = MIN_BASE_SESSIONS;

/**
 * Ranks price performance across the tradable universe, 1-99.
 *
 * Only floor-passing names are ranked: the source notes that including
 * untradeable microcaps would distort the scale.
 */
export function assignRsRatings(
  metrics: StockMetrics[],
  returnsBySymbol: Map<string, number | null>,
): void {
  const ranked = metrics
    .filter((m) => m.passesFloor && returnsBySymbol.get(m.symbol) != null)
    .map((m) => ({ metric: m, score: returnsBySymbol.get(m.symbol) as number }));
  const ratings = rankToRs(ranked.map((r) => r.score));
  ranked.forEach((entry, index) => {
    entry.metric.rs = ratings[index];
  });
  // Stocks only the screens list are placed on the same scale without moving anyone already rated.
  const scale = ranked.map((r) => r.score).sort((a, b) => a - b);
  for (const m of metrics) {
    const score = returnsBySymbol.get(m.symbol);
    if (m.passesScreenFloor && !m.passesFloor && score != null) m.rs = rsAmong(scale, score);
  }
}

export { rankToRs };

/**
 * Weighted relative performance, the input to the RS rank. Recent quarters
 * carry the most weight, matching the CAN SLIM style the screens are built on.
 */
export function performanceScore(candles: Candle[]): number | null {
  return performanceScoreAt(candles, candles.length - 1);
}

/** `performanceScore` as it stood at session `at`, without slicing. */
export function performanceScoreAt(candles: Candle[], at: number): number | null {
  // Anything that clears `computeMetrics`' own history minimum can be ranked;
  // brand-new listings are exactly what the IPO screen is looking for.
  if (at < 14 || at >= candles.length) return null;
  const last = candles[at].close;

  const windows: Array<[number, number]> = [
    [63, 0.4],
    [126, 0.2],
    [189, 0.2],
    [252, 0.2],
  ];

  let score = 0;
  let weightUsed = 0;
  for (const [sessions, weight] of windows) {
    if (at < sessions) continue;
    const past = candles[at - sessions].close;
    if (past <= 0) continue;
    score += (last / past - 1) * weight;
    weightUsed += weight;
  }
  if (!weightUsed) {
    // A listing too young for even the shortest window still needs a rating,
    // so fall back to its whole life.
    const first = candles[0].close;
    return first > 0 ? (last / first - 1) * 100 : null;
  }
  return (score / weightUsed) * 100;
}
