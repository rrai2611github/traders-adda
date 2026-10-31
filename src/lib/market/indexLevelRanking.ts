import type { StructuralLevel } from "./indexAnalysis.ts";

export interface RankedIndexLevel {
  price: number;
  low: number;
  high: number;
  side: "Support" | "Resistance" | "At price";
  strength: "Major" | "Intermediate" | "Minor";
  score: number;
  references: string[];
  distancePercent: number;
}

const weight = (label: string) =>
  label.includes("swing") ? 4 : label.includes("week") || label.includes("200-day") ? 3
    : label.includes("50-day") ? 2 : 1;

/** Cluster within 0.15 ATR (or 0.1% without ATR), without chained merging into wide zones. */
export function rankIndexLevels(levels: StructuralLevel[], close: number, atrPercent: number | null): RankedIndexLevel[] {
  const tolerance = atrPercent != null ? close * atrPercent / 100 * 0.15 : close * 0.001;
  const sorted = levels.filter((l) => Number.isFinite(l.price) && l.price > 0).sort((a, b) => a.price - b.price);
  const clusters: StructuralLevel[][] = [];
  for (const level of sorted) {
    const group = clusters.at(-1);
    if (group && level.price - group[0].price <= tolerance) group.push(level);
    else clusters.push([level]);
  }
  return clusters.map((group): RankedIndexLevel => {
    const references = [...new Set(group.map((l) => l.label))];
    const score = references.reduce((sum, label) => sum + weight(label), 0);
    const price = group.reduce((sum, l) => sum + l.price, 0) / group.length;
    return {
      price, low: group[0].price, high: group.at(-1)!.price,
      side: group.at(-1)!.price < close ? "Support" : group[0].price > close ? "Resistance" : "At price",
      strength: score >= 4 ? "Major" : score >= 2 ? "Intermediate" : "Minor",
      score, references, distancePercent: Math.abs(price / close - 1) * 100,
    };
  }).sort((a, b) => b.score - a.score || a.distancePercent - b.distancePercent);
}
