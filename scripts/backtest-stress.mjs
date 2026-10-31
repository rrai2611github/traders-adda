// One-at-a-time changes around the recommended rule (screen breakout, 8% stop, 50-day trail, breadth 50, 10 positions).
import { runBacktest } from "../src/lib/backtest/run.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";

const screenName = process.argv[2] ?? "Multi-year breakouts";
const base = { ...DEFAULT_SETTINGS, from: "2016-12-01", to: "2026-10-16", breadthMin: 50, strategy: { kind: "screen", screen: screenName }, stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0 };
const ma = (period, when = "close") => ({ kind: "ma", type: "sma", period, when });
const cases = {
  "base": {},
  "stop 6%": { stop: { kind: "percent", percent: 6 } },
  "stop 10%": { stop: { kind: "percent", percent: 10 } },
  "stop 12%": { stop: { kind: "percent", percent: 12 } },
  "trail 20DMA": { exit: ma(20) },
  "trail 100DMA": { exit: ma(100) },
  "trail 50DMA next-open": { exit: ma(50, "next-open") },
  "5 positions": { maxPositions: 5 },
  "20 positions": { maxPositions: 20 },
  "cost 0.5%/side": { costPercent: 0.5 },
  "cost 1%/side": { costPercent: 1 },
  "risk 0.5%": { sizing: { kind: "risk", riskPercent: 0.5 } },
  "no breadth gate": { breadthMin: 0 },
  "breadth 60": { breadthMin: 60 },
  "screen floor ₹1Cr": { floor: "screen", turnoverLimitPercent: 10 },
  "start 2019": { from: "2019-01-01" },
  "start 2021": { from: "2021-01-01" },
  "2017-2020 only": { to: "2020-12-31" },
  "2021-2026 only": { from: "2021-01-01" },
};
for (const [name, over] of Object.entries(cases)) {
  const r = runBacktest({ ...base, ...over }, ".cache/history10y");
  const t = r.stats, h = r.halves;
  console.log(`${name.padEnd(24)} n=${String(t.trades).padStart(4)} win=${t.winRate?.toFixed(0)}% R=${t.avgR?.toFixed(2)} PF=${t.profitFactor?.toFixed(2)} CAGR=${t.cagrPercent?.toFixed(1)}% DD=${t.maxDrawdownPercent.toFixed(0)}% halves ${h?.first.avgR?.toFixed(2)}/${h?.second.avgR?.toFixed(2)}`);
}
