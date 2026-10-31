// Do the filters suggested by the weak last year hold up over ten years and on two separate halves? Backtest only.
// Run: node --use-system-ca scripts/backtest-variants.mjs
import { runBacktest } from "../src/lib/backtest/run.ts";

const base = {
  strategy: { kind: "screen", screen: "Blue sky" }, alsoScreens: ["Multi-year breakouts"], from: "2016-12-01", to: "2099-12-31",
  entry: "next-open", stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0,
  costPercent: 0.25, capital: 1_000_000, maxPositions: 10, sizing: { kind: "risk", riskPercent: 2 }, positionCapPercent: 20,
  turnoverLimitPercent: 10, breadthMin: 35, floor: "trading", maxNewPerDay: 3,
};
const variants = {
  "ATR stop x1.5": { stop: { kind: "atr", multiple: 1.5 } },
  "ATR stop x2": { stop: { kind: "atr", multiple: 2 } },
  "ATR stop x2.5": { stop: { kind: "atr", multiple: 2.5 } },
  "ATR x2 + Nifty>200": { stop: { kind: "atr", multiple: 2 }, niftyAbove: 200 },
  "today's rules": {},
  "Nifty above 200-day": { niftyAbove: 200 },
};
const periods = {
  "10 years": ["2016-12-01", "2099-12-31"],
  "first half (to Nov 2021)": ["2016-12-01", "2021-11-30"],
  "second half (Dec 2021 on)": ["2021-12-01", "2099-12-31"],
  "last 12 months": ["2025-10-31", "2099-12-31"],
};
const f = (v, d = 1) => (v == null ? "—" : v.toFixed(d));
for (const [pname, [from, to]] of Object.entries(periods)) {
  console.log(`\n=== ${pname}`);
  console.log("variant".padEnd(28) + "profit(L)  CAGR%  worstDrop%  avgR  trades  win%");
  for (const [name, o] of Object.entries(variants)) {
    const r = runBacktest({ ...base, ...o, from, to }, ".cache/history10y");
    const s = r.stats;
    console.log(`${name.padEnd(28)}${f(s.totalProfit / 1e5, 1).padStart(8)}${f(s.cagrPercent, 0).padStart(8)}${f(s.maxDrawdownPercent, 0).padStart(10)}${f(s.avgR, 2).padStart(10)}${String(s.trades).padStart(7)}${f(s.winRate, 0).padStart(7)}`);
  }
}
