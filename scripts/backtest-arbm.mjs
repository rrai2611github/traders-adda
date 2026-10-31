// Walk-forward backtest of GainzAlgo's open-source "Adaptive Regression Breakout Map" (ARBM), long side.
// Usage: node --use-system-ca --no-warnings scripts/backtest-arbm.mjs
// Logic copied from the published Pine source (defaults): 50-bar linear regression of close
// ± 2 standard deviations; squeeze = bandwidth in the bottom 20% of its 100-bar range;
// signal = close crosses above the upper band while the previous bar was in a squeeze.
// Trade map: stop = previous lower band, TP1/2/3 = entry + 1/2/3 × previous bandwidth;
// TP1 moves the stop to entry, TP2 moves it to TP1, TP3 closes. No time stop in the original.
import { loadBacktestData, tradeStats } from "./backtest-common.mjs";

const CFG = { warmup: 260, turnoverCr: 5, costPercent: 0.25, length: 50, devMult: 2, sqzLen: 100, sqzPct: 20, tp: [1, 2, 3] };

const VARIANTS = {
  exact: "As published: fill at signal close, no time stop",
  nextOpen: "Fill at next open",
  nextOpen60: "Fill at next open, 60-session time stop",
  breadth: "nextOpen60 + breadth >= 50%",
  trend: "breadth + close > 200 SMA",
};

/** Pine ta.linreg(close, n, 0), ta.stdev(close, n) (population) and the band series. */
function bands(c) {
  const n = CFG.length, N = c.length;
  const upper = new Float64Array(N).fill(NaN), lower = new Float64Array(N).fill(NaN), width = new Float64Array(N).fill(NaN);
  const sx = (n * (n - 1)) / 2, sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  for (let i = n - 1; i < N; i++) {
    let sy = 0, sxy = 0, syy = 0;
    for (let k = 0; k < n; k++) { const y = c[i - n + 1 + k].close; sy += y; sxy += k * y; syy += y * y; }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const reg = (sy - b * sx) / n + b * (n - 1);
    const mean = sy / n;
    const sd = Math.sqrt(Math.max(0, syy / n - mean * mean));
    upper[i] = reg + CFG.devMult * sd; lower[i] = reg - CFG.devMult * sd; width[i] = upper[i] - lower[i];
  }
  const squeeze = new Uint8Array(N);
  for (let i = n - 1 + CFG.sqzLen - 1; i < N; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let k = i - CFG.sqzLen + 1; k <= i; k++) { lo = Math.min(lo, width[k]); hi = Math.max(hi, width[k]); }
    squeeze[i] = ((width[i] - lo) / Math.max(hi - lo, 1e-6)) * 100 <= CFG.sqzPct ? 1 : 0;
  }
  return { upper, lower, width, squeeze };
}

/** Long trade from bar e at `fill`; stop and targets fixed from the signal bar i. */
function manage(c, i, e, fill, b, maxHold) {
  const stop0 = b.lower[i - 1];
  const tp = CFG.tp.map((m) => c[i].close + m * b.width[i - 1]);
  if (!(fill > stop0)) return null;
  let sl = stop0, tp1 = false, tp2 = false, px = null, exit = "open", exitIndex = c.length - 1;
  for (let j = e; j < c.length; j++) {
    const k = c[j];
    const open = j === e ? fill : k.open;
    // Bar-close fill: the signal bar's range is already spent, so management starts next bar.
    if (j === e && e === i) continue;
    // Conservative: a stop inside the same bar as a target counts first.
    if (k.low <= sl) { px = Math.min(open, sl); exit = tp2 ? "trail TP1" : tp1 ? "breakeven" : "stop"; exitIndex = j; break; }
    if (k.high >= tp[2]) { px = Math.max(open, tp[2]); exit = "TP3"; exitIndex = j; break; }
    if (!tp2 && k.high >= tp[1]) { tp1 = tp2 = true; sl = tp[0]; }
    else if (!tp1 && k.high >= tp[0]) { tp1 = true; sl = fill; }
    if (maxHold && j - e >= maxHold) { px = k.close; exit = "time"; exitIndex = j; break; }
  }
  if (px == null) px = c[c.length - 1].close;
  const risk = fill - stop0, cost = (fill * CFG.costPercent) / 100;
  return { exitIndex, exit, hitTp1: tp1, hold: exitIndex - e, r: (px - fill - cost) / risk, pct: ((px - fill - cost) / fill) * 100, riskPct: (risk / fill) * 100 };
}

