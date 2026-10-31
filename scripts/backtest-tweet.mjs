// Tests the rules from the "find stocks before they break out" thread against our data: breakout volume, skipping extended stocks, RS 95, a 21-day EMA trail.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";
const base = { ...USER, alsoScreens: ["Multi-year breakouts"] };
const blocks = [["2016-12-01", "2019-12-31"], ["2020-01-01", "2021-12-31"], ["2022-01-01", "2023-12-31"], ["2024-01-01", "2026-10-16"]];
const full = ["2016-12-01", "2026-10-16"];
const cases = {
  "our setup (Blue sky + Multi-year)": {},
  "breakout volume >= 1.5x": { minVolumeRatio: 1.5 },
  "breakout volume >= 2x": { minVolumeRatio: 2 },
  "breakout volume >= 3x": { minVolumeRatio: 3 },
  "skip extended (>20% above 50-day)": { maxAbove50Percent: 20 },
  "skip extended (>30% above 50-day)": { maxAbove50Percent: 30 },
  "RS >= 95 (his filter)": { minRs: 95 },
  "trail 21-day EMA (his exit)": { exit: { kind: "ma", type: "ema", period: 21, when: "close" } },
  "his rules: vol 2x + not extended + RS95": { minVolumeRatio: 2, maxAbove50Percent: 20, minRs: 95 },
  "his stop 10% + 21 EMA": { stop: { kind: "percent", percent: 10 }, exit: { kind: "ma", type: "ema", period: 21, when: "close" } },
};
const run = (o, [from, to]) => runBacktest({ ...base, ...o, from, to }, ".cache/history10y");
console.log("variant".padEnd(40), "FULL: profit CAGR   DD    R    n win | blocks CAGR/DD (17-19, 20-21, 22-23, 24-26)");
for (const [name, o] of Object.entries(cases)) {
  const s = run(o, full).stats;
  const bl = blocks.map((b) => { const x = run(o, b).stats; return `${x.cagrPercent == null ? "-" : x.cagrPercent.toFixed(0)}/${x.maxDrawdownPercent.toFixed(0)}`; });
  console.log(name.padEnd(40), `${String(Math.round(s.totalProfit / 1e5)).padStart(5)}L ${s.cagrPercent.toFixed(0).padStart(3)}% ${s.maxDrawdownPercent.toFixed(0).padStart(4)}% ${s.avgR.toFixed(2)} ${String(s.trades).padStart(4)} ${s.winRate.toFixed(0)}% |`, bl.join("  "));
}
