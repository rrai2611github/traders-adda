import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FyersApiError, fyersHistory } from "@/lib/fyers/fyersClient";
import {
  DEFAULT_COSTS, FUTURES_COSTS, backtestOrb, backtestSignals, byMonth, costInPoints, defaultParams, roundTripCost, summarize, verdictOf,
  type BacktestTrade, type CostModel, type TradeStats, type Verdict,
} from "./backtest";
import {
  backtestSwing, breakout20Signals, firstHourBreakoutSignals, rsi2Signals, trendFollow, trendHoldSignals, type TrendPlan,
} from "./holds";
import {
  DEFAULT_CONDOR, DEFAULT_STRADDLE, backtestCondor, backtestStraddle, bsPrice, dayStats, ivRatioByDay, overnightShare, realisedVolByDay, shortLegCost,
  type CondorPlan, type StraddleInput, type StraddlePlan,
} from "./premium";
import { SCALP_INDEXES, istDayKey, parseCandles, type Bar, type ScalpIndex } from "./scalpLogic";
import { SETUPS } from "./setups";

const DAY_MS = 86_400_000;
const CACHE_DIR = join(process.cwd(), ".cache", "scalp-history");
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SWING_YEARS = 10;
const CARRY_PCT_YEAR = 6.5;
const STRADDLE_DAYS = 730;
const VIX_SYMBOL = "NSE:INDIAVIX-INDEX";
const STRIKE_STEP: Record<ScalpIndex, number> = { NIFTY: 50, BANKNIFTY: 100 };

// Fyers allows up to 100 days of 1-minute and 366 days of daily data per request.
const RESOLUTIONS = {
  "1": { label: "1m", chunkDays: 90 },
  D: { label: "D", chunkDays: 360 },
} as const;
type Resolution = keyof typeof RESOLUTIONS;

/**
 * One fixed window of bars. Windows that ended before today are stored on disk
 * for good; the current window is always refetched.
 */
async function loadWindow(cacheKey: string, symbol: string, resolution: Resolution, w: number, todayStart: number): Promise<Bar[]> {
  const { label, chunkDays } = RESOLUTIONS[resolution];
  const from = w * chunkDays * DAY_MS;
  const to = from + chunkDays * DAY_MS - 1000;
  const file = join(CACHE_DIR, `${cacheKey}-${label}-${w}.json`);
  const complete = to < todayStart;
  if (complete) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Bar[];
    } catch {
      // not cached yet
    }
  }
  const bars = parseCandles(await fyersHistory(symbol, resolution, from / 1000, Math.min(to, Date.now()) / 1000));
  if (complete) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(bars));
  }
  return bars;
}

async function loadSeries(cacheKey: string, symbol: string, days: number, resolution: Resolution = "1"): Promise<Bar[]> {
  const span = RESOLUTIONS[resolution].chunkDays * DAY_MS;
  const now = Date.now();
  const todayStart = Date.parse(`${istDayKey(now)}T00:00:00+05:30`);
  const out: Bar[] = [];
  for (let w = Math.floor((now - days * DAY_MS) / span); w <= Math.floor(now / span); w++) {
    out.push(...(await loadWindow(cacheKey, symbol, resolution, w, todayStart)));
  }
  const since = now - days * DAY_MS;
  return out.filter((b) => b.t >= since);
}

/** Continuous futures: Fyers stitches past contracts when asked with any live contract and cont_flag=1. */
async function loadFutures(index: ScalpIndex, days: number): Promise<Bar[]> {
  const prefix = SCALP_INDEXES[index].futPrefix;
  const [year, month] = istDayKey(Date.now()).split("-").map(Number);
  for (let ahead = 0; ahead < 3; ahead++) {
    const m = (month - 1 + ahead) % 12;
    const y = year + Math.floor((month - 1 + ahead) / 12);
    const symbol = `NSE:${prefix}${String(y).slice(2)}${MONTHS[m]}FUT`;
    try {
      return await loadSeries(`${prefix}-FUT`, symbol, days);
    } catch (error) {
      if (!(error instanceof FyersApiError)) throw error;
    }
  }
  return [];
}

