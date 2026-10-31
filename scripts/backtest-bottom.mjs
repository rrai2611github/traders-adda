// Walk-forward backtest of a "bottomed out" screen: a stock that fell hard, stopped making new lows,
// printed a higher low and has reclaimed its short-term trend. Entry on the next open after the signal
// close; every signal uses only candles up to that close.
// Usage: node --use-system-ca --no-warnings scripts/backtest-bottom.mjs
import { loadBacktestData, tradeStats } from "./backtest-common.mjs";

const CFG = { warmup: 260, turnoverCr: 5, costPercent: 0.25, lowWindow: 120, minAgo: 8, maxAgo: 60, maxRiskPercent: 15 };

const ENTRIES = {
  control: "Control: down 35%+ from 52W high only",
  base: "Bottom: 35%+ off high, low 8-60d ago, higher low, close > EMA20",
  vol: "base + volume >= 1.5x 50-day avg",
  ema50: "base + close > EMA50",
  breadth: "base + breadth >= 50%",
  div: "base + RSI bullish divergence",
  volEma50: "base + volume 1.5x + close > EMA50",
  deep: "base + 50%+ off high",
  strict: "vol + ema50 + higher-low + RSI > 50",
  deepBreadth: "deep + breadth >= 50%",
  deepWeak: "deep + breadth < 50%",
  deepVol: "deep + volume >= 1.5x",
  deepEma50: "deep + close > EMA50",
  deepDiv: "deep + RSI divergence",
  early: "early only: 35-50% off high",
};
const EXITS = {
  swing: "Stop under base low, half at 2R (SL to cost), rest 3R, 40 days",
  trend: "Stop under base low, exit on close < EMA50 (next open), 120 days",
  fix: "Stop -8%, target +16%, 40 days",
};

