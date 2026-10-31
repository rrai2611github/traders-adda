// Shared pieces of the walk-forward backtests: cached candle loading, the
// live scan's liquidity floor, RS rating and market breadth, and trade simulation.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "daily-candles", "yahoo");
const IST = 5.5 * 3600e3;
const DAY = 86400e3;
export const dayNo = (t) => Math.floor((t + IST) / DAY);

/** Candles per symbol plus per-candle floor flag, RS rating (1-99) and market breadth (%, -1 unknown). */
export function loadBacktestData(cfg) {
  const universe = JSON.parse(readFileSync(join(ROOT, "src/lib/market/data/nse-equities.json"), "utf8")).equities.map((e) => e.symbol);
  const files = new Set(readdirSync(CACHE));
  const raw = new Map();
  for (const s of universe) {
    if (!files.has(`${s}.json`)) continue;
    const c = JSON.parse(readFileSync(join(CACHE, `${s}.json`), "utf8")).c;
    if (c?.length) raw.set(s, c.map(([t, open, high, low, close, volume]) => ({ t, open, high, low, close, volume })));
  }

  // Same exchange-holiday placeholder removal as the live scan.
  const tally = new Map();
  for (const c of raw.values()) c.forEach((k, i) => {
    const d = dayNo(k.t); const e = tally.get(d) ?? [0, 0]; e[0]++;
    if (i > 0 && k.volume === 0 && k.open === k.close && k.high === k.close && k.low === k.close && k.close === c[i - 1].close) e[1]++;
    tally.set(d, e);
  });
  const holidays = new Set([...tally].filter(([, [b, p]]) => b >= 50 && p / b >= 0.95).map(([d]) => d));
  const hist = new Map([...raw].map(([s, c]) => [s, c.filter((k) => !holidays.has(dayNo(k.t)))]));

  // Cross-sectional RS (1-99) per day among floor-passing stocks, as in the live scan.
  const perf = (c, at) => {
    if (at < 14) return null;
    let score = 0, w = 0;
    for (const [n, wt] of [[63, 0.4], [126, 0.2], [189, 0.2], [252, 0.2]]) {
      if (at < n || c[at - n].close <= 0) continue;
      score += (c[at].close / c[at - n].close - 1) * wt; w += wt;
    }
    return w ? (score / w) * 100 : (c[0].close > 0 ? (c[at].close / c[0].close - 1) * 100 : null);
  };
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const byDay = new Map();
  const floor = new Map();
  for (const [s, c] of hist) {
    const f = new Uint8Array(c.length);
    for (let i = 49; i < c.length; i++) {
      f[i] = median(c.slice(i - 49, i + 1).map((k) => (k.close * k.volume) / 1e7)) >= cfg.turnoverCr ? 1 : 0;
      const p = f[i] ? perf(c, i) : null;
      if (p == null) continue;
      const d = dayNo(c[i].t);
      (byDay.get(d) ?? byDay.set(d, []).get(d)).push([s, i, p]);
    }
    floor.set(s, f);
  }
  // Market breadth: share of liquid stocks closing above their 50-day average.
  const above = new Map();
  for (const [s, c] of hist) {
    const f = floor.get(s);
    let sum = 0;
    for (let i = 0; i < c.length; i++) {
      sum += c[i].close; if (i >= 50) sum -= c[i - 50].close;
      if (i < 49 || !f[i]) continue;
      const d = dayNo(c[i].t); const e = above.get(d) ?? [0, 0];
      e[0]++; if (c[i].close > sum / 50) e[1]++; above.set(d, e);
    }
  }
  const breadthOf = (t) => { const e = above.get(dayNo(t)); return e && e[0] >= 100 ? (e[1] / e[0]) * 100 : null; };
  const breadth = new Map([...hist].map(([s, c]) => [s, Float32Array.from(c, (k) => breadthOf(k.t) ?? -1)]));
  const rs = new Map([...hist].map(([s, c]) => [s, new Uint8Array(c.length)]));
  for (const list of byDay.values()) {
    list.sort((a, b) => a[2] - b[2]);
    list.forEach(([s, i], rank) => {
      const pct = list.length === 1 ? 1 : rank / (list.length - 1);
      rs.get(s)[i] = Math.max(1, Math.min(99, Math.round(1 + pct * 98)));
    });
  }
  return { hist, floor, rs, breadth, holidays };
}

/** Nifty 50 daily candles for RS-line scans: the app's cache when present, else Yahoo (5 years). */
export async function loadBenchmark() {
  try {
    const c = JSON.parse(readFileSync(join(CACHE, "NIFTY50.json"), "utf8")).c;
    if (c?.length) return c.map(([t, open, high, low, close, volume]) => ({ t, open, high, low, close, volume }));
  } catch {
    // Not cached yet; fetch below.
  }
  try {
    const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=5y", { headers: { "User-Agent": "Mozilla/5.0" } });
    const r = (await res.json()).chart.result[0];
    const q = r.indicators.quote[0];
    return r.timestamp.map((t, i) => ({ t: t * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 }))
      .filter((k) => k.close > 0);
  } catch (error) {
    console.warn(`Nifty 50 benchmark unavailable (${error.message}); RS-line scans will be empty.`);
    return null;
  }
}

