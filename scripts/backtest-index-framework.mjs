// Backtest of the "Daily trend + hourly entry" index framework on Nifty 50 / Bank Nifty / Sensex.
// Testable rules only: Yahoo index data has no volume, so the VWAP, volume and breadth conditions cannot be
// tested; they are replaced by nothing (the rule set is looser than the framework, which is flagged in the report).
// Usage: node --use-system-ca --no-warnings scripts/backtest-index-framework.mjs
const IST = 19_800_000, HOUR = 3_600_000;
const COST_PCT = 0.03; // round trip, index futures

async function chart(ticker, interval, range) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`${ticker} ${interval} ${r.status}`);
  const j = (await r.json()).chart.result[0];
  const q = j.indicators.quote[0];
  return j.timestamp.map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter((k) => k.c > 0 && k.h > 0);
}

const sma = (v, n) => v.map((_, i) => (i + 1 < n ? null : v.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
function ema(v, n) { const k = 2 / (n + 1); const out = []; let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; out.push(i + 1 < n ? null : e); } return out; }
function rsi(v, n = 14) { const out = Array(v.length).fill(null); let g = 0, l = 0; for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1], u = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= n) { g += u / n; l += dn / n; } else { g = (g * (n - 1) + u) / n; l = (l * (n - 1) + dn) / n; } if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return out; }
function atr(bars, n = 14) { const out = Array(bars.length).fill(null); let a = 0; for (let i = 1; i < bars.length; i++) { const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)); a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n; if (i >= n) out[i] = a; } return out; }
const dayKey = (t) => new Date(t + IST).toISOString().slice(0, 10);
const onGrid = (t) => (t + IST) % HOUR === 900_000;

/** Daily state per date, decided at that day's close (used from the next session on, so no look-ahead). */
function dailyStates(daily, bank, vix) {
  const c = daily.map((k) => k.c);
  const s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c), e12 = ema(c, 12), e26 = ema(c, 26);
  const macd = c.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const bankC = new Map(bank.map((k, i) => [dayKey(k.t), { c: k.c, s50: sma(bank.map((x) => x.c), 50)[i] }]));
  const bc = bank.map((k) => k.c), bs50 = sma(bc, 50);
  const bankState = new Map(bank.map((k, i) => [dayKey(k.t), bs50[i] == null ? null : k.c > bs50[i] ? 1 : -1]));
  const vixByDay = new Map(vix.map((k) => [dayKey(k.t), k.c]));
  const vixDays = vix.map((k) => dayKey(k.t));
  const states = new Map();
  daily.forEach((k, i) => {
    if (s200[i] == null || r[i] == null || macd[i] == null) return;
    const d = dayKey(k.t), vi = vixDays.indexOf(d);
    const vNow = vixByDay.get(d), vThen = vi >= 5 ? vixByDay.get(vixDays[vi - 5]) : null;
    const vixOk = vNow != null && vThen != null ? vNow <= vThen * 1.03 : null;
    const vixUp = vNow != null && vThen != null ? vNow > vThen * 1.03 : null;
    const bk = bankState.get(d);
    const bull = k.c > s50[i] && s50[i] > s200[i] && r[i] > 55 && macd[i] > 0 && vixOk !== false && bk !== -1;
    const bear = k.c < s50[i] && s50[i] < s200[i] && r[i] < 45 && macd[i] < 0 && vixUp !== false && bk !== 1;
    states.set(d, bull ? "bull" : bear ? "bear" : "none");
  });
  return states;
}

