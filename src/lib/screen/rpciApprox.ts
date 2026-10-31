import type { Candle } from "@/lib/market/types";
import { getActiveSession, istDateKey, type ActiveSession } from "../market/marketHours.ts";
import type { StockMetrics } from "./metrics";

export const RPCI_APPROX_RULES = {
  windowSessions: 20,
  maxRangePercent: 18,
  maxPriorContractionRatio: 0.9,
  maxContractionRatio: 0.75,
  maxVolumeRatio: 0.8,
  minBreakoutVolumeRatio: 1.5,
  minRs: 70,
  maxFromHighPercent: 25,
  maxBelowPivotPercent: 8,
  maxAbovePivotPercent: 3,
} as const;

export interface RpciApproxResult {
  stage: "forming" | "testing" | "breakout";
  pivotPrice: number;
  baseLowPrice: number;
  baseCandleTimestamp: number;
  lastCompletedCandleTimestamp: number;
  entryTriggerPrice: number;
  riskPerShare: number;
  riskPercent: number;
  rangePercent: number;
  priorContractionRatio: number;
  contractionRatio: number;
  volumeRatio: number;
  breakoutVolumeRatio: number | null;
  distanceToPivotPercent: number;
}

function rangePercent(candles: Candle[]): number | null {
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  return high > 0 && low > 0 && high >= low ? ((high - low) / high) * 100 : null;
}

function averageVolume(candles: Candle[]): number {
  return candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
}

/** An independent price-contraction screen, not the proprietary RPCI formula. */
export function measureRpciApproximation(
  candles: Candle[],
  metrics: Pick<StockMetrics, "passesFloor" | "rs" | "vs50" | "vs200" | "fromHigh" | "price">,
  session: Pick<ActiveSession, "dateKey" | "progress"> = getActiveSession(),
): RpciApproxResult | null {
  const rules = RPCI_APPROX_RULES;
  if (!metrics.passesFloor || metrics.rs == null || metrics.rs < rules.minRs ||
      metrics.vs50 == null || metrics.vs50 < 0 ||
      metrics.vs200 == null || metrics.vs200 < 0 ||
      metrics.fromHigh == null || metrics.fromHigh > rules.maxFromHighPercent) return null;

  const completed = candles.filter((c) => {
    const day = istDateKey(c.t);
    return day < session.dateKey || (day === session.dateKey && session.progress === 1);
  });
  const windowCount = rules.windowSessions * 3;
  if (completed.length < windowCount) return null;

  // A completed breakout candle is checked against the *preceding* base, not
  // included in the range or quiet-volume measurements it would invalidate.
  const latest = completed[completed.length - 1];
  const priorHigh = Math.max(...completed.slice(-1 - rules.windowSessions, -1).map((c) => c.high));
  const breakoutCandle = latest.high > priorHigh && metrics.price > priorHigh ? latest : null;
  if (breakoutCandle && completed.length < windowCount + 1) return null;
  const base = completed.slice(-windowCount - (breakoutCandle ? 1 : 0), breakoutCandle ? -1 : undefined);
  const older = base.slice(0, rules.windowSessions);
  const middle = base.slice(rules.windowSessions, rules.windowSessions * 2);
  const recent = base.slice(rules.windowSessions * 2);
  const olderRange = rangePercent(older);
  const middleRange = rangePercent(middle);
  const currentRange = rangePercent(recent);
  const middleVolume = averageVolume(middle);
  if (olderRange == null || olderRange <= 0 || middleRange == null || middleRange <= 0 ||
      currentRange == null || middleVolume <= 0) return null;

  const priorContractionRatio = middleRange / olderRange;
  const contractionRatio = currentRange / middleRange;
  const volumeRatio = averageVolume(recent) / middleVolume;
  const pivotPrice = Math.max(...recent.map((c) => c.high));
  const baseLowPrice = Math.min(...recent.map((c) => c.low));
  const riskPerShare = pivotPrice - baseLowPrice;
  if (riskPerShare <= 0) return null;
  const distanceToPivotPercent = ((metrics.price - pivotPrice) / pivotPrice) * 100;
  if (currentRange > rules.maxRangePercent + 1e-10 ||
      priorContractionRatio > rules.maxPriorContractionRatio + 1e-10 ||
      contractionRatio > rules.maxContractionRatio + 1e-10 ||
      volumeRatio > rules.maxVolumeRatio + 1e-10 ||
      metrics.price < pivotPrice * (1 - rules.maxBelowPivotPercent / 100) ||
      metrics.price > pivotPrice * (1 + rules.maxAbovePivotPercent / 100)) return null;

  const breakoutVolumeRatio = breakoutCandle
    ? breakoutCandle.volume / averageVolume(recent)
    : null;
  const confirmed = distanceToPivotPercent > 0 &&
    breakoutCandle != null &&
    breakoutCandle.close > pivotPrice &&
    breakoutVolumeRatio != null &&
    breakoutVolumeRatio >= rules.minBreakoutVolumeRatio;

  return {
    stage: confirmed ? "breakout" : distanceToPivotPercent > 0 ? "testing" : "forming",
    pivotPrice,
    baseLowPrice,
    baseCandleTimestamp: recent[recent.length - 1].t,
    lastCompletedCandleTimestamp: latest.t,
    entryTriggerPrice: pivotPrice,
    riskPerShare,
    riskPercent: (riskPerShare / pivotPrice) * 100,
    rangePercent: currentRange,
    priorContractionRatio,
    contractionRatio,
    volumeRatio,
    breakoutVolumeRatio,
    distanceToPivotPercent,
  };
}
