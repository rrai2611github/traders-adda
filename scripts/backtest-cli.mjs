// Usage: node scripts/backtest-cli.mjs [breadthMin] [from] [to]  — prints a one-line summary of a leaders backtest.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";

const [breadth = "60", from = "2016-06-01", to = "2026-10-16"] = process.argv.slice(2);
const settings = { ...DEFAULT_SETTINGS, from, to, breadthMin: Number(breadth) };
const r = runBacktest(settings, ".cache/history10y", (m) => console.error(m));
const s = r.stats;
console.log(JSON.stringify({ breadth, trades: s.trades, winRate: s.winRate?.toFixed(1), avgR: s.avgR?.toFixed(3), pf: s.profitFactor?.toFixed(2), cagr: s.cagrPercent?.toFixed(1), total: s.totalReturnPercent.toFixed(0), maxDD: s.maxDrawdownPercent.toFixed(1), exposure: s.exposurePercent.toFixed(0), secs: (r.elapsedMs / 1000).toFixed(1), data: r.data }));
console.log(r.years.map((y) => `${y.year}: ${y.trades}t R${y.avgR?.toFixed(2)} ${y.returnPercent.toFixed(1)}%`).join("\n"));