function backtest(name, hourly, daily, states, opt) {
  const bars = hourly.filter((k) => onGrid(k.t)).sort((a, b) => a.t - b.t);
  const closes = bars.map((b) => b.c), e20 = ema(closes, 20), r14 = rsi(closes), a14 = atr(bars);
  const days = [...new Set(bars.map((b) => dayKey(b.t)))];
  const prevDayOf = new Map(days.map((d, i) => [d, days[i - 1]]));
  const trades = [];
  let pos = null, openDay = null;
  const perDay = new Map();
  for (let i = 25; i < bars.length - 1; i++) {
    const b = bars[i], d = dayKey(b.t), next = bars[i + 1];
    const lastOfDay = dayKey(next.t) !== d;
    // manage the open trade on this bar
    if (pos) {
      const long = pos.dir === 1;
      let exit = null, why = "";
      if (long ? b.l <= pos.stop : b.h >= pos.stop) { exit = pos.stop; why = "stop"; }
      else if (opt.target === "2R" && (long ? b.h >= pos.tp : b.l <= pos.tp)) { exit = pos.tp; why = "target"; }
      else if (opt.target === "trend" && (long ? (b.c < e20[i] || r14[i] < 50) : (b.c > e20[i] || r14[i] > 50))) { exit = b.c; why = "trend"; }
      else if (opt.intraday && lastOfDay) { exit = b.c; why = "eod"; }
      else if (i - pos.i >= 60) { exit = b.c; why = "time"; }
      if (exit != null) {
        const pts = (exit - pos.entry) * pos.dir - (pos.entry * COST_PCT) / 100;
        trades.push({ t: pos.t, dir: pos.dir, r: pts / pos.risk, why, year: dayKey(pos.t).slice(0, 4) });
        const pd = perDay.get(pos.day) ?? { n: 0, losses: 0, r: 0 }; pd.r += pts / pos.risk; if (pts < 0) pd.losses++; perDay.set(pos.day, pd);
        pos = null;
      }
    }
    if (pos || lastOfDay) continue;
    // daily state from the previous session's close
    const st = states.get(prevDayOf.get(d)) ?? "none";
    if (st === "none") continue;
    const pd = perDay.get(d) ?? { n: 0, losses: 0, r: 0 };
    if (opt.limits && (pd.n >= 3 || pd.losses >= 2 || pd.r <= -2)) continue;
    const dir = st === "bull" ? 1 : -1;
    const prev = bars[i - 1];
    // hourly set-up (testable subset): EMA20, RSI, HH/HL, close beyond the previous hour's extreme
    const hhhl = dir === 1 ? b.h > prev.h && b.l > prev.l && prev.h > bars[i - 2].h : b.l < prev.l && b.h < prev.h && prev.l < bars[i - 2].l;
    const ok = dir === 1
      ? b.c > e20[i] && r14[i] > 60 && b.c > prev.h && (!opt.hhhl || hhhl)
      : b.c < e20[i] && r14[i] < 40 && b.c < prev.l && (!opt.hhhl || hhhl);
    if (!ok) continue;
    const entry = next.o; // filled at the next bar's open
    const swing = dir === 1 ? Math.min(...bars.slice(i - 5, i + 1).map((x) => x.l)) : Math.max(...bars.slice(i - 5, i + 1).map((x) => x.h));
    const dist = Math.max(Math.abs(entry - swing), 1.5 * a14[i]); // "whichever is larger" = the wider stop
    const stop = entry - dir * dist;
    pos = { dir, entry, stop, risk: dist, tp: entry + dir * 2 * dist, t: next.t, i: i + 1, day: dayKey(next.t) };
    pd.n++; perDay.set(d, pd);
  }
  return trades;
}

function stats(trades) {
  if (!trades.length) return null;
  const r = trades.map((t) => t.r), w = r.filter((x) => x > 0), gross = w.reduce((a, b) => a + b, 0), loss = -r.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
  let eq = 1, peak = 1, dd = 0;
  for (const t of [...trades].sort((a, b) => a.t - b.t)) { eq *= 1 + 0.01 * t.r; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak); }
  return { n: trades.length, win: (w.length / r.length) * 100, avgR: r.reduce((a, b) => a + b, 0) / r.length, pf: loss ? gross / loss : Infinity, ret: (eq - 1) * 100, dd: dd * 100 };
}
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "inf");
const line = (label, s) => (s ? `${label.padEnd(34)} ${String(s.n).padStart(5)} trades  win ${f(s.win, 0).padStart(3)}%  avg ${f(s.avgR).padStart(5)}R  PF ${f(s.pf)}  1%-risk return ${f(s.ret, 1).padStart(6)}%  maxDD ${f(s.dd, 1)}%` : `${label.padEnd(34)}     0 trades`);

const [nifty, bank, sensex, vix, niftyH, bankH, sensexH] = await Promise.all([
  chart("^NSEI", "1d", "5y"), chart("^NSEBANK", "1d", "5y"), chart("^BSESN", "1d", "5y"), chart("^INDIAVIX", "1d", "5y"),
  chart("^NSEI", "1h", "2y"), chart("^NSEBANK", "1h", "2y"), chart("^BSESN", "1h", "2y"),
]);
const span = (h) => `${dayKey(h[0].t)} to ${dayKey(h.at(-1).t)}`;
console.log(`Hourly data: Nifty ${span(niftyH)} (${niftyH.length} bars)`);
const sets = [["Nifty 50", nifty, niftyH], ["Bank Nifty", bank, bankH], ["Sensex", sensex, sensexH]];
const configs = [
  { label: "2R target, carry overnight", opt: { target: "2R", intraday: false, limits: true, hhhl: true } },
  { label: "2R target, intraday only", opt: { target: "2R", intraday: true, limits: true, hhhl: true } },
  { label: "Trend exit (EMA20 / RSI50)", opt: { target: "trend", intraday: false, limits: true, hhhl: true } },
  { label: "2R, no HH/HL requirement", opt: { target: "2R", intraday: false, limits: true, hhhl: false } },
];
for (const [name, daily, hourly] of sets) {
  const states = dailyStates(daily, bank, vix);
  const counts = [...states.values()].reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {});
  console.log(`\n=== ${name} · daily regime days: ${JSON.stringify(counts)}`);
  for (const c of configs) {
    const t = backtest(name, hourly, daily, states, c.opt);
    console.log(line(c.label + " · all", stats(t)));
    console.log(line("   longs", stats(t.filter((x) => x.dir === 1))));
    console.log(line("   shorts", stats(t.filter((x) => x.dir === -1))));
    if (c === configs[0]) for (const y of [...new Set(t.map((x) => x.year))].sort()) console.log(line(`   year ${y}`, stats(t.filter((x) => x.year === y))));
  }
}
