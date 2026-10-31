// Changes one setting at a time around your Blue sky setup, on 2022-2026 (where you tuned it) and on 2017-2021 (which it has not seen).
import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";

const ma = (period) => ({ kind: "ma", type: "sma", period, when: "close" });
const cases = {
  "your setup": {},
  "risk 1% (not 2%)": { sizing: { kind: "risk", riskPercent: 1 } },
  "stop 6%": { stop: { kind: "percent", percent: 6 } },
  "stop 10%": { stop: { kind: "percent", percent: 10 } },
  "stop 12%": { stop: { kind: "percent", percent: 12 } },
  "stop 15%": { stop: { kind: "percent", percent: 15 } },
  "stop 2.5×ATR": { stop: { kind: "atr", multiple: 2.5 } },
  "stop 3×ATR": { stop: { kind: "atr", multiple: 3 } },
  "trail 30-day": { exit: ma(30) },
  "trail 75-day": { exit: ma(75) },
  "trail 100-day": { exit: ma(100) },
  "trail 150-day": { exit: ma(150) },
  "breadth gate 0": { breadthMin: 0 },
  "breadth gate 25": { breadthMin: 25 },
  "breadth gate 45": { breadthMin: 45 },
  "breadth gate 50": { breadthMin: 50 },
  "breadth gate 60": { breadthMin: 60 },
  "5 positions": { maxPositions: 5 },
  "15 positions": { maxPositions: 15 },
  "20 positions": { maxPositions: 20 },
  "1 new a day": { maxNewPerDay: 1 },
  "5 new a day": { maxNewPerDay: 5 },
  "cost 0.5%/side": { costPercent: 0.5 },
  "wider floor ₹1Cr": { floor: "screen" },
};
const wins = { "2022-26": ["2022-01-01", "2026-10-16"], "2017-21": ["2016-12-01", "2021-12-31"] };
const fmt = (r) => `${(r.stats.totalProfit / 1e5).toFixed(0).padStart(4)}L ${r.stats.cagrPercent == null ? "  - " : r.stats.cagrPercent.toFixed(0).padStart(3) + "%"} DD${r.stats.maxDrawdownPercent.toFixed(0).padStart(4)} R${(r.stats.avgR ?? 0).toFixed(2)} n${String(r.stats.trades).padStart(3)}`;
console.log("variant".padEnd(20), "2022-26 (tuned)".padEnd(34), "2017-21 (unseen)");
for (const [name, o] of Object.entries(cases)) {
  const cols = Object.values(wins).map(([from, to]) => fmt(runBacktest({ ...USER, ...o, from, to }, ".cache/history10y")));
  console.log(name.padEnd(20), cols[0].padEnd(34), cols[1]);
}
