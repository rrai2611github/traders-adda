// What did the quick stop-outs look like at the moment of entry, compared with the winners that were held long?
import { runBacktest } from "../src/lib/backtest/run.ts";
import { loadHistory, isoToDay } from "../src/lib/backtest/history.ts";
import { ensureDerived } from "../src/lib/backtest/derive.ts";
import { movingAverage } from "../src/lib/backtest/signals.ts";
import { USER } from "./backtest-losers.mjs";

const DIR = ".cache/history10y";
const r = runBacktest(USER, DIR);
const history = loadHistory(DIR);
const derived = ensureDerived(DIR, history, () => {});
const cache = new Map();
const feat = (t) => {
  const s = history.series.get(t.symbol);
  let c = cache.get(t.symbol);
  if (!c) { c = { s50: movingAverage(s.close, 50), s200: movingAverage(s.close, 200) }; cache.set(t.symbol, c); }
  const day = isoToDay(t.entryDay);
  let i = 0; while (i < s.n && s.day[i] < day) i += 1;
  const p = i - 1; // signal day
  if (p < 60) return null;
  let hi = 0; for (let k = Math.max(0, p - 251); k <= p; k += 1) hi = Math.max(hi, s.high[k]);
  let atr = 0; for (let k = p - 13; k <= p; k += 1) atr += Math.max(s.high[k] - s.low[k], Math.abs(s.high[k] - s.close[k - 1]), Math.abs(s.low[k] - s.close[k - 1])) / 14;
  let volAvg = 0; for (let k = p - 49; k <= p; k += 1) volAvg += s.volume[k] / 50;
  const pos = history.position.get(s.day[p]);
  return {
    gap: (s.open[i] / s.close[p] - 1) * 100,
    ext50: (s.close[p] / c.s50[p] - 1) * 100,
    ext200: (s.close[p] / c.s200[p] - 1) * 100,
    fromHigh: (1 - s.close[p] / hi) * 100,
    atrPct: (atr / s.close[p]) * 100,
    breakoutVol: s.volume[p] / volAvg,
    dayMove: (s.close[p] / s.close[p - 1] - 1) * 100,
    breadth: derived.breadth50[pos],
    turn: derived.turn.get(t.symbol)[p],
  };
};
const rows = r.trades.map((t) => ({ t, f: feat(t) })).filter((x) => x.f);
const quick = rows.filter((x) => x.t.exitReason === "stop" && x.t.holdDays <= 15);
const longWin = rows.filter((x) => x.t.holdDays > 40 && x.t.pnl > 0);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
console.log(`quick stop-outs n=${quick.length} | long winners n=${longWin.length}`);
console.log("feature".padEnd(14), "quick-loss".padEnd(12), "long-win".padEnd(12));
for (const k of ["gap", "ext50", "ext200", "fromHigh", "atrPct", "breakoutVol", "dayMove", "breadth", "turn"]) console.log(k.padEnd(14), med(quick.map((x) => x.f[k])).toFixed(1).padEnd(12), med(longWin.map((x) => x.f[k])).toFixed(1));
// Bucketed outcomes for the features that separate best
const bucket = (name, key, cuts) => {
  console.log(`\n${name}`);
  let lo = -Infinity;
  for (const hi of [...cuts, Infinity]) {
    const a = rows.filter((x) => x.f[key] >= lo && x.f[key] < hi);
    if (a.length) console.log(`  ${lo === -Infinity ? "<" + hi : hi === Infinity ? "≥" + lo : lo + " to " + hi}`.padEnd(14), `n=${String(a.length).padStart(3)} win=${(100 * a.filter((x) => x.t.pnl > 0).length / a.length).toFixed(0)}% avgR=${(a.reduce((p, x) => p + x.t.r, 0) / a.length).toFixed(2)} quickStops=${a.filter((x) => quick.includes(x)).length}`);
    lo = hi;
  }
};
bucket("Gap at the open vs signal close (%)", "gap", [-1, 0, 1, 2, 4]);
bucket("Distance above 50-day average at signal (%)", "ext50", [5, 10, 15, 25, 40]);
bucket("Breadth at signal (%)", "breadth", [40, 50, 60, 70]);
bucket("Signal-day volume vs 50-day average (×)", "breakoutVol", [0.8, 1.2, 2, 3]);
bucket("Stock's daily range ATR %", "atrPct", [2, 3, 4, 6]);
bucket("Signal-day move (%)", "dayMove", [0, 2, 5, 8]);
