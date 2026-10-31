// Experiment 2: with the market gate in place, do stop placement, exit style and a tiered gate change the result?
// Research only: nothing in the app reads this. Signal on the close, entry at the next open, 0.25% costs.
// Leaders = stacked 50/150/200 averages, near the 52-week high, RS >= 80. Setups: "control" (any such day) and "breakout".
// Usage: node --use-system-ca --no-warnings scripts/backtest-gate-stops.mjs
import { loadBacktestData, tradeStats, dayNo } from "./backtest-common.mjs";

const CFG = { warmup: 260, turnoverCr: 5, costPercent: 0.25, rsMin: 80, topPerDay: 3, maxRiskPercent: Number(process.env.MAXRISK ?? 12) };
const STOPS = { fix7: "7% below entry", low10: "below the 10-day low", atr2: "2 x ATR(14) below entry" };
const EXITS = { t2R: "2R target, 30 days", t3R: "3R target, 40 days", ema20: "close under 20 EMA, 60 days", ema50: "close under 50 EMA, 80 days" };
const SETUPS = ["control", "breakout"];
const tier = (b) => (b >= 60 ? "full" : b >= 50 ? "mid" : b >= 40 ? "low" : "weak");

const t0 = Date.now();
const { hist, floor, rs, breadth } = loadBacktestData(CFG);
const ema = (v, n) => { const k = 2 / (n + 1), o = new Float64Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
const sma = (v, n) => { const o = new Float64Array(v.length).fill(NaN); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };

function simulate(c, e, fill, stop, exit, e20, e50) {
  const risk = fill - stop;
  const [kind, maxHold] = exit === "t2R" ? ["r2", 30] : exit === "t3R" ? ["r3", 40] : exit === "ema20" ? ["e20", 60] : ["e50", 80];
  const target = kind === "r2" ? fill + 2 * risk : kind === "r3" ? fill + 3 * risk : Infinity;
  let px = null, idx = -1, why = "time";
  for (let j = e; j < c.length; j++) {
    const k = c[j], open = j === e ? fill : k.open, low = j === e ? Math.min(k.low, fill) : k.low;
    if (j > e && kind === "e20" && c[j - 1].close < e20[j - 1]) { px = open; why = "ema"; idx = j; break; }
    if (j > e && kind === "e50" && c[j - 1].close < e50[j - 1]) { px = open; why = "ema"; idx = j; break; }
    if (low <= stop) { px = Math.min(open, stop); why = "stop"; idx = j; break; }
    if (k.high >= target) { px = Math.max(open, target); why = "target"; idx = j; break; }
    if (j - e >= maxHold || j === c.length - 1) { px = k.close; why = "time"; idx = j; break; }
  }
  const cost = (fill * CFG.costPercent) / 100;
  return { idx, exit: why, hold: idx - e, r: (px - fill - cost) / risk, pct: ((px - fill - cost) / fill) * 100 };
}

const trades = new Map(); // `${setup}|${stop}|${exit}` -> trades
const busy = new Map();
for (const [symbol, c] of hist) {
  if (c.length < CFG.warmup + 5) continue;
  const f = floor.get(symbol), r = rs.get(symbol), br = breadth.get(symbol);
  const closes = c.map((k) => k.close), vols = c.map((k) => k.volume);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), s50 = sma(closes, 50), s150 = sma(closes, 150), s200 = sma(closes, 200), v50 = sma(vols, 50);
  const tr = c.map((k, i) => (i ? Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close)) : k.high - k.low));
  const atr = sma(tr, 14);
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i] || r[i] < CFG.rsMin || !(br[i] >= 40)) continue;
    const k = c[i];
    if (k.close < 20 || k.volume < 50000) continue;
    let hi52 = 0, lo52 = Infinity;
    for (let q = i - 251; q <= i; q++) { hi52 = Math.max(hi52, c[q].high); lo52 = Math.min(lo52, c[q].low); }
    if (!(k.close > s50[i] && s50[i] > s150[i] && s150[i] > s200[i]) || k.close < hi52 * 0.75 || k.close < lo52 * 1.3) continue;
    let hh20 = 0; for (let q = i - 20; q < i; q++) hh20 = Math.max(hh20, c[q].high);
    let low10 = Infinity; for (let q = i - 9; q <= i; q++) low10 = Math.min(low10, c[q].low);
    const vx = v50[i] > 0 ? k.volume / v50[i] : 0;
    const hits = { control: true, breakout: k.close > hh20 && vx >= 1.5 };
    const e = i + 1, fill = c[e].open;
    if (fill > k.close * 1.05) continue;
    const stops = { fix7: fill * 0.93, low10: low10 * 0.99, atr2: fill - 2 * atr[i] };
    const t = tier(br[i]), d = dayNo(k.t);
    for (const setup of SETUPS) {
      if (!hits[setup]) continue;
      for (const [stopName, stop] of Object.entries(stops)) {
        if (!(stop < fill) || (fill - stop) / fill * 100 > CFG.maxRiskPercent) continue;
        for (const exit of Object.keys(EXITS)) {
          const key = `${setup}|${stopName}|${exit}`, bkey = `${key}|${t}|${symbol}`;
          if ((busy.get(bkey) ?? -1) >= i) continue;
          const sim = simulate(c, e, fill, stop, exit, e20, e50);
          busy.set(bkey, sim.idx + 3);
          (trades.get(key) ?? trades.set(key, []).get(key)).push({ symbol, day: d, entryT: c[e].t, rs: r[i], tier: t, breadth: br[i], ...sim });
        }
      }
    }
  }
}
console.log(`Simulated in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${[...trades.values()].reduce((a, l) => a + l.length, 0)} trades across ${trades.size} rule sets`);
const times = [...trades.values()].flat().map((t) => t.entryT).sort((a, b) => a - b);
const mid = times[times.length >> 1];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`Entries ${iso(times[0])} to ${iso(times.at(-1))}; first half before ${iso(mid)}, second half after.\n`);

