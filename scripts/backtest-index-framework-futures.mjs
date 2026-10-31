// Same framework as backtest-index-framework.mjs, but on the cached Fyers 1-minute index FUTURES candles, which carry
// volume, so the VWAP and volume conditions can be tested. Covers Sep 2025 - Sep 2026 (the cached futures window) for
// Nifty and Bank Nifty; Sensex and FinNifty futures are not in the cache.
// Usage: node --use-system-ca --no-warnings scripts/backtest-index-framework-futures.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IST = 19_800_000, HOUR = 3_600_000, COST_PCT = 0.03;
const dayKey = (t) => new Date(t + IST).toISOString().slice(0, 10);

async function chart(ticker, interval, range) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = (await r.json()).chart.result[0], q = j.indicators.quote[0];
  return j.timestamp.map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter((k) => k.c > 0 && k.h > 0);
}
const sma = (v, n) => v.map((_, i) => (i + 1 < n ? null : v.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
function ema(v, n) { const k = 2 / (n + 1); let e = v[0]; return v.map((x, i) => { e = i ? x * k + e * (1 - k) : v[0]; return i + 1 < n ? null : e; }); }
function rsi(v, n = 14) { const out = Array(v.length).fill(null); let g = 0, l = 0; for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1], u = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= n) { g += u / n; l += dn / n; } else { g = (g * (n - 1) + u) / n; l = (l * (n - 1) + dn) / n; } if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return out; }
function atr(bars, n = 14) { const out = Array(bars.length).fill(null); let a = 0; for (let i = 1; i < bars.length; i++) { const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)); a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n; if (i >= n) out[i] = a; } return out; }

function dailyStates(daily, bank, vix) {
  const c = daily.map((k) => k.c), s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c), e12 = ema(c, 12), e26 = ema(c, 26);
  const bc = bank.map((k) => k.c), bs50 = sma(bc, 50);
  const bankState = new Map(bank.map((k, i) => [dayKey(k.t), bs50[i] == null ? null : k.c > bs50[i] ? 1 : -1]));
  const vixDays = vix.map((k) => dayKey(k.t)), vixBy = new Map(vix.map((k) => [dayKey(k.t), k.c]));
  const states = new Map();
  daily.forEach((k, i) => {
    if (s200[i] == null || r[i] == null || e12[i] == null || e26[i] == null) return;
    const d = dayKey(k.t), vi = vixDays.indexOf(d), vNow = vixBy.get(d), vThen = vi >= 5 ? vixBy.get(vixDays[vi - 5]) : null;
    const vixOk = vNow != null && vThen != null ? vNow <= vThen * 1.03 : null, vixUp = vNow != null && vThen != null ? vNow > vThen * 1.03 : null;
    const bk = bankState.get(d), macd = e12[i] - e26[i];
    const bull = k.c > s50[i] && s50[i] > s200[i] && r[i] > 55 && macd > 0 && vixOk !== false && bk !== -1;
    const bear = k.c < s50[i] && s50[i] < s200[i] && r[i] < 45 && macd < 0 && vixUp !== false && bk !== 1;
    states.set(d, bull ? "bull" : bear ? "bear" : "none");
  });
  return states;
}

/** 1-minute futures -> 09:15-grid hourly bars with volume and the day's running VWAP at each bar's close. */
function hourlyFromMinutes(minutes) {
  const byBar = new Map();
  let day = null, pv = 0, vv = 0;
  for (const m of minutes) {
    const d = dayKey(m.t);
    if (d !== day) { day = d; pv = 0; vv = 0; }
    const mod = Math.floor(((m.t + IST) % 86_400_000) / 60_000);
    if (mod < 555 || mod > 930) continue;
    pv += ((m.high + m.low + m.close) / 3) * m.volume; vv += m.volume;
    const key = `${d}:${Math.floor((mod - 555) / 60)}`;
    const b = byBar.get(key) ?? { t: m.t - (((mod - 555) % 60) * 60_000), o: m.open, h: m.high, l: m.low, c: m.close, v: 0, vwap: null };
    b.h = Math.max(b.h, m.high); b.l = Math.min(b.l, m.low); b.c = m.close; b.v += m.volume; b.vwap = vv ? pv / vv : null;
    byBar.set(key, b);
  }
  return [...byBar.values()].sort((a, b) => a.t - b.t);
}