/** Same entry as `simulate`; one target, one stop, time stop at the close. */
export function simulateFixed(c, i, lv, cfg, { targetR, stopR, maxHold }) {
  let e = -1, fill = 0;
  for (let j = i + 1; j <= Math.min(c.length - 1, i + cfg.entryDays); j++) {
    const k = c[j];
    if (k.low <= lv.stop) return null;
    if (k.high >= lv.entry) {
      fill = Math.max(k.open, lv.entry);
      if (fill > lv.buyZoneHigh) return null;
      e = j; break;
    }
  }
  if (e < 0) return null;
  const risk = fill - lv.stop;
  if (risk <= 0) return null;
  const stop = fill - stopR * risk, target = fill + targetR * risk;
  let px = null, exitIndex = -1, exit = "time";
  for (let j = e; j < c.length; j++) {
    const k = c[j];
    const open = j === e ? fill : k.open;
    const low = j === e ? Math.min(k.low, fill) : k.low;
    if (low <= stop) { px = Math.min(open, stop); exit = "stop"; exitIndex = j; break; }
    if (k.high >= target) { px = Math.max(open, target); exit = "target"; exitIndex = j; break; }
    if (j - e >= maxHold || j === c.length - 1) { px = k.close; exit = j === c.length - 1 ? "open" : "time"; exitIndex = j; break; }
  }
  const cost = (fill * cfg.costPercent) / 100;
  return { entryT: c[e].t, exitIndex, exit, hitT1: exit === "target", hold: exitIndex - e, r: (px - fill - cost) / risk, pct: ((px - fill - cost) / fill) * 100 };
}

/**
 * Stop-buy above the signal day's high, initial SL from the app's levels.
 * targets: half off at T1 (2R) with SL moved to entry, rest at T2 (3R), 30-session time stop.
 * trail: no targets; SL trails the lowest low of the last 10 sessions, 120-session time stop.
 */
export function simulate(c, i, lv, cfg, mode = "targets") {
  let e = -1, fill = 0;
  for (let j = i + 1; j <= Math.min(c.length - 1, i + cfg.entryDays); j++) {
    const k = c[j];
    if (k.low <= lv.stop) return null;             // invalidated before triggering
    if (k.high >= lv.entry) {
      fill = Math.max(k.open, lv.entry);
      if (fill > lv.buyZoneHigh) return null;      // gapped above the buy zone: don't chase
      e = j; break;
    }
  }
  if (e < 0) return null;
  const risk = fill - lv.stop;
  if (risk <= 0) return null;
  let stop = lv.stop, half = false, realized = 0, exitIndex = -1, exit = "time", t1Index = -1;
  const maxHold = mode === "trail" ? 120 : cfg.maxHold;
  for (let j = e; j < c.length; j++) {
    if (mode === "trail" && j > e + 1) {
      let lo = Infinity; for (let q = j - 10; q < j; q++) lo = Math.min(lo, c[q].low);
      stop = Math.max(stop, lo);
    }
    const k = c[j];
    const open = j === e ? fill : k.open;
    const low = j === e ? Math.min(k.low, fill) : k.low;
    // Conservative: if the stop and a target are both inside the day, assume the stop came first.
    if (low <= stop) {
      const px = Math.min(open, stop);
      realized += (half ? 0.5 : 1) * (px - fill);
      exit = half || stop > lv.stop ? "trailed" : "stop"; exitIndex = j; break;
    }
    if (mode === "targets" && !half && k.high >= lv.target1) { realized += 0.5 * (lv.target1 - fill); half = true; stop = fill; t1Index = j; }
    if (half && k.high >= lv.target2) { realized += 0.5 * (Math.max(open, lv.target2) - fill); exit = "target"; exitIndex = j; break; }
    if (j - e >= maxHold || j === c.length - 1) {
      realized += (half ? 0.5 : 1) * (k.close - fill);
      exit = j === c.length - 1 ? "open" : "time"; exitIndex = j; break;
    }
  }
  const cost = (fill * cfg.costPercent) / 100;
  return {
    entryT: c[e].t, exitIndex, exit, hitT1: half || (mode === "trail" && realized >= 2 * risk), hold: exitIndex - e,
    r: (realized - cost) / risk,
    pct: ((realized - cost) / fill) * 100,
    t1Days: t1Index >= 0 ? t1Index - e : null,
  };
}

export function tradeStats(list) {
  if (!list.length) return null;
  const r = list.map((t) => t.r);
  const wins = r.filter((x) => x > 0);
  const gross = wins.reduce((a, b) => a + b, 0);
  const loss = -r.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const t of [...list].sort((a, b) => a.entryT - b.entryT)) { eq += t.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return {
    trades: list.length, winRate: (wins.length / list.length) * 100,
    avgR: r.reduce((a, b) => a + b, 0) / list.length,
    avgPct: list.reduce((a, t) => a + t.pct, 0) / list.length,
    pf: loss ? gross / loss : Infinity,
    big: (list.filter((t) => t.r >= 2).length / list.length) * 100,
    stopped: (list.filter((t) => t.exit === "stop").length / list.length) * 100,
    hold: list.reduce((a, t) => a + t.hold, 0) / list.length, maxDdR: dd,
  };
}
