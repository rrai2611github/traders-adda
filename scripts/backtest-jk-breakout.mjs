// Walk-forward backtest of the "near 52-week high" breakout method (Jaynesh Kasliwal webinar),
// with the gaps in the method replaced by exact, testable rules.
// Usage: node --use-system-ca --no-warnings scripts/backtest-jk-breakout.mjs
// Each signal uses only candles up to that day's close; entries happen on later sessions.
import { dayNo, loadBacktestData, loadBenchmark, tradeStats } from "./backtest-common.mjs";

const CFG = { warmup: 260, turnoverCr: 5, entryDays: 3, costPercent: 0.25, baseDays: 20 };

const ENTRIES = {
  screen: "His Chartink screen hit, buy next open",
  bo: "Close above 20-day base high + screen",
  bo15: "..+ volume >= 1.5x 50-day avg",
  bo2: "..+ volume >= 2x 50-day avg",
  bo15rs: "bo15 + 65-day return beats Nifty",
  bo15rsb: "bo15rs + breadth >= 50%",
  bo15rsbTight: "bo15rsb + base range <= 15%",
  bo15rsbStack: "bo15rsb + EMA 21>50>200",
  alert: "Alert at base high (stop-buy) + RS + breadth",
};
const EXITS = {
  fix8: "Stop -3%, target +8%, 30 days",
  fix6: "Stop -3%, target +6%, 30 days",
  atr: "Stop 1.5 ATR, half 2R (SL to cost), rest 3R, 30 days",
  trend: "Stop -3%, exit on close < EMA21 (next open), 60 days",
};

function emaSeries(v, n) {
  const k = 2 / (n + 1), out = new Float64Array(v.length);
  let e = v[0];
  for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; out[i] = e; }
  return out;
}

function atrSeries(c, n = 14) {
  const out = new Float64Array(c.length);
  let a = 0;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n;
    out[i] = a;
  }
  return out;
}

/** e = entry bar, fill = entry price. A stop and a target inside the same day count as the stop. */
function exitTrade(c, e, fill, mode, ind) {
  let stop, t1 = Infinity, t2 = Infinity, maxHold = 30;
  if (mode === "fix8" || mode === "fix6") { stop = fill * 0.97; t2 = fill * (mode === "fix8" ? 1.08 : 1.06); }
  else if (mode === "atr") { stop = fill - 1.5 * ind.atr[e - 1]; t1 = fill + 2 * (fill - stop); t2 = fill + 3 * (fill - stop); }
  else { stop = fill * 0.97; maxHold = 60; }
  const risk = fill - stop;
  if (!(risk > 0)) return null;
  let half = false, realized = 0, s = stop, exitIndex = -1, exit = "time";
  for (let j = e; j < c.length; j++) {
    const k = c[j];
    const open = j === e ? fill : k.open;
    if (mode === "trend" && j > e && c[j - 1].close < ind.e21[j - 1]) {
      realized += open - fill; exit = "ema"; exitIndex = j; break;
    }
    // Intraday stop-buy fill: the day's low may have come before the fill, so judge that day by its close.
    const intraday = j === e && fill > k.open;
    const low = intraday ? k.close : k.low;
    if (low <= s) { realized += (half ? 0.5 : 1) * ((intraday ? k.close : Math.min(open, s)) - fill); exit = half ? "trailed" : "stop"; exitIndex = j; break; }
    if (!half && k.high >= t1) { realized += 0.5 * (t1 - fill); half = true; s = fill; }
    if (k.high >= t2) { realized += (half ? 0.5 : 1) * (Math.max(open, t2) - fill); exit = "target"; exitIndex = j; break; }
    if (j - e >= maxHold || j === c.length - 1) {
      realized += (half ? 0.5 : 1) * (k.close - fill); exit = j === c.length - 1 ? "open" : "time"; exitIndex = j; break;
    }
  }
  const cost = (fill * CFG.costPercent) / 100;
  return { exitIndex, exit, hold: exitIndex - e, r: (realized - cost) / risk, pct: ((realized - cost) / fill) * 100 };
}

