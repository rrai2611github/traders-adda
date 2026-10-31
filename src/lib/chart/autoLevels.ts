import type { Candle } from "../market/types.ts";

/**
 * Auto support / resistance from swing pivots (idea from Scanner Pro's auto
 * levels; the algorithm is ours). Swing highs and lows are clustered within an
 * ATR-based tolerance; each cluster is one level whose strength grows with the
 * number of touches and how recent they are. Levels below the close are
 * support, above are resistance; a cluster of old highs now below the close is
 * flagged as flipped (old resistance acting as support), and vice versa.
 */
export interface AutoLevelRules {
  pivotBars: number;
  atrPeriod: number;
  toleranceAtr: number;
  toleranceMinPercent: number;
  maxDistancePercent: number;
  maxPerKind: number;
  minTouches: number;
}

export const AUTO_LEVEL_RULES: AutoLevelRules = {
  pivotBars: 3,
  atrPeriod: 14,
  toleranceAtr: 0.6,
  toleranceMinPercent: 0.5,
  maxDistancePercent: 25,
  maxPerKind: 3,
  minTouches: 2,
};

export interface AutoLevel {
  price: number;
  kind: "support" | "resistance";
  touches: number;
  /** Time of the most recent pivot in the cluster. */
  lastT: number;
  /** Old resistance now below price (or old support now above). */
  flipped: boolean;
  strength: number;
  zoneLow: number;
  zoneHigh: number;
}

export function averageTrueRange(candles: ReadonlyArray<Candle>, period: number = AUTO_LEVEL_RULES.atrPeriod): number | null {
  const n = candles.length;
  if (n < period + 1) return null;
  let sum = 0;
  for (let k = n - period; k < n; k += 1) {
    const c = candles[k];
    const prev = candles[k - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  }
  return sum / period;
}

interface Pivot { price: number; index: number; type: "high" | "low" }

function swingPivots(candles: ReadonlyArray<Candle>, k: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < candles.length - k; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k && (isHigh || isLow); j += 1) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) out.push({ price: candles[i].high, index: i, type: "high" });
    if (isLow) out.push({ price: candles[i].low, index: i, type: "low" });
  }
  return out;
}

export function autoLevels(candles: ReadonlyArray<Candle>, rules: Partial<AutoLevelRules> = {}): AutoLevel[] {
  const R = { ...AUTO_LEVEL_RULES, ...rules };
  const n = candles.length;
  if (n < R.pivotBars * 2 + R.atrPeriod + 2) return [];
  const close = candles[n - 1].close;
  const atr = averageTrueRange(candles, R.atrPeriod) ?? close * 0.02;
  const tolerance = Math.max(atr * R.toleranceAtr, (close * R.toleranceMinPercent) / 100);

  const pivots = swingPivots(candles, R.pivotBars).sort((a, b) => a.price - b.price);
  const clusters: Pivot[][] = [];
  for (const p of pivots) {
    const current = clusters[clusters.length - 1];
    if (current) {
      const mean = current.reduce((a, q) => a + q.price, 0) / current.length;
      if (p.price - mean <= tolerance) {
        current.push(p);
        continue;
      }
    }
    clusters.push([p]);
  }

  const levels: AutoLevel[] = [];
  for (const cluster of clusters) {
    if (cluster.length < R.minTouches) continue;
    const price = cluster.reduce((a, q) => a + q.price, 0) / cluster.length;
    if (Math.abs(price / close - 1) * 100 > R.maxDistancePercent) continue;
    const last = cluster.reduce((a, q) => (q.index > a.index ? q : a));
    const kind = price <= close ? "support" as const : "resistance" as const;
    const highs = cluster.filter((q) => q.type === "high").length;
    const lows = cluster.length - highs;
    const recency = last.index / (n - 1);
    levels.push({
      price,
      kind,
      touches: cluster.length,
      lastT: candles[last.index].t,
      flipped: kind === "support" ? highs > lows : lows > highs,
      strength: Math.round((cluster.length + 2 * recency) * 10) / 10,
      zoneLow: Math.min(...cluster.map((q) => q.price)),
      zoneHigh: Math.max(...cluster.map((q) => q.price)),
    });
  }

  const pick = (kind: AutoLevel["kind"]) => levels
    .filter((l) => l.kind === kind)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, R.maxPerKind);
  return [...pick("resistance"), ...pick("support")].sort((a, b) => b.price - a.price);
}
