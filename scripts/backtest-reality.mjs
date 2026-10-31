// Reality check: do the live rules still make money when fills are worse and some stops gap through? Backtest only.
// Run: node --use-system-ca scripts/backtest-reality.mjs
import { runBacktest } from "../src/lib/backtest/run.ts";

const base = {
  strategy: { kind: "screen", screen: "Blue sky" }, alsoScreens: ["Multi-year breakouts"], from: "2016-12-01", to: "2099-12-31",
  entry: "next-open", stop: { kind: "percent", percent: 12 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0,
  costPercent: 0.25, capital: 1_000_000, maxPositions: 10, sizing: { kind: "risk", riskPercent: 2 }, positionCapPercent: 20,
  turnoverLimitPercent: 10, breadthMin: 35, floor: "trading", maxNewPerDay: 3,
};
const stress = (slippagePercent, gapShare, gapLossPercent, seed) => ({ stress: { slippagePercent, gapShare, gapLossPercent, seed } });
const scenarios = [
  ["the test as it is", () => [{}]],
  ["slippage 1% each way", () => [stress(1, 0, 25, 1)]],
  ["15% of stops gap to -25%", () => [1, 2, 3, 4, 5].map((s) => stress(0, 0.15, 25, s))],
  ["slippage 1% + 15% gap to -25%", () => [1, 2, 3, 4, 5].map((s) => stress(1, 0.15, 25, s))],
  ["harsh: 1.5% + 30% gap to -30%", () => [1, 2, 3, 4, 5].map((s) => stress(1.5, 0.3, 30, s))],
];
const f = (v, d = 0) => (v == null ? "—" : v.toFixed(d));
console.log("scenario".padEnd(34) + "profit(L)  CAGR%  worstDrop%   avgR   win%   (random scenarios: average of 5 seeds, and the worst seed)");
for (const [name, make] of scenarios) {
  const runs = make().map((o) => runBacktest({ ...base, ...o }, ".cache/history10y").stats);
  const mean = (k) => runs.reduce((a, s) => a + (s[k] ?? 0), 0) / runs.length;
  const worst = runs.length > 1 ? `   worst seed: ${f(Math.min(...runs.map((s) => s.totalProfit)) / 1e5)}L, CAGR ${f(Math.min(...runs.map((s) => s.cagrPercent ?? 0)))}%` : "";
  console.log(`${name.padEnd(34)}${f(mean("totalProfit") / 1e5).padStart(8)}${f(mean("cagrPercent")).padStart(8)}${f(mean("maxDrawdownPercent")).padStart(10)}${f(mean("avgR"), 2).padStart(10)}${f(mean("winRate")).padStart(7)}${worst}`);
}
