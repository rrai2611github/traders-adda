// Why was the last 12 months weak? Splits the live rules' closed trades into "earlier" and "last 12 months" and compares segments.
// Backtest only: changes nothing in the app.  Run: node --use-system-ca scripts/backtest-recent.mjs
import { readFileSync } from "node:fs";
import { runBacktest } from "../src/lib/backtest/run.ts";
import { loadHistory, isoToDay } from "../src/lib/backtest/history.ts";

const settings = {
  strategy: { kind: "screen", screen: "Blue sky" }, alsoScreens: ["Multi-year breakouts"], from: "2016-12-01", to: "2099-12-31",
  entry: "next-open", stop: { kind: "percent", percent: 8 }, exit: { kind: "ma", type: "sma", period: 50, when: "close" }, maxHoldDays: 0,
  costPercent: 0.25, capital: 1_000_000, maxPositions: 10, sizing: { kind: "risk", riskPercent: 2 }, positionCapPercent: 20,
  turnoverLimitPercent: 10, breadthMin: 35, floor: "trading", maxNewPerDay: 3,
};
const result = runBacktest(settings, ".cache/history10y");
const lastDay = result.data.lastDay;
const cut = new Date(Date.parse(`${lastDay}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
const trades = result.trades.filter((t) => t.exitReason !== "end");
const history = loadHistory(".cache/history10y");

const screen = JSON.parse(readFileSync("tmp/screen.json", "utf8"));
const info = new Map([...screen.rows, ...(screen.extraRows ?? [])].map((r) => [r.symbol, { sector: r.sector ?? "Unknown", mcap: r.mcap ?? null }]));

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (v, d = 2) => (v == null ? "  —  " : (v >= 0 ? "+" : "") + v.toFixed(d));

function features(t) {
  const s = history.series.get(t.symbol);
  const i = s ? s.day.findIndex((d) => d >= isoToDay(t.entryDay)) : -1;
  const meta = info.get(t.symbol);
  const out = { sector: meta?.sector ?? "Unknown", size: meta?.mcap == null ? "unknown size" : meta.mcap < 2000 ? "small (<2k Cr)" : meta.mcap < 20000 ? "mid (2k-20k Cr)" : "large (20k+ Cr)" };
  out.rs = t.rs == null ? "rs unknown" : t.rs >= 97 ? "RS 97+" : t.rs >= 93 ? "RS 93-96" : "RS under 93";
  if (s && i >= 64) {
    let atr = 0;
    for (let k = i - 14; k < i; k += 1) atr += (s.high[k] - s.low[k]) / s.close[k];
    atr = (atr / 14) * 100;
    out.vol = atr < 3 ? "calm (ATR<3%)" : atr < 4.5 ? "normal (3-4.5%)" : "wild (ATR>4.5%)";
    const gap = (s.open[i] / s.close[i - 1] - 1) * 100;
    out.gap = gap < 0.5 ? "gap under 0.5%" : gap < 2 ? "gap 0.5-2%" : "gap 2%+";
    const run = (s.close[i - 1] / s.close[i - 64] - 1) * 100;
    out.run = run < 30 ? "3-mo run-up <30%" : run < 80 ? "run-up 30-80%" : "run-up 80%+";
  }
  out.year = t.entryDay.slice(0, 4);
  out.hold = t.holdDays <= 10 ? "held 10 days or less" : t.holdDays <= 40 ? "held 11-40 days" : "held 40+ days";
  return out;
}

const rows = trades.map((t) => ({ t, ...features(t), recent: t.entryDay >= cut }));
const recent = rows.filter((r) => r.recent);
const earlier = rows.filter((r) => !r.recent);
const seg = (xs) => ({ n: xs.length, win: xs.length ? (xs.filter((r) => r.t.pnl > 0).length / xs.length) * 100 : null, r: avg(xs.map((r) => r.t.r)) });

console.log(`Closed trades: ${rows.length}. Last 12 months (entries since ${cut}): ${recent.length}; earlier: ${earlier.length}`);
const a = seg(earlier), b = seg(recent);
console.log(`Earlier: win ${a.win.toFixed(0)}%  avg R ${f(a.r)}   |   Recent: win ${b.win?.toFixed(0)}%  avg R ${f(b.r)}\n`);

for (const key of ["year", "size", "vol", "rs", "gap", "run", "hold"]) {
  console.log(`--- by ${key}`);
  const values = [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();
  for (const v of values) {
    const e = seg(earlier.filter((r) => r[key] === v)), c = seg(recent.filter((r) => r[key] === v));
    console.log(`${String(v).padEnd(24)} earlier n=${String(e.n).padStart(3)} win ${e.win == null ? " — " : e.win.toFixed(0).padStart(3) + "%"} R ${f(e.r)}   recent n=${String(c.n).padStart(3)} win ${c.win == null ? " — " : c.win.toFixed(0).padStart(3) + "%"} R ${f(c.r)}`);
  }
}
console.log("\n--- by sector (all years, sectors with 8+ trades)");
const sectors = [...new Set(rows.map((r) => r.sector))];
for (const s of sectors.map((v) => [v, seg(rows.filter((r) => r.sector === v))]).filter(([, x]) => x.n >= 8).sort((x, y) => y[1].r - x[1].r)) {
  const c = seg(recent.filter((r) => r.sector === s[0]));
  console.log(`${s[0].padEnd(34)} all n=${String(s[1].n).padStart(3)} win ${s[1].win.toFixed(0).padStart(3)}% R ${f(s[1].r)}   recent n=${c.n} R ${f(c.r)}`);
}
console.log("\n--- the recent trades");
for (const r of recent.sort((x, y) => x.t.entryDay.localeCompare(y.t.entryDay))) {
  console.log(`${r.t.entryDay} ${r.t.symbol.padEnd(11)} R ${f(r.t.r).padStart(6)} ${r.t.exitReason.padEnd(5)} held ${String(r.t.holdDays).padStart(3)}  ${r.sector.slice(0, 22).padEnd(22)} ${r.size ?? ""}  ${r.vol ?? ""}  ${r.run ?? ""}`);
}
