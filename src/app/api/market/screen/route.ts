import { getDataSource } from "@/lib/market/engine";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { getActiveSession } from "@/lib/market/marketHours";
import { EQUITIES, UNIVERSE_INFO } from "@/lib/market/universe";
import {
  HOUSE_PRESETS,
  SCREEN_BADGES,
  SCREEN_NAMES,
  type FactorValues,
  type ScreenName,
  matchesScreen,
  screenBadges,
} from "@/lib/screen/criteria";
import { FRESH_BREAKOUT_SESSIONS, MIN_BASE_SESSIONS, independentExit, smaSeries, type BaseMeasures, type Episode } from "@/lib/screen/episodes";
import { judgeBases } from "@/lib/screen/multiBase";
import type { EpisodeWithFacts, StockMetrics } from "@/lib/screen/metrics";
import { istDayNumber, scanUniverse } from "@/lib/screen/scan";
import { measureRpciApproximation, type RpciApproxResult } from "@/lib/screen/rpciApprox";
import { measureMomentumOscillator, type MomentumResult } from "@/lib/screen/oscillators";
import { scoreOscillators, type OscillatorScore } from "@/lib/screen/oscillatorScore";
import { relativeVolume, riskFlags, type RelativeVolume, type RiskFlag } from "@/lib/screen/riskFlags";
import { measureRsiEdgeFacts, type RsiEdgeFacts } from "@/lib/screen/rsiEdgeScans";
import { priceActionRating, type PriceActionRating } from "@/lib/screen/priceActionRating";

export const dynamic = "force-dynamic";

type RowStage = "forming" | "breakout" | "climbing" | "played-out";

interface ScanRow {
  /** Unique per row: a stock can sit in more than one stage at once. */
  key: string;
  symbol: string;
  name: string;
  /** Clears the trading liquidity floor; false for names only the wider screen floor lists. */
  liquid: boolean;
  /** NSE series: "BE" is trade-for-trade. */
  series: "EQ" | "BE";
  sector?: string;
  price: number;
  changePercent: number;
  rs: number | null;
  ext: number | null;
  vs50: number | null;
  vs200: number | null;
  fromHigh: number | null;
  aboveLow: number | null;
  coil: number | null;
  dry: number | null;
  obv: number | null;
  udBase: number | null;
  baseWk: number | null;
  baseDepth: number | null;
  listedWk: number | null;
  level: number | null;
  turnoverCr: number | null;
  mcap: number | null;
  pivotPrice: number | null;
  stage: RowStage | null;
  squats: number;
  failedPokes: number;
  baseStartTimestamp: number | null;
  breakoutReturn: number | null;
  exitReason: string | null;
  exitTimestamp: number | null;
  breakoutVolume: number | null;
  closeInRange: number | null;
  breakoutTimestamp: number | null;
  /** RS on the breakout day, which the screens judge a breakout on. */
  entryRs: number | null;
  /** The card's history line inputs, per screen ("all" when unscreened). */
  history: Record<HistoryKey, RowHistory>;
  badges: string[];
  screens: ScreenName[];
  rpciApprox: RpciApproxResult | null;
  momentum: MomentumResult | null;
  oscillatorScore: OscillatorScore | null;
  rsiEdge: RsiEdgeFacts | null;
  quoteTimestamp: number | null;
  rvol: RelativeVolume | null;
  riskFlags: RiskFlag[];
  paRating: PriceActionRating;
}

interface RowHistory {
  /** The last breakout before this base, when it played out. */
  previous: { retPct: number; exitTimestamp: number | null } | null;
  /** The run this row belongs to when bases have been built mid-run. */
  run: { bases: number; firstTimestamp: number; gainPct: number } | null;
}

type FeedType =
  | "breakout"
  | "inner_breakout"
  | "failed_poke"
  | "played_out"
  | "milestone_10"
  | "milestone_20"
  | "now_climbing"
  | "squat"
  | "base_born";

interface FeedEvent {
  type: FeedType;
  symbol: string;
  name: string;
  price: number;
  pivot: number;
  screens: ScreenName[];
  ext?: number;
  volumeRatio?: number | null;
  retPct?: number;
  why?: string | null;
  nth?: number;
  sinceTimestamp?: number;
  breakoutTimestamp?: number;
  baseWk?: number;
  baseDepth?: number;
  level?: number;
}

let scanCache: { snapshotId: number; providerId: string; payload: unknown } | null = null;

