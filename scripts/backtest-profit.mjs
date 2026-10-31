// What could have made the Blue sky setup earn more? Each idea over the whole period and four separate time blocks.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";
const blocks = [["2016-12-01", "2019-12-31"], ["2020-01-01", "2021-12-31"], ["2022-01-01", "2023-12-31"], ["2024-01-01", "2026-10-16"]];
const full = ["2016-12-01", "2026-10-16"];
const ma = (p) => ({ kind: "ma", type: "sma", period: p, when: "close" });
const S12 = { stop: { kind: "percent", percent: 12 } };
const MY = ["Multi-year breakouts"], ALL = ["Multi-year breakouts", "VCP", "IPO base"];
const cases = {
  "your setup": {},
  "+ Multi-year screen": { alsoScreens: MY },
  "+ all four screens": { alsoScreens: ALL },
  "all four, 15 positions": { alsoScreens: ALL, maxPositions: 15 },
  "all four, 20 positions": { alsoScreens: ALL, maxPositions: 20 },
  "add 50% at +10%": { addOn: { afterPercent: 10, fraction: 0.5 } },
  "add 50% at +20%": { addOn: { afterPercent: 20, fraction: 0.5 } },
  "add 100% at +15%": { addOn: { afterPercent: 15, fraction: 1 } },
  "trail 75-day": { exit: ma(75) },
  "trail 100-day": { exit: ma(100) },
  "all four + 12% stop": { alsoScreens: ALL, ...S12 },
  "all four + add 50% at +10%": { alsoScreens: ALL, addOn: { afterPercent: 10, fraction: 0.5 } },
  "all four + 12% + add 50%@10": { alsoScreens: ALL, ...S12, addOn: { afterPercent: 10, fraction: 0.5 } },
  "all four + Nifty>200": { alsoScreens: ALL, niftyAbove: 200 },
  "all four+12%+Nifty>200+add": { alsoScreens: ALL, ...S12, niftyAbove: 200, addOn: { afterPercent: 10, fraction: 0.5 } },
};
const run = (o, [from, to]) => runBacktest({ ...USER, ...o, from, to }, ".cache/history10y");
console.log("variant".padEnd(28), "FULL: profit CAGR   DD   R    n", "  | blocks CAGR/DD (17-19, 20-21, 22-23, 24-26)");
for (const [name, o] of Object.entries(cases)) {
  const s = run(o, full).stats;
  const bl = blocks.map((b) => { const x = run(o, b).stats; return `${x.cagrPercent == null ? "-" : x.cagrPercent.toFixed(0)}/${x.maxDrawdownPercent.toFixed(0)}`; });
  console.log(name.padEnd(28), `${String(Math.round(s.totalProfit / 1e5)).padStart(5)}L ${s.cagrPercent.toFixed(0).padStart(3)}% ${s.maxDrawdownPercent.toFixed(0).padStart(4)}% ${s.avgR.toFixed(2)} ${String(s.trades).padStart(4)}`, " |", bl.join("  "));
}
