"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ScreenScan } from "@/hooks/useScreenScan";
import {
  DEFAULT_SCREENER_FILTER, SCREENER_PRESETS, matchesScreener, parseSavedScans, removeSavedScan, sortScreenerRows, toScreenerCsv,
  validateSavedScans,
  toTradingViewList, upsertSavedScan, type SavedScan, type ScreenerFilter, type ScreenerSort, type ScreenerSortKey, type ScreenerStage,
} from "@/lib/screen/stockScreener";
import { formatPrice, toneClass } from "@/lib/format";
import { StockSymbolButton } from "./StockDetailContext";
import { DataQualityNotice } from "./DataQualityNotice";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";

const STORAGE_KEY = "sa.savedScans.v1";
const PAGE = 100;
const STAGES: { key: ScreenerStage; label: string }[] = [
  { key: "forming", label: "Base forming" },
  { key: "breakout", label: "Breakout" },
  { key: "climbing", label: "Climbing" },
  { key: "played-out", label: "Played out" },
];

const COLUMNS: { key: ScreenerSortKey; label: string }[] = [
  { key: "symbol", label: "Stock" },
  { key: "price", label: "Price" },
  { key: "changePercent", label: "Day" },
  { key: "rs", label: "RS" },
  { key: "vs50", label: "vs 50-DMA" },
  { key: "fromHigh", label: "From 52W high" },
  { key: "turnoverCr", label: "₹ Cr/day" },
  { key: "mcap", label: "Mkt cap Cr" },
  { key: "baseWk", label: "Base" },
];

