// Weak-market watchlist backtest: on days when breadth is below 50%, does a strict
// quality filter on "every check passes except breadth" stocks make money?
// Usage: node --no-warnings scripts/backtest-weak-watch.mjs
// Variants are picked per day from the whole market, one trade per stock at a time,
// top N by RS, T1/T2 exit (half at T1 with stop to cost, rest at T2, 30-day time stop), 0.25% cost.
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { loadBacktestData, loadBenchmark, simulate, tradeStats } from "./backtest-common.mjs";

const CFG = { warmup: 260, window: 800, turnoverCr: 5, entryDays: 3, maxHold: 30, costPercent: 0.25 };

if (isMainThread) await main();
else await work();

async function main() {
  const t0 = Date.now();
  const { hist, floor, rs, breadth } = loadBacktestData(CFG);
  const benchmark = await loadBenchmark();
  const symbols = [...hist.keys()].filter((s) => hist.get(s).length > CFG.warmup + 5);
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
  const cands = results.flat();
  console.log(`\n${cands.length} setup-ready candidates in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

  const byDay = new Map();
  for (const c of cands) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const mid = days[days.length >> 1];
  const quality = (c) => c.turnover >= 40 && c.paScore >= 76 && c.rs >= 75 && c.riskPct <= 6;
  const EMAIL = ["leader", "fall4", "ath"];
  const variants = [
    ["Weak, all scanners, top 5", (c) => c.breadth < 50, 5],
    ["Weak, email scanners, top 5", (c) => c.breadth < 50 && c.scanners.some((k) => EMAIL.includes(k)), 5],
    ["Weak, quality filter, top 5", (c) => c.breadth < 50 && quality(c), 5],
    ["Weak, quality filter, top 3", (c) => c.breadth < 50 && quality(c), 3],
    ["Weak, quality filter, top 1", (c) => c.breadth < 50 && quality(c), 1],
    ["Weak, quality + 2+ scanners, top 5", (c) => c.breadth < 50 && quality(c) && c.scanners.length >= 2, 5],
    ["Weak <35%, quality filter, top 5", (c) => c.breadth < 35 && quality(c), 5],
    ["Weak 35-49%, quality filter, top 5", (c) => c.breadth >= 35 && c.breadth < 50 && quality(c), 5],
    ["Healthy, all scanners, top 5", (c) => c.breadth >= 50, 5],
    ["Healthy, quality filter, top 5", (c) => c.breadth >= 50 && quality(c), 5],
  ];
  const f = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
  const cell = (s) => (s ? `${String(s.trades).padStart(5)} ${f(s.winRate, 0).padStart(3)}% ${f(s.avgR).padStart(5)}R ${f(s.pf).padStart(4)}` : "     -").padEnd(26);
  console.log(`${"Variant".padEnd(38)}${"ALL".padEnd(26)}${"1st half".padEnd(26)}${"2nd half".padEnd(26)}`);
  for (const [name, keep, top] of variants) {
    const busy = new Map();
    const trades = [];
    for (const day of days) {
      const pool = byDay.get(day).filter(keep).sort((a, b) => b.rs - a.rs || a.symbol.localeCompare(b.symbol));
      let taken = 0;
      for (const c of pool) {
        if (taken >= top) break;
        if ((busy.get(c.symbol) ?? -1) >= day) continue;
        taken++;
        busy.set(c.symbol, c.trade ? c.trade.exitDay : day + CFG.entryDays);
        if (c.trade) trades.push({ ...c.trade, day });
      }
    }
    console.log(`${name.padEnd(38)}${cell(tradeStats(trades))}${cell(tradeStats(trades.filter((t) => t.day < mid)))}${cell(tradeStats(trades.filter((t) => t.day >= mid)))}`);
  }
  console.log("\nCells: trades, win rate, average R after costs, profit factor.");
}

async function work() {
  const { items, CFG: cfg, benchmark: benchCandles } = workerData;
  const { runScanners, SCANNER_KEYS, benchmarkCloses } = await import("../src/lib/screen/chartinkScans.ts");
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
    for (let i = cfg.warmup; i < c.length - 1; i++) {
      if (!floor[i] || !(breadth[i] >= 0)) continue;
      const slice = c.slice(Math.max(0, i + 1 - cfg.window), i + 1);
      const hits = runScanners(symbol, slice, { rs: rs[i] || null, benchmark }, settled);
      const found = SCANNER_KEYS.filter((k) => hits[k]);
      if (!found.length) continue;
      const sc = scoreOscillators(slice, settled);
      if (!sc?.levels) continue;
      const ma50 = sma(i, 50), ma200 = sma(i, 200);
      const ctx = {
        breadthPercent: breadth[i], passesFloor: true, rs: rs[i] || null, score: sc.score,
        vs50: ma50 ? (c[i].close / ma50 - 1) * 100 : null,
        vs200: ma200 ? (c[i].close / ma200 - 1) * 100 : null,
        aboveEma21: e21[i] ? (c[i].close / e21[i] - 1) * 100 : null,
        atr: sc.levels.atr, candles: slice,
      };
      const ready = [];
      let plan = null;
      for (const k of found) {
        const a = assessBuyReady(k, hits[k], ctx);
        if (a.plan && a.setupReady) { ready.push(k); plan ??= a.plan; }
      }
      if (!plan) continue;
      const turn = c.slice(i - 49, i + 1).map((k) => (k.close * k.volume) / 1e7).sort((a, b) => a - b);
      const turnover = (turn[24] + turn[25]) / 2;
      const pa = priceActionRating(slice, turnover);
      const trade = simulate(c, i, plan, cfg, "targets");
      out.push({
        symbol, day: i === 0 ? 0 : Math.floor(c[i].t / 864e5), breadth: breadth[i], rs: rs[i] || 0, turnover,
        paScore: pa.score ?? 0, riskPct: plan.riskPercent ?? ((plan.entry - plan.stop) / plan.entry) * 100, scanners: ready,
        trade: trade && { r: trade.r, pct: trade.pct, exitDay: Math.floor(c[trade.exitIndex].t / 864e5) },
      });
    }
  }
  parentPort.postMessage(out);
}
