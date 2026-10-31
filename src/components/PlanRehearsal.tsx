"use client";

import { useEffect, useRef, useState } from "react";
import { rehearsalSettings, summariseRehearsal, type Rehearsal } from "@/lib/backtest/rehearsal";
import type { BacktestResult, Trade } from "@/lib/backtest/types";

type Job = { status: "running"; id: string; message: string } | { status: "failed"; id: string; error: string } | { status: "done"; id: string; result: BacktestResult };

const num = (v: number | null, d = 2) => (v == null ? "—" : v.toFixed(d));

/**
 * "How has this stock behaved under the plan?": runs the tested rules on this one stock's ten-year history (market gate off, so it gets as
 * many trades as it can) and sets its win rate beside the win rate the plan needs to break even. Small samples are called small.
 */
export function PlanRehearsal({ symbol }: { symbol: string }) {
  const [state, setState] = useState<{ phase: "idle" | "running" | "done" | "failed"; message?: string; summary?: Rehearsal; trades?: Trade[] }>({ phase: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);
  // A different stock remounts this component (the drawer keys it by symbol), so it starts again from scratch.

  const poll = (id: string) => {
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/backtest?id=${id}`, { cache: "no-store" });
        if (!alive.current) return;
        if (!res.ok) { setState({ phase: "failed", message: "The server forgot this run. Try again." }); return; }
        const job = (await res.json()) as Job;
        if (job.status === "running") { setState((s) => ({ ...s, message: job.message })); poll(id); }
        else if (job.status === "failed") setState({ phase: "failed", message: job.error });
        else setState({ phase: "done", summary: summariseRehearsal(job.result.trades), trades: job.result.trades.filter((t) => t.exitReason !== "end").slice(-8).reverse() });
      } catch { if (alive.current) setState({ phase: "failed", message: "Could not reach the server." }); }
    }, 1500);
  };

  const run = async () => {
    setState({ phase: "running", message: "starting" });
    try {
      const res = await fetch("/api/backtest", { method: "POST", body: JSON.stringify(rehearsalSettings(symbol)) });
      const job = (await res.json()) as Job;
      if (!alive.current) return;
      if (job.status === "running") poll(job.id);
      else if (job.status === "failed") setState({ phase: "failed", message: job.error });
      else setState({ phase: "done", summary: summariseRehearsal(job.result.trades), trades: job.result.trades.filter((t) => t.exitReason !== "end").slice(-8).reverse() });
    } catch { if (alive.current) setState({ phase: "failed", message: "Could not start the rehearsal." }); }
  };

  const s = state.summary;
  return (
    <section aria-label="Plan rehearsal" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">Plan rehearsal</h3>
          <p className="text-[11px] text-slate-500">How would the tested plan (12% stop, exit under the 50-day average) have done on {symbol} alone since 2016?</p>
        </div>
        <button type="button" onClick={() => void run()} disabled={state.phase === "running"} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-60">
          {state.phase === "running" ? "Rehearsing…" : s ? "Run again" : `Rehearse on ${symbol}`}
        </button>
      </div>
      {state.phase === "running" && <p className="mt-2 text-[11px] text-slate-500">{state.message || "working"}. The first run after a price update can take a minute or two.</p>}
      {state.phase === "failed" && <p className="mt-2 text-[11px] font-semibold text-rose-700">Could not rehearse: {state.message}</p>}
      {s && (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-700">{s.verdict}</p>
          {s.trades > 0 && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
                <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Trades</dt><dd className="font-mono text-base font-black text-slate-900">{s.trades}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Won</dt><dd className="font-mono font-black text-slate-900">{s.wins} ({num(s.winRate, 0)}%)</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Average</dt><dd className={`font-mono font-black ${(s.avgR ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{num(s.avgR)}R</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Best / worst</dt><dd className="font-mono font-black text-slate-900">{num(s.bestR)}R / {num(s.worstR)}R</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Typical hold</dt><dd className="font-mono font-black text-slate-900">{s.medianHoldDays ?? "—"} sessions</dd></div>
              </dl>
              <p className="text-[11px] leading-5 text-slate-500">
                To break even a plan must win {s.breakEven.map((b) => `${b.winRate}% of the time when its winners are ${b.r}× its losers`).join("; ")}. Of the {s.trades} trades, {s.reached.r1} ended at +1R or better, {s.reached.r2} at +2R and {s.reached.r3} at +3R. Across all stocks the plan wins about 40% of the time, with winners averaging about 2× the loss.
              </p>
              {state.trades && state.trades.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-[11.5px] [&_td]:px-1.5 [&_th]:px-1.5"><thead className="text-[10px] uppercase tracking-wide text-slate-400"><tr><th>Bought</th><th>Sold</th><th>Why</th><th className="text-right">R</th></tr></thead><tbody>
                    {state.trades.map((t, i) => <tr key={`${t.entryDay}${i}`} className="border-t border-slate-100"><td>{t.entryDay}</td><td>{t.exitDay}</td><td>{t.exitReason}</td><td className={`text-right tabular-nums ${t.r >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{t.r.toFixed(2)}</td></tr>)}
                  </tbody></table>
                </div>
              )}
            </>
          )}
          <p className="text-[10px] leading-4 text-slate-400">A rehearsal replays the past; it is not a forecast. The market check is left off here so the stock gets as many trades as possible.</p>
        </div>
      )}
    </section>
  );
}
