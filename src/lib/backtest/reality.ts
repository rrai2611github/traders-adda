import type { BacktestSettings, BacktestStats, StressSettings } from "./types.ts";

/**
 * The reality check: the same rules rerun with the harms a real account meets and a backtest ignores. The numbers on a backtest page assume
 * every fill is exactly at the test price and no stop ever gaps; neither is true, so this shows how much of the result survives.
 */
export interface RealityScenario {
  key: "fills" | "gaps" | "both" | "harsh";
  name: string;
  detail: string;
  stress: StressSettings;
}

export const REALITY_SCENARIOS: ReadonlyArray<RealityScenario> = [
  { key: "fills", name: "Worse fills", detail: "Every buy and every sale 1% worse than the test price.", stress: { slippagePercent: 1, gapShare: 0, gapLossPercent: 25, seed: 7 } },
  { key: "gaps", name: "Some stops gap", detail: "15% of stop-outs sell 25% under the buy price, far below the stop (a bad-news gap).", stress: { slippagePercent: 0, gapShare: 0.15, gapLossPercent: 25, seed: 7 } },
  { key: "both", name: "Both together", detail: "Worse fills and gapping stops at once: a realistic bad case.", stress: { slippagePercent: 1, gapShare: 0.15, gapLossPercent: 25, seed: 7 } },
  { key: "harsh", name: "Harsh", detail: "1.5% worse fills and 30% of stop-outs selling 30% under the buy price.", stress: { slippagePercent: 1.5, gapShare: 0.3, gapLossPercent: 30, seed: 7 } },
];

/** The settings of a scenario: the same rules as the result being checked, plus the stress. */
export const scenarioSettings = (base: BacktestSettings, scenario: RealityScenario): BacktestSettings => ({ ...base, stress: scenario.stress });

type Figures = Pick<BacktestStats, "totalProfit" | "cagrPercent" | "maxDrawdownPercent" | "avgR">;
export interface RealityRow { scenario: RealityScenario; stats: Figures }

const keep = (now: number | null, was: number | null) => (now == null || was == null || was <= 0 ? null : Math.round((now / was) * 100));

/** A plain-language reading of how much of the result survives. */
export function realityVerdict(baseline: Figures, rows: ReadonlyArray<RealityRow>): { tone: "good" | "warn" | "bad"; text: string } {
  const lost = rows.filter((r) => r.stats.totalProfit <= 0);
  if (baseline.totalProfit <= 0) return { tone: "bad", text: "The test itself loses money, so there is nothing to stress." };
  if (lost.length) return { tone: "bad", text: `It loses money under: ${lost.map((r) => r.scenario.name.toLowerCase()).join(", ")}. Do not rely on this result.` };
  const both = rows.find((r) => r.scenario.key === "both");
  const harsh = rows.find((r) => r.scenario.key === "harsh");
  const kept = both ? keep(both.stats.cagrPercent, baseline.cagrPercent) : null;
  const harshKept = harsh ? keep(harsh.stats.cagrPercent, baseline.cagrPercent) : null;
  if (kept != null && kept < 50) return { tone: "warn", text: `Still profitable in every case, but the realistic bad case keeps only about ${kept}% of the yearly return. Plan for much less than the test shows.` };
  const harshText = harshKept != null ? ` Even the harsh case keeps about ${harshKept}% of it.` : "";
  return { tone: kept != null && kept < 75 ? "warn" : "good", text: `Profitable in every case. The realistic bad case keeps about ${kept ?? "—"}% of the yearly return.${harshText}` };
}
