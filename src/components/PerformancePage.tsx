"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";
import type { PerformanceReport } from "@/lib/performance/report";
import type { CheckState, PerformanceCard } from "@/lib/performance/summary";
import { monitoredQuote } from "@/lib/performance/summary";
import { useMarketStream } from "@/hooks/useMarketStream";
import { useNow } from "@/hooks/useNow";

const money = (n: number | null) => n == null ? "Not available" : n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const percent = (n: number | null) => n == null ? "Not available" : `${n.toFixed(1)}%`;
const tone = (n: number | null) => n == null || n === 0 ? "text-slate-700" : n > 0 ? "text-emerald-700" : "text-rose-700";
const time = (at: number | string | null) => at == null ? "Not recorded" : typeof at === "string" ? `Session ${at}` :
  `${new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} IST`;
const STATE: Record<CheckState, { label: string; color: string }> = {
  ok: { label: "Check passed", color: "bg-emerald-50 text-emerald-800" },
  watch: { label: "Needs attention", color: "bg-amber-50 text-amber-800" },
  error: { label: "Error", color: "bg-rose-50 text-rose-800" },
  idle: { label: "Idle", color: "bg-slate-100 text-slate-600" },
};

function Metric({ label, value, color = "text-slate-900" }: { label: string; value: string; color?: string }) {
  return <div className="min-w-0"><dt className="text-[11px] text-slate-500">{label}</dt><dd className={`mt-1 break-words text-sm font-extrabold tabular-nums ${color}`}>{value}</dd></div>;
}

function ResultCard({ card }: { card: PerformanceCard }) {
  const actual = card.evidence === "Manually recorded";
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900"><Link href={card.href} className="hover:underline">{card.title}</Link></h3>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${actual ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>{card.evidence}</span>
      </div>
      <p className="mt-2 text-sm text-slate-500">{card.closed} closed {card.unit} / {card.open} open</p>
      <p className="mt-1 text-xs text-slate-500">{card.evidence === "Quote simulation" ? "Engine heartbeat (not price time)" : "Result price session"}: {time(card.asOf)}</p>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Metric label="Deployed / margin" value={money(card.deployed)} />
        <Metric label={actual ? "Total P&L (before fees)" : "Total P&L (cost-adjusted)"} value={money(card.totalPnl)} color={tone(card.totalPnl)} />
        <Metric label="Return on capital" value={percent(card.returnPct)} color={tone(card.returnPct)} />
        <Metric label="Closed win rate" value={percent(card.winRate)} />
      </dl>
      <details className="mt-4 rounded-lg border border-slate-100 p-3">
        <summary className="cursor-pointer text-sm font-bold text-slate-700">Capital, risk and detailed results</summary>
        <dl className="mt-4 grid grid-cols-2 gap-4">
        <Metric label="Starting capital" value={money(card.capital)} />
        <Metric label="Closed-trade P&L" value={money(card.closedPnl)} color={tone(card.closedPnl)} />
        <Metric label="Open / residual P&L" value={money(card.openPnl)} color={tone(card.openPnl)} />
        <Metric label="Average closed result / initial risk" value={card.expectancyR == null ? "Not available" : `${card.expectancyR.toFixed(2)}R`} />
        <Metric label={card.drawdownPct == null ? "Closed P&L drawdown" : "Account drawdown"} value={card.drawdownPct == null ? money(card.drawdownRs) : percent(card.drawdownPct)} />
        <Metric label="Nifty, same period" value={percent(card.benchmarkPct)} />
        </dl>
      </details>
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">{card.note}</p>
      <Link href={card.href} className="mt-2 inline-block text-xs font-bold text-emerald-700 hover:underline">Open source record →</Link>
    </article>
  );
}