export interface VariantRow {
  label: string;
  isDefault: boolean;
  stats: TradeStats;
}

export type SetupGroup = "scalp" | "intraday" | "swing" | "selling" | "trend";

export interface Capital {
  /** Margin or premium blocked for one lot at today's index level. */
  blocked: number;
  /** How `blocked` was estimated. */
  basis: string;
  /** Blocked money plus the worst peak-to-trough fall, i.e. what the account needed to keep trading through the test. */
  needed: number;
  /** `needed` + net profit: the account at the end of the test. */
  endValue: number;
  /** Net profit ÷ `needed`. */
  returnPct: number;
  /** `returnPct` spread evenly over the years tested (simple, not compounded). */
  perYearPct: number;
  years: number;
}

/** Rough NSE margin as a share of one lot's contract value (SPAN + exposure); check the Fyers margin calculator for exact numbers. */
const MARGIN_PCT = { future: 0.12, straddle: 0.15, condor: 0.03 };
/** Average sessions left to expiry when a scalp buys its option (Nifty weekly; Bank Nifty mostly monthly). */
const SCALP_SESSIONS_TO_EXPIRY: Record<ScalpIndex, number> = { NIFTY: 2.5, BANKNIFTY: 10 };

type Draft = Omit<SetupResult, "capital">;

function withCapital(setup: Draft, blocked: number, basis: string): SetupResult {
  const needed = blocked + setup.stats.maxDrawdown;
  const years = Math.max(setup.sessions / 252, 1 / 252);
  const returnPct = needed > 0 ? setup.stats.totalNet / needed : 0;
  return {
    ...setup,
    capital: { blocked, basis, needed, endValue: needed + setup.stats.totalNet, returnPct, perYearPct: returnPct / years, years },
  };
}

export interface SetupResult {
  key: string;
  group: SetupGroup;
  name: string;
  rule: string;
  plan: string;
  instrument: string;
  from: string | null;
  to: string | null;
  /** Trading sessions in the tested period. */
  sessions: number;
  costPerTrade: number;
  costPoints: number;
  /** Shown instead of the cost sentence when costs vary per trade (option selling, trend). */
  costNote?: string;
  minTrades: number;
  stats: TradeStats;
  /** Option selling only: legs of the same entry day combined. */
  dayStats?: ReturnType<typeof dayStats>;
  verdict: Verdict;
  halves: [TradeStats, TradeStats];
  months: ReturnType<typeof byMonth>;
  bySide: { CE: TradeStats; PE: TradeStats };
  recent: BacktestTrade[];
  /** Money for one lot and the return on it (see `withCapital`). */
  capital: Capital;
  /** Robustness rows, ORB only. */
  variants: VariantRow[];
}

export interface IndexBacktest {
  index: ScalpIndex;
  name: string;
  lotSize: number;
  setups: SetupResult[];
}

export interface ScalpBacktestReport {
  generatedAt: number;
  days: number;
  indexes: IndexBacktest[];
  assumptions: string[];
}