const fx = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
const cell = (s) => (s ? `${String(s.trades).padStart(5)} ${fx(s.winRate, 0).padStart(3)}% ${fx(s.avgR).padStart(5)}R pf${fx(s.pf).padStart(5)}` : "        -").padEnd(26);
const capped = (list) => {
  const byDay = new Map();
  for (const t of list) (byDay.get(t.day) ?? byDay.set(t.day, []).get(t.day)).push(t);
  return [...byDay.values()].flatMap((l) => l.sort((a, b) => b.rs - a.rs || a.symbol.localeCompare(b.symbol)).slice(0, CFG.topPerDay));
};
const inTiers = (list, tiers) => capped(list.filter((t) => tiers.includes(t.tier)));
const half = (l, a) => l.filter((t) => (a ? t.entryT < mid : t.entryT >= mid));

// Deterministic bootstrap so the numbers repeat between runs.
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const ci = (l) => {
  if (l.length < 30) return "n/a";
  const rs_ = l.map((t) => t.r), means = [];
  for (let b = 0; b < 1000; b++) { let s = 0; for (let i = 0; i < rs_.length; i++) s += rs_[(rnd() * rs_.length) | 0]; means.push(s / rs_.length); }
  means.sort((a, b) => a - b);
  return `${fx(means[25])}R to ${fx(means[974])}R`;
};

console.log("=== Stops and exits: average R in the full-size tier (breadth 60%+), top 3 per day by RS ===");
console.log(`${"setup | stop | exit".padEnd(40)}${"1st half".padEnd(26)}${"2nd half".padEnd(26)}${"ALL".padEnd(26)}`);
const rows = [];
for (const [key, l] of trades) {
  const full = inTiers(l, ["full"]);
  rows.push({ key, full, a: tradeStats(half(full, true)), b: tradeStats(half(full, false)), all: tradeStats(full) });
}
rows.sort((x, y) => (y.all?.avgR ?? -9) - (x.all?.avgR ?? -9));
for (const x of rows) console.log(`${x.key.replaceAll("|", " | ").padEnd(40)}${cell(x.a)}${cell(x.b)}${cell(x.all)}`);

console.log("\n=== Does the gate level matter? Same rule set, each breadth tier on its own (all setups, all stops/exits pooled by average) ===");
for (const t of ["low", "mid", "full"]) {
  const per = [...trades.values()].map((l) => tradeStats(inTiers(l, [t]))).filter((s) => s && s.trades >= 30);
  const avg = per.reduce((a, s) => a + s.avgR, 0) / (per.length || 1);
  const label = { low: "40-50%", mid: "50-60%", full: "60%+" }[t];
  console.log(`  breadth ${label.padEnd(7)} rule sets ${String(per.length).padStart(2)}  mean avgR ${fx(avg).padStart(6)}R  positive in ${per.filter((s) => s.avgR > 0).length} of ${per.length}`);
}

console.log("\n=== Gate designs on the five best rule sets (chosen on 1st half, shown on 2nd half) ===");
const picks = rows.filter((x) => x.a && x.a.trades >= 60 && x.b && x.b.trades >= 40).sort((x, y) => y.a.avgR - x.a.avgR).slice(0, 5);
const designs = { "Gate 50% (today)": ["mid", "full"], "Gate 60%": ["full"], "Tiered: full 60%+, half 50-60%": ["full", "mid"] };
console.log(`${"rule set / gate".padEnd(62)}${"1st half".padEnd(26)}${"2nd half".padEnd(26)}`);
for (const x of picks) {
  const l = trades.get(x.key);
  console.log(x.key.replaceAll("|", " | "));
  for (const [name, tiers] of Object.entries(designs)) {
    const g = inTiers(l, tiers);
    // Tiered sizing: the 50-60% tier trades at half size, so its R counts half.
    const sized = name.startsWith("Tiered") ? g.map((t) => (t.tier === "mid" ? { ...t, r: t.r * 0.5, pct: t.pct * 0.5 } : t)) : g;
    console.log(`  ${name.padEnd(60)}${cell(tradeStats(half(sized, true)))}${cell(tradeStats(half(sized, false)))}`);
  }
}

const top = picks[0];
if (top) {
  const full = top.full;
  console.log(`\n=== Best design-period rule set in full detail: ${top.key.replaceAll("|", " | ")} (breadth 60%+) ===`);
  for (const y of [...new Set(full.map((t) => iso(t.entryT).slice(0, 4)))].sort()) console.log(`  ${y}  ${cell(tradeStats(full.filter((t) => iso(t.entryT).startsWith(y))))}`);
  console.log(`  95% range for average R across the whole period: ${ci(full)}   (trades ${full.length})`);
  console.log(`  95% range, 2nd half only: ${ci(half(full, false))}   (trades ${half(full, false).length})`);
  console.log(`  worst losing run ${fx(tradeStats(full).maxDdR, 1)}R, average hold ${fx(tradeStats(full).hold, 1)} sessions, stopped out ${fx(tradeStats(full).stopped, 0)}%`);
}
console.log("\nCells: trades, win rate, average R after costs, profit factor. R = profit divided by the distance to the stop.");