const t0 = Date.now();
const { hist, floor, breadth } = loadBacktestData(CFG);
const trades = [];
for (const [symbol, c] of hist) {
  if (c.length < CFG.warmup + 5) continue;
  const f = floor.get(symbol), br = breadth.get(symbol), b = bands(c);
  const pre = [0]; for (const k of c) pre.push(pre.at(-1) + k.close);
  const busy = {};
  for (let i = CFG.warmup; i < c.length - 1; i++) {
    if (!f[i]) continue;
    const signal = c[i].close > b.upper[i] && c[i - 1].close <= b.upper[i - 1] && b.squeeze[i - 1];
    if (!signal) continue;
    const sma200 = (pre[i + 1] - pre[i - 199]) / 200;
    const ok = { exact: true, nextOpen: true, nextOpen60: true, breadth: br[i] >= 50, trend: br[i] >= 50 && c[i].close > sma200 };
    for (const v of Object.keys(VARIANTS)) {
      if (!ok[v] || (busy[v] ?? -1) >= i) continue;
      const t = v === "exact" ? manage(c, i, i, c[i].close, b, 0) : manage(c, i, i + 1, c[i + 1].open, b, v === "nextOpen" ? 0 : 60);
      if (!t) continue;
      busy[v] = t.exitIndex;
      trades.push({ symbol, v, entryT: c[i].t, ...t });
    }
  }
}

const times = trades.map((t) => t.entryT).sort((a, b) => a - b);
const mid = times[times.length >> 1];
const d = (t) => new Date(t).toISOString().slice(0, 10);
const fx = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
const cell = (s) => (s ? `${String(s.trades).padStart(6)} ${fx(s.winRate, 0).padStart(3)}% ${fx(s.avgR).padStart(5)}R ${fx(s.avgPct).padStart(6)}% ${fx(s.pf).padStart(4)}` : "      -").padEnd(36);
console.log(`ARBM long side, ${((Date.now() - t0) / 1000).toFixed(0)}s, signals ${d(times[0])} to ${d(times.at(-1))}, split ${d(mid)}, costs ${CFG.costPercent}%\n`);
console.log(`${"Variant".padEnd(52)}${"ALL".padEnd(36)}${"1st half".padEnd(36)}${"2nd half".padEnd(36)}`);
for (const [v, name] of Object.entries(VARIANTS)) {
  const l = trades.filter((t) => t.v === v);
  console.log(`${name.padEnd(52)}${cell(tradeStats(l))}${cell(tradeStats(l.filter((t) => t.entryT < mid)))}${cell(tradeStats(l.filter((t) => t.entryT >= mid)))}`);
}
console.log("\nCells: trades, real win rate (profit after costs), average R, average % per trade, profit factor.\n");
for (const [v, name] of Object.entries(VARIANTS)) {
  const l = trades.filter((t) => t.v === v);
  if (!l.length) continue;
  const dash = (l.filter((t) => t.hitTp1 || t.exit === "TP3").length / l.length) * 100;
  const exits = Object.entries(l.reduce((m, t) => ({ ...m, [t.exit]: (m[t.exit] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${((n / l.length) * 100).toFixed(0)}%`).join(", ");
  const medRisk = l.map((t) => t.riskPct).sort((a, b) => a - b)[l.length >> 1];
  const hold = l.reduce((a, t) => a + t.hold, 0) / l.length;
  console.log(`${name}: dashboard "win rate" ${dash.toFixed(0)}% · median stop ${medRisk.toFixed(1)}% · avg hold ${hold.toFixed(0)} sessions · exits: ${exits}`);
}
console.log();
for (const v of ["nextOpen60", "breadth", "trend"]) {
  const l = trades.filter((t) => t.v === v);
  console.log(`By year · ${VARIANTS[v]}`);
  for (const y of [...new Set(l.map((t) => d(t.entryT).slice(0, 4)))].sort()) console.log(`  ${y}  ${cell(tradeStats(l.filter((t) => d(t.entryT).startsWith(y))))}`);
}
