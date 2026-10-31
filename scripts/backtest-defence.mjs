// Ways to cut the losses of the Blue sky breakout setup: each tested over the whole period and over four separate time blocks.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";

const blocks = [["2016-12-01", "2019-12-31"], ["2020-01-01", "2021-12-31"], ["2022-01-01", "2023-12-31"], ["2024-01-01", "2026-10-16"]];
const full = ["2016-12-01", "2026-10-16"];
const cases = {
  "your setup (8% stop)": {},
  "stop 12%": { stop: { kind: "percent", percent: 12 } },
  "confirm (next day holds)": { confirm: true },
  "break-even after +8%": { breakEvenAfterPercent: 8 },
  "break-even after +12%": { breakEvenAfterPercent: 12 },
  "break-even after +20%": { breakEvenAfterPercent: 20 },
  "time stop 10d <+2%": { timeStop: { days: 10, minGainPercent: 2 } },
  "time stop 15d <+4%": { timeStop: { days: 15, minGainPercent: 4 } },
  "time stop 25d <+8%": { timeStop: { days: 25, minGainPercent: 8 } },
  "Nifty above 50-day": { niftyAbove: 50 },
  "Nifty above 100-day": { niftyAbove: 100 },
  "Nifty above 200-day": { niftyAbove: 200 },
  "drawdown brake 10% → half": { drawdownBrake: { percent: 10, factor: 0.5 } },
  "drawdown brake 10% → pause": { drawdownBrake: { percent: 10, factor: 0 } },
  "drawdown brake 15% → half": { drawdownBrake: { percent: 15, factor: 0.5 } },
  "stop 12% + break-even 12%": { stop: { kind: "percent", percent: 12 }, breakEvenAfterPercent: 12 },
  "stop 12% + brake 10% half": { stop: { kind: "percent", percent: 12 }, drawdownBrake: { percent: 10, factor: 0.5 } },
  "stop 12% + Nifty>200": { stop: { kind: "percent", percent: 12 }, niftyAbove: 200 },
};
const run = (o, [from, to]) => runBacktest({ ...USER, ...o, from, to }, ".cache/history10y");
console.log("variant".padEnd(28), "FULL: profit CAGR  DD    R  stops% grossLoss", "  | per block CAGR/DD (17-19, 20-21, 22-23, 24-26)");
let base = null;
for (const [name, o] of Object.entries(cases)) {
  const r = run(o, full);
  const s = r.stats;
  const stops = r.trades.filter((t) => t.exitReason === "stop").length;
  const loss = r.trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
  const bl = blocks.map((b) => { const x = run(o, b); return `${x.stats.cagrPercent == null ? "-" : x.stats.cagrPercent.toFixed(0)}/${x.stats.maxDrawdownPercent.toFixed(0)}`; });
  console.log(name.padEnd(28), `${String(Math.round(s.totalProfit / 1e5)).padStart(5)}L ${s.cagrPercent.toFixed(0).padStart(3)}% ${s.maxDrawdownPercent.toFixed(0).padStart(4)}% ${s.avgR.toFixed(2)} ${(100 * stops / s.trades).toFixed(0).padStart(3)}% ${String(Math.round(loss / 1e5)).padStart(5)}L`, " |", bl.join("  "));
}
