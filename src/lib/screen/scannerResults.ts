import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { EQUITIES } from "@/lib/market/universe";
import { scanUniverse } from "./scan";
import { movingAverageBreadth } from "./breadth";
import { assessBuyReady, extraPickFailures } from "./buyReady";
import { ema } from "./oscillators";
import { scoreOscillators } from "./oscillatorScore";
import {
  benchmarkCloses,
  runScanners,
  SCANNER_KEYS,
  type ExtraPick,
  type ExtraSection,
  type ScannerKey,
  type ScannerMode,
  type ScannerPayload,
  type ScannerRow,
} from "./chartinkScans";
import { measureRpciApproximation } from "./rpciApprox";
import { measureHighBreakout, niftyReturn65, rankHighBreakouts, type HighBreakoutPick, type HighBreakoutSection } from "./highBreakout";
import { paBrief, priceActionRating } from "./priceActionRating";
import { measureMomentumOscillator } from "./oscillators";
import { SCORE_BANDS } from "./oscillatorScore";
import { LEVEL_RULES } from "./tradeLevels";
import type { ScannerPlan } from "./buyReady";
import type { ActiveSession } from "@/lib/market/marketHours";
import type { Candle } from "@/lib/market/types";
import type { StockMetrics } from "./metrics";

const EXTRA_TOP = 3;
const round2 = (v: number) => Math.round(v * 100) / 100;

function planFrom(entry: number, stop: number, atr: number, basis: string): ScannerPlan | null {
  if (!(entry > stop) || !(stop > 0)) return null;
  const r = LEVEL_RULES;
  const risk = entry - stop;
  return {
    entry: round2(entry),
    buyZoneHigh: round2(entry + r.buyZoneAtr * atr),
    stop: round2(stop),
    target1: round2(entry + r.target1R * risk),
    target2: round2(entry + r.target2R * risk),
    riskPercent: round2((risk / entry) * 100),
    highWinTarget: round2(entry + r.highWinTargetR * risk),
    highWinStop: round2(entry - r.highWinStopR * risk),
    basis,
  };
}

const STAGE_RANK = { breakout: 0, testing: 1, forming: 2 } as const;
const STAGE_LABEL = { breakout: "Confirmed breakout", testing: "Testing pivot", forming: "Base forming" } as const;

/**
 * Same rules as the RPCI and Oscillator tabs, on completed candles of liquid
 * stocks. RPCI keeps its own trigger (pivot) and invalidation (base low);
 * the Oscillator buy-watch uses the standard swing-low plan.
 */