function screensFor(values: FactorValues): ScreenName[] {
  return SCREEN_NAMES.filter((name) => matchesScreen(values, HOUSE_PRESETS[name]));
}

/** The facts a breakout was screened on: its own day's, not today's. */
function entryValues(m: StockMetrics, item: EpisodeWithFacts): FactorValues {
  const { entry } = item;
  return {
    rs: entry.rs,
    vs50: entry.vs50,
    vs200: entry.vs200,
    fromHigh: entry.fromHigh,
    aboveLow: entry.aboveLow,
    turn: m.turn,
    mcap: m.mcap,
    baseWk: entry.baseWk,
    baseDepth: entry.baseDepth,
    coil: entry.coil,
    dry: entry.dry,
    listedWk: entry.listedWk,
    level: entry.level,
    ext: entry.ext,
  };
}

/** Trade-for-trade stocks carry a visible tag wherever badges are shown. */
function tagTradeForTrade(row: ScanRow): ScanRow {
  return row.series === "BE" && !row.badges.includes("T2T") ? { ...row, badges: [...row.badges, "T2T"] } : row;
}

/** Today's facts against the base being built now. */
function formingValues(m: StockMetrics): FactorValues | null {
  const base = m.formingBase;
  if (!base) return null;
  return {
    ...m,
    baseWk: base.baseWk,
    baseDepth: base.baseDepth,
    coil: base.coil,
    dry: base.dry,
    level: m.formingLevel,
    ext: ((m.price - base.pivot) / base.pivot) * 100,
  };
}

/** The facts a screen judges one base on: today's price against that base's own pivot, shape and level. */
function baseValues(m: StockMetrics, base: BaseMeasures, level: number): FactorValues {
  return {
    ...m,
    baseWk: base.baseWk,
    baseDepth: base.baseDepth,
    coil: base.coil,
    dry: base.dry,
    level,
    ext: ((m.price - base.pivot) / base.pivot) * 100,
  };
}

type HistoryKey = "all" | ScreenName;

interface Leg {
  episode: Episode;
  screens: ScreenName[];
}

/**
 * Where a run went: a rebased breakout carries on through the next base, so
 * its result compounds along the chain until one plays out (or is still live).
 */
function runEnd(
  episode: Episode,
  childOf: Map<Episode, Episode>,
): { through: Set<Episode>; played: { retPct: number; exitTimestamp: number | null } | null } {
  const through = new Set<Episode>([episode]);
  let growth = 1;
  let current = episode;
  while (current.outcome === "rebased" && childOf.has(current)) {
    growth *= 1 + current.retPct / 100;
    current = childOf.get(current) as Episode;
    through.add(current);
  }
  if (current.outcome !== "played") return { through, played: null };
  growth *= 1 + current.retPct / 100;
  return { through, played: { retPct: (growth - 1) * 100, exitTimestamp: current.endTimestamp } };
}

/**
 * The card's history for one screen: only this year's breakouts that passed
 * the screen on their own day count. Consecutive counted bases in one run make
 * the row the Nth base; otherwise the last counted breakout's played-out
 * result is quoted.
 */
function historyFor(
  legs: Leg[],
  childOf: Map<Episode, Episode>,
  row: { episode: Episode | null; formingStart: number | null; price: number },
  screen: ScreenName | null,
): RowHistory {
  const prior = legs.filter(
    (leg) =>
      leg.episode !== row.episode &&
      (screen == null || leg.screens.includes(screen)) &&
      // Breakouts from bases nested inside the one being built now are part of it.
      !(row.formingStart != null && leg.episode.baseStart >= row.formingStart) &&
      leg.episode.index < (row.episode?.index ?? Infinity),
  );
  let n = 1;
  let first: Episode | null = row.episode;
  let previous: RowHistory["previous"] = null;
  // Walk back while each earlier counted breakout's run reaches the next one.
  let next: Episode | null = row.episode;
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const leg = prior[i].episode;
    const end = runEnd(leg, childOf);
    const continues = next ? end.through.has(next) : end.played == null;
    if (!continues) {
      if (n === 1) previous = end.played;
      break;
    }
    n += 1;
    first = leg;
    next = leg;
  }
  if (n >= 2 && first) {
    return {
      previous: null,
      run: { bases: n, firstTimestamp: first.timestamp, gainPct: (row.price / first.pivot - 1) * 100 },
    };
  }
  return { previous, run: null };
}

