"use client";

import Link from "next/link";
import { ScalpNav } from "./ScalpNav";
import { useEffect, useState } from "react";
import type { IndexBacktest, ScalpBacktestReport, SetupGroup, SetupResult } from "@/lib/scalp/backtestRun";
import type { TradeStats } from "@/lib/scalp/backtest";

const GROUP_LABEL: Record<SetupGroup, string> = {
  scalp: "Scalp", intraday: "Intraday hold", swing: "Swing", selling: "Option selling", trend: "Positional trend",
};

const rs = (value: number | null | undefined, sign = true) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const text = `₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
  return value < 0 ? `−${text}` : sign && value > 0 ? `+${text}` : text;
};
const pct = (value: number | null | undefined) => (value == null ? "—" : `${Math.round(value * 100)}%`);
const signedPct = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%`;
const pts = (value: number | null | undefined) => (value == null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`);
const pf = (value: number | null | undefined) => (value == null ? "—" : Number.isFinite(value) ? value.toFixed(2) : "∞");
const tone = (value: number | null | undefined) => (value == null ? "text-slate-300" : value > 0 ? "text-emerald-400" : value < 0 ? "text-rose-400" : "text-slate-300");
const time = (t: number) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const verdictClass = (edge: boolean) => (edge ? "bg-emerald-900/60 text-emerald-200" : "bg-rose-900/60 text-rose-200");

export function ScalpBacktest() {
  const [report, setReport] = useState<ScalpBacktestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [selected, setSelected] = useState<string>("ORB");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scalp/backtest?days=365", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (response.status === 401) setNeedsLogin(true);
        else if (!response.ok) setError(body.error || "Backtest failed.");
        else setReport(body as ScalpBacktestReport);
      })
      .catch(() => { if (!cancelled) setError("Could not reach the server."); });
    return () => { cancelled = true; };
  }, []);

  const setupList = report?.indexes[0]?.setups ?? [];

  return (
    <main className="min-h-screen bg-[#060b16] text-slate-200">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-3 py-3 sm:px-5">
        <ScalpNav current="backtest" />
        <header className="rounded-xl border border-slate-800 bg-[#0b1220] px-4 py-3">
          <h1 className="text-xl font-black tracking-tight text-white">Index strategy backtest</h1>
          <p className="text-xs text-slate-400">
            Scalps, intraday holds and 1–3 day swings on Nifty and Bank Nifty, replayed on Fyers history and judged after every cost.
          </p>
        </header>

        {needsLogin ? (
          <div className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            Fyers login needed for today. <a href="/api/fyers/login" className="font-bold underline">Connect Fyers</a>, then reload this page.
          </div>
        ) : null}
        {error ? <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-200">{error}</div> : null}
        {!report && !error && !needsLogin ? (
          <div className="rounded-xl border border-slate-800 bg-[#0b1220] px-4 py-8 text-center text-sm text-slate-400">
            Running the backtest… the first run downloads about a year of 1-minute data and can take a minute.
          </div>
        ) : null}

        {report ? (
          <>
            <Comparison
              report={report}
              onSelect={(key) => {
                setSelected(key);
                requestAnimationFrame(() => document.getElementById("setup-details")?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
            />
            <div id="setup-details" className="flex scroll-mt-3 flex-wrap gap-1" role="tablist" aria-label="Setup details">
              {setupList.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={selected === s.key}
                  onClick={() => setSelected(s.key)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${selected === s.key ? "border-sky-500 bg-sky-500 text-white" : "border-slate-700 text-slate-300 hover:bg-slate-800"}`}
                >
                  {GROUP_LABEL[s.group]}: {s.name}
                </button>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {report.indexes.map((ix) => {
                const setup = ix.setups.find((s) => s.key === selected);
                return setup ? <SetupCard key={ix.index} ix={ix} setup={setup} /> : null;
              })}
            </div>
            <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4 text-xs text-slate-400">
              <h2 className="text-sm font-bold text-white">How this was tested</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {report.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
              <p className="mt-2">Generated {new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.</p>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

type Ranked = { ix: IndexBacktest; setup: SetupResult; tier: number };

/** 0 passed · 1 profitable but model-sensitive · 2 profitable but unproven · 3 lost money. */
function tierOf(s: SetupResult): number {
  if (s.verdict.edge) return 0;
  if (s.stats.totalNet <= 0) return 3;
  return s.verdict.label === "Model-sensitive" ? 1 : 2;
}

const TIER_STYLE = [
  { badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40", rank: "bg-emerald-500 text-slate-950" },
  { badge: "bg-amber-500/15 text-amber-300 ring-amber-500/40", rank: "bg-amber-400 text-slate-950" },
  { badge: "bg-sky-500/15 text-sky-300 ring-sky-500/40", rank: "bg-sky-500 text-slate-950" },
  { badge: "bg-rose-500/10 text-rose-300 ring-rose-500/30", rank: "bg-slate-800 text-slate-400" },
];

/** ₹1.63L / ₹51.8k style for the summary table. */
const short = (value: number, sign = true) => {
  const a = Math.abs(value);
  const body = a >= 1e5 ? `₹${(a / 1e5).toFixed(2)}L` : a >= 1e3 ? `₹${(a / 1e3).toFixed(1)}k` : `₹${Math.round(a)}`;
  return value < 0 ? `−${body}` : sign && value > 0 ? `+${body}` : body;
};

function Comparison({ report, onSelect }: { report: ScalpBacktestReport; onSelect: (key: string) => void }) {
  const [filter, setFilter] = useState<"ALL" | IndexBacktest["index"]>("ALL");
  const [showLosers, setShowLosers] = useState(true);
  const ranked: Ranked[] = report.indexes
    .flatMap((ix) => ix.setups.map((setup) => ({ ix, setup, tier: tierOf(setup) })))
    .sort((a, b) => a.tier - b.tier || b.setup.capital.perYearPct - a.setup.capital.perYearPct);
  const rankOf = new Map(ranked.map((r, i) => [r, i + 1]));
  const rows = ranked.filter((r) => (filter === "ALL" || r.ix.index === filter) && (showLosers || r.tier < 3));
  const passed = ranked.filter((r) => r.tier === 0).length;
  const profitable = ranked.filter((r) => r.tier < 3).length;
  const maxReturn = Math.max(0.01, ...ranked.map((r) => Math.abs(r.setup.capital.perYearPct)));

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-white">Strategy ranking</h2>
          <p className="text-[11px] text-slate-400">
            1 lot each, after all costs. Ranked by verdict first, then by yearly return on the capital used. Click a row for details.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Pill tone="emerald">{passed} passed</Pill>
          <Pill tone="amber">{profitable - passed} profitable, unproven</Pill>
          <Pill tone="rose">{ranked.length - profitable} lost money</Pill>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(["ALL", ...report.indexes.map((ix) => ix.index)] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${filter === key ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >
            {key === "ALL" ? "Both indexes" : report.indexes.find((ix) => ix.index === key)?.name}
          </button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={showLosers} onChange={(e) => setShowLosers(e.target.checked)} className="accent-sky-500" />
          Show losing strategies
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <div className={`hidden items-center gap-x-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:grid lg:grid-cols-[2.5rem_minmax(0,1fr)_9rem_10rem_6.5rem_9.5rem_4.5rem]`}>
          <span>Rank</span><span>Strategy</span><span>Verdict</span><span className="text-right">Capital → end</span>
          <span className="text-right">Profit</span><span>Return / yr</span><span className="text-center">Halves</span>
        </div>
        {rows.map((r) => {
          const s = r.setup;
          const style = TIER_STYLE[r.tier];
          const width = `${Math.min(100, (Math.abs(s.capital.perYearPct) / maxReturn) * 100)}%`;
          return (
            <button
              key={`${r.ix.index}-${s.key}`}
              type="button"
              onClick={() => onSelect(s.key)}
              className={`grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-left transition hover:border-slate-600 hover:bg-slate-800/80 lg:gap-x-4 lg:grid-cols-[2.5rem_minmax(0,1fr)_9rem_10rem_6.5rem_9.5rem_4.5rem] ${r.tier === 3 ? "opacity-80" : ""}`}
            >
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-black ${style.rank}`}>{rankOf.get(r)}</span>
              <span className="min-w-0">
                <span className="block font-bold text-white">{s.name}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  <b className="text-slate-300">{r.ix.name}</b> · {GROUP_LABEL[s.group]} · {s.stats.trades} trades · {pct(s.stats.winRate)} win
                </span>
              </span>
              <span className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:contents">
                <span className="col-span-2 sm:col-span-4 lg:col-span-1">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${style.badge}`} title={s.verdict.detail}>{s.verdict.label}</span>
                </span>
                <Cell label="Capital → end" className="lg:text-right">
                  <span className="text-slate-300">{short(s.capital.needed, false)}</span> <span className="text-slate-500">→</span>{" "}
                  <b className={tone(s.stats.totalNet)}>{short(s.capital.endValue, false)}</b>
                </Cell>
                <Cell label="Profit after costs" className="lg:text-right">
                  <b className={`text-base ${tone(s.stats.totalNet)}`}>{short(s.stats.totalNet)}</b>
                </Cell>
                <Cell label="Return per year">
                  <b className={`text-xs ${tone(s.capital.perYearPct)}`}>{signedPct(s.capital.perYearPct)}</b>
                  <span className="ml-1 text-[11px] text-slate-500">({s.capital.years.toFixed(1)} yrs)</span>
                  <span className="mt-1 block h-1.5 rounded-full bg-slate-800">
                    <span className={`block h-1.5 rounded-full ${s.capital.perYearPct >= 0 ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width }} />
                  </span>
                </Cell>
                <Cell label="Both halves" className="lg:text-center">
                  {s.halves.map((h, i) => (
                    <span
                      key={i}
                      title={`${i ? "2nd" : "1st"} half: ${rs(h.totalNet)}`}
                      className={`mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-xs font-black ${h.totalNet > 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}
                    >
                      {h.totalNet > 0 ? "✓" : "✗"}
                    </span>
                  ))}
                </Cell>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        <b className="text-slate-300">Passed</b> needs enough trades (100 intraday, 50 swing, 200 option-selling legs, 10 trend trades), a positive average trade after costs and a profit in both halves.
        Capital = money one lot blocks today + the worst drawdown. Return per year is simple, not compounded. Hover a verdict or a half for detail.
      </p>
    </section>
  );
}

function Cell({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <span className={`block whitespace-nowrap ${className}`}>
      <span className="block text-[10px] uppercase tracking-wider text-slate-500 lg:hidden">{label}</span>
      {children}
    </span>
  );
}

function Pill({ tone: color, children }: { tone: "emerald" | "amber" | "rose"; children: React.ReactNode }) {
  const cls = { emerald: "bg-emerald-500/15 text-emerald-300", amber: "bg-amber-500/15 text-amber-300", rose: "bg-rose-500/15 text-rose-300" }[color];
  return <span className={`rounded-full px-2.5 py-1 font-bold ${cls}`}>{children}</span>;
}

function SetupCard({ ix, setup }: { ix: IndexBacktest; setup: SetupResult }) {
  const s = setup.stats;
  const isFuture = setup.instrument.startsWith("Index future");
  const selling = setup.group === "selling";
  const daily = setup.group === "swing" || setup.group === "trend";
  const spreads = setup.instrument.startsWith("Iron condor");
  const sideLabel = (side: "CE" | "PE") => isFuture ? (side === "CE" ? "Long" : "Short")
    : spreads ? (side === "CE" ? "Call spread" : "Put spread")
    : selling ? (side === "CE" ? "Short call" : "Short put")
    : side === "CE" ? "Call buys (bullish)" : "Put buys (bearish)";
  const exitText = setup.group === "trend"
    ? `Exits: ${s.exits.time} on a trend flip · ${s.exits.eod} still open at the end (marked at the last close).`
    : `Exits: ${s.exits.target} target · ${s.exits.stop} stop · ${s.exits.time} time · ${s.exits.eod} ${selling ? "bought back at 15:15" : "end of day"}.`;
  const periods = daily ? byYear(setup.months) : setup.months.map((m) => ({ label: m.month, trades: m.trades, net: m.net }));
  const when = (t: number) => (daily ? new Date(t + 19_800_000).toISOString().slice(5, 10) : time(t));
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-[#0b1220] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-white">{ix.name}</h2>
          <p className="text-[11px] text-slate-400">{setup.from} → {setup.to} · {setup.sessions} sessions · {setup.instrument} ({ix.lotSize})</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${verdictClass(setup.verdict.edge)}`}>{setup.verdict.label}</span>
      </div>
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-300">
        <b className="text-white">{setup.name}.</b> {setup.rule} {setup.plan}
      </div>
      <p className="text-xs text-slate-300">{setup.verdict.detail}</p>
      {selling && !spreads ? (
        <Link href="/scalp/paper" className="text-xs font-bold text-amber-300 hover:underline">Track it with real option prices on the paper straddle page →</Link>
      ) : null}

      <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Capital used" value={rs(setup.capital.needed, false)} />
          <Stat label="Profit after costs" value={rs(s.totalNet)} className={tone(s.totalNet)} />
          <Stat label="Account at the end" value={rs(setup.capital.endValue, false)} className={tone(s.totalNet)} />
          <Stat label={`Return (${setup.capital.years.toFixed(1)} yrs)`} value={`${signedPct(setup.capital.returnPct)} · ${signedPct(setup.capital.perYearPct)}/yr`} className={tone(setup.capital.returnPct)} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Capital = {rs(setup.capital.blocked, false)} for 1 lot + {rs(setup.capital.needed - setup.capital.blocked, false)} to sit through the worst drawdown. {setup.capital.basis}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Trades" value={String(s.trades)} />
        <Stat label="Win rate" value={pct(s.winRate)} />
        <Stat label={selling ? "Avg premium pts" : "Avg index pts"} value={pts(s.avgPoints)} className={tone(s.avgPoints)} />
        <Stat label="Profit factor" value={pf(s.profitFactor)} />
        <Stat label="Before costs" value={rs(s.totalGross)} className={tone(s.totalGross)} />
        <Stat label="After costs" value={rs(s.totalNet)} className={tone(s.totalNet)} />
        <Stat label="Per trade, net" value={rs(s.netPerTrade)} className={tone(s.netPerTrade)} />
        <Stat label="Max drawdown" value={rs(-s.maxDrawdown)} className="text-rose-400" />
        {setup.dayStats ? (
          <>
            <Stat label="Winning days" value={`${setup.dayStats.winDays}/${setup.dayStats.days} (${pct(setup.dayStats.days ? setup.dayStats.winDays / setup.dayStats.days : null)})`} />
            <Stat label="Worst day" value={rs(setup.dayStats.worstDay)} className="text-rose-400" />
            <Stat label="Best day" value={rs(setup.dayStats.bestDay)} className={tone(setup.dayStats.bestDay)} />
            <Stat label="Per day, net" value={rs(setup.dayStats.days ? s.totalNet / setup.dayStats.days : null)} className={tone(s.totalNet)} />
          </>
        ) : null}
      </div>
      <p className="text-[11px] text-slate-400">
        {setup.costNote ?? (
          <>Costs ≈ {rs(setup.costPerTrade, false)} per lot per round trip at today&apos;s level, so each trade must make about <b className="text-slate-200">{setup.costPoints.toFixed(1)} index points</b> just to break even.</>
        )}{" "}
        {exitText}
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <MiniTable title="Each half of the period" rows={[["First half", setup.halves[0]], ["Second half", setup.halves[1]]]} />
        <MiniTable title="By direction" rows={[[sideLabel("CE"), setup.bySide.CE], [sideLabel("PE"), setup.bySide.PE]]} />
      </div>

      {setup.variants.length ? (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Would a different setting help?</h3>
          <table className="mt-1 w-full text-xs">
            <thead className="text-left text-[10px] uppercase text-slate-500">
              <tr><th className="py-1">Variant</th><th>Trades</th><th>Win</th><th>Avg pts</th><th className="text-right">Net, 1 lot</th></tr>
            </thead>
            <tbody>
              {setup.variants.map((v) => (
                <tr key={v.label} className={`border-t border-slate-800 ${v.isDefault ? "font-bold text-white" : ""}`}>
                  <td className="py-1 pr-2">{v.label}</td>
                  <td>{v.stats.trades}</td>
                  <td>{pct(v.stats.winRate)}</td>
                  <td className={tone(v.stats.avgPoints)}>{pts(v.stats.avgPoints)}</td>
                  <td className={`text-right ${tone(v.stats.totalNet)}`}>{rs(v.stats.totalNet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-500">Shown to check robustness, not to pick the best row. Choosing the best of many variants overstates results.</p>
        </div>
      ) : null}

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">By {daily ? "year" : "month"} (net, 1 lot)</h3>
        <div className="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-4">
          {periods.map((m) => (
            <div key={m.label} className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px]">
              <div className="text-slate-500">{m.label} · {m.trades}</div>
              <div className={`font-bold ${tone(m.net)}`}>{rs(m.net)}</div>
            </div>
          ))}
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer font-bold text-slate-300">Latest {setup.recent.length} trades</summary>
        <table className="mt-1 w-full">
          <thead className="text-left text-[10px] uppercase text-slate-500">
            <tr><th className="py-1">Day</th><th>Side</th><th>In</th><th>Out</th><th>Exit</th><th>Pts</th><th className="text-right">Net</th></tr>
          </thead>
          <tbody>
            {setup.recent.map((t) => (
              <tr key={t.entryAt} className="border-t border-slate-800">
                <td className="py-1">{t.day}</td>
                <td>{sideLabel(t.side)}</td>
                <td>{when(t.entryAt)} @ {t.entry.toFixed(1)}</td>
                <td>{when(t.exitAt)} @ {t.exit.toFixed(1)}</td>
                <td>{t.reason}</td>
                <td className={tone(t.points)}>{pts(t.points)}</td>
                <td className={`text-right ${tone(t.netRs)}`}>{rs(t.netRs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function byYear(months: SetupResult["months"]): Array<{ label: string; trades: number; net: number }> {
  const years = new Map<string, { label: string; trades: number; net: number }>();
  for (const m of months) {
    const label = m.month.slice(0, 4);
    const row = years.get(label) ?? { label, trades: 0, net: 0 };
    row.trades += m.trades;
    row.net += m.net;
    years.set(label, row);
  }
  return [...years.values()];
}

function Stat({ label, value, className = "text-white" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm font-black ${className}`}>{value}</div>
    </div>
  );
}

function MiniTable({ title, rows }: { title: string; rows: Array<[string, TradeStats]> }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</div>
      {rows.map(([label, s]) => (
        <div key={label} className="mt-1 flex justify-between gap-2">
          <span>{label} · {s.trades} · {pct(s.winRate)}</span>
          <span className={`font-bold ${tone(s.totalNet)}`}>{rs(s.totalNet)}</span>
        </div>
      ))}
    </div>
  );
}
