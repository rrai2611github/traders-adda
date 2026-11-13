"use client";

import { useEffect, useMemo, useState } from "react";
import { CHANGE_GROUPS, changeSentence, groupRows, sectorTally, summarizeChanges, type ChangeKind, type ChangeRow } from "@/lib/screen/dailyChanges";
import type { DataHealth } from "@/lib/market/historyQuality";
import { formatPrice, toneClass } from "@/lib/format";
import { StockSymbolButton } from "./StockDetailContext";
import { DataQualityNotice } from "./DataQualityNotice";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";

interface Payload extends DataHealth {
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  eligible: number;
  scored: number;
  sessionAt: number | null;
  rows: ChangeRow[];
}

const LABELS = Object.fromEntries(CHANGE_GROUPS.map((g) => [g.kind, g.label])) as Record<ChangeKind, string>;
const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`);

export function DailyChanges({ keep }: { keep: ((symbol: string) => boolean) | null }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [kind, setKind] = useState<ChangeKind>("enteredStage2");
  const [sector, setSector] = useState("");

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = 5 * 60_000;
      try {
        const response = await fetch("/api/market/daily-changes", { cache: "no-store", signal: controller.signal });
        if (response.status === 503) {
          const body: { warming?: boolean; error?: string } = await response.json();
          if (body.warming) {
            if (alive) { setProgress(body.error ?? "Loading price history."); setError(null); }
            delay = 5_000;
            return;
          }
          throw new Error(body.error ?? "Price history unavailable.");
        }
        if (!response.ok) throw new Error(`Daily changes request failed (HTTP ${response.status}).`);
        const payload: Payload = await response.json();
        if (alive) { setData(payload); setError(null); setProgress(null); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        console.error("[daily-changes] Refresh failed:", failure);
        if (alive) { setError(failure instanceof Error ? failure.message : "Refresh failed."); setProgress(null); }
      } finally {
        if (alive) timer = setTimeout(load, delay);
      }
    };
    void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);

  const rows = useMemo(() => (data?.rows ?? []).filter((row) => !keep || keep(row.symbol)), [data, keep]);
  const summary = useMemo(() => summarizeChanges(rows), [rows]);
  const inKind = useMemo(() => groupRows(rows, kind), [rows, kind]);
  const shown = useMemo(() => inKind.filter((row) => !sector || row.sector === sector), [inKind, sector]);
  const tally = useMemo(() => sectorTally(rows, kind).slice(0, 6), [rows, kind]);
  const sectors = useMemo(() => [...new Set(inKind.map((r) => r.sector).filter((s): s is string => !!s))].sort(), [inKind]);
  const group = CHANGE_GROUPS.find((g) => g.kind === kind)!;
  const sessionLabel = data?.sessionAt ? new Date(data.sessionAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }) : null;
  const choose = (next: ChangeKind) => { setKind(next); setSector(""); };

  return (
    <WorkspaceFrame id="daily-changes" className="scroll-mt-28">
      <WorkspaceHero eyebrow="What changed" icon="setups" title="Daily Changes"
        description="Stocks that crossed a line on the latest session: entered or left Stage 2, broke out of a base, crossed their 50 or 200-day average. Each is a plain fact checked against both sessions, not a score." />
      <div className="space-y-4 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}{data ? " Retained results may be stale." : " No results substituted."}</p>}
        {progress && data && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{progress} Retained results may be stale.</p>}
        <DataQualityNotice health={data} updatedAt={data?.updatedAt} />
        {!data ? (error ? <EmptyState tone="error" title="Daily changes unavailable">The feed will retry automatically.</EmptyState> : <LoadingState rows={5} message={progress ?? "Comparing the last two sessions."} />) : (<>
          <p className="rounded-xl border border-border bg-raised p-3 text-sm leading-6"><b>{sessionLabel ?? "Latest session"}.</b> {changeSentence(summary, data.scored)}</p>
          <p className="text-xs text-muted">{data.scored.toLocaleString("en-IN")} of {data.eligible.toLocaleString("en-IN")} liquid stocks had enough history to compare · {data.source.label} · completed sessions only. Not backtested: a change is a fact about the day, not a signal.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["gain", "loss"] as const).map((direction) => (
              <div key={direction} className="rounded-xl border border-border bg-raised p-3">
                <div className={`mb-2 text-xs font-bold uppercase tracking-wide ${direction === "gain" ? "text-emerald-700" : "text-rose-700"}`}>{direction === "gain" ? "Improved" : "Deteriorated"}</div>
                <div className="space-y-1.5">
                  {CHANGE_GROUPS.filter((g) => g.direction === direction).map((g) => (
                    <button key={g.kind} type="button" aria-pressed={kind === g.kind} onClick={() => choose(g.kind)} title={g.detail}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs ${kind === g.kind ? "border-emerald-600 bg-emerald-50 font-bold" : "border-border bg-white hover:border-emerald-300"}`}>
                      <span>{g.label}</span><span className="font-mono">{summary.counts[g.kind]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-white p-3 text-xs leading-5">
            <b className="text-foreground">{group.label}</b> <span className="text-muted">· {group.detail}</span>
            {tally.length > 0 && <p className="mt-2 text-muted">By sector: {tally.map((t) => `${t.sector} ${t.count}`).join(" · ")}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2"><span className="font-bold text-foreground">Sector</span>
              <select value={sector} onChange={(e) => setSector(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2">
                <option value="">All sectors</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <span className="text-muted">{shown.length} stock{shown.length === 1 ? "" : "s"}, strongest RS first</span>
          </div>
          {!shown.length ? <EmptyState title={`No stocks in "${group.label}"`}>{sector ? "None in this sector. Try All sectors." : "Nothing crossed this line on the latest session. Empty results are valid."}</EmptyState> : (
            <div className="max-h-[650px] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-xs">
                <thead className="sticky top-0 z-20 bg-raised text-[11px] uppercase tracking-wide text-muted"><tr>
                  <th className="px-4 py-3">Stock</th><th className="px-3 py-3">Close</th><th className="px-3 py-3">Day</th><th className="px-3 py-3">RS</th><th className="px-3 py-3">₹ Cr/day</th><th className="px-3 py-3">Also today</th>
                </tr></thead>
                <tbody>{shown.map((row) => (
                  <tr key={row.symbol} className="odd:bg-white even:bg-slate-50 hover:bg-emerald-50">
                    <td className="border-b border-border px-4 py-3"><StockSymbolButton symbol={row.symbol} className="font-bold">{row.symbol}</StockSymbolButton><div className="mt-1 truncate text-muted">{row.name}</div>{row.sector && <div className="text-[11px] text-muted">{row.sector}</div>}</td>
                    <td className="border-b border-border px-3 py-3 font-mono">₹{formatPrice(row.close)}</td>
                    <td className={`border-b border-border px-3 py-3 font-mono ${row.dayChangePercent == null ? "" : toneClass(row.dayChangePercent)}`}>{pct(row.dayChangePercent)}</td>
                    <td className="border-b border-border px-3 py-3 font-mono font-bold text-accent">{row.rs ?? "—"}</td>
                    <td className="border-b border-border px-3 py-3 font-mono">{row.turnoverCr == null ? "—" : row.turnoverCr.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                    <td className="border-b border-border px-3 py-3 text-muted">{row.kinds.filter((k) => k !== kind).map((k) => LABELS[k]).join(" · ") || "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>)}
      </div>
    </WorkspaceFrame>
  );
}
