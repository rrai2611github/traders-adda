// How long did the tested strategy actually hold a stock? Reads the saved ten-year backtest of the tested rules
// (Blue sky + Multi-year breakouts, 12% stop, exit under the 50-day average) and writes the holding-period figures the
// Top picks "term" label is based on: src/lib/screen/pickHolding.json.
// Usage: node scripts/backtest-holding.mjs [--write]
// The result files are in .cache/backtest-results (created when the Backtest page runs a test), so run the 12%-stop
// "Blue sky + Multi-year breakouts" preset there first if none is found.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".cache", "backtest-results");

/** The exact rules the live strategy check runs (src/lib/backtest/tracker.ts), with the 12% stop. */
function isTestedStrategy(s) {
  return s?.strategy?.screen === "Blue sky"
    && (s.alsoScreens ?? []).length === 1 && s.alsoScreens[0] === "Multi-year breakouts"
    && s.stop?.kind === "percent" && s.stop.percent === 12
    && s.exit?.kind === "ma" && s.exit.type === "sma" && s.exit.period === 50
    && s.breadthMin === 35 && s.niftyAbove == null
    && s.maxPositions === 10 && s.maxNewPerDay === 3 && s.sizing?.riskPercent === 2 && s.positionCapPercent === 20
    && s.costPercent === 0.25 && s.from <= "2017-01-01";
}

const quantile = (values, q) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };


/**
 * Does anything knowable at entry predict how long a trade is held? If it did, a Top pick could honestly get its own term.
 * Each trade is matched to the daily history, and the traits are measured on the signal day (the close before the buy).
 * Spearman rank correlation with the holding time; with n trades, anything under about 2 / sqrt(n) is indistinguishable from noise.
 */
const IST = 19_800_000;
const isoDay = (t) => new Date(t + IST).toISOString().slice(0, 10);
const history = new Map();
function barsOf(symbol) {
  if (history.has(symbol)) return history.get(symbol);
  const file = join(ROOT, ".cache", "history10y", `${encodeURIComponent(symbol)}.json`);
  const bars = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).c.map((x) => ({ d: isoDay(x[0]), h: x[2], l: x[3], c: x[4] })) : null;
  history.set(symbol, bars);
  return bars;
}
const ranks = (values) => { const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const out = new Array(values.length); order.forEach(([, i], k) => { out[i] = k; }); return out; };
function spearman(x, y) {
  const a = ranks(x), b = ranks(y), mid = (a.length - 1) / 2;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < a.length; i++) { sxy += (a[i] - mid) * (b[i] - mid); sxx += (a[i] - mid) ** 2; syy += (b[i] - mid) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
const TRAITS = [
  ["baseSessions", "Base length"], ["baseDepth", "Base depth"], ["atrPercent", "Volatility (ATR %)"],
  ["return63", "63-day return"], ["rs", "Relative strength"], ["above200", "Distance above the 200-day"], ["above50", "Distance above the 50-day"],
];
function predictors(trades) {
  const rows = [];
  for (const t of trades) {
    const b = barsOf(t.symbol);
    if (!b) continue;
    const entry = b.findIndex((x) => x.d >= t.entryDay);
    if (entry < 262) continue;
    const i = entry - 1;
    let high = -Infinity, at = -1;
    for (let k = i - 252; k < i; k++) if (b[k].h >= high) { high = b[k].h; at = k; }
    let low = Infinity;
    for (let k = at; k <= i; k++) low = Math.min(low, b[k].l);
    let range = 0;
    for (let k = i - 13; k <= i; k++) range += Math.max(b[k].h - b[k].l, Math.abs(b[k].h - b[k - 1].c), Math.abs(b[k].l - b[k - 1].c));
    const mean = (n) => b.slice(i - n + 1, i + 1).reduce((a, x) => a + x.c, 0) / n;
    rows.push({ hold: t.holdDays, baseSessions: i - at, baseDepth: (high / low - 1) * 100, atrPercent: (range / 14 / b[i].c) * 100, return63: (b[i].c / b[i - 63].c - 1) * 100, rs: t.rs, above200: (b[i].c / mean(200) - 1) * 100, above50: (b[i].c / mean(50) - 1) * 100 });
  }
  if (rows.length < 100) return null;
  const features = TRAITS.map(([key, label]) => ({ key, label, spearman: Math.round(spearman(rows.map((r) => r[key]), rows.map((r) => r.hold)) * 100) / 100 }));
  const strongest = features.reduce((a, b) => (Math.abs(b.spearman) > Math.abs(a.spearman) ? b : a));
  return { matchedTrades: rows.length, noiseLevel: Math.round((2 / Math.sqrt(rows.length)) * 100) / 100, features, strongest };
}

let best = null;
for (const name of readdirSync(DIR).filter((n) => n.endsWith(".settings.json"))) {
  const settings = JSON.parse(readFileSync(join(DIR, name), "utf8"));
  if (!isTestedStrategy(settings)) continue;
  const id = name.replace(".settings.json", "");
  const result = JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"));
  const trades = (result.trades ?? []).filter((t) => Number.isFinite(t.holdDays));
  if (!best || trades.length > best.trades.length) best = { id, settings, trades };
}
if (!best) { console.error("No saved ten-year result of the tested rules was found. Run that preset on the Backtest page first."); process.exit(1); }

const hold = best.trades.map((t) => t.holdDays);
const winners = best.trades.filter((t) => t.pnl > 0).map((t) => t.holdDays);
const losers = best.trades.filter((t) => t.pnl <= 0).map((t) => t.holdDays);
const share = (n) => Math.round((hold.filter((d) => d > n).length / hold.length) * 1000) / 10;
const out = {
  generated: new Date().toISOString().slice(0, 10),
  source: `.cache/backtest-results/${best.id}.json`,
  from: best.settings.from,
  trades: best.trades.length,
  /** Trading sessions held. */
  hold: { p25: quantile(hold, 0.25), median: quantile(hold, 0.5), p75: quantile(hold, 0.75), p90: quantile(hold, 0.9), max: Math.max(...hold) },
  winnersMedian: quantile(winners, 0.5),
  losersMedian: quantile(losers, 0.5),
  /** Percent of trades still open after 30 / 63 / 250 sessions: the app's short, mid and long limits. */
  shareLonger: { short: share(30), mid: share(63), long: share(250) },
  /** Whether any trait known at entry predicts the holding time; null when the price history for the trades is not on disk. */
  predictors: predictors(best.trades),
};
console.log(JSON.stringify(out, null, 2));
if (process.argv.includes("--write")) {
  writeFileSync(join(ROOT, "src", "lib", "screen", "pickHolding.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log("Wrote src/lib/screen/pickHolding.json");
}
