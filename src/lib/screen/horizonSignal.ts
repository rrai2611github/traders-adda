import type { ScanRow } from "../../hooks/useScreenScan.ts";
import { classifyBuyingStatus, withRiskFlags, type BuyingStatus, type RatedCheck } from "./buyingStatus.ts";

export type BuyHorizon = "short" | "mid" | "long";

export interface HorizonPlan {
  entry: number;
  buyZoneHigh: number;
  stop: number;
  target1: number;
  target2: number;
  riskPercent: number;
  rewardRisk1: number;
  rewardRisk2: number;
  /** How the stop-loss was placed, shown next to the plan. */
  stopBasis?: string;
  /** How the targets were set, shown next to the plan. */
  targetBasis?: string;
}

/** Shown instead of a plan when levels exist but are not tradeable. */
export interface NoTrade {
  reason: string;
  detail: string;
}

export interface HorizonSignal {
  horizon: BuyHorizon;
  status: BuyingStatus;
  /** Null whenever the risk or stop-loss check fails, so no untradeable targets are shown. */
  plan: HorizonPlan | null;
  noTrade: NoTrade | null;
}

/** Maximum holding period per horizon (short-term matches the backtested 30-session time exit). */
export const HORIZON_HOLDING: Record<BuyHorizon, string> = {
  short: "up to 30 trading days",
  mid: "up to ~3 months",
  long: "6–12 months",
};

export const MAX_RISK_PERCENT: Record<BuyHorizon, number> = { short: 6, mid: 8, long: 10 };

/**
 * Horizon levels are reference levels, not a recommendation: scripts/backtest-horizons.mjs
 * (Nov 2022–Oct 2026) found no horizon consistently profitable, so every plan is shown with
 * how often its targets were actually reached (horizonBacktest.json).
 */
export const HORIZON_RESEARCH_NOTE =
  "Reference levels, not a recommendation. A 4-year test found no consistent edge for these Short/Mid/Long rules; the hit rates show how often each target was actually reached. Today's Picks is the tested buy list.";

/** Historical outcome of a horizon's plan (Buy ready sample) from scripts/backtest-horizons.mjs. */
export interface TargetOdds {
  trades: number;
  t1HitPercent: number;
  t1MedianDays: number | null;
  t2HitPercent: number;
  t2MedianDays: number | null;
  stopFirstPercent: number;
  timeExitPercent: number;
  avgR: number;
  winPercent: number;
  maxHoldSessions: number;
  from: string;
  to: string;
}

/** Below this many trades a hit rate is flagged as a small sample. */
export const MIN_ODDS_TRADES = 100;

const days = (n: number | null) => (n == null ? "" : ` (median ${n} trading day${n === 1 ? "" : "s"})`);

