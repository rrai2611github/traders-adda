// How many "trades" were slivers bought with the last scraps of cash, and what skipping them changes.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { USER } from "./backtest-losers.mjs";
const S = { ...USER, alsoScreens: ["Multi-year breakouts"], addOn: { afterPercent: 15, fraction: 1 }, from: "2016-12-01", to: "2026-10-16" };
const cases = { "your Blue sky setup": { ...USER, from: "2016-12-01", to: "2026-10-16" }, "Blue sky + Multi-year + add": S, "stop 12%": { ...USER, from: "2016-12-01", to: "2026-10-16", stop: { kind: "percent", percent: 12 } }, "Nifty>200": { ...USER, from: "2016-12-01", to: "2026-10-16", niftyAbove: 200 } };
for (const [name, o] of Object.entries(cases)) {
  const r = runBacktest(o, ".cache/history10y"); const s = r.stats;
  const tiny = r.trades.filter((t) => t.quantity * t.entryPrice < 0.02 * o.capital).length;
  console.log(`${name.padEnd(30)} profit ${Math.round(s.totalProfit / 1e5)}L CAGR ${s.cagrPercent.toFixed(0)}% DD ${s.maxDrawdownPercent.toFixed(0)}% R ${s.avgR.toFixed(2)} trades ${s.trades} win ${s.winRate.toFixed(0)}% tiny(<2% of start) ${tiny}`);
}
