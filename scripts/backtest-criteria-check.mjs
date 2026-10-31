// Experiment 5: a user-supplied "9/10" swing criteria set, tested rule by rule against the cached history.
// Research only. Signal on the close, entry at the next open, stop 2 x ATR(14), 0.25% costs, at most 3 new trades a day by RS.
// Exits: "t3R" = all out at 3R (40 days); "half+ema21" = half at 3R, stop to entry, the rest leaves on a close under the 21 EMA (80 days).
// Usage: node --use-system-ca --no-warnings scripts/backtest-criteria-check.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBacktestData, loadBenchmark, tradeStats, ROOT, dayNo } from "./backtest-common.mjs";

const CFG = { warmup: 260, turnoverCr: 5, costPercent: 0.25, topPerDay: 3, maxRiskPercent: 12 };
const industry = new Map(JSON.parse(readFileSync(join(ROOT, "src/lib/market/data/nse-equities.json"), "utf8")).equities.filter((e) => e.industry).map((e) => [e.symbol, e.industry]));
const { hist, floor, rs, breadth } = loadBacktestData(CFG);
const bench = await loadBenchmark();
const ema = (v, n) => { const k = 2 / (n + 1), o = new Float64Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
const sma = (v, n) => { const o = new Float64Array(v.length).fill(NaN); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Nifty 50 above its 50 and 200-day averages, by day.
const niftyOk = new Map();
{
  const cl = bench.map((k) => k.close), a50 = sma(cl, 50), a200 = sma(cl, 200);
  bench.forEach((k, i) => niftyOk.set(dayNo(k.t), i >= 199 && cl[i] > a50[i] && cl[i] > a200[i]));
}
// Top 5 industries by median 63-day return, per day (745 stocks carry an industry).
const perDay = new Map();
for (const [s, c] of hist) {
  const ind = industry.get(s); if (!ind) continue;
  const f = floor.get(s);
  for (let i = 63; i < c.length; i++) {
    if (!f[i]) continue;
    const d = dayNo(c[i].t), m = perDay.get(d) ?? perDay.set(d, new Map()).get(d);
    (m.get(ind) ?? m.set(ind, []).get(ind)).push(c[i].close / c[i - 63].close - 1);
  }
}
const top5 = new Map();
for (const [d, m] of perDay) top5.set(d, new Set([...m].filter(([, r]) => r.length >= 4).map(([k, r]) => [k, median(r)]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k)));

function simulate(c, e, fill, stop, exit, e21) {
  const risk = fill - stop, target = fill + 3 * risk, maxHold = exit === "t3R" ? 40 : 80;
  let half = false, realized = 0, cur = stop, idx = -1;
  for (let j = e; j < c.length; j++) {
    const k = c[j], open = j === e ? fill : k.open, low = j === e ? Math.min(k.low, fill) : k.low;
    if (exit === "half+ema21" && half && j > e && c[j - 1].close < e21[j - 1]) { realized += 0.5 * (open - fill); idx = j; break; }
    if (low <= cur) { realized += (half ? 0.5 : 1) * (Math.min(open, cur) - fill); idx = j; break; }
    if (k.high >= target) {
      if (exit === "t3R") { realized += Math.max(open, target) - fill; idx = j; break; }
      if (!half) { realized += 0.5 * (Math.max(open, target) - fill); half = true; cur = fill; }
    }
    if (j - e >= maxHold || j === c.length - 1) { realized += (half ? 0.5 : 1) * (k.close - fill); idx = j; break; }
  }
  return { idx, r: (realized - (fill * CFG.costPercent) / 100) / risk };
}

// Every rule is a named predicate; a rule set is just a list of names.
const RULES = {
  rs85: (x) => x.rs >= 85, rs80: (x) => x.rs >= 80,
  stack: (x) => x.stack, rising200: (x) => x.rising200,
  near25: (x) => x.fromHigh <= 25, near10: (x) => x.fromHigh <= 10, near5: (x) => x.fromHigh <= 5,
  avgVol500k: (x) => x.avgVol >= 500_000,
  sector5: (x) => x.sectorTop5, nifty: (x) => x.niftyOk,
  breakout20: (x) => x.breakout20, vol150: (x) => x.vx >= 1.5,
  breadth60: (x) => x.breadth >= 60,
};
const FIVE = ["rs85", "stack", "near10", "breakout20", "vol150", "breadth60"]; // the "5 rules": breakout and volume are one rule
const FULL = ["rs85", "stack", "rising200", "near10", "avgVol500k", "sector5", "breakout20", "vol150", "nifty", "breadth60"];
const OURS = ["rs80", "stack", "near25", "breadth60"];
const without = (set, r) => set.filter((x) => x !== r);
const SETS = {
  "THEIR FULL SETUP (all 10 rules)": FULL,
  "THEIR 5 RULES (RS85, stack, 10% of high, breakout + volume, breadth 60)": FIVE,
  "OURS (RS80, stack, 25% of high, breadth 60, no breakout)": OURS,
  "5 rules minus RS85 (use RS80)": [...without(FIVE, "rs85"), "rs80"],
  "5 rules minus 10% of high (use 25%)": [...without(FIVE, "near10"), "near25"],
  "5 rules minus breakout20": without(FIVE, "breakout20"),
  "5 rules minus volume 150%": without(FIVE, "vol150"),
  "5 rules minus breakout AND volume": without(without(FIVE, "breakout20"), "vol150"),
  "5 rules minus breadth 60": without(FIVE, "breadth60"),
  "5 rules + 200 DMA rising": [...FIVE, "rising200"],
  "5 rules + avg volume 500k": [...FIVE, "avgVol500k"],
  "5 rules + top-5 sector": [...FIVE, "sector5"],
  "5 rules + Nifty above 50 and 200": [...FIVE, "nifty"],
  "5 rules but within 5% of high": [...without(FIVE, "near10"), "near5"],
};
const EXITS = ["t3R", "half+ema21"];

const trades = new Map(), busy = new Map();
for (const [symbol, c] of hist) {
  if (c.length < CFG.warmup + 5) continue;
  const ind = industry.get(symbol) ?? null;
  const f = floor.get(symbol), r = rs.get(symbol), br = breadth.get(symbol);
  const closes = c.map((k) => k.close), vols = c.map((k) => k.volume);
  const e21 = ema(closes, 21), s50 = sma(closes, 50), s150 = sma(closes, 150), s200 = sma(closes, 200), v50 = sma(vols, 50);
  const atr = sma(c.map((k, i) => (i ? Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close)) : k.high - k.low)), 14);
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i] || !(br[i] >= 0)) continue;
    const k = c[i];
    if (k.close < 20 || k.volume < 50000) continue;
    let hi52 = 0; for (let q = i - 251; q <= i; q++) hi52 = Math.max(hi52, c[q].high);
    let hh20 = 0; for (let q = i - 20; q < i; q++) hh20 = Math.max(hh20, c[q].high);
    const d = dayNo(k.t);
    const x = {
      rs: r[i], breadth: br[i], stack: k.close > s50[i] && s50[i] > s150[i] && s150[i] > s200[i],
      rising200: s200[i] > s200[i - 20], fromHigh: (1 - k.close / hi52) * 100, avgVol: v50[i],
      sectorTop5: ind != null && (top5.get(d)?.has(ind) ?? false), niftyOk: niftyOk.get(d) === true,
      breakout20: k.close > hh20, vx: v50[i] > 0 ? k.volume / v50[i] : 0,
    };
    const e = i + 1, fill = c[e].open;
    if (fill > k.close * 1.05) continue;
    const stop = fill - 2 * atr[i];
    if (!(stop < fill) || ((fill - stop) / fill) * 100 > CFG.maxRiskPercent) continue;
    for (const [name, rules] of Object.entries(SETS)) {
      if (!rules.every((rule) => RULES[rule](x))) continue;
      for (const exit of EXITS) {
        const bkey = `${name}|${exit}|${symbol}`;
        if ((busy.get(bkey) ?? -1) >= i) continue;
        const s = simulate(c, e, fill, stop, exit, e21);
        busy.set(bkey, s.idx + 3);
        const key = `${name}|${exit}`;
        (trades.get(key) ?? trades.set(key, []).get(key)).push({ symbol, day: d, entryT: c[e].t, rs: x.rs, r: s.r, exit: "", pct: 0, hold: s.idx - e });
      }
    }
  }
}
const all = [...trades.values()].flat().map((t) => t.entryT).sort((a, b) => a - b);
const mid = all[all.length >> 1];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`Entries ${iso(all[0])} to ${iso(all.at(-1))}; first half before ${iso(mid)}\n`);
const fx = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
const cell = (s) => (s ? `${String(s.trades).padStart(4)} ${fx(s.winRate, 0).padStart(3)}% ${fx(s.avgR).padStart(5)}R` : "      -").padEnd(17);
const capped = (l) => { const m = new Map(); for (const t of l) (m.get(t.day) ?? m.set(t.day, []).get(t.day)).push(t); return [...m.values()].flatMap((q) => q.sort((a, b) => b.rs - a.rs || a.symbol.localeCompare(b.symbol)).slice(0, CFG.topPerDay)); };
let seed = 21; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const range = (l) => { if (l.length < 30) return "too few"; const a = l.map((t) => t.r), m = []; for (let b = 0; b < 800; b++) { let s = 0; for (let i = 0; i < a.length; i++) s += a[(rnd() * a.length) | 0]; m.push(s / a.length); } m.sort((p, q) => p - q); return `${fx(m[20])} to ${fx(m[779])}`; };

for (const exit of EXITS) {
  console.log(`=== Exit: ${exit === "t3R" ? "all out at 3R" : "half at 3R, rest on a close under the 21 EMA"} ===`);
  console.log(`${"rule set".padEnd(72)}${"ALL".padEnd(17)}${"1st half".padEnd(17)}${"2nd half".padEnd(17)}95% range (avg R)   max losing run`);
  for (const name of Object.keys(SETS)) {
    const l = capped(trades.get(`${name}|${exit}`) ?? []);
    const s = tradeStats(l);
    console.log(`${name.padEnd(72)}${cell(s)}${cell(tradeStats(l.filter((t) => t.entryT < mid)))}${cell(tradeStats(l.filter((t) => t.entryT >= mid)))}${range(l).padEnd(18)}${s ? fx(s.maxDdR, 1) + "R" : "-"}`);
  }
  console.log();
}
console.log("Cells: trades, win rate, average R after costs. Sector rules only see the ~745 stocks that carry an industry.");
