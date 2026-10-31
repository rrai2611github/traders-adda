// Walk-forward backtest of the Chartink scanners, raw versus the app's Buy-ready filter.
// Usage: node --no-warnings scripts/backtest-scanners.mjs [--write]
// --write saves the per-scanner stats to src/lib/screen/scannerBacktest.json for the app.
// BT_VARIANTS=1 adds rows with single checks switched off.
// Each day uses only candles up to that day's close; trades are stop-buys over the next sessions.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { ROOT, loadBacktestData, loadBenchmark, simulate, simulateFixed, tradeStats } from "./backtest-common.mjs";

const CFG = {
  warmup: 260,
  // Full history, so the all-time-high scan sees every earlier high as the live app does.
  window: 800,
  // BT_FLOOR / BT_COST let a run test a lower liquidity floor or higher costs (default: the live ₹5 Cr floor).
  turnoverCr: Number(process.env.BT_FLOOR ?? 5),
  entryDays: 3,
  maxHold: 30,
  costPercent: Number(process.env.BT_COST ?? 0.25),
};
const EXITS = {
  targets: "Half at 2R (SL to cost), rest at 3R, 30-day time stop",
  highwin: "Target +0.5R, SL -2R, 30-day time stop",
  atr3r: "Next open, stop 2 x ATR, target 3R, 40-day time stop",
};
const LEVELS = ["raw", "setup", "ready", ...(process.env.BT_VARIANTS ? ["noScore", "noExt", "noScoreExt", "noRs"] : [])];
const LEVEL_NAMES = { raw: "Screener hit (liquid)", setup: "All checks except breadth", ready: "Buy-ready (all checks)", noScore: "..without score", noExt: "..without extension", noScoreExt: "..without score+ext", noRs: "..without RS" };

if (isMainThread) await main();
else await work();