function orbVariants(spot: Bar[], fut: Bar[], index: ScalpIndex): VariantRow[] {
  const base = defaultParams(index);
  const costs = DEFAULT_COSTS[index];
  const rows: Array<{ label: string; params: typeof base; isDefault?: boolean }> = [
    { label: `Default (stop ${base.stopPoints}, 1.5R, 10-min exit)`, params: base, isDefault: true },
    { label: "Without futures-VWAP filter", params: { ...base, useFutVwap: false } },
    { label: `Wider stop (${base.stopPoints * 1.5})`, params: { ...base, stopPoints: base.stopPoints * 1.5 } },
    { label: `Tighter stop (${base.stopPoints * 0.75})`, params: { ...base, stopPoints: base.stopPoints * 0.75 } },
    { label: "Target 1R", params: { ...base, rewardRisk: 1 } },
    { label: "Target 2R", params: { ...base, rewardRisk: 2 } },
    { label: "Hold up to 30 min", params: { ...base, timeStopMin: 30, cooldownMin: 30 } },
    { label: "30-min opening range", params: { ...base, orbMinutes: 30 } },
    { label: "1 trade a day", params: { ...base, maxPerDay: 1 } },
  ];
  return rows.map((row) => ({
    label: row.label,
    isDefault: Boolean(row.isDefault),
    stats: summarize(backtestOrb({ spot, fut }, row.params, costs)),
  }));
}

function result(
  meta: Pick<SetupResult, "key" | "group" | "name" | "rule" | "plan" | "instrument" | "minTrades" | "costNote">,
  trades: BacktestTrade[],
  bars: Bar[],
  costs: CostModel,
  variants: VariantRow[] = [],
): Draft {
  const mid = Math.floor(trades.length / 2);
  const lastPrice = bars.length ? bars[bars.length - 1].close : 0;
  return {
    ...meta,
    from: bars.length ? istDayKey(bars[0].t) : null,
    to: bars.length ? istDayKey(bars[bars.length - 1].t) : null,
    sessions: new Set(bars.map((b) => istDayKey(b.t))).size,
    costPerTrade: roundTripCost(costs, lastPrice),
    costPoints: costInPoints(costs, lastPrice),
    stats: summarize(trades),
    ...(meta.group === "selling" ? { dayStats: dayStats(trades) } : {}),
    verdict: verdictOf(trades, meta.minTrades),
    halves: [summarize(trades.slice(0, mid)), summarize(trades.slice(mid))],
    months: byMonth(trades),
    bySide: { CE: summarize(trades.filter((t) => t.side === "CE")), PE: summarize(trades.filter((t) => t.side === "PE")) },
    recent: trades.slice(-15).reverse(),
    variants,
  };
}

const OPTION = "ATM option, 1 lot";
const FUTURE = "Index future, 1 lot";
const STRADDLE = "Short ATM straddle, 1 lot (modelled)";

function straddleVariants(input: StraddleInput, costs: CostModel): VariantRow[] {
  const rows: Array<{ label: string; plan: Partial<StraddlePlan>; isDefault?: boolean }> = [
    { label: "Default (09:20, 25% stop per leg, exit 15:15)", plan: {}, isDefault: true },
    { label: "Premiums 10% cheaper at entry (model stress)", plan: { entryIvScale: 0.9 } },
    { label: "Premiums 5% cheaper at entry", plan: { entryIvScale: 0.95 } },
    { label: "15% stop per leg", plan: { legStopPct: 0.15 } },
    { label: "40% stop per leg", plan: { legStopPct: 0.4 } },
    { label: "No stop (not advised)", plan: { legStopPct: Infinity } },
    { label: "Expiry day only", plan: { days: "expiry" } },
    { label: "Skip expiry day", plan: { days: "nonExpiry" } },
    { label: "Enter 09:45", plan: { entryMin: 9 * 60 + 45 } },
  ];
  return rows.map((row) => ({
    label: row.label,
    isDefault: Boolean(row.isDefault),
    stats: summarize(backtestStraddle(input, { ...DEFAULT_STRADDLE, ...row.plan }, costs)),
  }));
}

const IV_RV_MIN = 1.2;
const CONDOR = "Iron condor, 1 lot (modelled)";

