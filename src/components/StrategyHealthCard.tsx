"use client";

import { useEffect, useState } from "react";
import type { HealthReport, HealthState } from "@/lib/backtest/health";

type Payload = { status: "running"; message: string } | { status: "failed"; message: string } | { status: "done"; report: HealthReport; lastDay: string; liveTrades: number | null };

const STYLE: Record<HealthState, { chip: string; label: string }> = {
  ok: { chip: "bg-emerald-600 text-white", label: "OK" },
  early: { chip: "bg-slate-200 text-slate-700", label: "Early" },
  watch: { chip: "bg-amber-100 text-amber-800", label: "Watch" },
  alert: { chip: "bg-rose-100 text-rose-800", label: "Alert" },
};
const HEAD = {
  "on-track": "border-emerald-200 bg-emerald-50 text-emerald-900",
  early: "border-slate-200 bg-slate-50 text-slate-800",
  watch: "border-amber-200 bg-amber-50 text-amber-900",
  review: "border-rose-200 bg-rose-50 text-rose-900",
} as const;

/** Is the edge still there? Shows the rules' recent record against their history and the live check against the backtest. Warns only. */
export function StrategyHealthCard() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = 120_000;
      try {
        const res = await fetch("/api/strategy-health", { cache: "no-store" });
        const body = (await res.json()) as Payload;
        if (!alive) return;
        setData(body);
        if (body.status === "running") delay = 3000;
      } catch { /* the card simply stays as it was */ }
      if (alive) timer = setTimeout(() => void load(), delay);
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  return (
    <section aria-label="Strategy health" className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-[13px] font-extrabold text-slate-900">Strategy health: is the edge still there?</h3>
      <p className="mb-2 text-[11.5px] text-slate-500">Compares the rules&apos; last 12 months and your live trades with what the 10-year backtest says is normal. It only warns; it never changes a rule.</p>
      {!data || data.status === "running" ? (
        <p className="text-sm text-slate-600">Checking… {data?.status === "running" ? `${data.message}. ` : ""}The first check after a price update takes a minute or two.</p>
      ) : data.status === "failed" ? (
        <p className="text-sm text-rose-700">Could not check: {data.message}</p>
      ) : (
        <div className="space-y-2">
          <p className={`rounded-lg border px-3 py-2 text-[12.5px] font-bold ${HEAD[data.report.verdict]}`}>{data.report.headline}</p>
          <ul className="space-y-1.5">
            {data.report.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-[12px] leading-5 text-slate-700">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${STYLE[c.state].chip}`}>{STYLE[c.state].label}</span>
                <span className="min-w-0"><b className="text-slate-900">{c.label}.</b> {c.detail}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10.5px] text-slate-400">Prices up to {data.lastDay}. One warning is a reason to look, not a reason to stop: even a good rule has bad stretches.</p>
        </div>
      )}
    </section>
  );
}