async function main() {
  const t0 = Date.now();
  const { hist, floor, rs, breadth } = loadBacktestData(CFG);
  const benchmark = await loadBenchmark();
  const symbols = [...hist.keys()].filter((s) => hist.get(s).length > CFG.warmup + 5);
  console.log(`Loaded ${hist.size} stocks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const n = Math.max(1, Math.min(cpus().length - 2, 14));
  const chunks = Array.from({ length: n }, (_, k) => symbols.filter((_, i) => i % n === k));
  let done = 0;
  const results = await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), {
      workerData: { items: chunk.map((s) => [s, hist.get(s), floor.get(s), rs.get(s), breadth.get(s)]), CFG, benchmark },
    });
    w.on("message", (m) => { done++; process.stdout.write(`\rworkers done ${done}/${n}`); resolve(m); });
    w.on("error", reject);
  })));
  const trades = results.flat();
  console.log(`\nSimulated in ${((Date.now() - t0) / 1000).toFixed(0)}s over ${symbols.length} stocks, costs ${CFG.costPercent}% per trade\n`);

  const times = trades.map((t) => t.entryT).sort((a, b) => a - b);
  const mid = times[times.length >> 1];
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  console.log(`Entries ${d(times[0])} to ${d(times.at(-1))}, split at ${d(mid)}\n`);
  const f = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
  const cell = (s) => (s ? `${String(s.trades).padStart(5)} ${f(s.winRate, 0).padStart(3)}% ${f(s.avgR).padStart(5)}R ${f(s.pf).padStart(4)}` : "     -").padEnd(26);
  const keys = [...new Set(trades.map((t) => t.scanner))].sort();
  for (const [mode, desc] of Object.entries(EXITS)) {
    console.log(`EXIT ${mode}: ${desc}`);
    console.log(`${"Scanner".padEnd(8)}${"Filter".padEnd(28)}${"ALL".padEnd(26)}${"1st half".padEnd(26)}${"2nd half".padEnd(26)}`);
    for (const k of keys) {
      for (const lvl of LEVELS) {
        const l = trades.filter((t) => t.mode === mode && t.scanner === k && t.level === lvl);
        console.log(`${k.padEnd(8)}${LEVEL_NAMES[lvl].padEnd(28)}${cell(tradeStats(l))}${cell(tradeStats(l.filter((t) => t.entryT < mid)))}${cell(tradeStats(l.filter((t) => t.entryT >= mid)))}`);
      }
    }
    console.log();
  }
  console.log("Cells: trades, win rate, average R after costs, profit factor. ANY = one trade per stock when any alert scanner (range, nr7, fall4) is Buy-ready.\n");

  // Does the Price Action Rating sort scanner trades? T1/T2 exit, liquid hits and ready-except-breadth.
  const byScanner = (level, keys) => trades.filter((t) => t.mode === "targets" && t.level === level && keys.includes(t.scanner));
  const allKeys = keys.filter((k) => k !== "ANY");
  for (const [title, list] of [["All scanners, liquid hits", byScanner("raw", allKeys)], ["All scanners, all checks but breadth", byScanner("setup", allKeys)]]) {
    console.log(`PA grade · ${title}`);
    for (const g of ["A+", "A", "B", "C", "D", null]) {
      const l = list.filter((t) => t.pa === g);
      console.log(`${String(g ?? "n/r").padEnd(6)}${cell(tradeStats(l))}${cell(tradeStats(l.filter((t) => t.entryT < mid)))}${cell(tradeStats(l.filter((t) => t.entryT >= mid)))}`);
    }
    console.log();
  }
  if (CFG.turnoverCr < 5) {
    // Liquidity bands: do stocks under the live ₹5 Cr floor trade as well as the ones above it?
    const bands = [["₹1-2 Cr", 0, 2], ["₹2-5 Cr", 2, 5], ["₹5-20 Cr", 5, 20], ["₹20 Cr+", 20, Infinity]];
    for (const level of ["raw", "ready"]) {
      console.log(`Liquidity bands · all scanners · ${LEVEL_NAMES[level]} · T1/T2 exit`);
      for (const [label, lo, hi] of bands) {
        const l = trades.filter((t) => t.mode === "targets" && t.level === level && t.scanner !== "ANY" && t.turn >= lo && t.turn < hi);
        console.log(`${label.padEnd(10)}${cell(tradeStats(l))}${cell(tradeStats(l.filter((t) => t.entryT < mid)))}${cell(tradeStats(l.filter((t) => t.entryT >= mid)))}`);
      }
      console.log();
    }
  }
  // Scanner hits by market breadth on the signal day (all liquid hits), ATR stop and the app's own T1/T2 plan.
  for (const mode of ["atr3r", "targets"]) {
    console.log(`=== BY BREADTH: scanner hits, exit ${mode} (${EXITS[mode]}) ===`);
    console.log(`${"Scanner".padEnd(10)}${"under 50%".padEnd(26)}${"50-60%".padEnd(26)}${"60%+".padEnd(26)}`);
    for (const k of keys.filter((x) => x !== "ANY")) {
      const l = trades.filter((t) => t.mode === mode && t.scanner === k && t.level === "raw" && t.br != null);
      console.log(`${k.padEnd(10)}${cell(tradeStats(l.filter((t) => t.br < 50)))}${cell(tradeStats(l.filter((t) => t.br >= 50 && t.br < 60)))}${cell(tradeStats(l.filter((t) => t.br >= 60)))}`);
    }
    const all = trades.filter((t) => t.mode === mode && t.scanner !== "ANY" && t.level === "raw" && t.br != null);
    console.log(`${"ALL".padEnd(10)}${cell(tradeStats(all.filter((t) => t.br < 50)))}${cell(tradeStats(all.filter((t) => t.br >= 50 && t.br < 60)))}${cell(tradeStats(all.filter((t) => t.br >= 60)))}
`);
  }
  if (process.env.BT_TRADES) writeFileSync(process.env.BT_TRADES, JSON.stringify(trades));

  if (process.argv.includes("--write")) {
    const brief = (l) => {
      const s = tradeStats(l);
      return s && { trades: s.trades, winRate: +s.winRate.toFixed(1), avgR: +s.avgR.toFixed(2), profitFactor: Number.isFinite(s.pf) ? +s.pf.toFixed(2) : null };
    };
    const scanners = {};
    for (const k of keys) {
      scanners[k] = {};
      for (const lvl of ["raw", "ready"]) {
        scanners[k][lvl] = {};
        for (const mode of Object.keys(EXITS)) {
          const l = trades.filter((t) => t.mode === mode && t.scanner === k && t.level === lvl);
          scanners[k][lvl][mode] = { all: brief(l), firstHalf: brief(l.filter((t) => t.entryT < mid)), secondHalf: brief(l.filter((t) => t.entryT >= mid)) };
        }
      }
    }
    const file = join(ROOT, "src", "lib", "screen", "scannerBacktest.json");
    const payload = { generatedAt: new Date().toISOString(), from: d(times[0]), to: d(times.at(-1)), split: d(mid), costPercent: CFG.costPercent, exits: EXITS, scanners };
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Wrote ${file}`);
  }
}

/** Next open after the signal close, stop 2 x ATR below, one 3R target, 40-session time stop. */
function simulateAtr(c, i, atr, cfg) {
  const e = i + 1;
  if (!(atr > 0) || e >= c.length) return null;
  const fill = c[e].open;
  if (fill > c[i].close * 1.05) return null;
  const risk = 2 * atr, stop = fill - risk, target = fill + 3 * risk;
  if (risk / fill > 0.12) return null;
  let px = null, exitIndex = -1, exit = "time";
  for (let j = e; j < c.length; j++) {
    const k = c[j], open = j === e ? fill : k.open, low = j === e ? Math.min(k.low, fill) : k.low;
    if (low <= stop) { px = Math.min(open, stop); exit = "stop"; exitIndex = j; break; }
    if (k.high >= target) { px = Math.max(open, target); exit = "target"; exitIndex = j; break; }
    if (j - e >= 40 || j === c.length - 1) { px = k.close; exit = j === c.length - 1 ? "open" : "time"; exitIndex = j; break; }
  }
  const cost = (fill * cfg.costPercent) / 100;
  return { entryT: c[e].t, exitIndex, exit, hitT1: exit === "target", hold: exitIndex - e, r: (px - fill - cost) / risk, pct: ((px - fill - cost) / fill) * 100 };
}

