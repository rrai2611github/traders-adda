"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RealityCheck } from "./RealityCheck";
import { AppShell } from "./AppShell";
import type { BacktestResult, BacktestSettings, TradeStats } from "@/lib/backtest/types";
import { Term } from "./Term";

type Job = { status: "running"; id: string; message: string } | { status: "failed"; id: string; error: string } | { status: "done"; id: string; result: BacktestResult };

const SCREENS = ["Multi-year breakouts", "Blue sky", "VCP", "IPO base"] as const;

type Form = {
  strategy: "leaders" | (typeof SCREENS)[number];
  rsMin: number; nearHigh: number; breakout: boolean;
  stopKind: "percent" | "atr"; stopPercent: number; stopAtr: number;
  exitKind: "ma" | "target" | "stop"; maPeriod: number; targetR: number; maxHold: number;
  symbol: string;
  /** Screens only: 0 keeps the screen's own RS band. */
  minRs: number;
  /** Buy only while the Nifty 50 closes above its average of this many days; 0 turns it off. */
  niftyAbove: number;
  /** Other screens traded in the same account. */
  also: Array<(typeof SCREENS)[number]>;
  /** Add to a winner once it is this % above the buy price (0 = never), by this % of the first size. */
  addAfter: number;
  addSize: number;
  from: string; to: string; breadth: number; positions: number; risk: number; cost: number; capital: number;
};

const RECOMMENDED: Form = {
  strategy: "Multi-year breakouts", rsMin: 80, nearHigh: 25, breakout: false,
  stopKind: "percent", stopPercent: 12, stopAtr: 2,
  exitKind: "ma", maPeriod: 50, targetR: 3, maxHold: 0,
  symbol: "",
  minRs: 0,
  niftyAbove: 0,
  also: [] as Array<(typeof SCREENS)[number]>,
  addAfter: 0,
  addSize: 100,
  from: "2017-01-01", to: "2026-10-16", breadth: 35, positions: 10, risk: 2, cost: 0.25, capital: 1_000_000,
};

const PRESETS: Array<{ name: string; note: string; form: Partial<Form> }> = [
  { name: "Recommended", note: "Multi-year breakouts, 12% stop, exit under the 50-day average", form: {} },
  { name: "Blue sky", note: "Stocks at all-time highs", form: { strategy: "Blue sky" } },
  { name: "Blue sky, tighter stop", note: "Blue sky with a tighter 8% stop: a little less profit and a deeper worst drop (about 27%) than the 12% stop, but bigger positions (10-year test)", form: { strategy: "Blue sky", stopPercent: 8, breadth: 35, risk: 2 } },
  { name: "Blue sky + Nifty above 200-day", note: "Blue sky, 8% stop, and no buying while the Nifty 50 is under its 200-day average: about 45% a year, worst drop 25%, and total losses cut by about a sixth", form: { strategy: "Blue sky", breadth: 35, niftyAbove: 200, risk: 2 } },
  { name: "Blue sky + Multi-year", note: "Also trade Multi-year breakouts in the same account: about 46% a year with a worst drop of 27% (10-year test). This is the 8% stop version; the Live strategy check follows the 12% stop version below", form: { strategy: "Blue sky", breadth: 35, risk: 2, also: ["Multi-year breakouts"] } },
  { name: "Blue sky + Multi-year, 12% stop", note: "The same with a 12% stop: about 47% a year and a worst drop of 21%, the best result of the combinations I tested. This is the rule the Live strategy check follows", form: { strategy: "Blue sky", breadth: 35, risk: 2, stopPercent: 12, also: ["Multi-year breakouts"] } },
  { name: "Top 5 rule as it is today", note: "Strong stocks, ATR stop, fixed 3R target", form: { strategy: "leaders", stopKind: "atr", exitKind: "target", maxHold: 40 } },
  { name: "Top 5 with a trailing exit", note: "Same stocks, no target, trail the 50-day average", form: { strategy: "leaders", stopKind: "atr", exitKind: "ma", maxHold: 0 } },
];

