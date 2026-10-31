// Does buying strong stocks BEFORE a breakout (close to the 52-week high, not yet broken out) work? Leaders rule, 8% stop, 50-day trail.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";
const base = { ...DEFAULT_SETTINGS, from: "2016-12-01", to: "2026-10-16", breadthMin: 50, stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0 };
const cases = {
  "within 3% of high, RS80": { strategy: { kind: "leaders", rsMin: 80, nearHighPercent: 3, breakout: false } },
  "within 5% of high, RS80": { strategy: { kind: "leaders", rsMin: 80, nearHighPercent: 5, breakout: false } },
  "within 10% of high, RS80": { strategy: { kind: "leaders", rsMin: 80, nearHighPercent: 10, breakout: false } },
  "within 5%, RS90": { strategy: { kind: "leaders", rsMin: 90, nearHighPercent: 5, breakout: false } },
  "within 5%, RS90, breadth 60": { strategy: { kind: "leaders", rsMin: 90, nearHighPercent: 5, breakout: false }, breadthMin: 60 },
  "20-day breakout, RS80": { strategy: { kind: "leaders", rsMin: 80, nearHighPercent: 25, breakout: true } },
  "screen Multi-year (breakout day)": { strategy: { kind: "screen", screen: "Multi-year breakouts" }, exit: { kind: "ma", type: "sma", period: 100, when: "close" } },
};
for (const [name, o] of Object.entries(cases)) {
  const r = runBacktest({ ...base, ...o }, ".cache/history10y"); const t = r.stats, h = r.halves;
  console.log(`${name.padEnd(34)} n=${String(t.trades).padStart(4)} win=${t.winRate?.toFixed(0)}% R=${t.avgR?.toFixed(2)} PF=${t.profitFactor?.toFixed(2)} CAGR=${t.cagrPercent?.toFixed(1)}% DD=${t.maxDrawdownPercent.toFixed(0)}% halves ${h?.first.avgR?.toFixed(2)}/${h?.second.avgR?.toFixed(2)}`);
}