const t0 = Date.now();
const { hist, floor, breadth } = loadBacktestData(CFG);
const nifty = await loadBenchmark();
if (!nifty) throw new Error("Nifty benchmark needed for the RS rule");
const niftyAt = new Map(nifty.map((k, i) => [dayNo(k.t), i]));
const niftyRet65 = (t) => { const i = niftyAt.get(dayNo(t)); return i != null && i >= 65 ? nifty[i].close / nifty[i - 65].close - 1 : null; };
console.log(`Loaded ${hist.size} stocks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const trades = [];
for (const [symbol, c] of hist) {
  if (c.length < CFG.warmup + 5) continue;
  const f = floor.get(symbol), br = breadth.get(symbol);
  const closes = c.map((k) => k.close);
  const ind = { e20: emaSeries(closes, 20), e21: emaSeries(closes, 21), e50: emaSeries(closes, 50), e200: emaSeries(closes, 200), atr: atrSeries(c) };
  const busy = {};
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i]) continue;
    const k = c[i];
    let hi252 = 0; for (let q = i - 251; q <= i; q++) hi252 = Math.max(hi252, c[q].high);
    const screen = k.close >= 0.95 * hi252 && k.close / c[i - 65].close > 1 && k.close > 100
      && ind.e20[i] > ind.e50[i] && k.close > ind.e21[i] && k.volume > 50000;
    if (!screen) continue;
    let baseHi = 0, baseLo = Infinity, vol50 = 0;
    for (let q = i - CFG.baseDays; q < i; q++) { baseHi = Math.max(baseHi, c[q].high); baseLo = Math.min(baseLo, c[q].low); }
    for (let q = i - 50; q < i; q++) vol50 += c[q].volume / 50;
    const vx = vol50 > 0 ? k.volume / vol50 : 0;
    const nr = niftyRet65(k.t);
    const rsOk = nr != null && k.close / c[i - 65].close - 1 > nr;
    const breadthOk = br[i] >= 50;
    const tight = (baseHi - baseLo) / baseHi <= 0.15;
    const stack = ind.e21[i] > ind.e50[i] && ind.e50[i] > ind.e200[i];
    const bo = k.close > baseHi;
    const hits = {
      screen: true,
      bo,
      bo15: bo && vx >= 1.5,
      bo2: bo && vx >= 2,
      bo15rs: bo && vx >= 1.5 && rsOk,
      bo15rsb: bo && vx >= 1.5 && rsOk && breadthOk,
      bo15rsbTight: bo && vx >= 1.5 && rsOk && breadthOk && tight,
      bo15rsbStack: bo && vx >= 1.5 && rsOk && breadthOk && stack,
      // Not broken out yet, within 5% under the base high: alert/stop-buy at the base high.
      alert: !bo && k.close >= baseHi * 0.95 && rsOk && breadthOk,
    };
    for (const [entry, ok] of Object.entries(hits)) {
      if (!ok) continue;
      for (const mode of Object.keys(EXITS)) {
        const id = `${entry}|${mode}`;
        if ((busy[id] ?? -1) >= i) continue;
        let e = -1, fill = 0;
        if (entry === "alert") {
          for (let j = i + 1; j <= Math.min(c.length - 1, i + CFG.entryDays); j++) {
            if (c[j].high < baseHi) continue;
            fill = Math.max(c[j].open, baseHi);
            if (fill <= baseHi * 1.02) e = j; // gapped >2% over the level: don't chase
            break;
          }
        } else { e = i + 1; fill = c[e].open; }
        if (e < 0) { busy[id] = i + CFG.entryDays; continue; }
        const t = exitTrade(c, e, fill, mode, ind);
        busy[id] = t ? t.exitIndex : i + CFG.entryDays;
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
  console.log(`${"Entry".padEnd(44)}${"ALL".padEnd(34)}${"1st half".padEnd(34)}${"2nd half".padEnd(34)}`);
  for (const [entry, name] of Object.entries(ENTRIES)) {
    const l = trades.filter((t) => t.mode === mode && t.entry === entry);
    console.log(`${name.padEnd(44)}${cell(tradeStats(l))}${cell(tradeStats(l.filter((t) => t.entryT < mid)))}${cell(tradeStats(l.filter((t) => t.entryT >= mid)))}`);
  }
  console.log();
}
console.log("Cells: trades, win rate, average R after costs, average % per trade after costs, profit factor.\n");

// Year-by-year for the best rows, to see whether an edge is steady or one lucky stretch.
const ranked = Object.keys(ENTRIES).flatMap((entry) => Object.keys(EXITS).map((mode) => {
  const l = trades.filter((t) => t.entry === entry && t.mode === mode);
  return { entry, mode, l, s: tradeStats(l) };
})).filter((x) => x.s?.trades >= 200).sort((a, b) => b.s.avgR - a.s.avgR).slice(0, 3);
for (const { entry, mode, l } of ranked) {
  console.log(`By year · ${ENTRIES[entry]} · exit ${mode}`);
  for (const y of [...new Set(l.map((t) => d(t.entryT).slice(0, 4)))].sort()) console.log(`  ${y}  ${cell(tradeStats(l.filter((t) => d(t.entryT).startsWith(y))))}`);
}