function emaSeries(v, n) {
  const k = 2 / (n + 1), out = new Float64Array(v.length);
  let e = v[0];
  for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; out[i] = e; }
  return out;
}
function rsiSeries(v, n = 14) {
  const out = new Float64Array(v.length).fill(50);
  let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function exitTrade(c, e, fill, mode, stopPx, ind) {
  let stop = stopPx, t1 = Infinity, t2 = Infinity, maxHold = 40;
  if (mode === "fix") { stop = fill * 0.92; t2 = fill * 1.16; }
  const risk = fill - stop;
  if (!(risk > 0)) return null;
  if (mode === "swing") { t1 = fill + 2 * risk; t2 = fill + 3 * risk; }
  if (mode === "trend") maxHold = 120;
  let half = false, realized = 0, s = stop, exitIndex = -1, exit = "time";
  for (let j = e; j < c.length; j++) {
    const k = c[j];
    const open = j === e ? fill : k.open;
    if (mode === "trend" && j > e && c[j - 1].close < ind.e50[j - 1]) { realized += open - fill; exit = "ema"; exitIndex = j; break; }
    if (k.low <= s && j > e) { realized += (half ? 0.5 : 1) * (Math.min(open, s) - fill); exit = half ? "trailed" : "stop"; exitIndex = j; break; }
    if (j === e && k.low <= s) { realized += (k.close - fill); exit = "stop"; exitIndex = j; break; }
    if (!half && k.high >= t1) { realized += 0.5 * (t1 - fill); half = true; s = fill; }
    if (k.high >= t2) { realized += (half ? 0.5 : 1) * (Math.max(open, t2) - fill); exit = "target"; exitIndex = j; break; }
    if (j - e >= maxHold || j === c.length - 1) { realized += (half ? 0.5 : 1) * (k.close - fill); exit = j === c.length - 1 ? "open" : "time"; exitIndex = j; break; }
  }
  const cost = (fill * CFG.costPercent) / 100;
  return { exitIndex, exit, hold: exitIndex - e, r: (realized - cost) / risk, pct: ((realized - cost) / fill) * 100 };
}

const t0 = Date.now();
const { hist, floor, breadth } = loadBacktestData(CFG);
console.log(`Loaded ${hist.size} stocks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const trades = [];
for (const [symbol, c] of hist) {
  if (c.length < CFG.warmup + 5) continue;
  const f = floor.get(symbol), br = breadth.get(symbol);
  const closes = c.map((k) => k.close);
  const ind = { e20: emaSeries(closes, 20), e50: emaSeries(closes, 50), rsi: rsiSeries(closes) };
  const busy = {};
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i]) continue;
    const k = c[i];
    if (k.close < 20 || k.volume < 50000) continue;
    let hi = 0; for (let q = i - 251; q <= i; q++) hi = Math.max(hi, c[q].high);
    const off = (1 - k.close / hi) * 100;
    if (off < 35) continue;
    // Lowest low of the last 120 sessions and how long ago it was set.
    let lo = Infinity, loAt = -1;
    for (let q = i - CFG.lowWindow + 1; q <= i; q++) if (c[q].low < lo) { lo = c[q].low; loAt = q; }
    const ago = i - loAt;
    const bottomOk = ago >= CFG.minAgo && ago <= CFG.maxAgo && k.close >= lo * 1.08 && k.close <= lo * 1.5;
    let recentLow = Infinity; for (let q = i - 4; q <= i; q++) recentLow = Math.min(recentLow, c[q].low);
    const higherLow = recentLow > lo * 1.02;
    const base = bottomOk && higherLow && k.close > ind.e20[i];
    let vol50 = 0; for (let q = i - 50; q < i; q++) vol50 += c[q].volume / 50;
    const vx = vol50 > 0 ? k.volume / vol50 : 0;
    // RSI bullish divergence: the RSI floor of the last 10 sessions is higher than the RSI at the price low.
    const rsiAtLow = ind.rsi[loAt];
    let minRsiRecent = 100;
    for (let q = i - 9; q <= i; q++) minRsiRecent = Math.min(minRsiRecent, ind.rsi[q]);
    const div = base && minRsiRecent > rsiAtLow + 3;
    const hits = {
      control: true,
      base,
      vol: base && vx >= 1.5,
      ema50: base && k.close > ind.e50[i],
      breadth: base && br[i] >= 50,
      div,
      volEma50: base && vx >= 1.5 && k.close > ind.e50[i],
      deep: base && off >= 50,
      deepBreadth: base && off >= 50 && br[i] >= 50,
      deepWeak: base && off >= 50 && br[i] >= 0 && br[i] < 50,
      deepVol: base && off >= 50 && vx >= 1.5,
      deepEma50: base && off >= 50 && k.close > ind.e50[i],
      deepDiv: div && off >= 50,
      early: base && off < 50,
      strict: base && vx >= 1.5 && k.close > ind.e50[i] && ind.rsi[i] > 50,
    };
    for (const [entry, ok] of Object.entries(hits)) {
      if (!ok) continue;
      for (const mode of Object.keys(EXITS)) {
        const id = `${entry}|${mode}`;
        if ((busy[id] ?? -1) >= i) continue;
        const e = i + 1, fill = c[e].open;
        let swingLow = Infinity;
        for (let q = i - 9; q <= i; q++) swingLow = Math.min(swingLow, c[q].low);
        const stopPx = (entry === "control" ? swingLow : lo) * 0.99;
        if (((fill - stopPx) / fill) * 100 > CFG.maxRiskPercent && mode !== "fix") { busy[id] = i + 5; continue; }
        const t = exitTrade(c, e, fill, mode, stopPx, ind);
        busy[id] = t ? t.exitIndex + 5 : i + 5;
        if (t) trades.push({ symbol, entry, mode, entryT: c[e].t, ...t });
      }
    }
  }
}

const times = trades.map((t) => t.entryT).sort((a, b) => a - b);
const mid = times[times.length >> 1];
const d = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`Simulated in ${((Date.now() - t0) / 1000).toFixed(0)}s, entries ${d(times[0])} to ${d(times.at(-1))}, split ${d(mid)}, costs ${CFG.costPercent}%\n`);
const fx = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
const cell = (s) => (s ? `${String(s.trades).padStart(6)} ${fx(s.winRate, 0).padStart(3)}% ${fx(s.avgR).padStart(5)}R ${fx(s.avgPct).padStart(5)}% ${fx(s.pf).padStart(4)}` : "      -").padEnd(34);
for (const [mode, desc] of Object.entries(EXITS)) {
  console.log(`EXIT ${mode}: ${desc}`);
  console.log(`${"Entry".padEnd(66)}${"ALL".padEnd(34)}${"1st half".padEnd(34)}${"2nd half".padEnd(34)}`);
  for (const [entry, name] of Object.entries(ENTRIES)) {
    const l = trades.filter((t) => t.mode === mode && t.entry === entry);
    console.log(`${name.padEnd(66)}${cell(tradeStats(l))}${cell(tradeStats(l.filter((t) => t.entryT < mid)))}${cell(tradeStats(l.filter((t) => t.entryT >= mid)))}`);
  }
  console.log();
}
console.log("Cells: trades, win rate, average R after costs, average % per trade after costs, profit factor.\n");
const ranked = Object.keys(ENTRIES).flatMap((entry) => Object.keys(EXITS).map((mode) => {
  const l = trades.filter((t) => t.entry === entry && t.mode === mode);
  return { entry, mode, l, s: tradeStats(l) };
})).filter((x) => x.s?.trades >= 200 && x.entry !== "control").sort((a, b) => b.s.avgR - a.s.avgR).slice(0, 3);
for (const { entry, mode, l } of ranked) {
  console.log(`By year · ${ENTRIES[entry]} · exit ${mode}`);
  for (const y of [...new Set(l.map((t) => d(t.entryT).slice(0, 4)))].sort()) console.log(`  ${y}  ${cell(tradeStats(l.filter((t) => d(t.entryT).startsWith(y))))}`);
}
