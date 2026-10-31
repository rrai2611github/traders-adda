import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";
const wins = { "2022-26": ["2022-01-01", "2026-10-16"], "2017-21": ["2016-12-01", "2021-12-31"] };
const fmt = (r) => `${(r.stats.totalProfit / 1e5).toFixed(0).padStart(4)}L ${r.stats.cagrPercent == null ? "  - " : r.stats.cagrPercent.toFixed(0).padStart(3) + "%"} DD${r.stats.maxDrawdownPercent.toFixed(0).padStart(4)} R${(r.stats.avgR ?? 0).toFixed(2)} n${String(r.stats.trades).padStart(3)}`;
const cases = {
  "your setup": {}, "min RS 80": { minRs: 80 }, "min RS 85": { minRs: 85 }, "min RS 90": { minRs: 90 }, "min RS 95": { minRs: 95 },
  "RS90 + stop 10%": { minRs: 90, stop: { kind: "percent", percent: 10 } },
  "RS90 + 2.5×ATR": { minRs: 90, stop: { kind: "atr", multiple: 2.5 } },
  "RS90 + stop 12%": { minRs: 90, stop: { kind: "percent", percent: 12 } },
  "RS95 + stop 10%": { minRs: 95, stop: { kind: "percent", percent: 10 } },
};
console.log("variant".padEnd(20), "2022-26 (tuned)".padEnd(34), "2017-21 (unseen)");
for (const [name, o] of Object.entries(cases)) {
  const cols = Object.values(wins).map(([from, to]) => fmt(runBacktest({ ...USER, ...o, from, to }, ".cache/history10y")));
  console.log(name.padEnd(20), cols[0].padEnd(34), cols[1]);
}
// Gaps through the stop in your setup
const r = runBacktest(USER, ".cache/history10y");
const stops = r.trades.filter((t) => t.exitReason === "stop");
const gap = stops.filter((t) => t.exitPrice < t.entryPrice * 0.92 - 0.01);
const sum = (a) => Math.round(a.reduce((p, t) => p + t.pnl, 0) / 1e5 * 10) / 10;
console.log(`\nstop-outs ${stops.length} (loss ${sum(stops)}L); gapped through the stop ${gap.length} (loss ${sum(gap)}L, avg R ${(gap.reduce((p, t) => p + t.r, 0) / gap.length).toFixed(2)}); clean stops ${stops.length - gap.length} avg R ${((stops.reduce((p, t) => p + t.r, 0) - gap.reduce((p, t) => p + t.r, 0)) / (stops.length - gap.length)).toFixed(2)}`);