function filteredVariants(input: StraddleInput, costs: CostModel): VariantRow[] {
  const base: StraddlePlan = { ...DEFAULT_STRADDLE, minIvOverRv: IV_RV_MIN };
  const rows: Array<{ label: string; plan: Partial<StraddlePlan>; isDefault?: boolean }> = [
    { label: `Default (IV ÷ realised ≥ ${IV_RV_MIN})`, plan: {}, isDefault: true },
    { label: "Premiums 10% cheaper at entry (model stress)", plan: { entryIvScale: 0.9 } },
    { label: "Premiums 5% cheaper at entry", plan: { entryIvScale: 0.95 } },
    { label: "Looser filter (≥ 1.0)", plan: { minIvOverRv: 1 } },
    { label: "Stricter filter (≥ 1.4)", plan: { minIvOverRv: 1.4 } },
    { label: "No filter (the plain straddle)", plan: { minIvOverRv: undefined } },
  ];
  return rows.map((row) => ({
    label: row.label,
    isDefault: Boolean(row.isDefault),
    stats: summarize(backtestStraddle(input, { ...base, ...row.plan }, costs)),
  }));
}

function condorVariants(input: StraddleInput, costs: CostModel): VariantRow[] {
  const rows: Array<{ label: string; plan: Partial<CondorPlan>; isDefault?: boolean }> = [
    { label: "Default (shorts 0.5% out, wings 0.5% beyond, stop at 1× credit, exit 15:15)", plan: {}, isDefault: true },
    { label: "Shorts 10% cheaper, wings 10% dearer (model stress)", plan: { entryIvScale: 0.9 } },
    { label: "Shorts 5% cheaper, wings 5% dearer", plan: { entryIvScale: 0.95 } },
    { label: "Iron fly (ATM shorts, wings 1% away)", plan: { shortPct: 0, wingPct: 0.01 } },
    { label: "Shorts 1% out", plan: { shortPct: 0.01 } },
    { label: "Stop at 0.5× credit", plan: { stopX: 0.5 } },
    { label: "No stop (loss capped by the wings)", plan: { stopX: Infinity } },
    { label: "Held to expiry, no stop", plan: { hold: "expiry", stopX: Infinity } },
    { label: "Expiry day only", plan: { days: "expiry" } },
    { label: `With IV ÷ realised ≥ ${IV_RV_MIN} filter`, plan: { minIvOverRv: IV_RV_MIN } },
  ];
  return rows.map((row) => ({
    label: row.label,
    isDefault: Boolean(row.isDefault),
    stats: summarize(backtestCondor(input, { ...DEFAULT_CONDOR, ...row.plan }, costs)),
  }));
}

/** A selling setup whose profit disappears when premiums are 10% cheaper than modelled is flagged. */
function flagModelSensitive(setup: Draft): Draft {
  const stress = setup.variants.find((v) => v.label.includes("10%"));
  if (setup.verdict.edge && stress && stress.stats.totalNet <= 0) {
    setup.verdict = {
      edge: false,
      label: "Model-sensitive",
      detail: "Profitable in the model, but pricing entry just 10% worse than modelled turns it into a loss. The edge is smaller than the model's error, so only real option prices (paper trading) can confirm it.",
    };
  }
  return setup;
}

function trendVariants(daily: Bar[], costs: CostModel): VariantRow[] {
  const base: TrendPlan = { mode: "longShort", fast: 50, slow: 200, carryPctYear: CARRY_PCT_YEAR };
  const rows: Array<{ label: string; plan: Partial<TrendPlan>; isDefault?: boolean }> = [
    { label: "Default: 50/200-day, long or short", plan: {}, isDefault: true },
    { label: "Benchmark: buy and hold the future", plan: { mode: "buyHold" } },
    { label: "Close vs 200-day average, long or short", plan: { mode: "price200" } },
    { label: "20/100-day, long or short", plan: { fast: 20, slow: 100 } },
    { label: "100/250-day, long or short", plan: { fast: 100, slow: 250 } },
  ];
  return rows.map((row) => ({
    label: row.label,
    isDefault: Boolean(row.isDefault),
    stats: summarize(trendFollow(daily, { ...base, ...row.plan }, costs)),
  }));
}

