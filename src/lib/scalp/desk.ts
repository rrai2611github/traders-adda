import { fyersHistory, fyersOptionChain } from "@/lib/fyers/fyersClient";
import {
  type Bar, type ChainLeg, type ChainSummary, type OpeningRange, type ScalpIndex, type ScalpSignal,
  SCALP_INDEXES, ema, futuresSymbol, istDayKey, latestSession, openingRange, orbSignals,
  parseCandles, parseChain, pickLeg, previousSession, vwap,
} from "@/lib/scalp/scalpLogic";

export interface LinePoint {
  t: number;
  v: number;
}

export interface DeskLeg {
  symbol: string;
  strike: number;
  side: "CE" | "PE";
  ltp: number;
  oi: number;
  oiChange: number;
  bars: Bar[];
  vwap: LinePoint[];
}

export interface ChainRow {
  strike: number;
  ce: Pick<ChainLeg, "ltp" | "oi" | "oiChange"> | null;
  pe: Pick<ChainLeg, "ltp" | "oi" | "oiChange"> | null;
}

export interface ScalpDeskData {
  index: ScalpIndex;
  name: string;
  generatedAt: number;
  /** Open time of the newest spot bar, to show data staleness. */
  lastBarAt: number | null;
  spot: {
    symbol: string;
    ltp: number | null;
    bars: Bar[];
    ema9: LinePoint[];
    ema21: LinePoint[];
    orb: OpeningRange | null;
    prev: { high: number; low: number; close: number } | null;
  };
  futures: { symbol: string; ltp: number; vwap: number | null; side: "above" | "below" | null } | null;
  ce: DeskLeg | null;
  pe: DeskLeg | null;
  straddle: LinePoint[];
  atm: number | null;
  offset: number;
  expiry: string | null;
  pcr: number | null;
  maxCallOiStrike: number | null;
  maxPutOiStrike: number | null;
  vix: number | null;
  chain: ChainRow[];
  signals: ScalpSignal[];
  stopPoints: number;
  warnings: string[];
}

const DAY_SEC = 86_400;
const CHAIN_TTL_MS = 20_000;
const DESK_TTL_MS = 8_000;

interface CacheEntry<T> {
  at: number;
  value: Promise<T>;
}

const caches = ((globalThis as { __scalpDeskCache?: { chain: Map<string, CacheEntry<ChainSummary>>; desk: Map<string, CacheEntry<ScalpDeskData>> } })
  .__scalpDeskCache ??= { chain: new Map(), desk: new Map() });

/** Reuses a recent (or in-flight) result; failed requests are not cached. */
function cached<T>(map: Map<string, CacheEntry<T>>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = load();
  map.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (map.get(key)?.value === value) map.delete(key);
  });
  return value;
}

const points = (bars: Bar[], series: Array<number | null>, from: number): LinePoint[] =>
  bars.flatMap((bar, i) => (bar.t >= from && series[i] != null ? [{ t: bar.t, v: round(series[i]!) }] : []));

const round = (n: number) => Math.round(n * 100) / 100;

async function history(symbol: string, days: number, now: number): Promise<Bar[]> {
  const to = Math.floor(now / 1000);
  return parseCandles(await fyersHistory(symbol, "1", to - days * DAY_SEC, to));
}

async function leg(chainLeg: ChainLeg | null, now: number, warnings: string[]): Promise<DeskLeg | null> {
  if (!chainLeg) return null;
  try {
    const all = await history(chainLeg.symbol, 4, now);
    const today = latestSession(all);
    const from = today[0]?.t ?? Infinity;
    return {
      symbol: chainLeg.symbol, strike: chainLeg.strike, side: chainLeg.type,
      ltp: chainLeg.ltp, oi: chainLeg.oi, oiChange: chainLeg.oiChange,
      bars: today, vwap: points(all, vwap(all), from),
    };
  } catch (error) {
    warnings.push(`${chainLeg.type} chart unavailable: ${(error as Error).message}`);
    return null;
  }
}

