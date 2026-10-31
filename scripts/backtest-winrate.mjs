// What does a higher win rate cost? Win rate, profit and drawdown for the usual ways of raising the win rate. Backtest only.
// Run: node --use-system-ca scripts/backtest-winrate.mjs
import { runBacktest } from "../src/lib/backtest/run.ts";

const base = {
  strategy: { kind: "screen", screen: "Blue sky" }, alsoScreens: ["Multi-year breakouts"], from: "2016-12-01", to: "2099-12-31",
  entry: "next-open", stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0,
  costPercent: 0.25, capital: 1_000_000, maxPositions: 10, sizing: { kind: "risk", riskPercent: 2 }, positionCapPercent: 20,
  turnoverLimitPercent: 10, breadthMin: 35, floor: "trading", maxNewPerDay: 3,
};
const variants = {
  "current rules (no Nifty filter)": {},
  "wider stop 12%": { stop: { kind: "percent", percent: 12 } },
  "wider stop 15%": { stop: { kind: "percent", percent: 15 } },
  "faster exit: 30-day average": { exit: { kind: "ma", type: "sma", period: 30, when: "close" } },
  "faster exit: 20-day average": { exit: { kind: "ma", type: "sma", period: 20, when: "close" } },
  "fixed target 1.5R, then out": { exit: { kind: "target", r: 1.5 } },
  "fixed target 2R, then out": { exit: { kind: "target", r: 2 } },
  "stop to break-even after +8%": { breakEvenAfterPercent: 8 },
  "stop to break-even after +15%": { breakEvenAfterPercent: 15 },
};
const periods = { "10 years": ["2016-12-01", "2099-12-31"], "first half": ["2016-12-01", "2021-11-30"], "second half": ["2021-12-01", "2099-12-31"] };
const f = (v, d = 1) => (v == null ? "—" : v.toFixed(d));
for (const [pname, [from, to]] of Object.entries(periods)) {
  console.log(`\n=== ${pname}`);
  console.log("variant".padEnd(32) + " win%  profit(L)  CAGR%  worstDrop%  avgR  payoff  trades");
  for (const [name, o] of Object.entries(variants)) {
    const s = runBacktest({ ...base, ...o, from, to }, ".cache/history10y").stats;
    console.log(`${name.padEnd(32)}${f(s.winRate, 0).padStart(4)}${f(s.totalProfit / 1e5, 0).padStart(10)}${f(s.cagrPercent, 0).padStart(8)}${f(s.maxDrawdownPercent, 0).padStart(10)}${f(s.avgR, 2).padStart(10)}${f(s.payoff, 1).padStart(7)}${String(s.trades).padStart(8)}`);
  }
}