/** One-line hit-rate summary per target, e.g. "T1 hit 17% of the time (median 12 trading days)". */
export function targetOddsLines(odds: TargetOdds): { t1: string; t2: string; stop: string; sample: string } {
  const window = `within ${odds.maxHoldSessions} trading days`;
  return {
    t1: `T1 hit ${Math.round(odds.t1HitPercent)}% of the time${days(odds.t1MedianDays)}`,
    t2: `T2 hit ${Math.round(odds.t2HitPercent)}% ${window}${days(odds.t2MedianDays)}`,
    stop: `Stop-loss hit first ${Math.round(odds.stopFirstPercent)}%`,
    sample: `${odds.trades} past trades, ${odds.from.slice(0, 4)}–${odds.to.slice(0, 4)}${odds.trades < MIN_ODDS_TRADES ? " · small sample" : ""}`,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

function planFromLevels(levels: NonNullable<ScanRow["oscillatorScore"]>["levels"]): HorizonPlan | null {
  if (!levels) return null;
  const risk = levels.entry - levels.stop;
  if (!(risk > 0)) return null;
  return {
    entry: levels.entry,
    buyZoneHigh: levels.buyZoneHigh,
    stop: levels.stop,
    target1: levels.target1,
    target2: levels.target2,
    riskPercent: levels.riskPercent,
    rewardRisk1: round((levels.target1 - levels.entry) / risk),
    rewardRisk2: round((levels.target2 - levels.entry) / risk),
  };
}

export const SWING_STOP_RULES = {
  mid: { swingSessions: 20, bufferAtr: 0.25, minStopAtr: 1.5, target1R: 2, target2R: 3 },
  long: { swingSessions: 50, bufferAtr: 0.5, minStopAtr: 2, target1R: 2.5, target2R: 4 },
} as const;

/**
 * Mid/long plan with the stop just below a real swing low (never closer than a
 * minimum ATR distance). The stop is not capped: when support is too far away
 * the risk check fails instead of moving the stop to an arbitrary percentage.
 */
function swingStopPlan(row: ScanRow, entry: number, horizon: "mid" | "long"): HorizonPlan | null {
  const rules = SWING_STOP_RULES[horizon];
  const levels = row.oscillatorScore?.levels;
  const swingLow = horizon === "mid" ? levels?.swingLow20 : levels?.swingLow50;
  const atr = levels?.atr;
  if (!(entry > 0) || swingLow == null || !(swingLow > 0) || atr == null || !(atr > 0)) return null;
  const swingStop = swingLow - rules.bufferAtr * atr;
  // Price already through the swing low: support is broken, so there is no valid plan.
  if (!(row.price > swingStop)) return null;
  const tightest = entry - rules.minStopAtr * atr;
  const atrFloor = swingStop > tightest;
  const stop = atrFloor ? tightest : swingStop;
  if (!(stop > 0) || !(stop < entry)) return null;
  const risk = entry - stop;
  return {
    entry: round(entry),
    buyZoneHigh: round(entry * 1.03),
    stop: round(stop),
    target1: round(entry + rules.target1R * risk),
    target2: round(entry + rules.target2R * risk),
    riskPercent: round((risk / entry) * 100),
    rewardRisk1: rules.target1R,
    rewardRisk2: rules.target2R,
    stopBasis: atrFloor
      ? `${rules.minStopAtr}×ATR below entry (the ${rules.swingSessions}-day low ₹${round(swingLow)} is too close)`
      : `Below the ${rules.swingSessions}-day low ₹${round(swingLow)} (−${rules.bufferAtr}×ATR)`,
  };
}

const aboveStop = (row: ScanRow, plan: HorizonPlan | null) => plan != null && row.price > plan.stop;
const withinRisk = (horizon: BuyHorizon, plan: HorizonPlan | null) => plan != null && plan.riskPercent <= MAX_RISK_PERCENT[horizon];

function finishSignal(horizon: BuyHorizon, row: ScanRow, checks: RatedCheck[], plan: HorizonPlan | null): HorizonSignal {
  const status = withRiskFlags(classifyBuyingStatus(checks), row.riskFlags);
  let noTrade: NoTrade | null = null;
  if (plan && !withinRisk(horizon, plan)) {
    noTrade = {
      reason: "Risk too wide – no trade",
      detail: `The nearest valid stop-loss is ${plan.riskPercent.toFixed(1)}% below entry; this horizon allows at most ${MAX_RISK_PERCENT[horizon]}%.`,
    };
  } else if (plan && !aboveStop(row, plan)) {
    noTrade = { reason: "Below stop-loss – no trade", detail: "Price is already at or below the stop-loss." };
  }
  return { horizon, status, plan: noTrade ? null : plan, noTrade };
}

/**
 * Short-term targets from the base's height ("measured move"): T1 = pivot + height,
 * T2 = pivot + 2 × height. Only used once price is at the breakout (pivot inside the
 * buy zone); deeper in a base the pivot is an old high and the targets would be far
 * away. In scripts/backtest-horizons.mjs these were reached about twice as often as
 * the 2R/3R targets with no worse average result. Otherwise the 2R/3R targets stay.
 */
export function withPatternTargets(plan: HorizonPlan | null, row: Pick<ScanRow, "pivotPrice" | "baseDepth">): HorizonPlan | null {
  if (!plan || row.pivotPrice == null || !(row.pivotPrice > 0) || row.baseDepth == null || !(row.baseDepth > 0)) return plan;
  if (row.pivotPrice > plan.buyZoneHigh) return plan;
  const height = (row.pivotPrice * row.baseDepth) / 100;
  const target1 = row.pivotPrice + height;
  const risk = plan.entry - plan.stop;
  if (!(target1 > plan.entry) || !(risk > 0)) return plan;
  const target2 = row.pivotPrice + 2 * height;
  return {
    ...plan,
    target1: round(target1),
    target2: round(target2),
    rewardRisk1: round((target1 - plan.entry) / risk),
    rewardRisk2: round((target2 - plan.entry) / risk),
    targetBasis: `Targets from the base height (₹${round(height)} above pivot ₹${round(row.pivotPrice)}).`,
  };
}

function shortTermSignal(row: ScanRow, breadthPercent: number | null): HorizonSignal {
  const plan = withPatternTargets(planFromLevels(row.oscillatorScore?.levels ?? null), row);
  const checks: RatedCheck[] = [
    { key: "breadth", label: "Market breadth", pass: breadthPercent != null && breadthPercent >= 50 },
    { key: "liquid", label: "Liquidity", pass: row.turnoverCr != null && row.turnoverCr >= 5 },
    { key: "rs", label: "RS at least 70", pass: row.rs != null && row.rs >= 70 },
    { key: "trend", label: "Above 50/200-day averages", pass: row.vs50 != null && row.vs50 > 0 && row.vs200 != null && row.vs200 > 0 },
    { key: "score", label: "Oscillator score at least 10", pass: row.oscillatorScore != null && row.oscillatorScore.score >= 10 },
    { key: "risk", label: "Risk at most 6%", pass: withinRisk("short", plan) },
    { key: "extension", label: "Inside short-term buy zone", pass: plan != null && row.price <= plan.buyZoneHigh },
    { key: "pattern", label: "Active setup", pass: row.exitReason == null && row.stage !== "played-out" },
    { key: "stop", label: "Price above stop-loss", pass: aboveStop(row, plan) },
  ];
  return finishSignal("short", row, checks, plan);
}

function midTermSignal(row: ScanRow, breadthPercent: number | null): HorizonSignal {
  const entry = row.pivotPrice != null && row.pivotPrice > row.price ? row.pivotPrice : row.price;
  const plan = swingStopPlan(row, entry, "mid");
  const activeStage = row.stage === "forming" || row.stage === "breakout" || row.stage === "climbing";
  const checks: RatedCheck[] = [
    { key: "breadth", label: "Market breadth at least 45%", pass: breadthPercent != null && breadthPercent >= 45 },
    { key: "liquid", label: "Liquidity", pass: row.turnoverCr != null && row.turnoverCr >= 5 },
    { key: "rs", label: "RS at least 75", pass: row.rs != null && row.rs >= 75 },
    { key: "trend", label: "Above 50/200-day averages", pass: row.vs50 != null && row.vs50 > 0 && row.vs200 != null && row.vs200 > 0 },
    { key: "score", label: "Positive oscillator score", pass: row.oscillatorScore != null && row.oscillatorScore.score >= 8 },
    { key: "base", label: "Valid medium-term stage", pass: activeStage },
    { key: "extension", label: "Not over 10% from pivot", pass: row.ext != null && row.ext <= 10 },
    { key: "risk", label: "Risk at most 8%", pass: withinRisk("mid", plan) },
    { key: "stop", label: "Price above stop-loss", pass: aboveStop(row, plan) },
  ];
  return finishSignal("mid", row, checks, plan);
}

function longTermSignal(row: ScanRow, breadthPercent: number | null): HorizonSignal {
  const plan = swingStopPlan(row, row.price, "long");
  const checks: RatedCheck[] = [
    { key: "breadth", label: "Market breadth at least 40%", pass: breadthPercent != null && breadthPercent >= 40 },
    { key: "liquid", label: "Liquidity", pass: row.turnoverCr != null && row.turnoverCr >= 5 },
    { key: "rs", label: "RS at least 80", pass: row.rs != null && row.rs >= 80 },
    { key: "trend200", label: "Above 200-day average", pass: row.vs200 != null && row.vs200 > 0 },
    { key: "trend50", label: "Above 50-day average", pass: row.vs50 != null && row.vs50 > 0 },
    // fromHigh is the percentage below the 52-week high (0 = at the high).
    { key: "high", label: "Within 15% of 52-week high", pass: row.fromHigh != null && row.fromHigh <= 15 },
    { key: "score", label: "Constructive oscillators", pass: row.oscillatorScore != null && row.oscillatorScore.score >= 8 },
    { key: "risk", label: "Risk at most 10%", pass: withinRisk("long", plan) },
    { key: "stop", label: "Price above stop-loss", pass: aboveStop(row, plan) },
  ];
  return finishSignal("long", row, checks, plan);
}

export function horizonBuySignal(
  row: ScanRow,
  horizon: BuyHorizon,
  breadthPercent: number | null,
): HorizonSignal {
  if (horizon === "short") return shortTermSignal(row, breadthPercent);
  if (horizon === "long") return longTermSignal(row, breadthPercent);
  return midTermSignal(row, breadthPercent);
}
