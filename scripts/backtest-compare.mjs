// Runs a set of strategy variants over the full history and prints one line each.
import { runBacktest } from "../src/lib/backtest/run.ts";
import { DEFAULT_SETTINGS } from "../src/lib/backtest/types.ts";

const base = { ...DEFAULT_SETTINGS, from: "2016-12-01", to: "2026-10-16", breadthMin: 50 };
const leaders = (o = {}, s = {}) => ({ ...base, strategy: { kind: "leaders", rsMin: 80, nearHighPercent: 25, breakout: false, ...o }, ...s });
const screen = (name, s = {}) => ({ ...base, strategy: { kind: "screen", screen: name }, stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0, entry: "next-open", ...s });
const runs = process.env.ONLY ? {} : {
  "leaders RS80 gate50 (base)": leaders(),
  "leaders RS90": leaders({ rsMin: 90 }),
  "leaders +breakout": leaders({ breakout: true }),
  "leaders RS90 +breakout": leaders({ rsMin: 90, breakout: true }),
  "leaders near-high 10%": leaders({ nearHighPercent: 10 }),
  "leaders 3xATR 4R": leaders({}, { stop: { kind: "atr", multiple: 3 }, exit: { kind: "target", r: 4 } }),
  "leaders trail 50DMA": leaders({}, { exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0 }),
  "leaders gate70 +breakout": leaders({ breakout: true }, { breadthMin: 70 }),
};
for (const n of (process.argv[2] ?? "").split(",").filter(Boolean)) runs[`screen ${n}`] = screen(n);
for (const [name, s] of Object.entries(runs)) {
  try {
    const r = runBacktest(s, ".cache/history10y");
    const t = r.stats;
    console.log(`${name.padEnd(30)} n=${String(t.trades).padStart(4)} win=${t.winRate?.toFixed(0)}% R=${t.avgR?.toFixed(2)} PF=${t.profitFactor?.toFixed(2)} CAGR=${t.cagrPercent?.toFixed(1)}% DD=${t.maxDrawdownPercent.toFixed(0)}% halves R ${r.halves?.first.avgR?.toFixed(2)}/${r.halves?.second.avgR?.toFixed(2)}`);
  } catch (e) { console.log(name, "ERR", e.message); }
}
