// Return versus worst drop: is the smoother ride just a smaller position, or a better rule?
import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";
const S12 = { stop: { kind: "percent", percent: 12 } };
const risk = (p) => ({ sizing: { kind: "risk", riskPercent: p } });
const cases = {
  "8% stop, risk 2%": {}, "8% stop, risk 1%": risk(1), "8% stop, risk 0.75%": risk(0.75), "8% stop, risk 0.5%": risk(0.5),
  "12% stop, risk 2%": S12, "12% stop, risk 1.5%": { ...S12, ...risk(1.5) }, "12% stop, risk 1%": { ...S12, ...risk(1) }, "12% stop, risk 0.75%": { ...S12, ...risk(0.75) },
  "12% stop, risk 2.5%": { ...S12, ...risk(2.5) }, "12% stop, risk 3%": { ...S12, ...risk(3) },
  "Nifty>200, risk 2%": { niftyAbove: 200 }, "Nifty>200, risk 2.5%": { niftyAbove: 200, ...risk(2.5) }, "Nifty>200, risk 3%": { niftyAbove: 200, ...risk(3) },
  "Nifty>200, 12% stop, risk 3%": { niftyAbove: 200, ...S12, ...risk(3) },
};
console.log("variant".padEnd(32), "profit  CAGR   DD   Calmar  worst year   2022   2018");
for (const [name, o] of Object.entries(cases)) {
  const r = runBacktest({ ...USER, ...o, from: "2016-12-01", to: "2026-10-16" }, ".cache/history10y");
  const s = r.stats; const yr = (y) => r.years.find((x) => x.year === y)?.returnPercent;
  const worst = r.years.filter((y) => y.year > 2016).reduce((m, y) => Math.min(m, y.returnPercent), 99);
  console.log(name.padEnd(32), `${String(Math.round(s.totalProfit / 1e5)).padStart(5)}L ${s.cagrPercent.toFixed(0).padStart(4)}% ${s.maxDrawdownPercent.toFixed(0).padStart(4)}%  ${(s.cagrPercent / -s.maxDrawdownPercent).toFixed(2)}   ${worst.toFixed(0).padStart(5)}%   ${yr(2022).toFixed(0).padStart(4)}%  ${yr(2018).toFixed(0).padStart(4)}%`);
}
