import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";
const full = { from: "2016-12-01", to: "2026-10-16" };
const cases = {
  "your setup": {},
  "RS 90+ & stop 10%": { minRs: 90, stop: { kind: "percent", percent: 10 } },
  "RS 90+ & stop 10% & risk 1%": { minRs: 90, stop: { kind: "percent", percent: 10 }, sizing: { kind: "risk", riskPercent: 1 } },
};
for (const [name, o] of Object.entries(cases)) {
  const r = runBacktest({ ...USER, ...full, ...o }, ".cache/history10y");
  const s = r.stats;
  console.log(`${name.padEnd(28)} profit ${(s.totalProfit / 1e5).toFixed(0)}L CAGR ${s.cagrPercent.toFixed(0)}% DD ${s.maxDrawdownPercent.toFixed(0)}% R ${s.avgR.toFixed(2)} n=${s.trades} win ${s.winRate.toFixed(0)}% | halves R ${r.halves.first.avgR.toFixed(2)}/${r.halves.second.avgR.toFixed(2)}`);
  console.log("   " + r.years.map((y) => `${y.year}:${y.returnPercent.toFixed(0)}%`).join(" "));
}