function backtest(bars, states, opt) {
  const closes = bars.map((b) => b.c), e20 = ema(closes, 20), r14 = rsi(closes), a14 = atr(bars);
  const vol20 = bars.map((_, i) => (i < 20 ? null : bars.slice(i - 20, i).reduce((a, b) => a + b.v, 0) / 20));
  const days = [...new Set(bars.map((b) => dayKey(b.t)))], prevDay = new Map(days.map((d, i) => [d, days[i - 1]]));
  const trades = [], perDay = new Map();
  let pos = null;
  for (let i = 25; i < bars.length - 1; i++) {
    const b = bars[i], d = dayKey(b.t), next = bars[i + 1], lastOfDay = dayKey(next.t) !== d;
    if (pos) {
      const long = pos.dir === 1; let exit = null, why = "";
      if (long ? b.l <= pos.stop : b.h >= pos.stop) { exit = pos.stop; why = "stop"; }
      else if (opt.target === "2R" && (long ? b.h >= pos.tp : b.l <= pos.tp)) { exit = pos.tp; why = "target"; }
      else if (opt.target === "trend" && (long ? (b.c < e20[i] || r14[i] < 50 || b.c < b.vwap) : (b.c > e20[i] || r14[i] > 50 || b.c > b.vwap))) { exit = b.c; why = "trend"; }
      else if (opt.intraday && lastOfDay) { exit = b.c; why = "eod"; }
      else if (i - pos.i >= 60) { exit = b.c; why = "time"; }
      if (exit != null) {
        const pts = (exit - pos.entry) * pos.dir - (pos.entry * COST_PCT) / 100;
        trades.push({ t: pos.t, dir: pos.dir, r: pts / pos.risk, why });
        const pd = perDay.get(pos.day) ?? { n: 0, losses: 0, r: 0 }; pd.r += pts / pos.risk; if (pts < 0) pd.losses++; perDay.set(pos.day, pd); pos = null;
      }
    }
    if (pos || lastOfDay) continue;
    const st = states.get(prevDay.get(d)) ?? "none";
    if (st === "none") continue;
    const pd = perDay.get(d) ?? { n: 0, losses: 0, r: 0 };
    if (pd.n >= 3 || pd.losses >= 2 || pd.r <= -2) continue;
    const dir = st === "bull" ? 1 : -1, prev = bars[i - 1];
    const hhhl = dir === 1 ? b.h > prev.h && b.l > prev.l && prev.h > bars[i - 2].h : b.l < prev.l && b.h < prev.h && prev.l < bars[i - 2].l;
    const vwapVol = b.vwap != null && vol20[i] != null && b.v > vol20[i] && (dir === 1 ? b.c > b.vwap : b.c < b.vwap);
    const ok = (dir === 1 ? b.c > e20[i] && r14[i] > 60 && b.c > prev.h : b.c < e20[i] && r14[i] < 40 && b.c < prev.l) && hhhl && (!opt.vwapVol || vwapVol);
    if (!ok) continue;
    const entry = next.o;
    const swing = dir === 1 ? Math.min(...bars.slice(i - 5, i + 1).map((x) => x.l)) : Math.max(...bars.slice(i - 5, i + 1).map((x) => x.h));
    const dist = Math.max(Math.abs(entry - swing), 1.5 * a14[i]);
    pos = { dir, entry, stop: entry - dir * dist, risk: dist, tp: entry + dir * 2 * dist, t: next.t, i: i + 1, day: dayKey(next.t) };
    pd.n++; perDay.set(d, pd);
  }
  return trades;
}
function stats(t) {
  if (!t.length) return null;
  const r = t.map((x) => x.r), w = r.filter((x) => x > 0), g = w.reduce((a, b) => a + b, 0), l = -r.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
  let eq = 1, pk = 1, dd = 0; for (const x of [...t].sort((a, b) => a.t - b.t)) { eq *= 1 + 0.01 * x.r; pk = Math.max(pk, eq); dd = Math.max(dd, (pk - eq) / pk); }
  return { n: t.length, win: (w.length / r.length) * 100, avgR: r.reduce((a, b) => a + b, 0) / r.length, pf: l ? g / l : Infinity, ret: (eq - 1) * 100, dd: dd * 100 };
}
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "inf");
const line = (label, s) => (s ? `${label.padEnd(42)} ${String(s.n).padStart(3)} trades  win ${f(s.win, 0).padStart(3)}%  avg ${f(s.avgR).padStart(5)}R  PF ${f(s.pf)}  return ${f(s.ret, 1).padStart(5)}%  maxDD ${f(s.dd, 1)}%` : `${label.padEnd(42)}   0 trades`);

const dir = join(ROOT, ".cache", "scalp-history");
const load = (prefix) => readdirSync(dir).filter((x) => x.startsWith(prefix + "-")).sort().flatMap((x) => JSON.parse(readFileSync(join(dir, x), "utf8")));
const [nifty, bank, sensex, vix] = await Promise.all([chart("^NSEI", "1d", "5y"), chart("^NSEBANK", "1d", "5y"), chart("^BSESN", "1d", "5y"), chart("^INDIAVIX", "1d", "5y")]);
for (const [name, daily, prefix] of [["Nifty 50", nifty, "NIFTY-FUT-1m"], ["Bank Nifty", bank, "BANKNIFTY-FUT-1m"]]) {
  const bars = hourlyFromMinutes(load(prefix));
  const states = dailyStates(daily, bank, vix);
  const inWindow = [...states].filter(([d]) => d >= dayKey(bars[0].t) && d <= dayKey(bars.at(-1).t));
  console.log(`\n=== ${name} futures · ${dayKey(bars[0].t)} to ${dayKey(bars.at(-1).t)} · ${bars.length} hourly bars · regime days ${JSON.stringify(inWindow.reduce((a, [, s]) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {}))}`);
  for (const [label, opt] of [
    ["WITHOUT VWAP/volume · 2R, carry", { target: "2R", intraday: false, vwapVol: false }],
    ["WITH VWAP + volume · 2R, carry", { target: "2R", intraday: false, vwapVol: true }],
    ["WITH VWAP + volume · 2R, intraday only", { target: "2R", intraday: true, vwapVol: true }],
    ["WITH VWAP + volume · trend exit", { target: "trend", intraday: false, vwapVol: true }],
  ]) {
    const t = backtest(bars, states, opt);
    console.log(line(label + " · all", stats(t)));
    console.log(line("   longs", stats(t.filter((x) => x.dir === 1))), "\n" + line("   shorts", stats(t.filter((x) => x.dir === -1))));
  }
}
