// Candlestick pattern study: does each chart marker lead to anything?
// Usage: node --no-warnings --use-system-ca scripts/backtest-candle-patterns.mjs
// Detects every pattern on liquid stocks' daily candles, then measures the next
// 5 and 10 sessions' return from the pattern close against that day's median
// liquid stock. Bearish patterns "work" when the excess is negative.
import { ROOT, dayNo, loadBacktestData } from "./backtest-common.mjs";

void ROOT;
const CFG = { turnoverCr: 5, horizons: [5, 10] };
const t0 = Date.now();
const { hist, floor } = loadBacktestData(CFG);
const { detectCandlePatterns, CANDLE_PATTERNS } = await import("../src/lib/chart/candlePatterns.ts");

// Median forward return of all liquid stocks per day.
const fwd = (c, i, h) => (i + h < c.length ? (c[i + h].close / c[i].close - 1) * 100 : null);
const medians = new Map(CFG.horizons.map((h) => [h, new Map()]));
const pools = new Map(CFG.horizons.map((h) => [h, new Map()]));
for (const [s, c] of hist) {
  const f = floor.get(s);
  for (let i = 0; i < c.length; i++) {
    if (!f[i]) continue;
    for (const h of CFG.horizons) {
      const v = fwd(c, i, h);
      if (v == null) continue;
      const p = pools.get(h);
      const d = dayNo(c[i].t);
      (p.get(d) ?? p.set(d, []).get(d)).push(v);
    }
  }
}
for (const h of CFG.horizons) for (const [d, list] of pools.get(h)) {
  list.sort((a, b) => a - b);
  medians.get(h).set(d, list[list.length >> 1]);
}

const rows = [];
for (const [s, c] of hist) {
  const f = floor.get(s);
  for (const hit of detectCandlePatterns(c)) {
    if (!f[hit.index]) continue;
    const d = dayNo(c[hit.index].t);
    const r = { key: hit.key, day: d };
    for (const h of CFG.horizons) {
      const v = fwd(c, hit.index, h);
      if (v != null) r[`x${h}`] = v - medians.get(h).get(d);
    }
    rows.push(r);
  }
}
const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b);
const mid = days[days.length >> 1];
console.log(`${rows.length} pattern hits in ${((Date.now() - t0) / 1000).toFixed(0)}s; split at ${new Date(mid * 864e5).toISOString().slice(0, 10)}`);
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
const stat = (list, key, bias) => {
  const v = list.map((r) => r[key]).filter((x) => x != null);
  if (!v.length) return "-";
  const hit = v.filter((x) => (bias === "bullish" ? x > 0 : x < 0)).length / v.length;
  return `${fmt(v.reduce((a, b) => a + b, 0) / v.length)}% ${Math.round(hit * 100)}%✓`;
};
console.log(`${"Pattern".padEnd(20)}${"Bias".padEnd(9)}${"Hits".padStart(7)}  ${"10d all".padEnd(16)}${"10d 1st".padEnd(16)}${"10d 2nd".padEnd(16)}${"5d all".padEnd(16)}`);
const summary = {};
for (const [key, def] of Object.entries(CANDLE_PATTERNS)) {
  const l = rows.filter((r) => r.key === key);
  const a = l.filter((r) => r.day < mid), b = l.filter((r) => r.day >= mid);
  console.log(`${def.label.padEnd(20)}${def.bias.padEnd(9)}${String(l.length).padStart(7)}  ${stat(l, "x10", def.bias).padEnd(16)}${stat(a, "x10", def.bias).padEnd(16)}${stat(b, "x10", def.bias).padEnd(16)}${stat(l, "x5", def.bias).padEnd(16)}`);
  const v = l.map((r) => r.x10).filter((x) => x != null);
  summary[key] = v.length ? Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 100) / 100 : null;
}
console.log(JSON.stringify(summary));
