import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";
const S12 = { stop: { kind: "percent", percent: 12 } };
const blocks = { "2017-19": ["2016-12-01", "2019-12-31"], "2020-21": ["2020-01-01", "2021-12-31"], "2022-23": ["2022-01-01", "2023-12-31"], "2024-26": ["2024-01-01", "2026-10-16"] };
const run = (o, from, to) => runBacktest({ ...USER, ...o, from, to }, ".cache/history10y");
const cell = (r) => `${r.stats.cagrPercent == null ? "  -" : r.stats.cagrPercent.toFixed(0).padStart(4)}% DD${r.stats.maxDrawdownPercent.toFixed(0).padStart(4)} R${(r.stats.avgR ?? 0).toFixed(2)} n${String(r.stats.trades).padStart(3)} win${r.stats.winRate.toFixed(0)}%`;
console.log("block".padEnd(9), "your setup (8%)".padEnd(36), "stop 12%");
let w = 0, d = 0;
for (const [name, [from, to]] of Object.entries(blocks)) { const a = run({}, from, to), b = run(S12, from, to); if (b.stats.cagrPercent > a.stats.cagrPercent) w += 1; if (b.stats.maxDrawdownPercent > a.stats.maxDrawdownPercent) d += 1; console.log(name.padEnd(9), cell(a).padEnd(36), cell(b)); }
console.log(`  stop 12% has the higher return in ${w} of 4 blocks, the shallower drop in ${d} of 4`);
const full = ["2016-12-01", "2026-10-16"];
const a = run({}, ...full), b = run(S12, ...full);
console.log("\nwhole period:", "\n  8%  ", cell(a), "profit", Math.round(a.stats.totalProfit / 1e5) + "L", "\n  12% ", cell(b), "profit", Math.round(b.stats.totalProfit / 1e5) + "L");
const bad = (r) => r.trades.filter((t) => t.exitReason === "stop");
console.log(`stop-outs: 8% -> ${bad(a).length} of ${a.trades.length} (${(100 * bad(a).length / a.trades.length).toFixed(0)}%), avg ${(bad(a).reduce((p, t) => p + t.r, 0) / bad(a).length).toFixed(2)}R; 12% -> ${bad(b).length} of ${b.trades.length} (${(100 * bad(b).length / b.trades.length).toFixed(0)}%), avg ${(bad(b).reduce((p, t) => p + t.r, 0) / bad(b).length).toFixed(2)}R`);
const qty = (r) => (r.trades.reduce((p, t) => p + t.quantity * t.entryPrice, 0) / r.trades.length / 1e5).toFixed(1);
console.log(`average position size: 8% -> ₹${qty(a)}L, 12% -> ₹${qty(b)}L`);
const worst = (r) => [...r.trades].sort((x, y) => x.pnl - y.pnl)[0];
console.log(`worst single trade: 8% -> ${worst(a).symbol} ₹${Math.round(worst(a).pnl / 1e5 * 10) / 10}L; 12% -> ${worst(b).symbol} ₹${Math.round(worst(b).pnl / 1e5 * 10) / 10}L`);
console.log("years 8%: ", a.years.map((y) => `${y.year}:${y.returnPercent.toFixed(0)}%`).join(" "));
console.log("years 12%:", b.years.map((y) => `${y.year}:${y.returnPercent.toFixed(0)}%`).join(" "));
for (const c of [0.5, 1]) { const x = run({ costPercent: c }, ...full), y = run({ ...S12, costPercent: c }, ...full); console.log(`cost ${c}%: 8% ${cell(x)} | 12% ${cell(y)}`); }