const toSettings = (f: Form): BacktestSettings => ({
  strategy: f.strategy === "leaders" ? { kind: "leaders", rsMin: f.rsMin, nearHighPercent: f.nearHigh, breakout: f.breakout } : { kind: "screen", screen: f.strategy },
  from: f.from, to: f.to, entry: "next-open",
  stop: f.stopKind === "atr" ? { kind: "atr", multiple: f.stopAtr } : { kind: "percent", percent: f.stopPercent },
  exit: f.exitKind === "ma" ? { kind: "ma", type: "sma", period: f.maPeriod, when: "close" } : f.exitKind === "target" ? { kind: "target", r: f.targetR } : { kind: "stop" },
  maxHoldDays: f.maxHold, costPercent: f.cost, capital: f.capital, maxPositions: f.positions,
  sizing: { kind: "risk", riskPercent: f.risk }, positionCapPercent: 20, turnoverLimitPercent: 10,
  breadthMin: f.breadth, floor: "trading", maxNewPerDay: 3,
  ...(f.symbol.trim() ? { symbol: f.symbol.trim().toUpperCase() } : {}),
  ...(f.strategy !== "leaders" && f.minRs > 0 ? { minRs: f.minRs } : {}),
  ...(f.niftyAbove > 0 ? { niftyAbove: f.niftyAbove } : {}),
  ...(f.strategy !== "leaders" && f.also.length ? { alsoScreens: f.also } : {}),
  ...(f.addAfter > 0 ? { addOn: { afterPercent: f.addAfter, fraction: f.addSize / 100 } } : {}),
});

