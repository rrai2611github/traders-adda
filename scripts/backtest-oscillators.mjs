// Walk-forward backtest of the oscillator filters on cached daily candles.
// Usage: node --no-warnings scripts/backtest-oscillators.mjs
// Each day uses only data up to that day's close; trades start the next session.
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { loadBacktestData, simulate, simulateFixed, tradeStats } from "./backtest-common.mjs";

const CFG = {
  warmup: 260,          // sessions before the first signal (200-day MA + RS windows)
  window: 400,          // candles passed to the indicator code, like the live scan's history
  turnoverCr: 5,        // live liquidity floor (median 50-day traded value)
  entryDays: 3,         // stop-buy order lives this many sessions
  maxHold: 30,          // time stop, sessions after entry
  costPercent: 0.25,    // round-trip brokerage, STT, slippage
  baselineEvery: 5,     // baseline samples every Nth session per stock
};

const STRATEGIES = {
  A_buyWatch: "Setup (fresh) + 3-day score >= 11",
  B_setupScore8: "Setup (fresh) + 3-day score >= 8",
  C_setupAny: "Setup (fresh), any score",
  D_scoreOnly: "Fresh score jump >= 11, no setup",
  E_baseline: "Any liquid stock, same entry/exit rules",
  F_strict: "A + RS >= 85 + within 5% of 21 EMA",
};

// Fixed-target exits for the win-rate study: target and stop in units of the app's initial risk (R).
const FIXED = {
  fixed_1R: { targetR: 1, stopR: 1, maxHold: 20 },
  fixed_05R: { targetR: 0.5, stopR: 1, maxHold: 20 },
  fixed_05R_wide: { targetR: 0.5, stopR: 2, maxHold: 30 },
};
const MODES = ["targets", "trail", ...Object.keys(FIXED)];

if (isMainThread) await main();
else await work();