function extraSections(
  metrics: StockMetrics[],
  candlesBySymbol: Map<string, Candle[]>,
  rawCandlesBySymbol: Map<string, Candle[]>,
  instruments: Map<string, { name?: string }>,
  session: ActiveSession,
  latest: number,
): { rpci: ExtraSection; oscillator: ExtraSection } {
  type Ranked = ExtraPick & { rank: number[]; turnoverCr: number | null };
  const rpci: Ranked[] = [];
  const osc: Ranked[] = [];
  for (const m of metrics) {
    if (!m.passesFloor) continue;
    const candles = candlesBySymbol.get(m.symbol) ?? [];
    if (!candles.length || candles[candles.length - 1].t < latest - 12 * 3600e3) continue;
    const sc = scoreOscillators(candles, session);
    const atr = sc?.levels?.atr ?? 0;
    const e21 = ema(candles.map((c) => c.close), 21).at(-1) ?? null;
    const lastClose = candles[candles.length - 1].close;
    const gate = {
      rs: m.rs ?? null,
      vs50: m.vs50 ?? null,
      vs200: m.vs200 ?? null,
      aboveEma21: e21 ? (lastClose / e21 - 1) * 100 : null,
    };
    const base = {
      symbol: m.symbol,
      name: instruments.get(m.symbol)?.name ?? m.symbol,
      close: lastClose,
      changePercent: Number.isFinite(m.changePercent) ? m.changePercent : null,
      rs: m.rs,
      score: sc?.score ?? null,
      turnoverCr: m.turnoverCr ?? null,
    };
    const rp = measureRpciApproximation(rawCandlesBySymbol.get(m.symbol) ?? candles, m, session);
    if (rp) {
      const plan = planFrom(rp.entryTriggerPrice, rp.baseLowPrice, atr, "Above the pivot; SL at the 20-session base low");
      if (plan) {
        const failed = extraPickFailures({ ...gate, riskPercent: plan.riskPercent });
        rpci.push({
          ...base,
          note: `${STAGE_LABEL[rp.stage]} · range contracted to ${rp.contractionRatio.toFixed(2)}× · volume ${rp.volumeRatio.toFixed(2)}×`,
          plan,
          failed,
          // Picks that pass the Buy-ready checks rank ahead of any that do not.
          rank: [failed.length ? 1 : 0, STAGE_RANK[rp.stage], rp.contractionRatio],
        });
      }
    }
    const mo = measureMomentumOscillator(candles, m, session);
    if (mo && sc && sc.score >= SCORE_BANDS.strong && sc.levels) {
      const l = sc.levels;
      const failed = extraPickFailures({ ...gate, riskPercent: l.riskPercent });
      osc.push({
        ...base,
        note: `${mo.setup === "continuation" ? "Momentum continuation" : "Pullback turn"}${mo.fresh || sc.freshJump ? " · fresh signal" : ""} · RSI ${mo.rsi.toFixed(0)} · ADX ${mo.adx.toFixed(0)}`,
        plan: {
          entry: l.entry, buyZoneHigh: l.buyZoneHigh, stop: l.stop, target1: l.target1, target2: l.target2,
          riskPercent: l.riskPercent, highWinTarget: l.highWinTarget, highWinStop: l.highWinStop,
          basis: "Above the last high; SL below the 10-day swing low",
        },
        failed,
        rank: [failed.length ? 1 : 0, mo.fresh || sc.freshJump ? 0 : 1, -sc.score, -(m.rs ?? 0)],
      });
    }
  }
  const byRank = (a: Ranked, b: Ranked) => {
    for (let i = 0; i < a.rank.length; i += 1) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
    return 0;
  };
  const section = (list: Ranked[]): ExtraSection => ({
    total: list.length,
    top: list.sort(byRank).slice(0, EXTRA_TOP).map((pick): ExtraPick => ({
      symbol: pick.symbol, name: pick.name, close: pick.close, changePercent: pick.changePercent,
      rs: pick.rs, score: pick.score, note: pick.note, plan: pick.plan, failed: pick.failed,
      pa: paBrief(priceActionRating(candlesBySymbol.get(pick.symbol) ?? [], pick.turnoverCr)),
    })),
  });
  return { rpci: section(rpci), oscillator: section(osc) };
}

type SnapshotState = ReturnType<typeof getUniverseSnapshot>;

/** His screen on liquid stocks' completed candles, plus the confirmed breakouts. */
function highBreakoutSection(
  metrics: StockMetrics[],
  candlesBySymbol: Map<string, Candle[]>,
  instruments: Map<string, { name?: string }>,
  benchmark: Candle[] | null | undefined,
  session: Pick<ActiveSession, "dateKey" | "progress">,
  latest: number,
): HighBreakoutSection {
  const isDone = (c: Candle) => {
    const day = istDateKey(c.t);
    return day < session.dateKey || (day === session.dateKey && session.progress === 1);
  };
  const nifty = niftyReturn65(benchmark?.filter(isDone), latest);
  let screened = 0;
  const breakouts: HighBreakoutPick[] = [];
  for (const m of metrics) {
    if (!m.passesFloor) continue;
    const done = (candlesBySymbol.get(m.symbol) ?? []).filter(isDone);
    if (!done.length || done[done.length - 1].t < latest - 12 * 3600e3) continue;
    const measure = measureHighBreakout(done, nifty);
    if (!measure.screened) continue;
    screened += 1;
    if (measure.pick) breakouts.push({ ...measure.pick, symbol: m.symbol, name: instruments.get(m.symbol)?.name ?? m.symbol, rs: m.rs ?? null });
  }
  return { screened, breakouts: breakouts.sort(rankHighBreakouts), niftyReturn65Percent: nifty == null ? null : Math.round(nifty * 10000) / 100 };
}
export type ScannerResultsState =
  | { status: "ready"; payload: ScannerPayload }
  | Exclude<SnapshotState, { status: "ready" }>;

const cache = new Map<ScannerMode, {
  snapshotId: number;
  providerId: string;
  dateKey: string;
  progress: number;
  payload: ScannerPayload;
}>();

/**
 * Runs every Chartink-style scanner and Buy-ready check over the universe.
 * Live mode deliberately treats the quote-built current candle as completed
 * for a provisional intraday preview; the default remains completed candles.
 */
