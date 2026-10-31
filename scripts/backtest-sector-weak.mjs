// Experiment 3: in a weak market, does picking leaders inside the outperforming sectors (or on a fresh base breakout) work?
// Research only. Same population for every row: stocks with an NSE industry (about 745), RS >= 80, stacked 50/150/200 averages,
// within 25% of the 52-week high. Signal on the close, entry next open, stop 2 x ATR(14), exit 3R target (40 days) or close under
// the 50 EMA (80 days), 0.25% costs, at most 3 new trades a day by RS.
// Usage: node --use-system-ca --no-warnings scripts/backtest-sector-weak.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBacktestData, tradeStats, ROOT, dayNo } from "./backtest-common.mjs";

const CFG = { warmup: 260, turnoverCr: 5, costPercent: 0.25, rsMin: 80, topPerDay: 3, maxRiskPercent: 12 };
const industry = new Map(JSON.parse(readFileSync(join(ROOT, "src/lib/market/data/nse-equities.json"), "utf8")).equities.filter((e) => e.industry).map((e) => [e.symbol, e.industry]));
const { hist, floor, rs, breadth } = loadBacktestData(CFG);
const ema = (v, n) => { const k = 2 / (n + 1), o = new Float64Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
const sma = (v, n) => { const o = new Float64Array(v.length).fill(NaN); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Sector strength per day, two ways: median 63-day return, and share of members above their 50-day average.
const perDay = new Map();
for (const [s, c] of hist) {
  const ind = industry.get(s); if (!ind) continue;
  const f = floor.get(s), a50 = sma(c.map((k) => k.close), 50);
  for (let i = 63; i < c.length; i++) {
    if (!f[i]) continue;
    const d = dayNo(c[i].t), m = perDay.get(d) ?? perDay.set(d, new Map()).get(d);
    const e = m.get(ind) ?? m.set(ind, { ret: [], above: 0, n: 0 }).get(ind);
    e.ret.push(c[i].close / c[i - 63].close - 1); e.n++; if (c[i].close > a50[i]) e.above++;
  }
}
const topByReturn = new Map(), topByBreadth = new Map();
for (const [d, m] of perDay) {
  const list = [...m].filter(([, e]) => e.n >= 4);
  const third = Math.max(1, Math.round(list.length / 3));
  topByReturn.set(d, new Set([...list].map(([k, e]) => [k, median(e.ret)]).sort((a, b) => b[1] - a[1]).slice(0, third).map(([k]) => k)));
  topByBreadth.set(d, new Set([...list].map(([k, e]) => [k, e.above / e.n]).sort((a, b) => b[1] - a[1]).slice(0, third).map(([k]) => k)));
}

function simulate(c, e, fill, stop, exit, e50) {
  const risk = fill - stop, maxHold = exit === "t3R" ? 40 : 80, target = exit === "t3R" ? fill + 3 * risk : Infinity;
  let px = null, idx = -1;
  for (let j = e; j < c.length; j++) {
    const k = c[j], open = j === e ? fill : k.open, low = j === e ? Math.min(k.low, fill) : k.low;
    if (j > e && exit === "ema50" && c[j - 1].close < e50[j - 1]) { px = open; idx = j; break; }
    if (low <= stop) { px = Math.min(open, stop); idx = j; break; }
    if (k.high >= target) { px = Math.max(open, target); idx = j; break; }
    if (j - e >= maxHold || j === c.length - 1) { px = k.close; idx = j; break; }
  }
  return { idx, r: (px - fill - (fill * CFG.costPercent) / 100) / risk };
}

const VARIANTS = ["leader", "sectorReturn", "sectorBreadth", "newBase", "newBase+sectorReturn", "newBase+sectorBreadth"];
const TIERS = ["weak", "mid", "full"];
const tierOf = (b) => (b >= 60 ? "full" : b >= 50 ? "mid" : "weak");
const trades = new Map(), busy = new Map();
for (const [symbol, c] of hist) {
  const ind = industry.get(symbol);
  if (!ind || c.length < CFG.warmup + 5) continue;
  const f = floor.get(symbol), r = rs.get(symbol), br = breadth.get(symbol);
  const closes = c.map((k) => k.close), vols = c.map((k) => k.volume);
  const e50 = ema(closes, 50), s50 = sma(closes, 50), s150 = sma(closes, 150), s200 = sma(closes, 200), v50 = sma(vols, 50);
  const atr = sma(c.map((k, i) => (i ? Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close)) : k.high - k.low)), 14);
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i] || r[i] < CFG.rsMin || !(br[i] >= 0)) continue;
    const k = c[i];
    if (k.close < 20 || k.volume < 50000) continue;
    let hi52 = 0, lo52 = Infinity;
    for (let q = i - 251; q <= i; q++) { hi52 = Math.max(hi52, c[q].high); lo52 = Math.min(lo52, c[q].low); }
    if (!(k.close > s50[i] && s50[i] > s150[i] && s150[i] > s200[i]) || k.close < hi52 * 0.75 || k.close < lo52 * 1.3) continue;
    let hh20 = 0, hh9 = 0, hi10 = 0, lo10 = Infinity;
    for (let q = i - 20; q < i; q++) hh20 = Math.max(hh20, c[q].high);
    for (let q = i - 9; q < i; q++) hh9 = Math.max(hh9, c[q].high);
    for (let q = i - 9; q <= i; q++) { hi10 = Math.max(hi10, c[q].high); lo10 = Math.min(lo10, c[q].low); }
    const vx = v50[i] > 0 ? k.volume / v50[i] : 0;
    // "New base": a breakout above the last 20 sessions on 1.5x volume, or out of a tight 10-day range.
    const fresh = (k.close > hh20 && vx >= 1.5) || ((hi10 - lo10) / k.close <= 0.1 && k.close > hh9 && vx >= 1.2);
    const d = dayNo(k.t);
    const sr = topByReturn.get(d)?.has(ind) ?? false, sb = topByBreadth.get(d)?.has(ind) ?? false;
    const ok = { leader: true, sectorReturn: sr, sectorBreadth: sb, newBase: fresh, "newBase+sectorReturn": fresh && sr, "newBase+sectorBreadth": fresh && sb };
    const e = i + 1, fill = c[e].open;
    if (fill > k.close * 1.05) continue;
    const stop = fill - 2 * atr[i];
    if (!(stop < fill) || ((fill - stop) / fill) * 100 > CFG.maxRiskPercent) continue;
    const t = tierOf(br[i]);
    for (const v of VARIANTS) {
      if (!ok[v]) continue;
      for (const exit of ["t3R", "ema50"]) {
        const bkey = `${v}|${exit}|${t}|${symbol}`;
        if ((busy.get(bkey) ?? -1) >= i) continue;
        const s = simulate(c, e, fill, stop, exit, e50);
        busy.set(bkey, s.idx + 3);
        const key = `${v}|${exit}|${t}`;
        (trades.get(key) ?? trades.set(key, []).get(key)).push({ symbol, day: d, entryT: c[e].t, rs: r[i], r: s.r, exit: "", pct: 0, hold: s.idx - e });
      }
    }
  }
}
const all = [...trades.values()].flat().map((t) => t.entryT).sort((a, b) => a - b);
const mid = all[all.length >> 1];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`Entries ${iso(all[0])} to ${iso(all.at(-1))}; first half before ${iso(mid)}\n`);
const fx = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
const cell = (s) => (s ? `${String(s.trades).padStart(5)} ${fx(s.winRate, 0).padStart(3)}% ${fx(s.avgR).padStart(5)}R` : "      -").padEnd(18);
const capped = (l) => { const m = new Map(); for (const t of l) (m.get(t.day) ?? m.set(t.day, []).get(t.day)).push(t); return [...m.values()].flatMap((x) => x.sort((a, b) => b.rs - a.rs || a.symbol.localeCompare(b.symbol)).slice(0, CFG.topPerDay)); };
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const range = (l) => { if (l.length < 40) return "too few"; const a = l.map((t) => t.r), m = []; for (let b = 0; b < 800; b++) { let s = 0; for (let i = 0; i < a.length; i++) s += a[(rnd() * a.length) | 0]; m.push(s / a.length); } m.sort((x, y) => x - y); return `${fx(m[20])} to ${fx(m[779])}`; };

for (const exit of ["t3R", "ema50"]) {
  console.log(`=== Exit ${exit}: average R by market strength (weak <50%, mid 50-60%, full 60%+) ===`);
  console.log(`${"variant".padEnd(24)}${"WEAK".padEnd(18)}${"  1st/2nd half".padEnd(36)}${"MID".padEnd(18)}${"FULL".padEnd(18)}95% range, weak`);
  for (const v of VARIANTS) {
    const tier = (t) => capped(trades.get(`${v}|${exit}|${t}`) ?? []);
    const weak = tier("weak");
    console.log(`${v.padEnd(24)}${cell(tradeStats(weak))}  ${cell(tradeStats(weak.filter((t) => t.entryT < mid)))}${cell(tradeStats(weak.filter((t) => t.entryT >= mid)))}${cell(tradeStats(tier("mid")))}${cell(tradeStats(tier("full")))}${range(weak)}`);
  }
  console.log();
}
console.log("Cells: trades, win rate, average R after costs. R = profit divided by the 2 x ATR stop distance.");
