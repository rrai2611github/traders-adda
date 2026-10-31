// "Ready for a run": strong stocks close to the high that have NOT already run (limited stretch above the 50-day) and are quiet.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";
const base = { ...DEFAULT_SETTINGS, from: "2016-12-01", to: "2026-10-16", breadthMin: 50, stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0 };
const L = (o) => ({ strategy: { kind: "leaders", rsMin: 90, nearHighPercent: 5, breakout: false, ...o } });
const cases = {
  "RS90 within5% (no run filter)": L({}),
  "+ not >20% above 50DMA": L({ maxAboveSma50Percent: 20 }),
  "+ not >15% above 50DMA": L({ maxAboveSma50Percent: 15 }),
  "+ not >10% above 50DMA": L({ maxAboveSma50Percent: 10 }),
  "+ not >10% & volume dry-up": L({ maxAboveSma50Percent: 10, volumeDryUp: true }),
  "+ not >15% & volume dry-up": L({ maxAboveSma50Percent: 15, volumeDryUp: true }),
  "+ not >10%, breadth 60": { ...L({ maxAboveSma50Percent: 10 }), breadthMin: 60 },
  "+ not >10%, 100DMA exit": { ...L({ maxAboveSma50Percent: 10 }), exit: { kind: "ma", type: "sma", period: 100, when: "close" } },
};
for (const [name, o] of Object.entries(cases)) {
  const r = runBacktest({ ...base, ...o }, ".cache/history10y"); const t = r.stats, h = r.halves;
  console.log(`${name.padEnd(32)} n=${String(t.trades).padStart(4)} win=${t.winRate?.toFixed(0)}% R=${t.avgR?.toFixed(2)} PF=${t.profitFactor?.toFixed(2)} CAGR=${t.cagrPercent?.toFixed(1)}% DD=${t.maxDrawdownPercent.toFixed(0)}% halves ${h?.first.avgR?.toFixed(2)}/${h?.second.avgR?.toFixed(2)}`);
}