/**
 * Runs the house screens across the universe using live prices.
 *
 * Forming names are screened on today's facts; breakouts, climbers and played
 * out episodes on the facts of their breakout day, the way the reference
 * method judges them.
 */
export async function GET() {
  const state = getUniverseSnapshot();
  if (state.status === "warming") return universeWarmingResponse(state.progress);
  if (state.status === "failed") return marketProviderErrorResponse(state.error);
  const snapshot = state.snapshot;

  if (scanCache && scanCache.snapshotId === snapshot.id && scanCache.providerId === snapshot.providerId) {
    return Response.json({ ...(scanCache.payload as object), refreshFailure: state.refreshFailure }, { headers: { "Cache-Control": "no-store" } });
  }

  const { metrics, candlesBySymbol, rawCandlesBySymbol, insufficientHistory } = scanUniverse(snapshot);
  if (metrics.length === 0) {
    return marketProviderErrorResponse(
      new Error("Market scan returned no metrics from the selected data provider."),
    );
  }

  const instrumentBySymbol = new Map(EQUITIES.map((e) => [e.symbol, e]));
  const session = getActiveSession();
  // The screens list everything above the wider screen floor. Tradable stocks stay in `rows` (market breadth and the
  // trading views are built from them); the thinner extra names go in `extraRows`, flagged `liquid: false`.
  const tradable = metrics.filter((m) => m.passesScreenFloor);

  const latestDay = Math.max(
    ...tradable.map((m) => {
      const candles = candlesBySymbol.get(m.symbol) ?? [];
      return candles.length ? istDayNumber(candles[candles.length - 1].t) : 0;
    }),
  );
  const currentYear = new Date(latestDay * 86_400_000).getUTCFullYear();
  /** Breakouts from the last 12 months, the window BananaPatterns lists played-out and history lines over. */
  const windowStart = latestDay * 86_400_000 - 365 * 86_400_000;

  const rows: ScanRow[] = [];
  const extraRows: ScanRow[] = [];
  const feed: FeedEvent[] = [];

  for (const m of tradable) {
    const candles = candlesBySymbol.get(m.symbol) ?? [];
    const n = candles.length;
    const instrument = instrumentBySymbol.get(m.symbol);
    const name = instrument?.name ?? m.symbol;
    const live = m.live;
    const forming = formingValues(m);
    const liveValues = live ? entryValues(m, live) : null;
    const primaryValues: FactorValues = liveValues ?? forming ?? m;

    const base = {
      symbol: m.symbol,
      name,
      liquid: m.passesFloor,
      series: instrument?.series ?? "EQ",
      sector: instrument?.sector,
      price: m.price,
      changePercent: m.changePercent,
      rs: m.rs,
      vs50: m.vs50,
      vs200: m.vs200,
      fromHigh: m.fromHigh,
      aboveLow: m.aboveLow,
      listedWk: m.listedWk,
      turnoverCr: m.turnoverCr,
      mcap: m.mcap,
      quoteTimestamp: snapshot.quotes.get(m.symbol)?.timestamp ?? null,
      rvol: relativeVolume(candles, session),
      riskFlags: riskFlags(candles, { vs50: m.vs50, turnoverCr: m.turnoverCr }),
      paRating: priceActionRating(candles, m.turnoverCr),
    };

    const formingFields = (values: FactorValues, source: BaseMeasures | null = m.formingBase, pokes: number = m.formingPokes) => ({
      ext: values.ext,
      coil: values.coil,
      dry: values.dry,
      obv: source?.obv ?? null,
      udBase: source?.udBase ?? null,
      baseWk: values.baseWk,
      baseDepth: values.baseDepth,
      level: values.level,
      pivotPrice: source?.pivot ?? null,
      squats: source?.squatIndices.length ?? 0,
      failedPokes: pokes,
      baseStartTimestamp: source ? candles[source.start].t : null,
      breakoutReturn: null,
      exitReason: null,
      exitTimestamp: null,
      breakoutVolume: null,
      closeInRange: null,
      breakoutTimestamp: null,
      entryRs: null,
    });

    /** `own` judges an earlier breakout on its own exit rule instead of how the walk ended it. */
    const episodeFields = (item: EpisodeWithFacts, values: FactorValues, own?: { retPct: number; exit: { why: string; timestamp: number } | null }) => {
      const { episode, entry } = item;
      return {
        ext: ((m.price - episode.pivot) / episode.pivot) * 100,
        coil: values.coil,
        dry: values.dry,
        obv: entry.obv,
        udBase: null,
        baseWk: values.baseWk,
        baseDepth: values.baseDepth,
        level: values.level,
        pivotPrice: episode.pivot,
        squats: 0,
        failedPokes: 0,
        baseStartTimestamp: candles[episode.baseStart]?.t ?? null,
        breakoutReturn: own ? own.retPct : episode.retPct,
        exitReason: own ? own.exit?.why ?? null : episode.outcome === "played" ? episode.why : null,
        exitTimestamp: own ? own.exit?.timestamp ?? null : episode.outcome === "played" ? episode.endTimestamp : null,
        breakoutVolume: entry.volumeRatio,
        closeInRange: entry.closeInRange,
        breakoutTimestamp: episode.timestamp,
        entryRs: entry.rs,
      };
    };

    const inYear = (episode: Episode) => episode.timestamp >= windowStart;
    const legs: Leg[] = m.episodes
      .filter((item) => inYear(item.episode))
      .map((item) => ({ episode: item.episode, screens: screensFor(entryValues(m, item)) }));
    const childOf = new Map<Episode, Episode>();
    for (const item of m.episodes) if (item.episode.parent) childOf.set(item.episode.parent, item.episode);
    const histories = (episode: Episode | null, formingStart: number | null): Record<HistoryKey, RowHistory> => {
      const row = { episode, formingStart, price: m.price };
      const out = { all: historyFor(legs, childOf, row, null) } as Record<HistoryKey, RowHistory>;
      for (const name of SCREEN_NAMES) out[name] = historyFor(legs, childOf, row, name);
      return out;
    };

    const rpciApprox = measureRpciApproximation(rawCandlesBySymbol.get(m.symbol) ?? candles, m, session);
    const primaryScreens = screensFor(primaryValues);
    const primaryFields = live && liveValues ? episodeFields(live, liveValues) : formingFields(primaryValues);
    const primary: ScanRow = {
      ...base,
      key: `${m.symbol}|${m.stage ?? "none"}`,
      ...primaryFields,
      riskFlags: riskFlags(candles, { vs50: m.vs50, turnoverCr: m.turnoverCr, stage: m.stage, breakoutVolume: primaryFields.breakoutVolume }),
      stage: m.stage,
      history: live ? histories(live.episode, null) : histories(null, m.formingBase?.start ?? null),
      badges: screenBadges(primaryValues),
      screens: primaryScreens,
      rpciApprox,
      momentum: measureMomentumOscillator(candles, m, session),
      oscillatorScore: m.passesFloor ? scoreOscillators(candles, session) : null,
      rsiEdge: measureRsiEdgeFacts(candles),
      quoteTimestamp: base.quoteTimestamp,
    };
    (m.passesFloor ? rows : extraRows).push(primary);

    // A breakout often clears nested bases on the same day (L3, L2 and L1 together). The main row judges the outermost one;
    // each inner base is judged on its own facts, and a screen only it satisfies lists the stock too (their "N bases match").
    const liveClaimed = new Set<ScreenName>(live ? primaryScreens : []);
    if (live) {
      const sameDay = m.episodes.filter((item) => item !== live && item.episode.index === live.episode.index);
      for (const judged of judgeBases(sameDay, (item) => entryValues(m, item), primaryScreens)) {
        if (!judged.claimed.length) continue;
        for (const name of judged.claimed) liveClaimed.add(name);
        const item = judged.candidate;
        const values = entryValues(m, item);
        extraRows.push({
          ...base,
          key: `${m.symbol}|${m.stage}|L${item.episode.level}`,
          ...episodeFields(item, values),
          stage: m.stage,
          history: histories(item.episode, null),
          badges: judged.claimed.map((name) => SCREEN_BADGES[name]),
          screens: judged.claimed,
          rpciApprox: null,
          momentum: null,
          oscillatorScore: null,
          rsiEdge: null,
        });
      }
    }

    // A new base built while the breakout is still running: on watch too.
    if (live && forming) {
      extraRows.push({
        ...base,
        key: `${m.symbol}|forming`,
        ...formingFields(forming),
        stage: "forming",
        history: histories(null, m.formingBase?.start ?? null),
        badges: screenBadges(forming),
        screens: screensFor(forming),
        rpciApprox: null,
        momentum: null,
        oscillatorScore: null,
        rsiEdge: null,
      });
    }

    // Outer bases are judged on their own facts: a stock in a short inner base still lists under a screen that only a
    // longer or higher base satisfies (BananaPatterns' "2 bases match"). Each screen lists the stock once per stage.
    if (m.formingBases.length > 1) {
      const covered = live ? (forming ? screensFor(forming) : []) : primaryScreens;
      const others = m.formingBases.filter((b) => b.level !== m.formingLevel);
      for (const judged of judgeBases(others, (b) => baseValues(m, b.base, b.level), covered)) {
        if (!judged.claimed.length) continue;
        const { base: measures, level, pokes } = judged.candidate;
        const values = baseValues(m, measures, level);
        extraRows.push({
          ...base,
          key: `${m.symbol}|forming|L${level}`,
          ...formingFields(values, measures, pokes),
          stage: "forming",
          history: histories(null, measures.start),
          badges: judged.claimed.map((name) => SCREEN_BADGES[name]),
          screens: judged.claimed,
          rpciApprox: null,
          momentum: null,
          oscillatorScore: null,
          rsiEdge: null,
        });
      }
    }

    // Earlier breakouts the walk ended when a newer one began are judged on their own exit rule, as BananaPatterns does: one
    // that never stopped out is still climbing, one that did is played out. Each screen lists the stock once per stage.
    const ownStage = new Map<string, Set<ScreenName>>([[m.stage ?? "", liveClaimed]]);
    const ma50Series = smaSeries(candles, 50);
    const earlier = m.episodes
      .filter((item) => item.episode.outcome === "rebased" && inYear(item.episode) && !(live && item.episode.index === live.episode.index))
      .sort((a, b) => b.episode.index - a.episode.index);
    for (const item of earlier) {
      const values = entryValues(m, item);
      const matched = screensFor(values);
      if (!matched.length) continue;
      const exit = independentExit(candles, item.episode, ma50Series);
      const endClose = candles[exit ? exit.index : candles.length - 1].close;
      const own = {
        retPct: (endClose / item.episode.entryClose - 1) * 100,
        exit: exit ? { why: exit.why, timestamp: candles[exit.index].t } : null,
      };
      let stage: ScanRow["stage"];
      let screens = matched;
      if (exit) {
        stage = "played-out";
      } else {
        stage = n - 1 - item.episode.index < FRESH_BREAKOUT_SESSIONS ? "breakout" : "climbing";
        const taken = ownStage.get(stage) ?? new Set<ScreenName>();
        screens = matched.filter((name) => !taken.has(name));
        if (!screens.length) continue;
        for (const name of screens) taken.add(name);
        ownStage.set(stage, taken);
      }
      extraRows.push({
        ...base,
        key: `${m.symbol}|${stage}|e${item.episode.index}`,
        ...episodeFields(item, values, own),
        stage,
        history: histories(item.episode, null),
        badges: screens.map((name) => SCREEN_BADGES[name]),
        screens,
        rpciApprox: null,
        momentum: null,
        oscillatorScore: null,
        rsiEdge: null,
      });
    }

    for (const item of m.episodes) {
      const { episode } = item;
      if (episode.outcome !== "played") continue;
      if (!inYear(episode)) continue;
      const values = entryValues(m, item);
      extraRows.push({
        ...base,
        key: `${m.symbol}|played|${episode.timestamp}`,
        ...episodeFields(item, values),
        stage: "played-out",
        history: histories(episode, null),
        badges: screenBadges(values),
        screens: screensFor(values),
        rpciApprox: null,
        momentum: null,
        oscillatorScore: null,
        rsiEdge: null,
      });
    }

    // What changed on the latest session.
    if (!n || istDayNumber(candles[n - 1].t) !== latestDay) continue;
    const today = n - 1;
    const event = (type: FeedType, pivot: number, screens: ScreenName[], extra: Partial<FeedEvent> = {}) =>
      feed.push({ type, symbol: m.symbol, name, price: m.price, pivot, screens, ...extra });

    if (live && liveValues) {
      const { episode } = live;
      const liveScreens = screensFor(liveValues);
      const since = today - episode.index;
      if (since === 0) {
        event(episode.level > 1 ? "inner_breakout" : "breakout", episode.pivot, liveScreens, {
          level: episode.level,
          ext: ((m.price - episode.pivot) / episode.pivot) * 100,
          volumeRatio: live.entry.volumeRatio,
        });
      } else {
        if (since === FRESH_BREAKOUT_SESSIONS) event("now_climbing", episode.pivot, liveScreens);
        let priorBest = -Infinity;
        for (let j = episode.index; j < today; j += 1) priorBest = Math.max(priorBest, candles[j].close);
        for (const [threshold, type] of [[1.2, "milestone_20"], [1.1, "milestone_10"]] as const) {
          const level = episode.pivot * threshold;
          if (candles[today].close >= level && priorBest < level) {
            event(type, episode.pivot, liveScreens, { breakoutTimestamp: episode.timestamp });
            break;
          }
        }
      }
    }
    for (const item of m.episodes) {
      if (item.episode.outcome !== "played" || item.episode.endIndex !== today) continue;
      event("played_out", item.episode.pivot, screensFor(entryValues(m, item)), {
        retPct: item.episode.retPct,
        why: item.episode.why,
        breakoutTimestamp: item.episode.timestamp,
      });
    }
    const formingScreens = forming ? screensFor(forming) : primaryScreens;
    for (const poke of m.failedPokes) {
      if (poke.endIndex === today) event("failed_poke", poke.pivot, formingScreens, { breakoutTimestamp: poke.timestamp });
    }
    const fb = m.formingBase;
    if (fb && forming) {
      if (fb.squatIndices.includes(today) && fb.start !== today) {
        event("squat", fb.pivot, formingScreens, {
          nth: fb.squatIndices.length,
          sinceTimestamp: candles[fb.squatIndices[0]].t,
        });
      }
      if (today - fb.start === MIN_BASE_SESSIONS) {
        event("base_born", fb.pivot, formingScreens, { baseWk: fb.baseWk, baseDepth: fb.baseDepth });
      }
    }
  }

  // Played out lists names, not breakouts: BananaPatterns shows each stock once per screen with its breakouts underneath.
  // Keep each stock's most recent played-out breakout per screen (the first one when two share a day).
  const latestPlayed = new Map<string, { at: number; key: string }>();
  for (const row of extraRows) {
    if (row.stage !== "played-out" || row.breakoutTimestamp == null) continue;
    for (const screen of row.screens) {
      const id = `${row.symbol}|${screen}`;
      const best = latestPlayed.get(id);
      if (!best || row.breakoutTimestamp > best.at) latestPlayed.set(id, { at: row.breakoutTimestamp, key: row.key });
    }
  }
  const listedExtra = extraRows.flatMap((row) => {
    if (row.stage !== "played-out") return [row];
    const screens = row.screens.filter((screen) => latestPlayed.get(`${row.symbol}|${screen}`)?.key === row.key);
    return screens.length ? [{ ...row, screens, badges: screens.map((name) => SCREEN_BADGES[name]) }] : [];
  });

  const staged = [...rows, ...listedExtra].filter((r) => r.stage);
  const counts = Object.fromEntries(
    SCREEN_NAMES.map((name) => {
      const inScreen = staged.filter((r) => r.screens.includes(name));
      return [
        name,
        {
          total: inScreen.length,
          forming: inScreen.filter((r) => r.stage === "forming").length,
          breakout: inScreen.filter((r) => r.stage === "breakout").length,
          climbing: inScreen.filter((r) => r.stage === "climbing").length,
          "played-out": inScreen.filter((r) => r.stage === "played-out").length,
        },
      ];
    }),
  );

  const payload = {
    updatedAt: snapshot.completedAt,
    sessionDateKey: session.dateKey,
    marketOpen: session.isLive,
    source: getDataSource(),
    scanned: metrics.length,
    unavailable: snapshot.unavailable,
    insufficientHistory,
    dataQuality: snapshot.dataQuality,
    universe: { ...UNIVERSE_INFO, total: snapshot.total },
    eligible: rows.length,
    /** Calendar year the played-out list covers. */
    playedOutYear: currentYear,
    /** Played-out and history lines cover breakouts from this date (12 months back). */
    playedOutSince: new Date(windowStart).toISOString().slice(0, 10),
    feedDay: latestDay > 0 ? new Date(latestDay * 86_400_000).toISOString().slice(0, 10) : null,
    badges: SCREEN_BADGES,
    counts,
    rows: rows.map(tagTradeForTrade),
    extraRows: listedExtra.map(tagTradeForTrade),
    feed,
  };

  scanCache = { snapshotId: snapshot.id, providerId: snapshot.providerId, payload };
  return Response.json({ ...payload, refreshFailure: state.refreshFailure }, { headers: { "Cache-Control": "no-store" } });
}
