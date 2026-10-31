"use client";

import { useFundamentals } from "@/hooks/useFundamentals";
import type { Tone, Verdict } from "@/lib/fundamentals/assess";

const CHIP: Record<Tone, { cls: string; label: string }> = {
  good: { cls: "bg-emerald-600 text-white", label: "Good" },
  ok: { cls: "bg-slate-200 text-slate-700", label: "OK" },
  warn: { cls: "bg-amber-100 text-amber-800", label: "Warning" },
  unknown: { cls: "bg-slate-100 text-slate-500", label: "No data" },
};
const HEAD: Record<Verdict, string> = {
  strong: "border-emerald-200 bg-emerald-50 text-emerald-900",
  fine: "border-slate-200 bg-slate-50 text-slate-800",
  mixed: "border-amber-200 bg-amber-50 text-amber-900",
  weak: "border-rose-200 bg-rose-50 text-rose-900",
  unknown: "border-slate-200 bg-slate-50 text-slate-700",
};
const TAG: Record<Verdict, { cls: string; label: string }> = {
  strong: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Company: strong" },
  fine: { cls: "bg-white text-slate-600 ring-slate-200", label: "Company: fine" },
  mixed: { cls: "bg-amber-50 text-amber-800 ring-amber-200", label: "Company: mixed" },
  weak: { cls: "bg-rose-50 text-rose-800 ring-rose-200", label: "Company: weak" },
  unknown: { cls: "", label: "" },
};

/** A small tag for a Top picks card. Shows nothing while loading, on failure or when there is too little data, so a card never carries a guess. */
export function CompanyHealthTag({ symbol, sector }: { symbol: string; sector?: string | null }) {
  const state = useFundamentals(symbol, sector);
  if (state.phase !== "done" || state.report.verdict === "unknown") return null;
  const tag = TAG[state.report.verdict];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ${tag.cls}`} title={`${state.report.headline} Open the stock for the details. Information only: it does not change the pick.`}>{tag.label}</span>;
}

/** Company health beside the chart: a good chart on a shaky company is a riskier trade. Information only; the picks and the risk check ignore it. */
export function FundamentalsPanel({ symbol, sector }: { symbol: string; sector?: string | null }) {
  const state = useFundamentals(symbol, sector);
  return (
    <section aria-label="Company health" className="rounded-xl border border-border bg-surface p-3.5">
      <h3 className="text-[13px] font-extrabold text-slate-900">Company health: is the business behind the chart sound?</h3>
      <p className="mb-2 text-[11.5px] text-slate-500">Information only. It is not part of the tested rules, so it never changes the picks or the risk check.</p>
      {state.phase === "loading" ? (
        <p className="text-sm text-slate-600">Checking sales, profit, debt and owners…</p>
      ) : state.phase === "failed" ? (
        <p className="text-sm text-slate-600">{state.message}</p>
      ) : (
        <div className="space-y-2">
          <p className={`rounded-lg border px-3 py-2 text-[12.5px] font-bold ${HEAD[state.report.verdict]}`}>{state.report.headline}</p>
          <ul className="space-y-1.5">
            {state.report.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-[12px] leading-5 text-slate-700">
                <span className={`mt-0.5 w-[68px] shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-black ${CHIP[c.tone].cls}`}>{CHIP[c.tone].label}</span>
                <span className="min-w-0"><b className="text-slate-900">{c.label}.</b> {c.detail}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-slate-400">Sales and profit: Yahoo Finance. Owners and pledges: NSE filings. Figures are for the company as a whole, not per share.</p>
        </div>
      )}
    </section>
  );
}