function strip(chain: ChainSummary, width = 5): ChainRow[] {
  if (chain.atm == null) return [];
  const i = chain.strikes.indexOf(chain.atm);
  const pick = (strike: number, type: "CE" | "PE") => {
    const found = chain.legs.find((l) => l.strike === strike && l.type === type);
    return found ? { ltp: found.ltp, oi: found.oi, oiChange: found.oiChange } : null;
  };
  return chain.strikes
    .slice(Math.max(0, i - width), i + width + 1)
    .map((strike) => ({ strike, ce: pick(strike, "CE"), pe: pick(strike, "PE") }));
}

async function buildDesk(index: ScalpIndex, offset: number): Promise<ScalpDeskData> {
  const config = SCALP_INDEXES[index];
  const now = Date.now();
  const warnings: string[] = [];
  const chain = await cached(caches.chain, index, CHAIN_TTL_MS, async () => parseChain(await fyersOptionChain(config.underlying, 8)));

  const futSymbol = futuresSymbol(config.futPrefix, chain.expiries, now);
  if (!futSymbol) warnings.push("Futures contract not found in the chain expiries; futures VWAP check skipped.");

  // Sequential on purpose: the client paces requests to stay inside Fyers' rate limits.
  const spotAll = await history(config.underlying, 6, now);
  let futAll: Bar[] = [];
  if (futSymbol) {
    try {
      futAll = await history(futSymbol, 2, now);
    } catch (error) {
      warnings.push(`Futures data unavailable: ${(error as Error).message}`);
    }
  }
  const ce = await leg(pickLeg(chain, "CE", offset), now, warnings);
  const pe = await leg(pickLeg(chain, "PE", offset), now, warnings);

  const today = latestSession(spotAll);
  const from = today[0]?.t ?? Infinity;
  const futToday = latestSession(futAll);
  const futVwap = vwap(futAll);
  const futLast = futToday[futToday.length - 1];
  const futVwapLast = futAll.length ? futVwap[futVwap.length - 1] : null;
  if (today.length && futToday.length && istDayKey(futToday[0].t) !== istDayKey(today[0].t)) {
    warnings.push("Futures and spot are on different days; check the futures contract.");
  }

  const peBars = new Map((pe?.bars ?? []).map((b) => [b.t, b.close]));
  const straddle = (ce?.bars ?? []).flatMap((b) => {
    const put = peBars.get(b.t);
    return put != null ? [{ t: b.t, v: round(b.close + put) }] : [];
  });

  const signals = orbSignals(
    { spot: spotAll, fut: futAll, ce: ce?.bars, pe: pe?.bars },
    { stopPoints: config.stopPoints },
  );
  if (!today.length) warnings.push("No 1-minute spot bars returned yet.");

  return {
    index,
    name: config.name,
    generatedAt: now,
    lastBarAt: today.length ? today[today.length - 1].t : null,
    spot: {
      symbol: config.underlying,
      ltp: chain.spot ?? today[today.length - 1]?.close ?? null,
      bars: today,
      ema9: points(spotAll, ema(spotAll, 9), from),
      ema21: points(spotAll, ema(spotAll, 21), from),
      orb: openingRange(spotAll, 15, now),
      prev: previousSession(spotAll),
    },
    futures: futSymbol && futLast
      ? {
        symbol: futSymbol,
        ltp: futLast.close,
        vwap: futVwapLast == null ? null : round(futVwapLast),
        side: futVwapLast == null ? null : futLast.close >= futVwapLast ? "above" : "below",
      }
      : null,
    ce,
    pe,
    straddle,
    atm: chain.atm,
    offset,
    expiry: chain.expiries[0]?.date ?? null,
    pcr: chain.pcr == null ? null : round(chain.pcr),
    maxCallOiStrike: chain.maxCallOiStrike,
    maxPutOiStrike: chain.maxPutOiStrike,
    vix: chain.vix,
    chain: strip(chain),
    signals,
    stopPoints: config.stopPoints,
    warnings,
  };
}

export function getScalpDesk(index: ScalpIndex, offset: number): Promise<ScalpDeskData> {
  return cached(caches.desk, `${index}:${offset}`, DESK_TTL_MS, () => buildDesk(index, offset));
}
