"use client";

import { useEffect, useRef, useState } from "react";
import { REALITY_SCENARIOS, realityVerdict, scenarioSettings, type RealityRow } from "@/lib/backtest/reality";
import type { BacktestResult } from "@/lib/backtest/types";

type Job = { status: "running"; id: string; message: string } | { status: "failed"; id: string; error: string } | { status: "done"; id: string; result: BacktestResult };

const money = (v: number) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs one backtest through the app's own job API and waits for it. */
async function runJob(settings: unknown, alive: () => boolean): Promise<BacktestResult> {
  const first = await fetch("/api/backtest", { method: "POST", body: JSON.stringify(settings) });
  let job = (await first.json()) as Job;
  while (job.status === "running") {
    await sleep(1500);
    if (!alive()) throw new Error("stopped");
    const res = await fetch(`/api/backtest?id=${job.id}`, { cache: "no-store" });
    if (!res.ok) throw new Error("The server forgot this run (it restarted). Try again.");
    job = (await res.json()) as Job;
  }
  if (job.status === "failed") throw new Error(job.error);
  return job.result;
}

const TONE = { good: "border-emerald-200 bg-emerald-50 text-emerald-900", warn: "border-amber-200 bg-amber-50 text-amber-900", bad: "border-rose-200 bg-rose-50 text-rose-900" } as const;

/**
 * "How much of this result survives the real world?": reruns the same rules with worse fills and some stops gapping through, and sets the
 * answers beside the test. The test assumes every fill is exact and no stop ever gaps, which a real account never gets.
 */
export function RealityCheck({ result }: { result: BacktestResult }) {
  const [state, setState] = useState<{ phase: "idle" | "running" | "done" | "failed"; step?: string; rows?: RealityRow[]; error?: string }>({ phase: "idle" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = async () => {
    setState({ phase: "running", step: "starting" });
    const rows: RealityRow[] = [];
    try {
      for (const scenario of REALITY_SCENARIOS) {
        setState({ phase: "running", step: `${scenario.name} (${rows.length + 1} of ${REALITY_SCENARIOS.length})` });
        const r = await runJob(scenarioSettings(result.settings, scenario), () => alive.current);
        rows.push({ scenario, stats: r.stats });
      }
      if (alive.current) setState({ phase: "done", rows });
    } catch (error) {
      if (alive.current) setState({ phase: "failed", error: error instanceof Error ? error.message : "Could not run the check." });
    }
  };

  const s = result.stats;
  const verdict = state.phase === "done" && state.rows ? realityVerdict(s, state.rows) : null;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4" aria-label="Reality check">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          <h3 className="text-[13px] font-extrabold text-slate-900">Reality check: how much of this survives real trading?</h3>
          <p className="text-[11.5px] text-slate-500">A backtest assumes every fill is exact and no stop ever gaps. Real accounts get worse fills and the odd bad-news gap. This reruns the same rules with those harms added (about {REALITY_SCENARIOS.length} runs, a minute or so).</p>
        </div>
        <button type="button" onClick={() => void run()} disabled={state.phase === "running"} className="rounded-lg bg-slate-900 px-4 py-2 text-[12.5px] font-extrabold text-white hover:bg-slate-700 disabled:opacity-60">
          {state.phase === "running" ? "Running…" : state.phase === "done" ? "Run again" : "Run the reality check"}
        </button>
      </div>
      {state.phase === "running" && <p className="text-[12px] text-slate-600">Running: {state.step}…</p>}
      {state.phase === "failed" && <p role="alert" className="text-[12.5px] font-semibold text-rose-700">{state.error}</p>}
      {state.phase === "done" && state.rows && verdict && (
        <>
          <p className={`rounded-lg border px-3 py-2 text-[12.5px] font-bold ${TONE[verdict.tone]}`}>{verdict.text}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12px]">
              <thead><tr className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-500"><th className="py-1 pr-3">Case</th><th className="py-1 pr-3">Profit</th><th className="py-1 pr-3">Yearly</th><th className="py-1 pr-3">Worst drop</th><th className="py-1">Average trade</th></tr></thead>
              <tbody>
                <tr className="border-t border-border"><td className="py-1.5 pr-3 font-semibold text-slate-800">The test as it is</td><td className="py-1.5 pr-3 font-mono">{money(s.totalProfit)}</td><td className="py-1.5 pr-3 font-mono">{pct(s.cagrPercent)}</td><td className="py-1.5 pr-3 font-mono">{pct(s.maxDrawdownPercent)}</td><td className="py-1.5 font-mono">{s.avgR == null ? "—" : `${s.avgR.toFixed(2)}R`}</td></tr>
                {state.rows.map((r) => (
                  <tr key={r.scenario.key} className="border-t border-border">
                    <td className="py-1.5 pr-3"><div className="font-semibold text-slate-800">{r.scenario.name}</div><div className="text-[11.5px] text-slate-500">{r.scenario.detail}</div></td>
                    <td className={`py-1.5 pr-3 font-mono font-bold ${r.stats.totalProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{money(r.stats.totalProfit)}</td>
                    <td className="py-1.5 pr-3 font-mono">{pct(r.stats.cagrPercent)}</td>
                    <td className="py-1.5 pr-3 font-mono">{pct(r.stats.maxDrawdownPercent)}</td>
                    <td className="py-1.5 font-mono">{r.stats.avgR == null ? "—" : `${r.stats.avgR.toFixed(2)}R`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-slate-400">Which stops gap is chosen at random with a fixed seed, so another seed gives a slightly different answer. It does not model delisted stocks, which this history does not contain either.</p>
        </>
      )}
    </section>
  );
}
