"use client";

import { useEffect, useState } from "react";

interface VisitorCounts {
  allTimeUniqueAccounts: number;
  todayUniqueAccounts: number;
}

export function VisitorCount() {
  const [counts, setCounts] = useState<VisitorCounts | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/visitor-stats", { cache: "no-store" });
        const result = await response.json() as VisitorCounts & { error?: string };
        if (!response.ok) throw new Error(result.error ?? `Could not load visitor counts (${response.status}).`);
        if (active) {
          setCounts(result);
          setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load visitor counts.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section aria-label="Visitor count" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-black text-slate-900">Visitors</h2>
          <p className="mt-1 text-xs text-slate-500">Unique signed-in accounts that opened the application.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">Account-level · no IP/device tracking</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">All time</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{counts ? counts.allTimeUniqueAccounts.toLocaleString("en-IN") : "—"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Today</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{counts ? counts.todayUniqueAccounts.toLocaleString("en-IN") : "—"}</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      <p className="mt-3 text-[11px] leading-5 text-slate-500">A signed-in account is counted once per IST day, even if it visits multiple times or uses multiple browsers.</p>
    </section>
  );
}