async function runIndex(index: ScalpIndex, days: number): Promise<IndexBacktest> {
  const config = SCALP_INDEXES[index];
  const since = Date.now() - days * DAY_MS;
  const spotLong = await loadSeries(index, config.underlying, Math.max(days, STRADDLE_DAYS));
  const spot = spotLong.filter((b) => b.t >= since);
  const fut = await loadFutures(index, days);
  const daily = await loadSeries(index, config.underlying, SWING_YEARS * 365, "D");
  const vix = await loadSeries("INDIAVIX", VIX_SYMBOL, STRADDLE_DAYS);
  const niftyDaily = index === "NIFTY" ? daily : await loadSeries("NIFTY", SCALP_INDEXES.NIFTY.underlying, SWING_YEARS * 365, "D");
  const options = DEFAULT_COSTS[index];
  const futures = FUTURES_COSTS[index];
  const base = config.stopPoints;

  const scalps = SETUPS.map((setup) => {
    const stopPoints = base * setup.stopMult;
    const trades = backtestSignals(
      { spot, fut },
      (ctx) => setup.detect(ctx, index),
      { stopPoints, rewardRisk: setup.rewardRisk, timeStopMin: setup.timeStopMin },
      options,
    );
    return result({
      key: setup.key, group: "scalp", name: setup.name, rule: setup.rule, instrument: OPTION, minTrades: 100,
      plan: `Stop ${stopPoints} pts, target ${setup.rewardRisk}R, exit after ${setup.timeStopMin} min, square-off 15:20.`,
    }, trades, spot, options, setup.key === "ORB" ? orbVariants(spot, fut, index) : []);
  });

  const holdExit = { stopPoints: base * 1.5, rewardRisk: Infinity, timeStopMin: 1_000, squareOffMin: 15 * 60 + 15 };
  const holdPlan = `Stop ${base * 1.5} pts, no target, exit at 15:15.`;
  const intraday = [
    result({
      key: "FIRST_HOUR_HOLD", group: "intraday", name: "First-hour breakout, held to 15:15", instrument: FUTURE, minTrades: 100,
      rule: "1-min close breaks the 09:15–10:15 range with EMA 9/21 and futures-VWAP agreeing. One a day, 10:15–13:00.",
      plan: holdPlan,
    }, backtestSignals({ spot, fut }, firstHourBreakoutSignals, holdExit, futures), spot, futures),
    result({
      key: "TREND_HOLD", group: "intraday", name: "5-minute trend, held to 15:15", instrument: FUTURE, minTrades: 100,
      rule: "The day's first 5-minute EMA 9/21 cross with futures-VWAP agreeing, before 13:00. One a day.",
      plan: holdPlan,
    }, backtestSignals({ spot, fut }, trendHoldSignals, holdExit, futures), spot, futures),
  ];

  const swingNote = `Futures carry ${CARRY_PCT_YEAR}%/yr charged to longs, credited to shorts.`;
  const swing = [
    result({
      key: "BREAKOUT_20D", group: "swing", name: "20-day breakout, 1–3 days", instrument: FUTURE, minTrades: 50,
      rule: "Daily close above the prior 20-day high (buy) or below the 20-day low (sell); enter next open.",
      plan: `Stop 1.5 × ATR(14), exit at the 3rd day's close. ${swingNote}`,
    }, backtestSwing(daily, breakout20Signals, { stopAtr: 1.5, maxDays: 3, exitOnSma5: false, carryPctYear: CARRY_PCT_YEAR }, futures), daily, futures),
    result({
      key: "RSI2_DIP", group: "swing", name: "RSI(2) dip in trend, 1–3 days", instrument: FUTURE, minTrades: 50,
      rule: "Above the 200-day average with RSI(2) under 10 (buy), or below it with RSI(2) over 90 (sell); enter next open.",
      plan: `Stop 2 × ATR(14); exit at the first close back beyond the 5-day average, or the 3rd day's close. ${swingNote}`,
    }, backtestSwing(daily, rsi2Signals, { stopAtr: 2, maxDays: 3, exitOnSma5: true, carryPctYear: CARRY_PCT_YEAR }, futures), daily, futures),
  ];

  const ownVol = realisedVolByDay(daily);
  const straddleInput: StraddleInput = {
    index, strikeStep: STRIKE_STEP[index], spot: spotLong, vix,
    ivRatio: ivRatioByDay(index, ownVol, realisedVolByDay(niftyDaily)),
    overnight: overnightShare(daily),
    realisedVol: (day) => ownVol.get(day),
  };
  const straddleTrades = backtestStraddle(straddleInput, DEFAULT_STRADDLE, options);
  const legCost = straddleTrades.length
    ? straddleTrades.reduce((sum, t) => sum + shortLegCost(options, t.entry, t.exit), 0) / straddleTrades.length : 0;
  const straddle = result({
    key: "STRADDLE_920", group: "selling", name: "09:20 short straddle", instrument: STRADDLE, minTrades: 200,
    rule: `Every day at 09:20 sell the ATM call and put of the nearest expiry (strike rounded to ${STRIKE_STEP[index]}). Premiums are modelled with Black-Scholes from the index and India VIX${index === "BANKNIFTY" ? " × the Bank Nifty / Nifty realised-volatility ratio" : ""}, with time measured in trading days (${Math.round(straddleInput.overnight * 100)}% of a day's movement happens overnight).`,
    plan: "Each leg has its own stop at 25% above its sale price; whatever is left is bought back at 15:15. Each leg counts as one trade.",
    costNote: `Costs average ₹${Math.round(legCost).toLocaleString("en-IN")} per leg (≈ ₹${Math.round(2 * legCost).toLocaleString("en-IN")} per straddle), including ${options.slippagePerSide} premium point slippage per side. Margin for a naked straddle is roughly ₹2–3 lakh per lot.`,
  }, straddleTrades, spotLong, options, straddleVariants(straddleInput, options));
  const filtered = result({
    key: "STRADDLE_IVRV", group: "selling", name: "09:20 straddle, only when options are rich", instrument: STRADDLE, minTrades: 100,
    rule: `The same straddle, but only on days when implied volatility at 09:20 (India VIX${index === "BANKNIFTY" ? " × the Bank Nifty ratio" : ""}) is at least ${IV_RV_MIN}× the index's realised volatility over the previous 20 sessions, i.e. options are priced for more movement than the market has been delivering.`,
    plan: "Same stops and exit as the plain straddle. Days that fail the filter are skipped.",
    costNote: `Same costs as the plain straddle. Margin roughly ₹2–3 lakh per lot.`,
  }, backtestStraddle(straddleInput, { ...DEFAULT_STRADDLE, minIvOverRv: IV_RV_MIN }, options), spotLong, options, filteredVariants(straddleInput, options));
  const condorTrades = backtestCondor(straddleInput, DEFAULT_CONDOR, options);
  const spreadCost = condorTrades.length ? condorTrades.reduce((s, t) => s + (t.grossRs - t.netRs), 0) / condorTrades.length : 0;
  const condor = result({
    key: "CONDOR_920", group: "selling", name: "09:20 iron condor (hedged)", instrument: CONDOR, minTrades: 200,
    rule: `Every day at 09:20 sell the call and put about 0.5% away from the index and buy the call and put about 0.5% further out (strikes rounded to ${STRIKE_STEP[index]}, nearest expiry). The bought wings cap the loss. Priced with the same model as the straddle; one volatility for all strikes (real markets price far puts higher, so the put wing is likely dearer than modelled).`,
    plan: "One stop on the whole position when its loss equals the credit received; otherwise bought back at 15:15. The call spread and put spread each count as one trade.",
    costNote: `Costs average ₹${Math.round(spreadCost).toLocaleString("en-IN")} per spread (≈ ₹${Math.round(2 * spreadCost).toLocaleString("en-IN")} per condor, 4 legs), including ${options.slippagePerSide} premium point slippage per leg per side. Margin is far lower than a naked straddle, roughly ₹40–70k per lot with the hedge benefit.`,
  }, condorTrades, spotLong, options, condorVariants(straddleInput, options));
  const selling = [straddle, filtered, condor].map(flagModelSensitive);

  const trendPlan: TrendPlan = { mode: "longShort", fast: 50, slow: 200, carryPctYear: CARRY_PCT_YEAR };
  const trendNote = `Each month held adds one futures roll (≈ ₹${Math.round(roundTripCost(futures, daily.at(-1)?.close ?? 0)).toLocaleString("en-IN")}) and ${CARRY_PCT_YEAR}%/yr carry (paid on longs, earned on shorts).`;
  const trend = [
    result({
      key: "TREND_50_200", group: "trend", name: "50/200-day trend, long or short", instrument: FUTURE, minTrades: 10,
      rule: "Long the future while the 50-day average is above the 200-day average, short while below; switch at the next open.",
      plan: "Held until the averages cross; no stop. Compare with the buy-and-hold benchmark below.",
      costNote: trendNote,
    }, trendFollow(daily, trendPlan, futures), daily, futures, trendVariants(daily, futures)),
    result({
      key: "TREND_50_200_LONG", group: "trend", name: "50/200-day trend, long or flat", instrument: FUTURE, minTrades: 10,
      rule: "Long the future while the 50-day average is above the 200-day average; otherwise no position.",
      plan: "Held until the averages cross; no stop.",
      costNote: trendNote,
    }, trendFollow(daily, { ...trendPlan, mode: "longOnly" }, futures), daily, futures),
  ];

  const lastSpot = spotLong.at(-1)?.close ?? daily.at(-1)?.close ?? 0;
  const contract = lastSpot * futures.lotSize;
  const lastVix = vix.at(-1)?.close ?? 15;
  const lastDay = spotLong.length ? istDayKey(spotLong[spotLong.length - 1].t) : "";
  const atmVol = (lastVix / 100) * straddleInput.ivRatio(lastDay);
  const atmStrike = Math.round(lastSpot / STRIKE_STEP[index]) * STRIKE_STEP[index];
  const premium = bsPrice("CE", lastSpot, atmStrike, SCALP_SESSIONS_TO_EXPIRY[index] / 252, atmVol) * options.lotSize;
  const k = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const capitalOf = (s: Draft): [number, string] => {
    if (s.instrument === OPTION) return [premium, `Premium for 1 ATM option lot today (≈ ${k(premium)} at India VIX ${lastVix.toFixed(1)}, ${SCALP_SESSIONS_TO_EXPIRY[index]} sessions to expiry).`];
    if (s.instrument === STRADDLE) return [contract * MARGIN_PCT.straddle, `Margin for a naked straddle ≈ ${MARGIN_PCT.straddle * 100}% of one lot's contract value (${k(contract)}).`];
    if (s.instrument === CONDOR) return [contract * MARGIN_PCT.condor, `Margin for a hedged iron condor ≈ ${MARGIN_PCT.condor * 100}% of one lot's contract value (${k(contract)}).`];
    return [contract * MARGIN_PCT.future, `Futures margin ≈ ${MARGIN_PCT.future * 100}% of one lot's contract value (${k(contract)}).`];
  };
  const setups = [...scalps, ...intraday, ...swing, ...selling, ...trend].map((s) => withCapital(s, ...capitalOf(s)));
  return { index, name: config.name, lotSize: options.lotSize, setups };
}

