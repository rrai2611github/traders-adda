// Experiment: does stacking market gate + sector strength + relative strength + a setup trigger beat each filter alone?
// Research only: nothing in the app reads this. Signal on the close, entry at the next open, all indicators use
// candles up to the signal close. Costs 0.25% round trip. Candles are the app's cached Yahoo history.
// Usage: node --use-system-ca --no-warnings scripts/backtest-leaders.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBacktestData, tradeStats, ROOT, dayNo } from "./backtest-common.mjs";

const CFG = { warmup: 260, turnoverCr: 5, costPercent: 0.25, stopPercent: 7, targetPercent: 14, maxHoldFix: 30, maxHoldTrail: 60, topPerDay: 3 };
const SETUPS = ["control", "breakout", "pullback", "tightBreak"];
const RS_MIN = [70, 80, 90];
const GATES = ["none", "breadth50", "breadth60"];
const SECTORS = ["all", "known", "top3rd"];
const EXITS = ["fix", "trail"];

const t0 = Date.now();
const { hist, floor, rs, breadth } = loadBacktestData(CFG);
const industry = new Map(JSON.parse(readFileSync(join(ROOT, "src/lib/market/data/nse-equities.json"), "utf8")).equities.filter((e) => e.industry).map((e) => [e.symbol, e.industry]));
console.log(`Loaded ${hist.size} stocks (${industry.size} with an industry) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const ema = (v, n) => { const k = 2 / (n + 1), o = new Float64Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
const sma = (v, n) => { const o = new Float64Array(v.length).fill(NaN); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };

// Sector strength per day: median 63-day return of liquid members of each industry; top third of industries flagged.
const sectorDay = new Map(); // day -> Map(industry -> returns[])
for (const [s, c] of hist) {
  const ind = industry.get(s); if (!ind) continue;
  const f = floor.get(s);
  for (let i = 63; i < c.length; i++) {
    if (!f[i]) continue;
    const d = dayNo(c[i].t);
    const m = sectorDay.get(d) ?? sectorDay.set(d, new Map()).get(d);
    (m.get(ind) ?? m.set(ind, []).get(ind)).push(c[i].close / c[i - 63].close - 1);
  }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const topSectors = new Map(); // day -> Set(industry)
for (const [d, m] of sectorDay) {
  const ranked = [...m].filter(([, r]) => r.length >= 4).map(([ind, r]) => [ind, median(r)]).sort((a, b) => b[1] - a[1]);
  topSectors.set(d, new Set(ranked.slice(0, Math.max(1, Math.round(ranked.length / 3))).map(([ind]) => ind)));
}

function simulate(c, e, fill, exit, e20) {
  const stop = fill * (1 - CFG.stopPercent / 100), risk = fill - stop;
  const target = fill * (1 + CFG.targetPercent / 100);
  const maxHold = exit === "fix" ? CFG.maxHoldFix : CFG.maxHoldTrail;
  let px = null, idx = -1, why = "time";
  for (let j = e; j < c.length; j++) {
    const k = c[j], open = j === e ? fill : k.open, low = j === e ? Math.min(k.low, fill) : k.low;
    if (exit === "trail" && j > e && c[j - 1].close < e20[j - 1]) { px = open; why = "ema"; idx = j; break; }
    if (low <= stop) { px = Math.min(open, stop); why = "stop"; idx = j; break; }
    if (exit === "fix" && k.high >= target) { px = Math.max(open, target); why = "target"; idx = j; break; }
    if (j - e >= maxHold || j === c.length - 1) { px = k.close; why = "time"; idx = j; break; }
  }
  const cost = (fill * CFG.costPercent) / 100;
  return { idx, exit: why, hold: idx - e, r: (px - fill - cost) / risk, pct: ((px - fill - cost) / fill) * 100 };
}

const configs = [];
for (const setup of SETUPS) for (const rsMin of RS_MIN) for (const gate of GATES) for (const sector of SECTORS) configs.push({ setup, rsMin, gate, sector, id: `${setup}|${rsMin}|${gate}|${sector}` });
const trades = new Map(); // `${id}|${exit}` -> trades[]
const busy = new Map();

for (const [symbol, c] of hist) {
  if (c.length < CFG.warmup + 5) continue;
  const f = floor.get(symbol), r = rs.get(symbol), br = breadth.get(symbol), ind = industry.get(symbol) ?? null;
  const closes = c.map((k) => k.close);
  const e20 = ema(closes, 20), s50 = sma(closes, 50), s150 = sma(closes, 150), s200 = sma(closes, 200);
  const vols = c.map((k) => k.volume), v50 = sma(vols, 50);
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i]) continue;
    const k = c[i];
    if (k.close < 20 || k.volume < 50000) continue;
    let hi52 = 0, lo52 = Infinity;
    for (let q = i - 251; q <= i; q++) { hi52 = Math.max(hi52, c[q].high); lo52 = Math.min(lo52, c[q].low); }
    // Trend template (lite): stacked averages, near the 52-week high, well off the low.
    const stacked = k.close > s50[i] && s50[i] > s150[i] && s150[i] > s200[i];
    if (!stacked || k.close < hi52 * 0.75 || k.close < lo52 * 1.3) continue;
    let hh20 = 0; for (let q = i - 20; q < i; q++) hh20 = Math.max(hh20, c[q].high);
    let hh9 = 0, hi10 = 0, lo10 = Infinity;
    for (let q = i - 9; q < i; q++) hh9 = Math.max(hh9, c[q].high);
    for (let q = i - 9; q <= i; q++) { hi10 = Math.max(hi10, c[q].high); lo10 = Math.min(lo10, c[q].low); }
    let low5 = Infinity; for (let q = i - 4; q <= i; q++) low5 = Math.min(low5, c[q].low);
    const vx = v50[i] > 0 ? k.volume / v50[i] : 0;
    const high20 = Math.max(hh20, k.high);
    const setups = {
      control: true,
      breakout: k.close > hh20 && vx >= 1.5,
      pullback: k.close < high20 * 0.95 && k.close >= e20[i] && k.close <= e20[i] * 1.03 && k.close > k.open && k.close > c[i - 1].close && low5 >= s50[i],
      tightBreak: (hi10 - lo10) / k.close <= 0.10 && k.close > hh9 && vx >= 1.2,
    };
    const d = dayNo(k.t);
    const inTop = ind != null && (topSectors.get(d)?.has(ind) ?? false);
    const b = br[i];
    let entry = null;
    for (const cf of configs) {
      if (!setups[cf.setup] || r[i] < cf.rsMin) continue;
      if (cf.gate === "breadth50" && !(b >= 50)) continue;
      if (cf.gate === "breadth60" && !(b >= 60)) continue;
      if (cf.sector !== "all" && ind == null) continue;
      if (cf.sector === "top3rd" && !inTop) continue;
      if (!entry) {
        const e = i + 1, fill = c[e].open;
        if (fill > k.close * 1.05) break; // gapped away: skip
        entry = { e, fill };
      }
      for (const exit of EXITS) {
        const key = `${cf.id}|${exit}|${symbol}`;
        if ((busy.get(key) ?? -1) >= i) continue;
        const t = simulate(c, entry.e, entry.fill, exit, e20);
        busy.set(key, t.idx + 3);
        const list = trades.get(`${cf.id}|${exit}`) ?? trades.set(`${cf.id}|${exit}`, []).get(`${cf.id}|${exit}`);
        list.push({ symbol, day: d, entryT: c[entry.e].t, rs: r[i], ...t });
      }
    }
  }
}
console.log(`Simulated in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${[...trades.values()].reduce((a, l) => a + l.length, 0)} trade rows`);

const all = [...trades.values()].flat();
const times = all.map((t) => t.entryT).sort((a, b) => a - b);
const mid = times[times.length >> 1];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`Entries ${iso(times[0])} to ${iso(times.at(-1))}; design period = before ${iso(mid)}, test period = after.\n`);

const fx = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
const cell = (s) => (s ? `${String(s.trades).padStart(5)} ${fx(s.winRate, 0).padStart(3)}% ${fx(s.avgR).padStart(5)}R pf${fx(s.pf).padStart(5)}` : "        -").padEnd(26);
const capped = (list) => { // at most `topPerDay` new entries a day, highest RS first
  const byDay = new Map();
  for (const t of list) (byDay.get(t.day) ?? byDay.set(t.day, []).get(t.day)).push(t);
  return [...byDay.values()].flatMap((l) => l.sort((a, b) => b.rs - a.rs || a.symbol.localeCompare(b.symbol)).slice(0, CFG.topPerDay));
};

const rows = [];
for (const cf of configs) for (const exit of EXITS) {
  const l = trades.get(`${cf.id}|${exit}`) ?? [];
  rows.push({ cf, exit, l, cap: capped(l) });
}
const statsOf = (l, from, to) => tradeStats(l.filter((t) => t.entryT >= from && t.entryT < to));
const MIN = 150;

console.log("=== What each choice does on its own (average R across all settings of the others, top-3-per-day) ===");
const factor = (name, get, levels) => {
  for (const lv of levels) {
    const l = rows.filter((x) => get(x) === lv && x.cap.length >= 30);
    const s = tradeStats(l.flatMap((x) => x.cap));
    const avgOfAvgs = l.length ? l.reduce((a, x) => a + (tradeStats(x.cap)?.avgR ?? 0), 0) / l.length : null;
    console.log(`${name.padEnd(8)} ${String(lv).padEnd(11)} configs ${String(l.length).padStart(3)}  mean of config avgR ${fx(avgOfAvgs).padStart(6)}R  pooled trades ${String(s?.trades ?? 0).padStart(6)}  win ${fx(s?.winRate, 0)}%`);
  }
};
factor("setup", (x) => x.cf.setup, SETUPS);
factor("rsMin", (x) => x.cf.rsMin, RS_MIN);
factor("gate", (x) => x.cf.gate, GATES);
factor("sector", (x) => x.cf.sector, SECTORS);
factor("exit", (x) => x.exit, EXITS);

console.log(`\n=== Best configs chosen on the DESIGN period only, then shown on the unseen TEST period (top ${CFG.topPerDay} per day by RS, min ${MIN} design trades) ===`);
console.log(`${"Setup | RS min | market gate | sector | exit".padEnd(54)}${"DESIGN".padEnd(26)}${"TEST (unseen)".padEnd(26)}${"ALL".padEnd(26)}`);
const scored = rows.map((x) => ({ ...x, design: statsOf(x.cap, -Infinity, mid), test: statsOf(x.cap, mid, Infinity), whole: tradeStats(x.cap) }))
  .filter((x) => x.design && x.design.trades >= MIN && x.test && x.test.trades >= 60)
  .sort((a, b) => b.design.avgR - a.design.avgR);
for (const x of scored.slice(0, 12)) console.log(`${`${x.cf.setup} | ${x.cf.rsMin} | ${x.cf.gate} | ${x.cf.sector} | ${x.exit}`.padEnd(54)}${cell(x.design)}${cell(x.test)}${cell(x.whole)}`);

console.log("\n=== Reference rows ===");
const ref = (setup, rsMin, gate, sector, exit) => {
  const x = scored.find((y) => y.cf.id === `${setup}|${rsMin}|${gate}|${sector}` && y.exit === exit) ?? rows.find((y) => y.cf.id === `${setup}|${rsMin}|${gate}|${sector}` && y.exit === exit);
  const d = statsOf(x.cap, -Infinity, mid), t = statsOf(x.cap, mid, Infinity), w = tradeStats(x.cap);
  console.log(`${`${setup} | ${rsMin} | ${gate} | ${sector} | ${exit}`.padEnd(54)}${cell(d)}${cell(t)}${cell(w)}`);
};
ref("control", 70, "none", "all", "fix");
ref("control", 70, "breadth50", "all", "fix");
ref("breakout", 80, "none", "all", "fix");
ref("breakout", 80, "breadth50", "all", "fix");
ref("pullback", 80, "none", "all", "fix");
ref("pullback", 80, "breadth50", "all", "fix");

const best = scored[0];
if (best) {
  console.log(`\n=== By year · best design-period config: ${best.cf.id} | ${best.exit} ===`);
  for (const y of [...new Set(best.cap.map((t) => iso(t.entryT).slice(0, 4)))].sort()) console.log(`  ${y}  ${cell(tradeStats(best.cap.filter((t) => iso(t.entryT).startsWith(y))))}`);
  console.log(`  worst drawdown ${fx(best.whole.maxDdR, 1)}R · avg hold ${fx(best.whole.hold, 1)} sessions · stopped out ${fx(best.whole.stopped, 0)}%`);
}

console.log("\n=== Market gate check: any setup, RS 80+, by breadth bucket on the signal day (top-3/day, fix exit) ===");
const buckets = [[0, 30], [30, 40], [40, 50], [50, 60], [60, 101]];
const pool = rows.filter((x) => x.cf.rsMin === 80 && x.cf.gate === "none" && x.cf.sector === "all" && x.exit === "fix" && x.cf.setup !== "control");
const brAt = new Map();
for (const [s, c] of hist) { const br = breadth.get(s); c.forEach((k, i) => { if (br[i] >= 0) brAt.set(dayNo(k.t), br[i]); }); }
for (const [a, b] of buckets) {
  const l = pool.flatMap((x) => x.cap).filter((t) => { const v = brAt.get(t.day - 0); return v != null && v >= a && v < b; });
  console.log(`  breadth ${String(a).padStart(2)}-${String(b > 100 ? 100 : b).padEnd(3)} ${cell(tradeStats(l))}`);
}
console.log("\nCells: trades, win rate, average R after costs, profit factor. R = profit divided by the 7% stop distance.");