export function PerformancePage() {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [section, setSection] = useState<"automation" | "results" | "health">("results");
  const stream = useMarketStream(["NIFTY50", "BANKNIFTY"], { movers: false });
  const now = useNow(5_000);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const pull = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const response = await fetch("/api/performance", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Performance report failed (HTTP ${response.status}).`);
        const body: PerformanceReport = await response.json();
        if (!controller.signal.aborted) { setReport(body); setError(null); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Performance report unavailable.");
      } finally { running = false; }
    };
    void pull();
    const timer = setInterval(() => void pull(), 5_000);
    const resume = () => { if (!document.hidden) void pull(); };
    document.addEventListener("visibilitychange", resume);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [refresh]);

  return (
    <AppShell current="performance">
      <div className="mx-auto max-w-[1280px] space-y-5 p-4 lg:p-6">
        <WorkspaceFrame>
          <WorkspaceHero eyebrow="Paper results are not real trades" title="Results" icon="breadth"
            description="See what is running, what it has earned on paper, and what needs fixing. This page never places orders."
            action={<button type="button" onClick={() => setRefresh((n) => n + 1)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh status</button>} />
        </WorkspaceFrame>
        <nav aria-label="Results tools" className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-3 text-sm font-bold">
          <Link href="/backtest" className="rounded-lg px-3 py-2 text-emerald-700 hover:bg-emerald-50">Historical backtest</Link>
          <Link href="/radar" className="rounded-lg px-3 py-2 text-emerald-700 hover:bg-emerald-50">Email track record</Link>
        </nav>
        <details aria-label="Market price monitor" className="rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold text-slate-900">Market price monitor · feed diagnostics</summary>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-slate-900">Market price monitor</h2>
            <span className="text-xs text-slate-600">{stream.status?.label ?? "Checking session"} · {stream.connection === "live" ? "Stream connected" : stream.connection === "polling" ? "Polling fallback" : stream.connection === "offline" ? "Feed disconnected" : "Connecting"}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["NIFTY50", "BANKNIFTY"] as const).map((symbol) => {
              const q = stream.quotes[symbol];
              const quality = monitoredQuote(q, stream.status?.isLive ?? false, Math.max(now ?? 0, stream.lastUpdate ?? 0));
              return <div key={symbol} className="rounded-xl border border-slate-100 p-3">
                <div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{symbol === "NIFTY50" ? "Nifty 50" : "Bank Nifty"}</strong><span className="text-xs text-slate-600">{quality.label}</span></div>
                <p className="mt-1 text-xl font-extrabold tabular-nums">{q ? money(q.ltp) : "Not available"}</p>
                <p className="mt-1 text-xs text-slate-500">{quality.detail}</p>
                <p className="mt-1 text-xs text-slate-500">Provider trade time: {time(q?.tradeTimestamp ?? (q?.timestampBasis === "trade" ? q.timestamp : null))}</p>
              </div>;
            })}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">Automatic updates use the existing quote channel, not a guaranteed exchange-tick feed. Fyers watched quotes are sampled/cached for 15 seconds; fallback data may be delayed. Daily replay results below do not change with these prices.</p>
        </details>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error} {report ? "Last loaded report remains below; it may be stale." : "Try refreshing."}</p>}
        {!report && !error && <LoadingState message="Reading existing portfolios and job status..." />}
        {report && <>
          <p className="text-xs text-slate-500">{report.market} · Status checked {time(report.generatedAt)} · Auto-refresh every 5 seconds while visible{now != null && now - report.generatedAt > 20_000 ? " · STATUS STALE" : ""}</p>
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            These are separate portfolios, not one account. Do not add their profits together or rank strategies on these different samples.
            Paper fills are estimates. A recently read report does not mean the underlying prices are current.
          </p>
          {report.errors.map((e) => <p key={e.source} role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{e.source}: {e.message}. This source may be missing below.</p>)}
          <nav aria-label="Performance sections" className="flex flex-wrap gap-2">
            {([["automation", "Automation status"], ["results", "Strategy results"], ["health", "System health"]] as const).map(([key, label]) =>
              <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)}
                className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-bold ${section === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{label}</button>)}
          </nav>
          {section === "automation" && <section aria-labelledby="automation-title" className="space-y-3">
            <h2 id="automation-title" className="text-base font-extrabold">What is actually running?</h2>
            <p className="text-sm text-slate-600">Enabled does not mean a trade was found. A successful evaluation can correctly decide to do nothing.</p>
            <div className="grid gap-4 xl:grid-cols-2">
              {report.automation.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-bold">{item.title}</h3>
                  <span className={`rounded-lg px-2 py-1 text-xs font-bold ${STATE[item.state].color}`}>{item.status}</span></div>
                <p className="mt-2 text-sm font-semibold text-slate-700">{item.mode}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{item.cadence}</p>
                <p className="mt-3 break-words text-sm leading-6 text-slate-700">{item.detail}</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Metric label="Last attempt / engine check" value={time(item.lastAttemptAt)} />
                  <Metric label="Last successful evaluation / recording" value={time(item.lastSuccessAt)} />
                </dl>
                <Link href={item.href} className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-emerald-700 underline">Open strategy workspace</Link>
              </article>)}
            </div>
            <p className="text-sm text-slate-600">Real holdings are manually recorded, not an automated strategy. <Link href="/positions" className="font-bold underline">View holdings</Link></p>
          </section>}
          {section === "results" && <>
          <section aria-labelledby="paper-performance">
            <h2 id="paper-performance" className="mb-3 text-base font-extrabold text-slate-900">Simulated / forward results</h2>
            <div className="grid gap-4 xl:grid-cols-2">{report.cards.filter((c) => c.evidence !== "Manually recorded").map((card) => <ResultCard key={card.id} card={card} />)}</div>
          </section>
          <section aria-labelledby="real-performance">
            <h2 id="real-performance" className="mb-3 text-base font-extrabold text-slate-900">Recorded real trades</h2>
            {report.cards.filter((c) => c.evidence === "Manually recorded").map((card) => <ResultCard key={card.id} card={card} />)}
          </section>
          </>}
          {section === "health" && <>
          <section aria-labelledby="reliability">
            <h2 id="reliability" className="mb-3 text-base font-extrabold text-slate-900">System reliability</h2>
            <p className="mb-3 text-xs text-slate-500">Reported status, not an independent uptime check. SMTP acceptance does not prove inbox delivery; a heartbeat does not prove exchange-feed freshness.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {report.checks.map((check) => <article key={check.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-900">{check.title}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${STATE[check.state].color}`}>{STATE[check.state].label}</span></div>
                <p className="mt-2 break-words text-xs leading-5 text-slate-600">{check.detail}</p>
                <p className="mt-2 text-[11px] text-slate-400">Last event: {time(check.lastAt)}</p>
              </article>)}
            </div>
          </section>
          </>}
        </>}
      </div>
    </AppShell>
  );
}