const memo = ((globalThis as { __scalpBacktest?: Map<number, { at: number; report: Promise<ScalpBacktestReport> }> })
  .__scalpBacktest ??= new Map());
const TTL_MS = 10 * 60_000;

export function getScalpBacktest(days: number): Promise<ScalpBacktestReport> {
  const hit = memo.get(days);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.report;
  const report = (async () => {
    const indexes: IndexBacktest[] = [];
    for (const index of ["NIFTY", "BANKNIFTY"] as const) indexes.push(await runIndex(index, days));
    return {
      generatedAt: Date.now(),
      days,
      indexes,
      assumptions: [
        `Scalps and intraday holds: the last ${days} days of 1-minute index spot from Fyers, futures VWAP from Fyers continuous futures. Swing setups: ${SWING_YEARS} years of daily index bars.`,
        "Signals act on a completed bar; entry is at the next bar's open. Stops are checked before targets inside a bar, and gaps through a stop fill at the open. One trade at a time.",
        "Each setup's rules and numbers were fixed before the first run and not tuned to these results. Testing many setups raises the chance that one looks good by luck, so a winner would still need paper trading.",
        "Scalps are priced as a bought ATM option: 0.5 delta × index points × lot (Nifty 65, Bank Nifty 30). Theta, gamma and IV changes are ignored. Expired options have no Fyers history, so option-VWAP filters are not tested.",
        "Longer holds are priced as one index future (P&L = index points × lot), because an option's time decay over hours or days would be large and cannot be measured without option history. Futures need roughly ₹1.5–2.5 lakh margin per lot.",
        "Fyers charges ₹20 per order. STT from 1 Apr 2026: 0.15% of option sell premium, 0.05% of futures sell value; plus exchange, SEBI, GST and stamp duty. Slippage: options ₹0.5 (Nifty) / ₹1 (Bank Nifty) of premium per side; futures 1 / 3 index points per side.",
        "Swing results use today's lot sizes and charges on all ten years so every year is judged at today's costs. A swing setup needs at least 50 trades; intraday setups need 100.",
        `Option selling is modelled, not replayed: Fyers has no prices for expired options. Each minute, both legs are priced with Black-Scholes from the index and India VIX (Bank Nifty: VIX × its realised-volatility ratio to Nifty) over the last ${STRADDLE_DAYS} days, with time to expiry in trading days. Stops are checked against the minute's worst index level and the VIX high. Expiries: Nifty weekly (Thursday, Tuesday from Sep 2025); Bank Nifty weekly (Wednesday) until Nov 2024, then monthly.`,
        "The first straddle run measured time in calendar days and lost money even before costs; that undercounts how much value options lose during market hours, so the model was switched to trading-day time before the results below. A model change after seeing results is a warning sign in itself, which is one more reason the stress row matters.",
        `The filtered straddle and the iron condor (added 5 Oct 2026) had their rules fixed before the first run: filter at IV ÷ 20-day realised volatility ≥ ${IV_RV_MIN}; condor shorts 0.5% out, wings 0.5% further, stop at a loss equal to the credit. The realised volatility uses only sessions before the trade day. The condor prices every strike at one volatility (no skew) and charges costs and slippage on all four legs.`,
        "Win rates for option selling count each leg (or spread) as a trade; \"winning days\" combines the legs of each day, which is what an account would see.",
        "Capital: the money one lot blocks today (option premium for scalps; estimated NSE margin of about 12% of contract value for futures, 15% for a naked straddle, 3% for a hedged condor) plus the setup's worst drawdown, so the account could keep trading through its worst losing stretch. Return = net profit ÷ that capital; per year is the simple average over the years tested, not compounded. Margins change with volatility; check Fyers' margin calculator.",
        "Trend following uses the same ten years of daily bars. A held future is rolled every month (one extra round trip each time) and pays or earns carry. With so few trades, compare it with the buy-and-hold row rather than relying on the verdict alone.",
        "Past results do not guarantee future results.",
      ],
    } satisfies ScalpBacktestReport;
  })();
  memo.set(days, { at: Date.now(), report });
  report.catch(() => memo.delete(days));
  return report;
}