async function work() {
  const { items, CFG: cfg, benchmark: benchCandles } = workerData;
  const { runScanners, SCANNER_KEYS, ALERT_SCANNER_KEYS, benchmarkCloses } = await import("../src/lib/screen/chartinkScans.ts");
  const benchmark = benchmarkCloses(benchCandles);
  const { assessBuyReady } = await import("../src/lib/screen/buyReady.ts");
  const { scoreOscillators } = await import("../src/lib/screen/oscillatorScore.ts");
  const { priceActionRating } = await import("../src/lib/screen/priceActionRating.ts");
  const { ema } = await import("../src/lib/screen/oscillators.ts");
  const settled = { dateKey: "2099-01-01", progress: 1 };
  const out = [];
  for (const [symbol, c, floor, rs, breadth] of items) {
    const closes = c.map((k) => k.close);
    const pre = [0]; for (const x of closes) pre.push(pre.at(-1) + x);
    const sma = (i, n) => (i + 1 >= n ? (pre[i + 1] - pre[i + 1 - n]) / n : null);
    const e21 = ema(closes, 21);
    const busyUntil = {};
    for (let i = cfg.warmup; i < c.length - 1; i++) {
      if (!floor[i]) continue;
      const slice = c.slice(Math.max(0, i + 1 - cfg.window), i + 1);
      const hits = runScanners(symbol, slice, { rs: rs[i] || null, benchmark }, settled);
      const found = SCANNER_KEYS.filter((k) => hits[k]);
      if (!found.length) continue;
      const sc = scoreOscillators(slice, settled);
      if (!sc?.levels) continue;
      const turn = c.slice(i - 49, i + 1).map((k) => (k.close * k.volume) / 1e7).sort((a, b) => a - b);
      const medTurn = (turn[24] + turn[25]) / 2;
      const pa = priceActionRating(slice, medTurn).grade;
      const ma50 = sma(i, 50), ma200 = sma(i, 200);
      const ctx = {
        breadthPercent: breadth[i] >= 0 ? breadth[i] : null,
        passesFloor: true,
        rs: rs[i] || null,
        score: sc.score,
        vs50: ma50 ? (c[i].close / ma50 - 1) * 100 : null,
        vs200: ma200 ? (c[i].close / ma200 - 1) * 100 : null,
        aboveEma21: e21[i] ? (c[i].close / e21[i] - 1) * 100 : null,
        atr: sc.levels.atr,
        candles: slice,
      };
      const signals = [];
      let anyReady = null;
      for (const k of found) {
        const a = assessBuyReady(k, hits[k], ctx);
        if (!a.plan) continue;
        signals.push([k, "raw", a.plan]);
        if (a.setupReady) signals.push([k, "setup", a.plan]);
        if (a.buyReady) { signals.push([k, "ready", a.plan]); if (ALERT_SCANNER_KEYS.includes(k)) anyReady ??= a.plan; }
        if (process.env.BT_VARIANTS) {
          const without = (...skip) => a.checks.every((ch) => ch.pass || skip.includes(ch.key));
          if (without("score")) signals.push([k, "noScore", a.plan]);
          if (without("notExtended")) signals.push([k, "noExt", a.plan]);
          if (without("score", "notExtended")) signals.push([k, "noScoreExt", a.plan]);
          if (without("rs")) signals.push([k, "noRs", a.plan]);
        }
      }
      if (anyReady) signals.push(["ANY", "ready", anyReady]);
      for (const mode of Object.keys(EXITS)) {
        for (const [k, level, plan] of signals) {
          const id = `${mode}|${k}|${level}`;
          if ((busyUntil[id] ?? -1) >= i) continue;
          const trade = mode === "highwin"
            ? simulateFixed(c, i, plan, cfg, { targetR: 0.5, stopR: 2, maxHold: 30 })
            : mode === "atr3r" ? simulateAtr(c, i, ctx.atr, cfg) : simulate(c, i, plan, cfg, "targets");
          busyUntil[id] = trade ? trade.exitIndex : i + cfg.entryDays;
          if (trade) out.push({ symbol, mode, scanner: k, level, pa, rs: rs[i], turn: medTurn, entryT: trade.entryT, br: ctx.breadthPercent, r: trade.r, pct: trade.pct, exit: trade.exit, hold: trade.hold });
        }
      }
    }
  }
  parentPort.postMessage(out);
}
