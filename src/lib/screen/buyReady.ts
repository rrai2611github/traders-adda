import type { Candle } from "@/lib/market/types";
import type { ScannerHit, ScannerKey } from "./chartinkScans.ts";
import { HEALTHY_BREADTH_PERCENT } from "./breadth.ts";
import { LEVEL_RULES, tradeLevels } from "./tradeLevels.ts";

/**
 * "Buy-ready" gate for Chartink scanner hits: common trend, strength and risk
 * checks plus one scanner-specific quality check, and a trade plan whose entry
 * and stop come from the scanner's own pattern where it has one.
 */
export const BUY_READY_RULES = {
  minBreadth: HEALTHY_BREADTH_PERCENT,
  minRs: 70,
  minScore: 10,
  maxAboveEma21: 8,
  maxRiskPercent: 6,
  swingMaxFromHigh: 10,
  rangeMinCloseInRange: 70,
  rsiDivRange: [40, 60] as const,
} as const;

export interface BuyContext {
  /** Share of liquid stocks above their 50-day average, 0-100. */
  breadthPercent: number | null;
  passesFloor: boolean;
  rs: number | null;
  /** 3-day average oscillator score out of 15. */
  score: number | null;
  vs50: number | null;
  vs200: number | null;
  /** % above the 21-day EMA. */
  aboveEma21: number | null;
  atr: number;
  /** Completed daily candles up to the scanner's candle. */
  candles: Candle[];
}

export interface ScannerPlan {
  entry: number;
  /** Skip the trade if it opens above this: do not chase a gap. */
  buyZoneHigh: number;
  stop: number;
  target1: number;
  target2: number;
  riskPercent: number;
  highWinTarget: number;
  highWinStop: number;
  basis: string;
}

export type BuyCheckKey = "breadth" | "liquid" | "rs" | "score" | "trend" | "notExtended" | "risk" | "pattern";

export interface BuyCheck {
  key: BuyCheckKey;
  pass: boolean;
}

export interface BuyReadiness {
  checks: BuyCheck[];
  passed: number;
  /** Every check passes, breadth included. */
  buyReady: boolean;
  /** Every check except market breadth passes. */
  setupReady: boolean;
  plan: ScannerPlan | null;
}

const PATTERN_CHECK: Record<ScannerKey, { label: string; pass: (v: ScannerHit["values"]) => boolean }> = {
  swing: { label: `Within ${BUY_READY_RULES.swingMaxFromHigh}% of the 52-week high`, pass: (v) => typeof v.fromHigh === "number" && v.fromHigh >= -BUY_READY_RULES.swingMaxFromHigh },
  range: { label: `Closed in the top ${100 - BUY_READY_RULES.rangeMinCloseInRange}% of the day's range`, pass: (v) => typeof v.closeInRange === "number" && v.closeInRange >= BUY_READY_RULES.rangeMinCloseInRange },
  nr7: { label: "Has not closed below the NR7 low", pass: (v) => v.brokeLow !== true },
  fall4: { label: "Reversal: higher high than yesterday (part of the screener)", pass: () => true },
  up3: { label: "Three 3% up days (part of the screener)", pass: () => true },
  ema21: { label: "21 EMA is rising", pass: (v) => v.emaRising === true },
  inside: { label: "True inside bar (inside the mother bar's range)", pass: (v) => v.trueInside === true },
  rsidiv: {
    label: `RSI between ${BUY_READY_RULES.rsiDivRange[0]} and ${BUY_READY_RULES.rsiDivRange[1]} (reset, not overbought)`,
    pass: (v) => typeof v.rsi === "number" && v.rsi >= BUY_READY_RULES.rsiDivRange[0] && v.rsi <= BUY_READY_RULES.rsiDivRange[1],
  },
  high52: { label: "Closed in the top half of the day's range (buyers held the breakout)", pass: (v) => typeof v.closeInRange === "number" && v.closeInRange >= 50 },
  pullback20: { label: "Closed in the top half of the day's range (the bounce held)", pass: (v) => typeof v.closeInRange === "number" && v.closeInRange >= 50 },
  leader: { label: "RS line at a new 52-week high (part of the screener)", pass: () => true },
  ath: { label: "Closed in the top half of the day's range (buyers held the high)", pass: (v) => typeof v.closeInRange === "number" && v.closeInRange >= 50 },
  pocket: { label: "Closed in the top half of the day's range", pass: (v) => typeof v.closeInRange === "number" && v.closeInRange >= 50 },
  arbm: { label: "Closed in the top half of the day's range (buyers held the breakout)", pass: (v) => typeof v.closeInRange === "number" && v.closeInRange >= 50 },
};

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The oscillator score is required only on breakout-type scanners. In the
 * backtest it helped NR7 and inside bars but only removed trades from the
 * pullback scanners, whose dip naturally pulls the oscillators down.
 */
export const SCORE_CHECKED: ReadonlySet<ScannerKey> = new Set(["nr7", "inside", "range"]);

