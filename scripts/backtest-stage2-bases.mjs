// Walk-forward backtest of the Stage 2 Bases screen (src/lib/screen/stage2Bases.ts, the exact shipped rules).
// Question: does the "quality" flag (base a breakout with volume >= 1.5x, and does a depth cap add anything) pick better breakouts?
// Entry on the next open after the signal close; every signal uses only candles up to that close.
// Usage: node --use-system-ca --no-warnings scripts/backtest-stage2-bases.mjs
import { loadBacktestData, tradeStats } from "./backtest-common.mjs";
import { measureStage2Base, inStage2Trend, STAGE2_BASE_RULES } from "../src/lib/screen/stage2Bases.ts";

const CFG = { warmup: 260, turnoverCr: 5, costPercent: 0.25, window: 260 };
const R = STAGE2_BASE_RULES;

const ENTRIES = {
  control: "Control: any liquid stock in a Stage 2 trend",
  forming3: "Forming base, within 3% of its high",
  forming3q: "Forming base, within 3% of its high, depth <= 35%",
  breakout: "ALL base breakouts (20+ sessions)",
  quality: "Breakout, QUALITY (volume >= 1.5x, as shipped)",
  depthOnly: "Breakout, depth <= 35% (any volume)",
  both: "Breakout, depth <= 35% AND volume >= 1.5x",
  shallowVol3: "Breakout, depth <= 25% and volume >= 2x",
  deep: "Breakout, depth > 35%",
  thin: "Breakout, thin volume (< 1.5x)",
};
const EXITS = {
  fix: "Stop -8%, target +16%, 40 days",
  ema50: "Stop -8%, exit on close under the 50-day average, 120 days",
  hold20: "No stop: sell at the close of the 20th session",
};

function smaSeries(v, n) {
  const out = new Float64Array(v.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < v.length; i++) { sum += v[i]; if (i >= n) sum -= v[i - n]; if (i >= n - 1) out[i] = sum / n; }
  return out;
}

function exitTrade(c, e, fill, mode, sma50) {
  let stop = mode === "hold20" ? 0 : fill * 0.92, target = mode === "fix" ? fill * 1.16 : Infinity;
  const maxHold = mode === "fix" ? 40 : mode === "ema50" ? 120 : 20;
  const risk = fill * 0.08; // 1R is the -8% stop for every exit, so R is comparable across exits.
  let px = null, exitIndex = -1, exit = "time";
  for (let j = e; j < c.length; j++) {
    const k = c[j];
    const open = j === e ? fill : k.open;
    if (mode === "ema50" && j > e && c[j - 1].close < sma50[j - 1]) { px = open; exit = "ema"; exitIndex = j; break; }
    const low = j === e ? Math.min(k.low, fill) : k.low;
    if (low <= stop && stop > 0) { px = Math.min(open, stop); exit = "stop"; exitIndex = j; break; }
    if (k.high >= target) { px = Math.max(open, target); exit = "target"; exitIndex = j; break; }
    if (j - e >= maxHold || j === c.length - 1) { px = k.close; exit = j === c.length - 1 ? "open" : "time"; exitIndex = j; break; }
  }
  if (px == null) return null;
  const cost = (fill * CFG.costPercent) / 100;
  return { exitIndex, exit, hold: exitIndex - e, r: (px - fill - cost) / risk, pct: ((px - fill - cost) / fill) * 100 };
}

const t0 = Date.now();
const { hist, floor } = loadBacktestData(CFG);
console.log(`Loaded ${hist.size} stocks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const trades = [];
for (const [symbol, c] of hist) {
  if (c.length < CFG.warmup + 5) continue;
  const f = floor.get(symbol);
  const sma50 = smaSeries(c.map((k) => k.close), 50);
  const busy = {};
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i]) continue;
    const view = c.slice(i - CFG.window + 1, i + 1);
    const base = measureStage2Base(view);
    const hits = {
      control: base != null || ((c[i].close >= R.minPrice && c[i].volume >= R.minVolume) && inStage2Trend(view)),
      forming3: base?.kind === "forming" && base.toHighPercent <= 3,
      forming3q: base?.kind === "forming" && base.toHighPercent <= 3 && base.depthPercent <= R.deepBasePercent,
      breakout: base?.kind === "breakout",
      quality: base?.kind === "breakout" && base.quality,
      depthOnly: base?.kind === "breakout" && base.depthPercent <= R.deepBasePercent,
      both: base?.kind === "breakout" && base.depthPercent <= R.deepBasePercent && base.volumeRatio >= R.confirmVolumeRatio,
      shallowVol3: base?.kind === "breakout" && base.depthPercent <= 25 && base.volumeRatio >= 2,
      deep: base?.kind === "breakout" && base.depthPercent > R.deepBasePercent,
      thin: base?.kind === "breakout" && base.volumeRatio < R.confirmVolumeRatio,
    };
    for (const [entry, ok] of Object.entries(hits)) {
      if (!ok) continue;
      for (const mode of Object.keys(EXITS)) {
        const id = `${entry}|${mode}`;
        if ((busy[id] ?? -1) >= i) continue;
        const e = i + 1, fill = c[e].open;
        const t = exitTrade(c, e, fill, mode, sma50);
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
  console.log(`${"Entry".padEnd(58)}${"ALL".padEnd(34)}${"1st half".padEnd(34)}${"2nd half".padEnd(34)}`);
  for (const [entry, name] of Object.entries(ENTRIES)) {
    const l = trades.filter((t) => t.mode === mode && t.entry === entry);
    console.log(`${name.padEnd(58)}${cell(tradeStats(l))}${cell(tradeStats(l.filter((t) => t.entryT < mid)))}${cell(tradeStats(l.filter((t) => t.entryT >= mid)))}`);
  }
  console.log();
}
console.log("Cells: trades, win rate, average R after costs (1R = the 8% stop), average % per trade after costs, profit factor.\n");
for (const entry of ["breakout", "quality", "thin"]) {
  const l = trades.filter((t) => t.entry === entry && t.mode === "fix");
  console.log(`By year · ${ENTRIES[entry]} · exit fix`);
  for (const y of [...new Set(l.map((t) => d(t.entryT).slice(0, 4)))].sort()) console.log(`  ${y}  ${cell(tradeStats(l.filter((t) => d(t.entryT).startsWith(y))))}`);
}
