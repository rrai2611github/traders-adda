// Does limiting positions per sector help? 10 years, two halves and the last 12 months. Backtest only.
// Run: node --use-system-ca scripts/backtest-sector.mjs
import { runBacktest } from "../src/lib/backtest/run.ts";

const base = {
  strategy: { kind: "screen", screen: "Blue sky" }, alsoScreens: ["Multi-year breakouts"], from: "2016-12-01", to: "2099-12-31",
  entry: "next-open", stop: { kind: "percent", percent: 12 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0,
  costPercent: 0.25, capital: 1_000_000, maxPositions: 10, sizing: { kind: "risk", riskPercent: 2 }, positionCapPercent: 20,
  turnoverLimitPercent: 10, breadthMin: 35, floor: "trading", maxNewPerDay: 3,
};
const variants = { "no limit (today)": {}, "max 4 per sector": { maxPerSector: 4 }, "max 3 per sector": { maxPerSector: 3 }, "max 2 per sector": { maxPerSector: 2 }, "max 1 per sector": { maxPerSector: 1 } };
const periods = {
  "10 years": ["2016-12-01", "2099-12-31"],
  "first half (to Nov 2021)": ["2016-12-01", "2021-11-30"],
  "second half (Dec 2021 on)": ["2021-12-01", "2099-12-31"],
  "last 12 months": ["2025-10-31", "2099-12-31"],
};
const f = (v, d = 0) => (v == null ? "—" : v.toFixed(d));
for (const [pname, [from, to]] of Object.entries(periods)) {
  console.log(`\n=== ${pname}`);
  console.log("variant".padEnd(22) + "profit(L)  CAGR%  worstDrop%   avgR  trades  win%");
  for (const [name, o] of Object.entries(variants)) {
    const s = runBacktest({ ...base, ...o, from, to }, ".cache/history10y").stats;
    console.log(`${name.padEnd(22)}${f(s.totalProfit / 1e5).padStart(8)}${f(s.cagrPercent).padStart(8)}${f(s.maxDrawdownPercent).padStart(10)}${f(s.avgR, 2).padStart(10)}${String(s.trades).padStart(7)}${f(s.winRate).padStart(7)}`);
  }
}