async function main() {
  const t0 = Date.now();
  const { hist, floor, rs, breadth, holidays } = loadBacktestData(CFG);
  console.log(`Loaded ${hist.size} stocks, ${holidays.size} holiday placeholders removed, prep ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const symbols = [...hist.keys()].filter((s) => hist.get(s).length > CFG.warmup + 5);
  const n = Math.max(1, Math.min(cpus().length - 2, 14));
  const chunks = Array.from({ length: n }, (_, k) => symbols.filter((_, i) => i % n === k));
  let done = 0;
  const results = await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), {
      workerData: { items: chunk.map((s) => [s, hist.get(s), floor.get(s), rs.get(s), breadth.get(s)]), CFG },
    });
    w.on("message", (m) => { done++; process.stdout.write(`\rworkers done ${done}/${n}`); resolve(m); });
    w.on("error", reject);
  })));
  const trades = results.flat();
  console.log(`\nSimulated in ${((Date.now() - t0) / 1000).toFixed(0)}s over ${symbols.length} stocks\n`);
  report(trades);
}

function report(trades) {
  const all = trades.flatMap((t) => t.strategies.map((k) => ({ ...t, k })));
  const times = trades.map((t) => t.entryT).sort((a, b) => a - b);
  const mid = times[times.length >> 1];
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  console.log(`Entries ${d(times[0])} to ${d(times.at(-1))} (median ${d(mid)}). Costs ${CFG.costPercent}% per trade included.\n`);

  const stats = tradeStats;
  const f = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
  const row = (name, s) => s
    ? `${name.padEnd(40)} ${String(s.trades).padStart(6)} ${f(s.winRate, 1).padStart(6)}% ${f(s.avgR).padStart(6)}R ${f(s.avgPct).padStart(6)}% ${f(s.pf).padStart(5)} ${f(s.big, 0).padStart(4)}% ${f(s.stopped, 0).padStart(4)}% ${f(s.hold, 1).padStart(5)} ${f(s.maxDdR, 1).padStart(7)}R`
    : `${name.padEnd(40)} no trades`;
  const header = `${"Strategy".padEnd(40)} ${"Trades".padStart(6)} ${"Win".padStart(7)} ${"AvgR".padStart(7)} ${"Avg%".padStart(7)} ${"PF".padStart(5)} ${">=2R".padStart(5)} ${"SL".padStart(5)} ${"Hold".padStart(5)} ${"MaxDD".padStart(8)}`;
  const table = (label, filter) => {
    console.log(label); console.log(header);
    for (const [k, name] of Object.entries(STRATEGIES)) console.log(row(`${k.split("_")[0]} ${name}`, stats(all.filter((t) => t.k === k && filter(t)))));
    console.log();
  };
  const cell = (s) => (s ? `${String(s.trades).padStart(5)} ${f(s.winRate, 0).padStart(3)}% ${f(s.avgR).padStart(5)}R ${f(s.pf).padStart(4)}` : "    -").padEnd(24);
  const healthy = (t) => t.breadth >= 50;
  console.log(`${"Exit".padEnd(15)}${"Filter".padEnd(44)}${"ALL MARKETS".padEnd(24)}${"BREADTH>=50%".padEnd(24)}${"  ..1st half".padEnd(24)}${"  ..2nd half".padEnd(24)}`);
  console.log(`${"".padEnd(59)}${"  trades win  avgR   PF  ".repeat(4)}`);
  for (const mode of MODES) {
    for (const [k, name] of Object.entries(STRATEGIES)) {
      const l = all.filter((t) => t.mode === mode && t.k === k);
      console.log(`${mode.padEnd(15)}${`${k.split("_")[0]} ${name}`.padEnd(44)}${cell(stats(l))}${cell(stats(l.filter(healthy)))}${cell(stats(l.filter((t) => healthy(t) && t.entryT < mid)))}${cell(stats(l.filter((t) => healthy(t) && t.entryT >= mid)))}`);
    }
    console.log();
  }  console.log("Win = closed with profit after costs. AvgR = average result in units of initial risk. PF = gross profit / gross loss.");
  console.log(">=2R = share of trades making at least 2R. SL = stopped at the initial SL. MaxDD = worst run of summed R, 1R risk per trade.");
}
async function work() {
  const { items, CFG: cfg } = workerData;
  const { measureMomentumOscillator } = await import("../src/lib/screen/oscillators.ts");
  const { scoreOscillators } = await import("../src/lib/screen/oscillatorScore.ts");
  const settled = { dateKey: "2099-01-01", progress: 1 };
  const out = [];
  for (const [symbol, c, floor, rs, breadth] of items) {
    const closes = c.map((k) => k.close);
    const pre = [0]; for (const x of closes) pre.push(pre.at(-1) + x);
    const sma = (i, n) => (i + 1 >= n ? (pre[i + 1] - pre[i + 1 - n]) / n : null);
    const busyUntil = {}; // strategy -> index until which a trade is pending or open
    for (let i = cfg.warmup; i < c.length - 1; i++) {
      if (!floor[i]) continue;
      const slice = c.slice(Math.max(0, i + 1 - cfg.window), i + 1);
      const ma50 = sma(i, 50), ma200 = sma(i, 200);
      const metrics = {
        passesFloor: true, rs: rs[i] || null,
        vs50: ma50 ? ((c[i].close - ma50) / ma50) * 100 : null,
        vs200: ma200 ? ((c[i].close - ma200) / ma200) * 100 : null,
      };
      const baselineDay = i % cfg.baselineEvery === 0;
      const mom = measureMomentumOscillator(slice, metrics, settled);
      const setupFresh = mom?.fresh === true;
      const sc = scoreOscillators(slice, settled);
      if (!sc?.levels) continue;
      const hits = [];
      if (setupFresh && sc.score >= 11) hits.push("A_buyWatch");
      if (setupFresh && sc.score >= 8) hits.push("B_setupScore8");
      if (setupFresh) hits.push("C_setupAny");
      if (!mom && sc.freshJump && sc.score >= 11) hits.push("D_scoreOnly");
      if (baselineDay) hits.push("E_baseline");
      if (setupFresh && sc.score >= 11 && metrics.rs >= 85 && mom.aboveEma21Percent <= 5) hits.push("F_strict");
      for (const mode of MODES) {
        const free = hits.filter((k) => (busyUntil[mode + k] ?? -1) < i);
        if (!free.length) continue;
        const trade = mode.startsWith("fixed") ? simulateFixed(c, i, sc.levels, cfg, FIXED[mode]) : simulate(c, i, sc.levels, cfg, mode);
        const until = trade ? trade.exitIndex : i + cfg.entryDays;
        for (const k of free) busyUntil[mode + k] = until;
        if (trade) out.push({ symbol, mode, breadth: breadth[i], signalT: c[i].t, entryT: trade.entryT, r: trade.r, pct: trade.pct, hitT1: trade.hitT1, exit: trade.exit, hold: trade.hold, strategies: free });
      }
    }
  }
  parentPort.postMessage(out);
}