export const money = (v: number) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
export const pct = (v: number | null, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)}%`);
export const num = (v: number | null, digits = 2) => (v == null ? "—" : v.toFixed(digits));

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
      {label}
      {children}
      {hint && <span className="text-[11.5px] font-medium normal-case tracking-normal text-slate-400">{hint}</span>}
    </label>
  );
}
const inputCls = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-semibold normal-case tracking-normal text-slate-900";

export function Stat({ label, value, tone, note }: { label: ReactNode; value: string; tone?: "good" | "bad"; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-1 text-[22px] font-extrabold tracking-[-0.02em] ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

export function EquityChart({ result }: { result: BacktestResult }) {
  const { days, account, benchmark, drawdown } = result.equity;
  const W = 900, H = 260, DH = 70, pad = 6;
  const geo = useMemo(() => {
    const all = [...account, ...benchmark.filter((v) => v > 0)];
    const lo = Math.min(...all), hi = Math.max(...all);
    const x = (i: number) => pad + (i / Math.max(1, days.length - 1)) * (W - pad * 2);
    const y = (v: number) => H - pad - ((v - lo) / Math.max(1, hi - lo)) * (H - pad * 2);
    const line = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const minDd = Math.min(...drawdown, -1);
    const dd = drawdown.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${((v / minDd) * (DH - 8) + 2).toFixed(1)}`).join("");
    const years: Array<{ x: number; label: string }> = [];
    days.forEach((d, i) => { if (i === 0 || d.slice(0, 4) !== days[i - 1].slice(0, 4)) years.push({ x: x(i), label: d.slice(0, 4) }); });
    return { strategy: line(account), bench: line(benchmark), dd, years, hi, lo };
  }, [account, benchmark, drawdown, days]);
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[11.5px] font-semibold text-slate-600">
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-5 bg-emerald-600" />This strategy</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-5 bg-slate-400" />Nifty 50, same money</span>
        <span className="ml-auto text-slate-400">{money(geo.lo)} – {money(geo.hi)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Account value over time against Nifty 50">
        {geo.years.map((y) => <g key={y.label}><line x1={y.x} x2={y.x} y1={0} y2={H} stroke="#e2e8f0" /><text x={y.x + 3} y={H - 4} fontSize="10" fill="#94a3b8">{y.label}</text></g>)}
        <path d={geo.bench} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        <path d={geo.strategy} fill="none" stroke="#059669" strokeWidth="2" />
      </svg>
      <p className="mb-1 mt-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-slate-500">Drop from the previous peak</p>
      <svg viewBox={`0 0 ${W} ${DH}`} className="w-full" role="img" aria-label="Drawdown">
        <path d={geo.dd} fill="none" stroke="#e11d48" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function HalfRow({ label, s }: { label: string; s: TradeStats }) {
  return <tr className="border-t border-border"><td className="py-1.5 pr-3 font-semibold">{label}</td><td>{s.trades}</td><td>{pct(s.winRate, 0)}</td><td className={(s.avgR ?? 0) > 0 ? "text-emerald-700" : "text-rose-700"}>{num(s.avgR)}R</td><td>{num(s.profitFactor)}</td></tr>;
}

/** Profit and money used, year by year and overall. The first and last years are part years when the dates do not start in January or end in December. */
function YearTable({ result }: { result: BacktestResult }) {
  const s = result.stats;
  const total = { trades: s.trades, bought: s.totalBought };
  const cell = "px-2 py-1.5 text-right tabular-nums";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-[13px] font-extrabold text-slate-900">Profit and money used, year by year</h3>
      <p className="mb-2 text-[11.5px] text-slate-500">Profit is the change in account value after costs, with open positions counted at the year-end price. &quot;Money in trades&quot; is the rupees held in shares, on average across the year and at its highest close. &quot;Bought&quot; is the total spent on shares for trades started that year. These tests only use stocks that are listed today, so companies that failed or were delisted are missing and real results are likely lower.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12.5px]">
          <thead className="text-[11.5px] uppercase tracking-[0.06em] text-slate-500">
            <tr><th className="px-2 py-1 text-left">Year</th><th className="px-2 py-1 text-right">Started with</th><th className="px-2 py-1 text-right">Profit</th><th className="px-2 py-1 text-right">Return</th><th className="px-2 py-1 text-right">Money in trades (avg)</th><th className="px-2 py-1 text-right">Most at once</th><th className="px-2 py-1 text-right">Bought</th><th className="px-2 py-1 text-right">Trades</th><th className="px-2 py-1 text-right">Win</th><th className="px-2 py-1 text-right">Avg R</th></tr>
          </thead>
          <tbody>
            {result.years.map((y) => (
              <tr key={y.year} className="border-t border-border">
                <td className="px-2 py-1.5 font-semibold">{y.year}</td>
                <td className={cell}>{money(y.startValue)}</td>
                <td className={`${cell} font-bold ${y.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{y.pnl >= 0 ? "+" : "−"}{money(Math.abs(y.pnl))}</td>
                <td className={`${cell} ${y.returnPercent >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{pct(y.returnPercent)}</td>
                <td className={cell}>{money(y.avgDeployed)}</td>
                <td className={cell}>{money(y.peakDeployed)}</td>
                <td className={cell}>{money(y.bought)}</td>
                <td className={cell}>{y.trades}</td>
                <td className={cell}>{pct(y.winRate, 0)}</td>
                <td className={cell}>{num(y.avgR)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-extrabold">
              <td className="px-2 py-2 text-left">Overall</td>
              <td className={cell}>{money(result.settings.capital)}</td>
              <td className={`${cell} ${s.totalProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{s.totalProfit >= 0 ? "+" : "−"}{money(Math.abs(s.totalProfit))}</td>
              <td className={`${cell} ${s.totalReturnPercent >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{pct(s.totalReturnPercent)}</td>
              <td className={cell}>{money(s.avgDeployed)}</td>
              <td className={cell}>{money(s.peakDeployed)}</td>
              <td className={cell}>{money(total.bought)}</td>
              <td className={cell}>{total.trades}</td>
              <td className={cell}>{pct(s.winRate, 0)}</td>
              <td className={cell}>{num(s.avgR)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Results({ result }: { result: BacktestResult }) {
  const s = result.stats;
  const verdict = (s.avgR ?? 0) <= 0 ? "No edge: this rule lost money per trade after costs." : (result.halves && Math.min(result.halves.first.avgR ?? 0, result.halves.second.avgR ?? 0) <= 0) ? "Positive overall but one half of the period lost money, so treat the edge as unproven." : "Positive in both halves of the period.";
  return (
    <section className="space-y-4" aria-label="Backtest result">
      <div className="rounded-xl border border-border bg-surface p-4 text-[13px] text-slate-700">
        <p className="font-bold text-slate-900">{verdict}</p>
        <p className="mt-1">
          {s.trades} trades over {result.data.sessions} sessions ({result.data.symbols} stocks in the history). R is the money risked on a trade: +1R means a profit equal to the loss you accepted at the stop.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Overall profit" value={money(s.totalProfit)} tone={s.totalProfit >= 0 ? "good" : "bad"} note={`on ${money(result.settings.capital)} start, after costs`} />
        <Stat label="Money in trades" value={money(s.avgDeployed)} note={`on average · most at once ${money(s.peakDeployed)}`} />
        <Stat label={<Term k="r">Average per trade</Term>} value={`${num(s.avgR)}R`} tone={(s.avgR ?? 0) > 0 ? "good" : "bad"} note="after costs" />
        <Stat label="Yearly return (CAGR)" value={pct(s.cagrPercent)} tone={(s.cagrPercent ?? 0) > 0 ? "good" : "bad"} note={`total ${pct(s.totalReturnPercent, 0)}`} />
        <Stat label={<Term k="drawdown">Worst drop</Term>} value={pct(s.maxDrawdownPercent, 0)} tone="bad" note="peak to bottom" />
        <Stat label={<Term k="winRate">Win rate</Term>} value={pct(s.winRate, 0)} note={`profit factor ${num(s.profitFactor)}`} />
        <Stat label="Trades per year" value={num(s.tradesPerYear, 0)} note={`avg hold ${num(s.avgHoldDays, 0)} sessions`} />
        <Stat label="Time in the market" value={pct(s.exposurePercent, 0)} note="of sessions with a position open" />
        <Stat label="Total bought" value={money(s.totalBought)} note="spent on shares over all trades" />
      </div>
      <EquityChart result={result} />
      <div className="grid gap-4 lg:grid-cols-2">
        {result.halves && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="text-[13px] font-extrabold text-slate-900">Does it hold up? Two halves of the period</h3>
            <p className="mb-2 text-[11.5px] text-slate-500">Split at {result.halves.split}. A real edge shows in both.</p>
            <table className="w-full text-left text-[12.5px]"><thead className="text-[11.5px] uppercase tracking-[0.06em] text-slate-500"><tr><th className="py-1">Half</th><th>Trades</th><th>Win</th><th>Avg</th><th>PF</th></tr></thead><tbody>
              <HalfRow label="First" s={result.halves.first} /><HalfRow label="Second" s={result.halves.second} />
            </tbody></table>
          </div>
        )}
      </div>
      <YearTable result={result} />
      <RealityCheck result={result} />
      <details className="rounded-xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-[13px] font-extrabold text-slate-900">Latest trades ({Math.min(60, result.trades.length)} of {result.tradeCount})</summary>
        <div className="mt-3 overflow-x-auto">
          <p className="mb-1 text-[11px] text-slate-500">Prices and P&amp;L in rupees (₹), after costs. R is the profit as a multiple of the amount risked on the trade.</p>
          <table className="w-full min-w-[640px] text-left text-[12px]"><thead className="text-[11.5px] uppercase tracking-[0.06em] text-slate-500"><tr><th className="py-1">Stock</th><th>Bought</th><th>Price</th><th>Sold</th><th>Price</th><th>Why</th><th>R</th><th>P&amp;L</th></tr></thead><tbody>
            {result.trades.slice(-60).reverse().map((t, i) => <tr key={`${t.symbol}${t.entryDay}${i}`} className="border-t border-border"><td className="py-1 font-bold">{t.symbol}</td><td>{t.entryDay}</td><td>{t.entryPrice.toFixed(1)}</td><td>{t.exitDay}</td><td>{t.exitPrice.toFixed(1)}</td><td>{t.exitReason}</td><td className={t.r >= 0 ? "text-emerald-700" : "text-rose-700"}>{t.r.toFixed(2)}</td><td>{money(t.pnl)}</td></tr>)}
          </tbody></table>
        </div>
      </details>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-950">
        <p className="font-extrabold">Read this before trusting the numbers</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      </div>
    </section>
  );
}

export function BacktestPage() {
  const [form, setForm] = useState<Form>(RECOMMENDED);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // A stock named in the address (from "How would the rules have traded this?") fills the form once the page is on screen.
  useEffect(() => {
    const symbol = new URLSearchParams(window.location.search).get("symbol");
    if (!symbol) return;
    const id = setTimeout(() => setForm((f) => ({ ...f, symbol: symbol.toUpperCase().slice(0, 20), from: "2017-01-01" })), 0);
    return () => clearTimeout(id);
  }, []);

  const poll = (id: string) => {
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/backtest?id=${id}`, { cache: "no-store" });
        if (!res.ok) { setError("The server forgot this run (it restarted). Run it again."); setJob(null); return; }
        const next = (await res.json()) as Job;
        setJob(next);
        if (next.status === "running") poll(id);
      } catch { setError("Could not reach the server."); setJob(null); }
    }, 1500);
  };
  const run = async () => {
    if (timer.current) clearTimeout(timer.current);
    setError(null); setJob({ status: "running", id: "", message: "starting" });
    try {
      const res = await fetch("/api/backtest", { method: "POST", body: JSON.stringify(toSettings(form)) });
      const next = (await res.json()) as Job;
      setJob(next);
      if (next.status === "running") poll(next.id);
    } catch { setError("Could not start the backtest."); setJob(null); }
  };

  return (
    <AppShell current="backtest">
    <div className="mx-auto w-full min-w-0 max-w-[1180px] space-y-5 px-4 py-6 lg:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-slate-900">Backtest</h1>
          <p className="text-[12.5px] text-slate-500">Replay a stock-picking rule on ten years of NSE prices with one account, real costs and the breadth gate.</p>
        </div>
      </header>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-4" aria-label="Settings">
        <div role="group" aria-label="Starting points" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p, index) => (
            <button key={p.name} type="button" onClick={() => setForm({ ...RECOMMENDED, ...p.form })} className={`flex flex-col gap-1 rounded-xl border bg-white px-3.5 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${index === 0 ? "border-[#e6b53c] ring-1 ring-[#e6b53c]/40" : "border-slate-200 hover:border-slate-300"}`}>
              <span className="flex items-center gap-2 text-[12.5px] font-extrabold text-slate-900">{p.name}{index === 0 && <span className="rounded-full bg-[#e6b53c]/20 px-1.5 py-0.5 text-[11px] font-black text-accent">main plan</span>}</span>
              <span className="text-[11.5px] leading-4 text-slate-500">{p.note}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Which stocks" hint="Screens test breakouts that passed that screen; Top 5 rule picks strong stocks daily.">
            <select className={inputCls} value={form.strategy} onChange={(e) => set("strategy", e.target.value as Form["strategy"])}>
              {SCREENS.map((s) => <option key={s}>{s}</option>)}<option value="leaders">Top 5 rule (strong stocks)</option>
            </select>
          </Field>
          {form.strategy === "leaders" && <>
            <Field label="Min RS rank"><input className={inputCls} type="number" min={1} max={99} value={form.rsMin} onChange={(e) => set("rsMin", Number(e.target.value))} /></Field>
            <Field label="Within % of high"><input className={inputCls} type="number" min={1} max={90} value={form.nearHigh} onChange={(e) => set("nearHigh", Number(e.target.value))} /></Field>
            <Field label="Needs breakout"><select className={inputCls} value={form.breakout ? "yes" : "no"} onChange={(e) => set("breakout", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></Field>
          </>}
          <Field label="Stop loss">
            <select className={inputCls} value={form.stopKind} onChange={(e) => set("stopKind", e.target.value as Form["stopKind"])}><option value="percent">Fixed %</option><option value="atr">ATR multiple</option></select>
          </Field>
          {form.stopKind === "percent"
            ? <Field label="Stop %" hint="Below the buy price"><input className={inputCls} type="number" min={1} max={25} step={0.5} value={form.stopPercent} onChange={(e) => set("stopPercent", Number(e.target.value))} /></Field>
            : <Field label="ATR ×" hint="Daily range multiples"><input className={inputCls} type="number" min={0.5} max={6} step={0.5} value={form.stopAtr} onChange={(e) => set("stopAtr", Number(e.target.value))} /></Field>}
          <Field label="Exit">
            <select className={inputCls} value={form.exitKind} onChange={(e) => set("exitKind", e.target.value as Form["exitKind"])}><option value="ma">Close under average</option><option value="target">Fixed R target</option><option value="stop">Only the stop</option></select>
          </Field>
          {form.exitKind === "ma" && <Field label="Average (days)"><input className={inputCls} type="number" min={5} max={200} value={form.maPeriod} onChange={(e) => set("maPeriod", Number(e.target.value))} /></Field>}
          {form.exitKind === "target" && <Field label="Target (R)"><input className={inputCls} type="number" min={0.5} max={20} step={0.5} value={form.targetR} onChange={(e) => set("targetR", Number(e.target.value))} /></Field>}
          <Field label="From"><input className={inputCls} type="date" value={form.from} min="2016-12-01" onChange={(e) => set("from", e.target.value)} /></Field>
          <Field label="To"><input className={inputCls} type="date" value={form.to} onChange={(e) => set("to", e.target.value)} /></Field>
          <Field label="Capital ₹"><input className={inputCls} type="number" min={10000} step={100000} value={form.capital} onChange={(e) => set("capital", Number(e.target.value))} /></Field>
        </div>
        <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
            <span className="text-[12.5px] font-extrabold text-slate-800">More options <span className="font-semibold text-slate-500">· one stock only, minimum RS, breadth and Nifty checks, extra screens, adding to winners, positions, risk and costs</span></span>
            <span className="shrink-0 text-[11.5px] font-bold text-accent group-open:hidden">Show</span><span className="hidden shrink-0 text-[11.5px] font-bold text-accent group-open:inline">Hide</span>
          </summary>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-3.5 md:grid-cols-4">
          <Field label="Only this stock" hint="Optional symbol, e.g. TATAELXSI"><input className={inputCls} type="text" value={form.symbol} placeholder="all stocks" onChange={(e) => set("symbol", e.target.value)} /></Field>
          {form.strategy !== "leaders" && <Field label="Minimum RS rank" hint="0 = the screen's own band. Higher skips weaker stocks"><input className={inputCls} type="number" min={0} max={99} value={form.minRs} onChange={(e) => set("minRs", Number(e.target.value))} /></Field>}
          <Field label="Sell after (days)" hint="0 = no time limit"><input className={inputCls} type="number" min={0} max={500} value={form.maxHold} onChange={(e) => set("maxHold", Number(e.target.value))} /></Field>
          <Field label="Buy only if breadth ≥ %" hint="Share of stocks above their 50-day average"><input className={inputCls} type="number" min={0} max={100} value={form.breadth} onChange={(e) => set("breadth", Number(e.target.value))} /></Field>
          <Field label="Buy only if Nifty above (days)" hint="Nifty 50 closes above its average of this many days. 0 = off"><input className={inputCls} type="number" min={0} max={400} value={form.niftyAbove} onChange={(e) => set("niftyAbove", Number(e.target.value))} /></Field>
          {form.strategy !== "leaders" && (
            <Field label="Also trade these screens" hint="Same account, strongest RS first">
              <div className="flex flex-wrap gap-x-3 gap-y-1 py-1.5">
                {SCREENS.filter((name) => name !== form.strategy).map((name) => (
                  <label key={name} className="flex items-center gap-1.5 text-[12px] font-semibold normal-case tracking-normal text-slate-700">
                    <input type="checkbox" checked={form.also.includes(name)} onChange={(e) => set("also", e.target.checked ? [...form.also, name] : form.also.filter((n) => n !== name))} />
                    {name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field label="Add to winners at +%" hint="0 = never. Buys more once it is this far above your buy price"><input className={inputCls} type="number" min={0} max={200} value={form.addAfter} onChange={(e) => set("addAfter", Number(e.target.value))} /></Field>
          {form.addAfter > 0 && <Field label="Add size (% of first buy)"><input className={inputCls} type="number" min={10} max={200} value={form.addSize} onChange={(e) => set("addSize", Number(e.target.value))} /></Field>}
          <Field label="Max positions"><input className={inputCls} type="number" min={1} max={50} value={form.positions} onChange={(e) => set("positions", Number(e.target.value))} /></Field>
          <Field label="Risk per trade %"><input className={inputCls} type="number" min={0.1} max={5} step={0.1} value={form.risk} onChange={(e) => set("risk", Number(e.target.value))} /></Field>
          <Field label="Cost per side %" hint="Brokerage, tax, slippage"><input className={inputCls} type="number" min={0} max={3} step={0.05} value={form.cost} onChange={(e) => set("cost", Number(e.target.value))} /></Field>
          </div>
        </details>
        <p className="text-[12px] text-slate-500">Want to see these rules on today&apos;s real prices instead of the past? Follow them with paper money on the <Link href="/tracker" className="font-bold text-emerald-700 underline">Live strategy check</Link>.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={run} disabled={job?.status === "running"} className="btn-gold h-10 rounded-xl px-5 text-sm font-extrabold">{job?.status === "running" ? "Running…" : "Run backtest"}</button>
          {job?.status === "running" && <span className="text-xs font-semibold text-slate-500">{job.message || "working"} — the first run builds ranks and can take a minute or two.</span>}
          {error && <span className="text-xs font-semibold text-rose-700">{error}</span>}
          {job?.status === "failed" && <span className="text-xs font-semibold text-rose-700">Failed: {job.error}</span>}
        </div>
      </section>

      {job?.status === "done" && <Results result={job.result} />}
    </div>
    </AppShell>
  );
}