/** Entry and stop from the scanner's pattern bar, else the app's standard swing-low plan. */
export function scannerPlan(key: ScannerKey, hit: ScannerHit, candles: Candle[], atr: number): ScannerPlan | null {
  if (!(atr > 0) || candles.length < 2) return null;
  const last = candles[candles.length - 1];
  const v = hit.values;
  let entry: number | null = null;
  let patternLow: number | null = null;
  let basis = "";
  if (key === "nr7" && typeof v.nr7High === "number" && typeof v.nr7Low === "number") {
    entry = Math.max(v.nr7High, v.brokeHigh === true ? last.high : v.nr7High);
    patternLow = v.nr7Low;
    basis = v.brokeHigh === true ? "Above today's high; SL below the NR7 low" : "Above the NR7 high; SL below the NR7 low";
  } else if (key === "inside" && v.trueInside === true && typeof v.motherHigh === "number" && typeof v.motherLow === "number") {
    entry = v.motherHigh;
    patternLow = v.motherLow;
    basis = "Above the mother bar's high; SL below its low";
  } else if (key === "fall4" && typeof v.reversalHigh === "number" && typeof v.pullbackLow === "number") {
    entry = v.reversalHigh;
    patternLow = v.pullbackLow;
    basis = "Above the reversal day's high; SL below the pullback low";
  } else if (key === "pullback20" && typeof v.dayHigh === "number" && typeof v.dayLow === "number") {
    entry = v.dayHigh;
    patternLow = v.dayLow;
    basis = "Above the pullback day's high; SL below its low";
  }
  if (entry == null || patternLow == null) {
    const std = tradeLevels(candles, atr);
    if (!std) return null;
    return {
      entry: std.entry, buyZoneHigh: std.buyZoneHigh, stop: std.stop, target1: std.target1, target2: std.target2,
      riskPercent: std.riskPercent, highWinTarget: std.highWinTarget, highWinStop: std.highWinStop,
      basis: "Above the last high; SL below the 10-day swing low",
    };
  }
  const r = LEVEL_RULES;
  // A pattern low closer than 1 ATR is inside normal daily noise; widen to 1 ATR.
  const stop = Math.min(patternLow - r.stopBufferAtr * atr, entry - r.minStopAtr * atr);
  if (!(stop > 0) || entry - stop > r.maxStopAtr * atr) return null;
  const risk = entry - stop;
  return {
    entry: round(entry),
    buyZoneHigh: round(entry + r.buyZoneAtr * atr),
    stop: round(stop),
    target1: round(entry + r.target1R * risk),
    target2: round(entry + r.target2R * risk),
    riskPercent: round((risk / entry) * 100),
    highWinTarget: round(entry + r.highWinTargetR * risk),
    highWinStop: round(entry - r.highWinStopR * risk),
    basis,
  };
}

/** Checks that apply to a scanner, in display order. */
export function buyCheckLabels(key: ScannerKey): { key: BuyCheckKey; label: string }[] {
  const R = BUY_READY_RULES;
  return [
    { key: "breadth", label: `Market breadth ≥ ${R.minBreadth}% of liquid stocks above their 50-day average` },
    { key: "liquid", label: "Liquid: median traded value ≥ ₹5 cr a day" },
    { key: "rs", label: `Relative strength ≥ ${R.minRs}` },
    ...(SCORE_CHECKED.has(key) ? [{ key: "score" as const, label: `Oscillator score (3-day average) ≥ ${R.minScore}/15` }] : []),
    { key: "trend", label: "Above the 50-day and 200-day averages" },
    { key: "notExtended", label: `Not more than ${R.maxAboveEma21}% above the 21 EMA` },
    { key: "risk", label: `Entry-to-SL risk ≤ ${R.maxRiskPercent}%` },
    { key: "pattern", label: PATTERN_CHECK[key].label },
  ];
}

export function assessBuyReady(key: ScannerKey, hit: ScannerHit, ctx: BuyContext): BuyReadiness {
  const R = BUY_READY_RULES;
  const plan = scannerPlan(key, hit, ctx.candles, ctx.atr);
  const pass: Record<BuyCheckKey, boolean> = {
    breadth: ctx.breadthPercent != null && ctx.breadthPercent >= R.minBreadth,
    liquid: ctx.passesFloor,
    rs: ctx.rs != null && ctx.rs >= R.minRs,
    score: ctx.score != null && ctx.score >= R.minScore,
    trend: ctx.vs50 != null && ctx.vs50 > 0 && ctx.vs200 != null && ctx.vs200 > 0,
    notExtended: ctx.aboveEma21 != null && ctx.aboveEma21 <= R.maxAboveEma21,
    risk: plan != null && plan.riskPercent <= R.maxRiskPercent,
    pattern: PATTERN_CHECK[key].pass(hit.values),
  };
  const checks: BuyCheck[] = buyCheckLabels(key).map((c) => ({ key: c.key, pass: pass[c.key] }));
  const passed = checks.filter((c) => c.pass).length;
  const setupReady = checks.every((c) => c.key === "breadth" || c.pass);
  return { checks, passed, setupReady, buyReady: setupReady && pass.breadth, plan };
}

export interface ExtraGateInput {
  rs: number | null;
  vs50: number | null;
  vs200: number | null;
  aboveEma21: number | null;
  riskPercent: number;
}

/**
 * The Buy-ready checks the RPCI and Oscillator picks must also pass, apart
 * from market breadth, which callers apply. Liquidity is already required to
 * enter those screens. Returns the checks that fail; empty means ready.
 */
export function extraPickFailures(input: ExtraGateInput): BuyCheckKey[] {
  const R = BUY_READY_RULES;
  const failed: BuyCheckKey[] = [];
  if (input.rs == null || input.rs < R.minRs) failed.push("rs");
  if (input.vs50 == null || input.vs50 <= 0 || input.vs200 == null || input.vs200 <= 0) failed.push("trend");
  if (input.aboveEma21 == null || input.aboveEma21 > R.maxAboveEma21) failed.push("notExtended");
  if (!(input.riskPercent <= R.maxRiskPercent)) failed.push("risk");
  return failed;
}
