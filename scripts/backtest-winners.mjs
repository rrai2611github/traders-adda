// How big were the winners of the "buy near the breakout level" rule, and how often did a trade reach +2R / +3R / +5R before it ended?
import { runBacktest } from "../src/lib/backtest/run.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";
const base = { ...DEFAULT_SETTINGS, from: "2016-12-01", to: "2026-10-16", breadthMin: 50, stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0 };
const cases = {
  "RS90 within 5% of high (Ready-style)": { strategy: { kind: "leaders", rsMin: 90, nearHighPercent: 5, breakout: false } },
  "Multi-year breakouts screen": { strategy: { kind: "screen", screen: "Multi-year breakouts" }, exit: { kind: "ma", type: "sma", period: 100, when: "close" } },
  "Blue sky screen": { strategy: { kind: "screen", screen: "Blue sky" } },
};
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
for (const [name, o] of Object.entries(cases)) {
  const r = runBacktest({ ...base, ...o }, ".cache/history10y");
  const t = r.trades;
  const rs = t.map((x) => x.r).sort((a, b) => a - b);
  const win = rs.filter((x) => x > 0);
  const pct = (x) => `${(100 * x / rs.length).toFixed(0)}%`;
  const gain = t.map((x) => x.pnlPercent).sort((a, b) => a - b);
  console.log(`${name}: trades ${rs.length} (of ${r.tradeCount}) | winners ${pct(win.length)} | median R ${q(rs, .5).toFixed(2)} | ended ≥+1R ${pct(rs.filter((x) => x >= 1).length)} ≥+2R ${pct(rs.filter((x) => x >= 2).length)} ≥+3R ${pct(rs.filter((x) => x >= 3).length)} ≥+5R ${pct(rs.filter((x) => x >= 5).length)} | winners median ${q(win, .5).toFixed(1)}R, 75th ${q(win, .75).toFixed(1)}R | gain% median of winners ${q(gain.filter((g) => g > 0), .5).toFixed(0)}% | hold days median ${t.map((x) => x.holdDays).sort((a, b) => a - b)[Math.floor(t.length / 2)]}`);
}