const pct = (value: number | null, digits = 1) => (value == null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`);
const sameFilter = (a: ScreenerFilter, b: ScreenerFilter) => JSON.stringify(a) === JSON.stringify(b);

function numberInput(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function StockScreener({ scan, error, loadingMessage, keep }: {
  scan: ScreenScan | null;
  error: boolean;
  loadingMessage: string | null;
  keep: ((symbol: string) => boolean) | null;
}) {
  const [filter, setFilter] = useState<ScreenerFilter>(DEFAULT_SCREENER_FILTER);
  const [sort, setSort] = useState<ScreenerSort>({ key: "rs", dir: "desc" });
  const [shown, setShown] = useState(PAGE);
  const [saved, setSaved] = useState<SavedScan[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedSaving, setSavedSaving] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  // Import existing device-local scans once when this account has no saved list yet.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/user/saved-scans", { cache: "no-store" });
        const payload = await response.json() as { exists?: boolean; scans?: unknown; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load saved scans.");
        const accountScans = validateSavedScans(payload.scans);
        if (!accountScans.ok) throw new Error(accountScans.error);
        let next = accountScans.scans;
        if (payload.exists === false && next.length === 0) {
          let legacy: SavedScan[] = [];
          try { legacy = parseSavedScans(window.localStorage.getItem(STORAGE_KEY)); }
          catch { if (active) setSavedError("Your account scans loaded, but this browser did not allow importing older device scans."); }
          if (legacy.length) {
            const imported = await fetch("/api/user/saved-scans", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scans: legacy }),
            });
            const result = await imported.json() as { scans?: unknown; error?: string };
            if (!imported.ok) throw new Error(result.error ?? "Could not import device scans.");
            const validated = validateSavedScans(result.scans);
            if (!validated.ok) throw new Error(validated.error);
            next = validated.scans;
          }
        }
        if (active) setSaved(next);
      } catch (loadError) {
        if (active) setSavedError(loadError instanceof Error ? loadError.message : "Could not load saved scans.");
      } finally {
        if (active) setSavedLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);
  const persist = async (next: SavedScan[]): Promise<boolean> => {
    setSavedSaving(true);
    setSavedError(null);
    try {
      const response = await fetch("/api/user/saved-scans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scans: next }),
      });
      const payload = await response.json() as { scans?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save scans to your account.");
      const validated = validateSavedScans(payload.scans);
      if (!validated.ok) throw new Error(validated.error);
      setSaved(validated.scans);
      return true;
    } catch (saveError) {
      setSavedError(saveError instanceof Error ? saveError.message : "Could not save scans to your account.");
      return false;
    } finally {
      setSavedSaving(false);
    }
  };
  const flash = (message: string) => { setNote(message); window.setTimeout(() => setNote(null), 2500); };

  const rows = useMemo(() => (scan?.rows ?? []).filter((row) => !keep || keep(row.symbol)), [scan, keep]);
  const sectors = useMemo(() => [...new Set(rows.map((row) => row.sector).filter((s): s is string => !!s))].sort(), [rows]);
  const matched = useMemo(() => sortScreenerRows(rows.filter((row) => matchesScreener(row, filter)), sort), [rows, filter, sort]);
  const savedMatches = useMemo(
    () => saved.map((item) => ({ name: item.name, rows: rows.filter((row) => matchesScreener(row, item.filter)) })).filter((item) => item.rows.length > 0),
    [rows, saved],
  );
  const visible = matched.slice(0, shown);
  const change = (patch: Partial<ScreenerFilter>) => { setFilter((current) => ({ ...current, ...patch })); setShown(PAGE); };
  const filtered = !sameFilter(filter, DEFAULT_SCREENER_FILTER);

  const onSort = (key: ScreenerSortKey) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "symbol" ? "asc" : "desc" }));

  const copyList = async () => {
    try { await navigator.clipboard.writeText(toTradingViewList(matched)); flash(`Copied ${matched.length} symbols for TradingView`); }
    catch { flash("Copy blocked by the browser; use Export CSV"); }
  };

  return (
    <WorkspaceFrame id="stock-screener" className="scroll-mt-28">
      <WorkspaceHero eyebrow="All stocks" icon="setups" title="Stock Screener"
        description="Every stock in the scan in one table. Filter, sort, save account-level scans, or export the result. Delivery % is not shown because no data feed here carries it." />
      <div className="space-y-4 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Scan refresh failed.{scan ? " Retained results may be stale." : " No results substituted."}</p>}
        {savedError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{savedError}</p>}
        <DataQualityNotice health={scan} updatedAt={scan?.updatedAt} />
        {!scan ? (error ? <EmptyState tone="error" title="Screener unavailable">The feed will retry automatically.</EmptyState> : <LoadingState rows={5} message={loadingMessage ?? "Loading the scan."} />) : (<>
          <div className="space-y-3 rounded-xl border border-border bg-raised p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-foreground">Presets</span>
              {SCREENER_PRESETS.map((preset) => {
                const next = { ...DEFAULT_SCREENER_FILTER, ...preset.filter };
                const active = sameFilter(filter, next);
                return <button key={preset.label} type="button" aria-pressed={active} onClick={() => { setFilter(active ? DEFAULT_SCREENER_FILTER : next); setShown(PAGE); }}
                  className={`rounded-full border px-3 py-1 ${active ? "border-emerald-600 bg-emerald-50 font-bold text-emerald-800" : "border-border bg-white text-muted hover:border-emerald-300"}`}>{preset.label}</button>;
              })}
              {filtered && <button type="button" onClick={() => { setFilter(DEFAULT_SCREENER_FILTER); setShown(PAGE); }} className="ml-auto font-bold text-accent underline">Reset all</button>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block"><span className="font-bold text-foreground">Search</span>
                <input value={filter.search} onChange={(e) => change({ search: e.target.value })} placeholder="Symbol or name" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2" /></label>
              <label className="block"><span className="font-bold text-foreground">Sector</span>
                <select value={filter.sector ?? ""} onChange={(e) => change({ sector: e.target.value || null })} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2">
                  <option value="">All sectors</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="block"><span className="font-bold text-foreground">Stage</span>
                <select value={filter.stage ?? ""} onChange={(e) => change({ stage: (e.target.value || null) as ScreenerStage | null })} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2">
                  <option value="">Any stage</option>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
              <label className="block"><span className="font-bold text-foreground">RS at least</span>
                <input type="number" min={1} max={99} inputMode="numeric" value={filter.minRs ?? ""} onChange={(e) => change({ minRs: numberInput(e.target.value) })} placeholder="1–99" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2" /></label>
              <label className="block"><span className="font-bold text-foreground">Within % of 52W high</span>
                <input type="number" min={0} inputMode="decimal" value={filter.maxFromHigh ?? ""} onChange={(e) => change({ maxFromHigh: numberInput(e.target.value) })} placeholder="e.g. 10" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2" /></label>
              <label className="block"><span className="font-bold text-foreground">₹ Cr/day at least</span>
                <input type="number" min={0} inputMode="decimal" value={filter.minTurnoverCr ?? ""} onChange={(e) => change({ minTurnoverCr: numberInput(e.target.value) })} placeholder="e.g. 25" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2" /></label>
              <label className="block"><span className="font-bold text-foreground">Market cap Cr at least</span>
                <input type="number" min={0} inputMode="decimal" value={filter.minMcapCr ?? ""} onChange={(e) => change({ minMcapCr: numberInput(e.target.value) })} placeholder="e.g. 1000" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2" /></label>
              <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={filter.liquidOnly} onChange={(e) => change({ liquidOnly: e.target.checked })} /><span className="font-bold text-foreground">Liquid stocks only</span></label>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="font-bold text-foreground">Saved scans</span>
              {savedLoading && <span className="text-muted">Loading account scans…</span>}
              {!savedLoading && !saved.length && <span className="text-muted">None yet. Set your filters, name the scan and save it to your account.</span>}
              {saved.map((item) => (
                <span key={item.name} className="inline-flex overflow-hidden rounded-full border border-border bg-white">
                  <button type="button" onClick={() => { setFilter(item.filter); setShown(PAGE); }} className={`px-3 py-1 hover:bg-emerald-50 ${sameFilter(filter, item.filter) ? "font-bold text-emerald-800" : "text-foreground"}`}>{item.name}</button>
                  <button type="button" disabled={savedSaving} aria-label={`Delete saved scan ${item.name}`} onClick={() => { void persist(removeSavedScan(saved, item.name)); }} className="border-l border-border px-2 text-muted hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40">×</button>
                </span>
              ))}
              <form className="ml-auto flex gap-2" onSubmit={(e) => {
                e.preventDefault();
                if (!saveName.trim() || savedLoading || savedSaving) return;
                void persist(upsertSavedScan(saved, { name: saveName, filter })).then((ok) => {
                  if (ok) { setSaveName(""); flash("Scan saved to your account"); }
                });
              }}>
                <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name this scan" aria-label="Name for this scan" maxLength={60} className="w-40 rounded-lg border border-border bg-white px-3 py-1.5" />
                <button type="submit" disabled={!saveName.trim() || savedLoading || savedSaving} className="rounded-lg border border-border bg-white px-3 py-1.5 font-bold disabled:opacity-40">{savedSaving ? "Saving…" : "Save this scan"}</button>
              </form>
            </div>
          </div>

          <section aria-live="polite" aria-label="Saved scan matches" className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-extrabold text-emerald-950">In-app saved-scan matches <span className="font-medium text-emerald-800">· refreshed with the market scan</span></p>
              <p className="text-emerald-800">{scan.source.label} · {new Date(scan.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
            </div>
            {savedLoading ? <p className="mt-2 text-emerald-900">Loading your saved criteria…</p>
              : !saved.length ? <p className="mt-2 text-emerald-900">Save a scan above to see daily matches here.</p>
                : !savedMatches.length ? <p className="mt-2 text-emerald-900">No saved scans match this scan snapshot.</p>
                  : <div className="mt-2 space-y-1.5">
                    {savedMatches.map((item) => <p key={item.name} className="text-emerald-950">
                      <span className="font-bold">{item.name}</span> · {item.rows.length} {item.rows.length === 1 ? "match" : "matches"}: {item.rows.slice(0, 8).map((row) => row.symbol).join(", ")}{item.rows.length > 8 ? `, +${item.rows.length - 8} more` : ""}
                    </p>)}
                  </div>}
            <p className="mt-2 text-[11px] text-emerald-800">Screening matches are informational, not buy recommendations. <Link href="/backtest" className="font-bold underline">Historical strategy tests</Link> use fixed supported rules, not your custom screener filters.</p>
          </section>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <p className="text-muted"><b className="text-foreground">{matched.length.toLocaleString("en-IN")}</b> of {rows.length.toLocaleString("en-IN")} stocks · {scan.source.label} · {new Date(scan.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
            <span role="status" className="text-emerald-700">{note}</span>
            <div className="ml-auto flex gap-2">
              <button type="button" disabled={!matched.length} onClick={copyList} className="rounded-lg border border-border bg-white px-3 py-1.5 font-bold disabled:opacity-40">Copy to TradingView</button>
              <button type="button" disabled={!matched.length} onClick={() => download(`stock-screener-${new Date().toISOString().slice(0, 10)}.csv`, toScreenerCsv(matched), "text/csv;charset=utf-8")} className="rounded-lg border border-border bg-white px-3 py-1.5 font-bold disabled:opacity-40">Export CSV</button>
            </div>
          </div>

          {!matched.length ? <EmptyState title="No stocks match these filters">Loosen a filter, or reset all.</EmptyState> : (
            <div className="max-h-[700px] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-xs">
                <thead className="sticky top-0 z-20 bg-raised text-[11px] uppercase tracking-wide text-muted"><tr>
                  {COLUMNS.map((col, index) => (
                    <th key={col.key} scope="col" aria-sort={sort.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-3 ${index === 0 ? "sticky left-0 z-30 bg-raised px-4" : ""}`}>
                      <button type="button" onClick={() => onSort(col.key)} className="font-bold uppercase tracking-wide hover:text-foreground">{col.label}{sort.key === col.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</button>
                    </th>
                  ))}
                </tr></thead>
                <tbody>{visible.map((row) => (
                  <tr key={row.symbol} className="odd:bg-white even:bg-slate-50 hover:bg-emerald-50">
                    <td className="sticky left-0 z-10 max-w-[240px] border-b border-border bg-inherit px-4 py-3">
                      <StockSymbolButton symbol={row.symbol} className="font-bold">{row.symbol}</StockSymbolButton>
                      <div className="mt-1 truncate text-muted">{row.name}</div>
                      {row.sector && <div className="truncate text-[11px] text-muted">{row.sector}</div>}
                    </td>
                    <td className="border-b border-border px-3 py-3 font-mono">₹{formatPrice(row.price)}</td>
                    <td className={`border-b border-border px-3 py-3 font-mono ${toneClass(row.changePercent)}`}>{pct(row.changePercent, 2)}</td>
                    <td className="border-b border-border px-3 py-3 font-mono font-bold text-accent">{row.rs ?? "—"}</td>
                    <td className={`border-b border-border px-3 py-3 font-mono ${row.vs50 == null ? "" : toneClass(row.vs50)}`}>{pct(row.vs50)}</td>
                    <td className="border-b border-border px-3 py-3 font-mono">{row.fromHigh == null ? "—" : `${Math.abs(row.fromHigh).toFixed(1)}%`}</td>
                    <td className="border-b border-border px-3 py-3 font-mono">{row.turnoverCr == null ? "—" : row.turnoverCr.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                    <td className="border-b border-border px-3 py-3 font-mono">{row.mcap == null ? "—" : Math.round(row.mcap).toLocaleString("en-IN")}</td>
                    <td className="border-b border-border px-3 py-3">{row.stage ? <><div>{STAGES.find((s) => s.key === row.stage)?.label}</div>{row.baseWk != null && <div className="text-muted">{row.baseWk}w{row.baseDepth != null ? ` · ${row.baseDepth.toFixed(0)}% deep` : ""}</div>}</> : <span className="text-muted">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {matched.length > shown && <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full rounded-xl border border-border bg-white py-2 text-xs font-bold hover:border-emerald-300">Show {Math.min(PAGE, matched.length - shown)} more ({(matched.length - shown).toLocaleString("en-IN")} left)</button>}
        </>)}
      </div>
    </WorkspaceFrame>
  );
}
