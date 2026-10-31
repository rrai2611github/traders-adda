// Validates "Blue sky, RS 90+, stop 10%" against your setup: separate time blocks, neighbouring settings, a confidence range on the average trade, and higher costs.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";

const CAND = { minRs: 90, stop: { kind: "percent", percent: 10 } };
const blocks = { "2017-19": ["2016-12-01", "2019-12-31"], "2020-21": ["2020-01-01", "2021-12-31"], "2022-23": ["2022-01-01", "2023-12-31"], "2024-26": ["2024-01-01", "2026-10-16"] };
const run = (o, from, to) => runBacktest({ ...USER, ...o, from, to }, ".cache/history10y");
const cell = (r) => `${r.stats.cagrPercent == null ? "  -" : r.stats.cagrPercent.toFixed(0).padStart(4)}% DD${r.stats.maxDrawdownPercent.toFixed(0).padStart(4)} R${(r.stats.avgR ?? 0).toFixed(2)} n${String(r.stats.trades).padStart(3)}`;

console.log("A. Separate time blocks (each starts fresh with ₹10L)");
console.log("block".padEnd(9), "your setup".padEnd(30), "RS90 + stop10");
let wins = 0, dd = 0;
for (const [name, [from, to]] of Object.entries(blocks)) {
  const a = run({}, from, to), b = run(CAND, from, to);
  if ((b.stats.cagrPercent ?? -99) > (a.stats.cagrPercent ?? -99)) wins += 1;
  if (b.stats.maxDrawdownPercent > a.stats.maxDrawdownPercent) dd += 1;
  console.log(name.padEnd(9), cell(a).padEnd(30), cell(b));
}
console.log(`  candidate has the higher yearly return in ${wins} of 4 blocks and the shallower drop in ${dd} of 4`);

console.log("\nB. Neighbouring settings over the whole period (CAGR% / worst drop) : rows = minimum RS, columns = stop %");
const stops = [8, 9, 10, 11, 12], rss = [0, 85, 88, 90, 92, 95];
console.log("RS \ stop".padEnd(10), stops.map((s) => `${s}%`.padStart(11)).join(""));
for (const rs of rss) {
  const cells = stops.map((s) => { const r = run({ minRs: rs, stop: { kind: "percent", percent: s } }, "2016-12-01", "2026-10-16"); return `${r.stats.cagrPercent.toFixed(0)}/${r.stats.maxDrawdownPercent.toFixed(0)}`.padStart(11); });
  console.log(String(rs || "none").padEnd(10), cells.join(""));
}

console.log("\nC. Average trade with a 95% range (whole period)");
const ci = (r) => { const x = r.trades.map((t) => t.r); const n = x.length; const m = x.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); const h = 1.96 * sd / Math.sqrt(n); return `${m.toFixed(2)}R (${(m - h).toFixed(2)} to ${(m + h).toFixed(2)}) over ${n} trades`; };
const fa = run({}, "2016-12-01", "2026-10-16"), fb = run(CAND, "2016-12-01", "2026-10-16");
console.log("your setup   ", ci(fa)); console.log("RS90+stop10  ", ci(fb));

console.log("\nD. Higher costs (0.5% and 1% per side) over the whole period");
for (const c of [0.25, 0.5, 1]) { const a = run({ costPercent: c }, "2016-12-01", "2026-10-16"), b = run({ ...CAND, costPercent: c }, "2016-12-01", "2026-10-16"); console.log(`cost ${c}%  your: ${cell(a)} | cand: ${cell(b)}`); }
