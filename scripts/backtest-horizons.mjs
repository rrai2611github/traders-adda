// Walk-forward backtest of the Short / Mid / Long horizon trade ideas (horizonSignal.ts)
// against holding Nifty 50 over the same dates.
// Usage: node --no-warnings scripts/backtest-horizons.mjs
// Each day uses only candles up to that day's close; orders start the next session.
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { dayNo, loadBacktestData, loadBenchmark, simulate, tradeStats } from "./backtest-common.mjs";

const CFG = {
  warmup: 260,          // sessions before the first signal (200-day MA + RS windows)
  window: 500,          // candles passed to the live metric code per day
  turnoverCr: 5,        // live liquidity floor
  entryDays: 3,         // stop-buy order lives this many sessions
  costPercent: 0.25,    // round-trip brokerage, STT, slippage
};
// Time exit per horizon, in sessions after entry: the holding periods shown in the app.
const MAX_HOLD = { short: 30, mid: 63, long: 250 };
const HORIZONS = ["short", "mid", "long"];

if (isMainThread) await main();
else await work();

async function main() {
  const t0 = Date.now();
  const { hist, floor, rs, breadth } = loadBacktestData(CFG);
  const nifty = await loadBenchmark();
  if (!nifty) throw new Error("Nifty 50 benchmark unavailable.");
  const niftyByDay = new Map(nifty.map((k) => [dayNo(k.t), k]));
  console.log(`Loaded ${hist.size} stocks in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const symbols = [...hist.keys()].filter((s) => hist.get(s).length > CFG.warmup + 5);
  const n = Math.max(1, Math.min(cpus().length - 2, 14));
  const chunks = Array.from({ length: n }, (_, k) => symbols.filter((_, i) => i % n === k));
  let done = 0;
  const results = await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), {
      workerData: { items: chunk.map((s) => [s, hist.get(s), floor.get(s), rs.get(s), breadth.get(s)]), CFG, MAX_HOLD },
    });
    w.on("message", (m) => { done++; process.stdout.write(`\rworkers done ${done}/${n}`); resolve(m); });
    w.on("error", reject);
  })));
  const trades = results.flat();
  console.log(`\nSimulated in ${((Date.now() - t0) / 1000).toFixed(0)}s over ${symbols.length} stocks`);

  // Nifty return over each trade's exact entry → exit dates (entry at the stock's entry day open, exit at the exit day close).
  const niftyDays = [...niftyByDay.keys()].sort((a, b) => a - b);
  const niftyAt = (day, field) => {
    let k = niftyByDay.get(day);
    if (!k) { const prev = niftyDays.filter((d) => d <= day).at(-1); k = prev != null ? niftyByDay.get(prev) : null; }
    return k ? k[field] : null;
  };
  for (const t of trades) {
    const a = niftyAt(dayNo(t.entryT), "open"), b = niftyAt(dayNo(t.exitT), "close");
    t.niftyPct = a && b ? (b / a - 1) * 100 : null;
  }
  await report(trades, nifty);
}

async function report(trades, nifty) {
  const times = trades.map((t) => t.entryT).sort((a, b) => a - b);
  const midT = times[times.length >> 1];
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  const first = nifty.find((k) => k.t >= times[0]), last = nifty.at(-1);
  const years = (last.t - first.t) / (365.25 * 86400e3);
  const niftyCagr = (Math.pow(last.close / first.close, 1 / years) - 1) * 100;
  console.log(`Entries ${d(times[0])} to ${d(times.at(-1))} (split at ${d(midT)}). Costs ${CFG.costPercent}% per trade included.`);
  console.log(`Nifty 50 buy-and-hold over the same span: ${((last.close / first.close - 1) * 100).toFixed(1)}% (${niftyCagr.toFixed(1)}% a year).\n`);

  const f = (x, p = 2) => (x == null ? "-" : Number.isFinite(x) ? x.toFixed(p) : "inf");
  const line = (label, list) => {
    const s = tradeStats(list);
    if (!s) return console.log(`${label.padEnd(34)} no trades`);
    const withNifty = list.filter((t) => t.niftyPct != null);
    const excess = withNifty.reduce((a, t) => a + (t.pct - t.niftyPct), 0) / (withNifty.length || 1);
    const niftyAvg = withNifty.reduce((a, t) => a + t.niftyPct, 0) / (withNifty.length || 1);
    const beat = (withNifty.filter((t) => t.pct > t.niftyPct).length / (withNifty.length || 1)) * 100;
    console.log(`${label.padEnd(34)} ${String(s.trades).padStart(6)} ${f(s.winRate, 0).padStart(4)}% ${f(s.avgR).padStart(6)}R ${f(s.avgPct).padStart(6)}% ${f(niftyAvg).padStart(6)}% ${f(excess).padStart(6)}% ${f(beat, 0).padStart(4)}% ${f(s.pf).padStart(5)} ${f(s.hold, 0).padStart(5)} ${f(s.maxDdR, 0).padStart(6)}R`);
  };
  const header = `${"".padEnd(34)} ${"Trades".padStart(6)} ${"Win".padStart(5)} ${"AvgR".padStart(7)} ${"Avg%".padStart(7)} ${"Nifty%".padStart(7)} ${"vsNif".padStart(7)} ${"Beat".padStart(5)} ${"PF".padStart(5)} ${"Hold".padStart(5)} ${"MaxDD".padStart(7)}`;
  for (const h of HORIZONS) {
    console.log(`== ${h.toUpperCase()} (time exit ${MAX_HOLD[h]} sessions) ==`);
    console.log(header);
    const ready = trades.filter((t) => t.h === h && t.k === "ready");
    const stock = trades.filter((t) => t.h === h && t.k === "stock");
    const base = trades.filter((t) => t.h === h && t.k === "baseline");
    line("App rules (Buy ready)", ready);
    line("  1st half", ready.filter((t) => t.entryT < midT));
    line("  2nd half", ready.filter((t) => t.entryT >= midT));
    line("Stock checks only (no breadth)", stock);
    line("  breadth < 40% days", stock.filter((t) => t.breadth >= 0 && t.breadth < 40));
    line("Baseline: any liquid stock", base);
    console.log();
  }
  console.log("Avg% = average trade return after costs. Nifty% = Nifty 50 return over the same entry-to-exit dates.");
  console.log("vsNif = average excess return over Nifty per trade. Beat = share of trades that beat Nifty over their own dates.");
  console.log("AvgR = average result in units of initial risk. PF = gross profit / gross loss. MaxDD = worst run of summed R at 1R per trade.");

  // Target hit rates: shown next to the reference levels in the app (horizonBacktest.json).
  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
  const pct = (n, of) => Math.round((n / of) * 1000) / 10;
  const targetStats = (list) => {
    if (!list.length) return null;
    const t1 = list.filter((t) => t.t1Days != null);
    const t2 = list.filter((t) => t.exit === "target");
    const s = tradeStats(list);
    return {
      trades: list.length,
      t1HitPercent: pct(t1.length, list.length),
      t1MedianDays: median(t1.map((t) => t.t1Days)),
      t2HitPercent: pct(t2.length, list.length),
      t2MedianDays: median(t2.map((t) => t.hold)),
      stopFirstPercent: pct(list.filter((t) => t.exit === "stop").length, list.length),
      timeExitPercent: pct(list.filter((t) => t.exit === "time" || t.exit === "open").length, list.length),
      avgR: Math.round(s.avgR * 100) / 100,
      winPercent: Math.round(s.winRate),
    };
  };
  const out = { generated: new Date().toISOString().slice(0, 10), from: d(times[0]), to: d(times.at(-1)), costPercent: CFG.costPercent, maxHoldSessions: MAX_HOLD, horizons: {} };
  console.log("\n== TARGET HIT RATES (T1 = half booked, then stop to cost; T2 = rest) ==");
  console.log(`${"".padEnd(34)} ${"Trades".padStart(6)} ${"T1%".padStart(6)} ${"T1 days".padStart(8)} ${"T2%".padStart(6)} ${"T2 days".padStart(8)} ${"Stop%".padStart(6)} ${"Time%".padStart(6)}`);
  for (const h of HORIZONS) {
    const ready = targetStats(trades.filter((t) => t.h === h && t.k === "ready"));
    const stock = targetStats(trades.filter((t) => t.h === h && t.k === "stock"));
    out.horizons[h] = { buyReady: ready, stockChecks: stock };
    for (const [label, s] of [[`${h} Buy ready`, ready], [`${h} stock checks only`, stock]]) {
      if (!s) { console.log(`${label.padEnd(34)} no trades`); continue; }
      console.log(`${label.padEnd(34)} ${String(s.trades).padStart(6)} ${f(s.t1HitPercent, 0).padStart(5)}% ${String(s.t1MedianDays ?? "-").padStart(8)} ${f(s.t2HitPercent, 0).padStart(5)}% ${String(s.t2MedianDays ?? "-").padStart(8)} ${f(s.stopFirstPercent, 0).padStart(5)}% ${f(s.timeExitPercent, 0).padStart(5)}%`);
    }
  }
  // Pattern-height targets vs ours, on identical entries and stops.
  console.log("\n== PATTERN-HEIGHT TARGETS vs CURRENT (same entries and stops; MM1 = pivot + base height) ==");
  console.log(`${"".padEnd(28)} ${"Trades".padStart(6)} ${"MM1 dist".padStart(9)} ${"MM1 R".padStart(6)} | ${"Current".padStart(16)} | ${"All out MM1".padStart(16)} | ${"Half MM1/MM2".padStart(16)} | ${"Half T1/MM1".padStart(16)}`);
  console.log(`${"".padEnd(28)} ${"".padStart(6)} ${"(median)".padStart(9)} ${"(med)".padStart(6)} | ${"AvgR  Win  Tgt%".padStart(16)} | ${"AvgR  Win  Tgt%".padStart(16)} | ${"AvgR  Win  Tgt%".padStart(16)} | ${"AvgR  Win  Tgt%".padStart(16)}`);
  const cell = (xs) => {
    if (!xs.length) return "-".padStart(16);
    const avg = xs.reduce((a, x) => a + x.r, 0) / xs.length;
    const win = (xs.filter((x) => x.r > 0).length / xs.length) * 100;
    const tgt = (xs.filter((x) => x.hitT1).length / xs.length) * 100;
    return `${f(avg).padStart(5)} ${f(win, 0).padStart(3)}% ${f(tgt, 0).padStart(4)}%`;
  };
  for (const h of HORIZONS) {
    for (const k of ["ready", "stock"]) {
      const all = trades.filter((t) => t.h === h && t.k === k);
      const list = all.filter((t) => t.mm?.full && t.mm.split && t.mm.hybrid);
      for (const [label, xs] of [[`${h} ${k === "ready" ? "Buy ready" : "stock checks"}`, list], ["  1st half", list.filter((t) => t.entryT < midT)], ["  2nd half", list.filter((t) => t.entryT >= midT)]]) {
        if (!xs.length) { console.log(`${label.padEnd(28)} no trades`); continue; }
        const head = `${label.padEnd(28)} ${String(xs.length).padStart(6)} ${(f(median(xs.map((t) => t.mm.mm1Pct)), 1) + "%").padStart(9)} ${f(median(xs.map((t) => t.mm.mm1R)), 1).padStart(6)}`;
        console.log(`${head} | ${cell(xs)} | ${cell(xs.map((t) => t.mm.full))} | ${cell(xs.map((t) => t.mm.split))} | ${cell(xs.map((t) => t.mm.hybrid))}`);
      }
      if (all.length) console.log(`${"".padEnd(28)} (${all.length - list.length} of ${all.length} trades had no usable base height)`);
    }
  }
  console.log("Tgt% = share of trades that reached the first target (T1 or MM1). Current = half at T1, rest at T2.");

  if (process.argv.includes("--write")) {
    const { writeFileSync } = await import("node:fs");
    const file = fileURLToPath(new URL("../src/lib/screen/horizonBacktest.json", import.meta.url));
    writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    console.log(`\nWrote ${file}`);
  }
}

async function work() {
  const { items, CFG: cfg, MAX_HOLD: maxHold } = workerData;
  // metrics.ts uses the app's extensionless and "@/" imports; resolve them like the bundler does.
  const { registerHooks } = await import("node:module");
  const srcUrl = new URL("../src/", import.meta.url).href;
  registerHooks({
    resolve(specifier, context, next) {
      const spec = specifier.startsWith("@/") ? srcUrl + specifier.slice(2) : specifier;
      try { return next(spec, context); } catch (error) {
        if (!/^(\.|file:)/.test(spec) || /\.\w+$/.test(spec)) throw error;
        return next(`${spec}.ts`, context);
      }
    },
  });
  const { computeMetrics } = await import("../src/lib/screen/metrics.ts");
  const { scoreOscillators } = await import("../src/lib/screen/oscillatorScore.ts");
  const { riskFlags } = await import("../src/lib/screen/riskFlags.ts");
  const { horizonBuySignal } = await import("../src/lib/screen/horizonSignal.ts");
  const settled = { dateKey: "2099-01-01", progress: 1, isLive: false };
  const out = [];
  for (const [symbol, c, floor, rs, breadth] of items) {
    const closes = c.map((k) => k.close);
    const pre = [0]; for (const x of closes) pre.push(pre.at(-1) + x);
    const sma = (i, n) => (i + 1 >= n ? (pre[i + 1] - pre[i + 1 - n]) / n : null);
    const busy = {};
    const trade = (h, k, i, plan, br, mm) => {
      const key = h + k;
      if ((busy[key] ?? -1) >= i) return;
      const hc = { ...cfg, maxHold: maxHold[h] };
      const t = simulate(c, i, plan, hc);
      busy[key] = t ? t.exitIndex : i + cfg.entryDays;
      if (!t) return;
      const rec = { symbol, h, k, breadth: br, entryT: t.entryT, exitT: c[t.exitIndex].t, r: t.r, pct: t.pct, hold: t.hold, exit: t.exit, hitT1: t.hitT1, t1Days: t.t1Days };
      // Pattern-height ("measured move") targets on the same entries and stop:
      // MM1 = pivot + base height, MM2 = pivot + 2 × base height.
      if (mm && mm.mm1 > plan.entry) {
        const risk = plan.entry - plan.stop;
        const v = (t1, t2) => { const s = simulate(c, i, { ...plan, target1: t1, target2: t2 }, hc); return s && { r: s.r, pct: s.pct, exit: s.exit, hitT1: s.t1Days != null, hold: s.hold }; };
        rec.mm = {
          mm1R: (mm.mm1 - plan.entry) / risk,
          mm1Pct: (mm.mm1 / plan.entry - 1) * 100,
          full: v(mm.mm1, mm.mm1),                       // all out at MM1
          split: v(mm.mm1, mm.mm2),                      // half at MM1, rest at MM2
          hybrid: v(plan.target1, Math.max(mm.mm1, plan.target2)), // half at our T1, rest at MM1 (or T2 if further)
        };
      }
      out.push(rec);
    };
    for (let i = cfg.warmup; i < c.length - 1; i++) {
      if (!floor[i]) continue;
      const ma50 = sma(i, 50), ma200 = sma(i, 200);
      const baselineDay = i % 10 === 0;
      // Every horizon needs RS >= 70 and price above both averages; skip the expensive replay otherwise.
      const candidate = rs[i] >= 70 && ma50 && ma200 && c[i].close > ma50 && c[i].close > ma200;
      if (!candidate && !baselineDay) continue;
      const slice = c.slice(Math.max(0, i + 1 - cfg.window), i + 1);
      const m = computeMetrics({ symbol, candles: slice });
      if (!m || !m.passesFloor) continue;
      const sc = scoreOscillators(slice, settled);
      const live = m.live;
      const row = {
        symbol, price: m.price, turnoverCr: m.turnoverCr, rs: rs[i] || null,
        vs50: m.vs50, vs200: m.vs200, fromHigh: m.fromHigh, stage: m.stage, baseDepth: m.baseDepth,
        pivotPrice: live ? live.episode.pivot : m.formingBase?.pivot ?? null,
        ext: live ? ((m.price - live.episode.pivot) / live.episode.pivot) * 100 : m.ext,
        exitReason: null,
        oscillatorScore: sc,
        riskFlags: riskFlags(slice, { vs50: m.vs50, turnoverCr: m.turnoverCr, stage: m.stage, breakoutVolume: live?.entry.volumeRatio ?? null }),
      };
      const br = breadth[i] >= 0 ? breadth[i] : null;
      const height = row.pivotPrice != null && m.baseDepth != null ? (row.pivotPrice * m.baseDepth) / 100 : null;
      const mm = height > 0 ? { mm1: row.pivotPrice + height, mm2: row.pivotPrice + 2 * height } : null;
      for (const h of HORIZONS) {
        if (candidate) {
          const actual = horizonBuySignal(row, h, br);
          if (actual.plan && actual.status.key === "buy-ready") trade(h, "ready", i, actual.plan, breadth[i], mm);
          const noGate = horizonBuySignal(row, h, 100);
          if (noGate.plan && noGate.status.key === "buy-ready") trade(h, "stock", i, noGate.plan, breadth[i], mm);
        }
        if (baselineDay) {
          // Same plan levels, no checks: shows whether the checks add anything.
          const ref = horizonBuySignal(row, h, 100);
          if (ref.plan) trade(h, "baseline", i, ref.plan, breadth[i]);
        }
      }
    }
  }
  parentPort.postMessage(out);
}
