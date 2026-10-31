// Experiment 4: when the market is weak, do short positions in the weakest F&O stocks make money?
// Research only. F&O stocks only (the only shares that can be shorted overnight). Weak stock = RS <= 25 with the 50/150/200 averages
// stacked downward and the close within 25% of the 52-week low. Signal on the close, short at the next open, stop 2 x ATR(14) above,
// exit at 3R (40 days) or when the close goes back above the 50 EMA (80 days). 0.25% costs, 3 new trades a day, weakest RS first.
// Usage: node --use-system-ca --no-warnings scripts/backtest-weak-shorts.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBacktestData, tradeStats, ROOT, dayNo } from "./backtest-common.mjs";

const CFG = { warmup: 260, turnoverCr: 5, costPercent: 0.25, rsMax: 25, topPerDay: 3, maxRiskPercent: 12 };
const fno = new Set(JSON.parse(readFileSync(join(ROOT, "src/lib/market/data/index-universes.json"), "utf8")).fno);
const { hist, floor, rs, breadth } = loadBacktestData(CFG);
const ema = (v, n) => { const k = 2 / (n + 1), o = new Float64Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
const sma = (v, n) => { const o = new Float64Array(v.length).fill(NaN); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };

function simulate(c, e, fill, stop, exit, e50) {
  const risk = stop - fill, maxHold = exit === "t3R" ? 40 : 80, target = exit === "t3R" ? fill - 3 * risk : -Infinity;
  let px = null, idx = -1;
  for (let j = e; j < c.length; j++) {
    const k = c[j], open = j === e ? fill : k.open, high = j === e ? Math.max(k.high, fill) : k.high;
    if (j > e && exit === "ema50" && c[j - 1].close > e50[j - 1]) { px = open; idx = j; break; }
    if (high >= stop) { px = Math.max(open, stop); idx = j; break; }
    if (k.low <= target) { px = Math.min(open, target); idx = j; break; }
    if (j - e >= maxHold || j === c.length - 1) { px = k.close; idx = j; break; }
  }
  return { idx, r: (fill - px - (fill * CFG.costPercent) / 100) / risk };
}

const TIERS = ["under40", "40-50", "50-60", "60plus"];
const tierOf = (b) => (b >= 60 ? "60plus" : b >= 50 ? "50-60" : b >= 40 ? "40-50" : "under40");
const SETUPS = ["control", "breakdown"];
const trades = new Map(), busy = new Map();
let fnoSeen = 0;
for (const [symbol, c] of hist) {
  if (!fno.has(symbol) || c.length < CFG.warmup + 5) continue;
  fnoSeen++;
  const f = floor.get(symbol), r = rs.get(symbol), br = breadth.get(symbol);
  const closes = c.map((k) => k.close), vols = c.map((k) => k.volume);
  const e50 = ema(closes, 50), s50 = sma(closes, 50), s150 = sma(closes, 150), s200 = sma(closes, 200), v50 = sma(vols, 50);
  const atr = sma(c.map((k, i) => (i ? Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close)) : k.high - k.low)), 14);
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i] || r[i] > CFG.rsMax || !(br[i] >= 0)) continue;
    const k = c[i];
    let hi52 = 0, lo52 = Infinity;
    for (let q = i - 251; q <= i; q++) { hi52 = Math.max(hi52, c[q].high); lo52 = Math.min(lo52, c[q].low); }
    if (!(k.close < s50[i] && s50[i] < s150[i] && s150[i] < s200[i]) || k.close > lo52 * 1.25) continue;
    let ll20 = Infinity; for (let q = i - 20; q < i; q++) ll20 = Math.min(ll20, c[q].low);
    const vx = v50[i] > 0 ? k.volume / v50[i] : 0;
    const ok = { control: true, breakdown: k.close < ll20 && vx >= 1.5 };
    const e = i + 1, fill = c[e].open;
    if (fill < k.close * 0.95) continue;
    const stop = fill + 2 * atr[i];
    if (((stop - fill) / fill) * 100 > CFG.maxRiskPercent) continue;
    const t = tierOf(br[i]), d = dayNo(k.t);
    for (const v of SETUPS) {
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
console.log(`F&O stocks with enough history: ${fnoSeen}`);
const all = [...trades.values()].flat().map((t) => t.entryT).sort((a, b) => a - b);
const mid = all[all.length >> 1];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`Entries ${iso(all[0])} to ${iso(all.at(-1))}; first half before ${iso(mid)}\n`);
const fx = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
const cell = (s) => (s ? `${String(s.trades).padStart(5)} ${fx(s.winRate, 0).padStart(3)}% ${fx(s.avgR).padStart(5)}R` : "      -").padEnd(18);
const capped = (l) => { const m = new Map(); for (const t of l) (m.get(t.day) ?? m.set(t.day, []).get(t.day)).push(t); return [...m.values()].flatMap((x) => x.sort((a, b) => a.rs - b.rs || a.symbol.localeCompare(b.symbol)).slice(0, CFG.topPerDay)); };
let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const range = (l) => { if (l.length < 40) return "too few"; const a = l.map((t) => t.r), m = []; for (let b = 0; b < 800; b++) { let s = 0; for (let i = 0; i < a.length; i++) s += a[(rnd() * a.length) | 0]; m.push(s / a.length); } m.sort((x, y) => x - y); return `${fx(m[20])} to ${fx(m[779])}`; };

for (const exit of ["t3R", "ema50"]) {
  console.log(`=== SHORTS, exit ${exit}: average R by market breadth on the signal day ===`);
  console.log(`${"setup".padEnd(12)}${"under 40%".padEnd(18)}${"40-50%".padEnd(18)}${"50-60%".padEnd(18)}${"60%+".padEnd(18)}1st/2nd half (under 50%)                 95% range (under 50%)`);
  for (const v of SETUPS) {
    const t = (x) => capped(trades.get(`${v}|${exit}|${x}`) ?? []);
    const weak = [...t("under40"), ...t("40-50")];
    console.log(`${v.padEnd(12)}${TIERS.map((x) => cell(tradeStats(t(x)))).join("")}${cell(tradeStats(weak.filter((q) => q.entryT < mid)))}${cell(tradeStats(weak.filter((q) => q.entryT >= mid)))}  ${range(weak)}`);
  }
  console.log();
}
console.log("Cells: trades, win rate, average R after costs (short side). R = profit divided by the 2 x ATR stop distance.");
