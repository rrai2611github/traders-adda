import { getDataSource } from "@/lib/market/engine";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { marketProviderErrorResponse, universeWarmingResponse } from "@/lib/market/apiErrors";
import { EQUITIES } from "@/lib/market/universe";
import { classifyTicker } from "@/lib/industry";
import {
  HOUSE_PRESETS,
  SCREEN_NAMES,
  type FactorValues,
  type ScreenName,
  matchesScreen,
} from "@/lib/screen/criteria";
import { istDayNumber, scanUniverse } from "@/lib/screen/scan";
import { canonicalBreakoutEvents } from "@/lib/screen/breakoutFeed";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 5;
const MAX_DAYS = 20;

interface BreakoutEventRow {
  /** Session date as YYYY-MM-DD in IST, the key the day filter groups on. */
  d: string;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  breakoutDayGain: number;
  nowVsPivot: number | null;
  rs: number | null;
  breakoutVolume: number | null;
  closeInRange: number | null;
  medianTurnover: number | null;
  marketCap: number | null;
  industry: string;
  subgroup: string;
  tags: ScreenName[];
  /** Nested-base depth; used to choose one canonical event per stock/session. */
  level: number;
}

let cache: { snapshotId: number; providerId: string; days: number; payload: unknown } | null = null;

/** NSE sessions are keyed by their IST calendar date. */
function istDateKey(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * The market-wide breakout feed: every tradable stock whose close first cleared
 * its base's lid in the recent window, whether or not it matches a house
 * screen. Tags reflect the screens it matched on its breakout day. Breakouts
 * that later closed back inside the base (failed pokes) are left out.
 */
export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(requested) && requested > 0
    ? Math.min(MAX_DAYS, Math.trunc(requested))
    : DEFAULT_DAYS;

  const state = getUniverseSnapshot();
  if (state.status === "warming") return universeWarmingResponse(state.progress);
  if (state.status === "failed") return marketProviderErrorResponse(state.error);
  const snapshot = state.snapshot;

  if (
    cache &&
    cache.days === days &&
    cache.snapshotId === snapshot.id &&
    cache.providerId === snapshot.providerId
  ) {
    return Response.json(cache.payload, { headers: { "Cache-Control": "no-store" } });
  }

  const { metrics, candlesBySymbol } = scanUniverse(snapshot);
  const instrumentBySymbol = new Map(EQUITIES.map((e) => [e.symbol, e]));
  const tradable = metrics.filter((m) => m.passesScreenFloor);

  // The last `days` sessions the market traded, newest first.
  const allDays = new Set<number>();
  for (const m of tradable) {
    const candles = candlesBySymbol.get(m.symbol) ?? [];
    for (let i = Math.max(0, candles.length - days); i < candles.length; i += 1) allDays.add(istDayNumber(candles[i].t));
  }
  const windowDays = new Set([...allDays].sort((a, b) => b - a).slice(0, days));

  const events: BreakoutEventRow[] = [];
  for (const measured of tradable) {
    const candles = candlesBySymbol.get(measured.symbol);
    if (!candles) continue;

    const instrument = instrumentBySymbol.get(measured.symbol);
    const classified = classifyTicker(measured.symbol, instrument?.sector);

    for (const { episode, entry } of measured.episodes) {
      if (!windowDays.has(istDayNumber(episode.timestamp))) continue;
      const previous = candles[episode.index - 1];
      const values: FactorValues = {
        ...measured,
        rs: entry.rs,
        vs50: entry.vs50,
        vs200: entry.vs200,
        fromHigh: entry.fromHigh,
        aboveLow: entry.aboveLow,
        baseWk: entry.baseWk,
        baseDepth: entry.baseDepth,
        coil: entry.coil,
        dry: entry.dry,
        listedWk: entry.listedWk,
        level: entry.level,
        ext: entry.ext,
      };
      events.push({
        d: istDateKey(episode.timestamp),
        symbol: measured.symbol,
        name: instrument?.name ?? measured.symbol,
        price: measured.price,
        changePercent: measured.changePercent,
        breakoutDayGain: previous && previous.close > 0 ? (episode.entryClose / previous.close - 1) * 100 : 0,
        nowVsPivot: ((measured.price - episode.pivot) / episode.pivot) * 100,
        rs: measured.rs,
        breakoutVolume: entry.volumeRatio,
        closeInRange: entry.closeInRange,
        medianTurnover: measured.turnoverCr,
        marketCap: measured.mcap,
        industry: classified.industry,
        subgroup: classified.subgroup,
        tags: SCREEN_NAMES.filter((name) => matchesScreen(values, HOUSE_PRESETS[name])),
        level: episode.level,
      });
    }
  }
  const canonicalEvents = canonicalBreakoutEvents(events);
  // Newest session first, then the biggest move on that session.
  const sessionDays = [...new Set(canonicalEvents.map((event) => event.d))].sort();
  canonicalEvents.sort((a, b) => (a.d === b.d ? b.breakoutDayGain - a.breakoutDayGain : a.d < b.d ? 1 : -1));

  const payload = {
    updatedAt: snapshot.completedAt,
    source: getDataSource(),
    unavailable: snapshot.unavailable,
    days: sessionDays,
    counts: Object.fromEntries(
      sessionDays.map((day) => [day, canonicalEvents.filter((event) => event.d === day).length]),
    ),
    events: canonicalEvents.map(({ level, ...event }) => {
      void level;
      return event;
    }),
  };

  cache = { snapshotId: snapshot.id, providerId: snapshot.providerId, days, payload };
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
