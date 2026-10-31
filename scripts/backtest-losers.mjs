// Re-runs one backtest and breaks the trades down: what do the losers have in common?
import { runBacktest } from "../src/lib/backtest/run.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";

export const USER = {
  ...DEFAULT_SETTINGS,
  strategy: { kind: "screen", screen: "Blue sky" },
  from: "2022-01-01", to: "2026-10-16", entry: "next-open",
  stop: { kind: "percent", percent: 8 },
  exit: { kind: "ma", type: "sma", period: 50, when: "close" },
  maxHoldDays: 0, costPercent: 0.25, capital: 1_000_000, maxPositions: 10,
  sizing: { kind: "risk", riskPercent: 2 }, positionCapPercent: 20, turnoverLimitPercent: 10,
  breadthMin: 35, floor: "trading", maxNewPerDay: 3,
};

if (process.argv[1].endsWith("backtest-losers.mjs")) {
  const r = runBacktest(USER, ".cache/history10y");
  const s = r.stats;
  console.log(`profit ${s.totalProfit} | trades ${s.trades} | avgR ${s.avgR.toFixed(2)} | CAGR ${s.cagrPercent.toFixed(1)}% | DD ${s.maxDrawdownPercent.toFixed(0)}% | win ${s.winRate.toFixed(0)}% | PF ${s.profitFactor.toFixed(2)}`);
  console.log("years:", r.years.map((y) => `${y.year}:${y.returnPercent.toFixed(0)}%`).join(" "));
  const t = r.trades;
  const by = (f) => { const m = new Map(); for (const x of t) { const k = f(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; };
  const line = (k, a) => `${String(k).padEnd(22)} n=${String(a.length).padStart(3)} win=${(100 * a.filter((x) => x.pnl > 0).length / a.length).toFixed(0)}% avgR=${(a.reduce((p, x) => p + x.r, 0) / a.length).toFixed(2)} sumPnL=${Math.round(a.reduce((p, x) => p + x.pnl, 0) / 1000)}k`;
  console.log("\nBy exit reason"); for (const [k, a] of by((x) => x.exitReason)) console.log(line(k, a));
  console.log("\nBy hold length"); for (const [k, a] of by((x) => x.holdDays <= 5 ? "≤5 days" : x.holdDays <= 15 ? "6-15" : x.holdDays <= 40 ? "16-40" : ">40")) console.log(line(k, a));
  console.log("\nBy year of entry"); for (const [k, a] of [...by((x) => x.entryDay.slice(0, 4))].sort()) console.log(line(k, a));
  console.log("\nBy RS at entry"); for (const [k, a] of by((x) => x.rs == null ? "n/a" : x.rs >= 95 ? "95+" : x.rs >= 90 ? "90-94" : x.rs >= 80 ? "80-89" : "<80")) console.log(line(k, a));
  console.log("\nWorst 12 trades"); for (const x of [...t].sort((a, b) => a.r - b.r).slice(0, 12)) console.log(`${x.symbol.padEnd(12)} ${x.entryDay}→${x.exitDay} ${x.exitReason} ${x.holdDays}d R${x.r.toFixed(2)} ${x.pnlPercent.toFixed(1)}% rs${x.rs}`);
}
