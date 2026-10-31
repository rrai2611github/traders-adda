import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";
const blocks = [["2016-12-01", "2019-12-31"], ["2020-01-01", "2021-12-31"], ["2022-01-01", "2023-12-31"], ["2024-01-01", "2026-10-16"]];
const full = ["2016-12-01", "2026-10-16"];
const MY = ["Multi-year breakouts"], A15 = { afterPercent: 15, fraction: 1 }, A10 = { afterPercent: 10, fraction: 0.5 };
const cases = {
  "your setup": {},
  "+ Multi-year": { alsoScreens: MY },
  "+ Multi-year, add 100%@15": { alsoScreens: MY, addOn: A15 },
  "+ Multi-year, add 50%@10": { alsoScreens: MY, addOn: A10 },
  "+ Multi-year, add 100%@15, 12% stop": { alsoScreens: MY, addOn: A15, stop: { kind: "percent", percent: 12 } },
  "+ Multi-year, add 100%@15, Nifty>200": { alsoScreens: MY, addOn: A15, niftyAbove: 200 },
  "Multi-year only (100-day trail)": { strategy: { kind: "screen", screen: "Multi-year breakouts" }, exit: { kind: "ma", type: "sma", period: 100, when: "close" } },
  "Multi-year only, add 100%@15": { strategy: { kind: "screen", screen: "Multi-year breakouts" }, exit: { kind: "ma", type: "sma", period: 100, when: "close" }, addOn: A15 },
};
const run = (o, [from, to]) => runBacktest({ ...USER, ...o, from, to }, ".cache/history10y");
const yrs = (r) => r.years.filter((y) => y.year >= 2017).map((y) => `${String(y.year).slice(2)}:${y.returnPercent.toFixed(0)}`).join(" ");
console.log("variant".padEnd(38), "FULL: profit CAGR   DD   R    n  | blocks CAGR/DD");
for (const [name, o] of Object.entries(cases)) {
  const f = run(o, full); const s = f.stats;
  const bl = blocks.map((b) => { const x = run(o, b).stats; return `${x.cagrPercent == null ? "-" : x.cagrPercent.toFixed(0)}/${x.maxDrawdownPercent.toFixed(0)}`; });
  console.log(name.padEnd(38), `${String(Math.round(s.totalProfit / 1e5)).padStart(5)}L ${s.cagrPercent.toFixed(0).padStart(3)}% ${s.maxDrawdownPercent.toFixed(0).padStart(4)}% ${s.avgR.toFixed(2)} ${String(s.trades).padStart(4)}`, " |", bl.join("  "));
  console.log("      years", yrs(f));
}
