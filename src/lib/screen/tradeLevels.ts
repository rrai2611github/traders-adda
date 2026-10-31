import type { Candle } from "@/lib/market/types";

export const LEVEL_RULES = {
  swingSessions: 10,
  minStopAtr: 1,
  maxStopAtr: 2.5,
  stopBufferAtr: 0.1,
  buyZoneAtr: 0.5,
  target1R: 2,
  target2R: 3,
  resistanceSessions: 250,
  /** High win-rate plan: small target, wide stop, both in units of R (entry − SL). */
  highWinTargetR: 0.5,
  highWinStopR: 2,
} as const;

export type StopBasis = "swing" | "atr-cap" | "atr-floor";

export interface TradeLevels {
  /** Buy above the last completed session's high. */
  entry: number;
  /** Do not chase above this; wait for a pullback instead. */
  buyZoneHigh: number;
  stop: number;
  stopBasis: StopBasis;
  swingLow: number;
  /** Lowest low of the last 20 / 50 completed sessions (null with too little history). */
  swingLow20: number | null;
  swingLow50: number | null;
  target1: number;
  target2: number;
  riskPercent: number;
  atr: number;
  /** Highest high of the last ~52 weeks, if it lies between entry and target 2 (overhead supply). */
  resistance: number | null;
  /** High win-rate plan: quick target at +0.5R with the SL at −2R. */
  highWinTarget: number;
  highWinStop: number;
  highWinStopPercent: number;
}

/**
 * Rule-based long plan from completed daily candles and ATR(14):
 * entry above the last high, stop just below the 10-session swing low but no
 * closer than 1×ATR and no wider than 2.5×ATR, targets at 2R and 3R.
 */
export function tradeLevels(done: Candle[], atr: number): TradeLevels | null {
  const rules = LEVEL_RULES;
  if (done.length < rules.swingSessions || !(atr > 0)) return null;
  const last = done[done.length - 1];
  const entry = last.high;
  const swingLow = Math.min(...done.slice(-rules.swingSessions).map((c) => c.low));
  const swingStop = swingLow - rules.stopBufferAtr * atr;
  const widest = entry - rules.maxStopAtr * atr;
  const tightest = entry - rules.minStopAtr * atr;
  const stopBasis: StopBasis = swingStop < widest ? "atr-cap" : swingStop > tightest ? "atr-floor" : "swing";
  const stop = stopBasis === "atr-cap" ? widest : stopBasis === "atr-floor" ? tightest : swingStop;
  if (!(stop > 0) || stop >= entry) return null;
  const risk = entry - stop;
  const target2 = entry + rules.target2R * risk;
  const yearHigh = Math.max(...done.slice(-rules.resistanceSessions).map((c) => c.high));
  const round = (v: number) => Math.round(v * 100) / 100;
  const lowestLow = (sessions: number) =>
    done.length >= sessions ? round(Math.min(...done.slice(-sessions).map((c) => c.low))) : null;
  return {
    entry: round(entry),
    buyZoneHigh: round(entry + rules.buyZoneAtr * atr),
    stop: round(stop),
    stopBasis,
    swingLow: round(swingLow),
    swingLow20: lowestLow(20),
    swingLow50: lowestLow(50),
    target1: round(entry + rules.target1R * risk),
    target2: round(target2),
    riskPercent: round((risk / entry) * 100),
    atr: round(atr),
    resistance: yearHigh > entry && yearHigh < target2 ? round(yearHigh) : null,
    highWinTarget: round(entry + rules.highWinTargetR * risk),
    highWinStop: round(entry - rules.highWinStopR * risk),
    highWinStopPercent: round(((rules.highWinStopR * risk) / entry) * 100),
  };
}

export type LevelStatus = "wait" | "triggered" | "extended" | "stopped";

/** Where the live price sits against the plan. */
export function levelStatus(levels: TradeLevels, price: number): LevelStatus {
  if (price <= levels.stop) return "stopped";
  if (price > levels.buyZoneHigh) return "extended";
  if (price > levels.entry) return "triggered";
  return "wait";
}