export function getScannerResults(mode: ScannerMode = "completed"): ScannerResultsState {
  const state = getUniverseSnapshot();
  if (state.status !== "ready") return state as Exclude<SnapshotState, { status: "ready" }>;
  const snapshot = state.snapshot;
  const session = getActiveSession();
  const scanSession = mode === "live" ? { ...session, progress: 1 } : session;
  const settled = scanSession.progress === 1 ? 1 : 0;
  const cached = cache.get(mode);
  if (cached && cached.snapshotId === snapshot.id && cached.providerId === snapshot.providerId &&
      cached.dateKey === session.dateKey && cached.progress === settled) {
    return { status: "ready", payload: { ...cached.payload, refreshFailure: state.refreshFailure } };
  }

  const { metrics, candlesBySymbol, rawCandlesBySymbol } = scanUniverse(snapshot);
  const metricsBySymbol = new Map(metrics.map((m) => [m.symbol, m]));
  const instrumentBySymbol = new Map(EQUITIES.map((e) => [e.symbol, e]));
  const breadth = movingAverageBreadth(metrics.filter((m) => m.passesFloor), "vs50");
  const results = Object.fromEntries(SCANNER_KEYS.map((k) => [k, [] as ScannerRow[]])) as Record<ScannerKey, ScannerRow[]>;
  const benchmark = benchmarkCloses(snapshot.benchmark);
  let scanned = 0;
  let latest = 0;

  for (const [symbol, candles] of candlesBySymbol) {
    if (candles.length < 10) continue;
    scanned += 1;
    const instrument = instrumentBySymbol.get(symbol);
    const m = metricsBySymbol.get(symbol);
    const hits = runScanners(
      symbol,
      candles,
      { marketCapCr: instrument?.marketCapCr ?? null, rs: m?.rs ?? null, benchmark },
      scanSession,
    );
    const found = SCANNER_KEYS.filter((k) => hits[k]);
    if (!found.length) continue;
    const done = candles.filter((c) => {
      const day = istDateKey(c.t);
      return day < scanSession.dateKey || (day === scanSession.dateKey && scanSession.progress === 1);
    });
    const sc = scoreOscillators(candles, scanSession);
    const closes = done.map((c) => c.close);
    const e21 = ema(closes, 21).at(-1) ?? null;
    const last = done.at(-1);
    const ctx = {
      breadthPercent: breadth.percent,
      passesFloor: m?.passesFloor ?? false,
      rs: m?.rs ?? null,
      score: sc?.score ?? null,
      vs50: m?.vs50 ?? null,
      vs200: m?.vs200 ?? null,
      aboveEma21: e21 && last ? (last.close / e21 - 1) * 100 : null,
      atr: sc?.levels?.atr ?? 0,
      candles: done,
    };
    const quote = snapshot.quotes.get(symbol);
    const paRating = priceActionRating(done, m?.turnoverCr ?? null);
    for (const key of found) {
      const h = hits[key]!;
      latest = Math.max(latest, h.candleTimestamp);
      results[key].push({
        ...h,
        name: instrument?.name ?? symbol,
        sector: instrument?.sector,
        price: quote?.ltp ?? h.close,
        livePercent: quote?.changePercent ?? null,
        rs: m?.rs ?? null,
        turnoverCr: m?.turnoverCr ?? null,
        passesFloor: m?.passesFloor ?? false,
        score: sc?.score ?? null,
        paRating,
        readiness: assessBuyReady(key, h, ctx),
      });
    }
  }
  // A stock whose last candle is older than the latest session did not trade then; drop its stale hit.
  for (const key of SCANNER_KEYS) {
    results[key] = results[key]
      .filter((r) => r.candleTimestamp >= latest - 12 * 3600e3)
      .sort((a, b) => (b.turnoverCr ?? 0) - (a.turnoverCr ?? 0));
  }

  const extras = extraSections(metrics, candlesBySymbol, rawCandlesBySymbol, instrumentBySymbol, scanSession, latest);
  const highBreakouts = highBreakoutSection(metrics, candlesBySymbol, instrumentBySymbol, snapshot.benchmark, scanSession, latest);

  const payload: ScannerPayload = {
    mode,
    provisional: mode === "live" && session.isLive,
    updatedAt: snapshot.completedAt,
    sessionDateKey: session.dateKey,
    candleTimestamp: latest || null,
    scanned,
    breadth,
    results,
    extras,
    highBreakouts,
    dataQuality: snapshot.dataQuality,
  };
  cache.set(mode, {
    snapshotId: snapshot.id,
    providerId: snapshot.providerId,
    dateKey: session.dateKey,
    progress: settled,
    payload,
  });
  return { status: "ready", payload: { ...payload, refreshFailure: state.refreshFailure } };
}
