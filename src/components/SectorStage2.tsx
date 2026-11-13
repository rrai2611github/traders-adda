"use client";

import { useEffect, useMemo, useState } from "react";
import {
  NO_SECTOR_FILTER, SECTOR_STAGE2_RULES, bandOf, matchesSectorFilter, sectorSummary, sortSectors, windowResult,
  type Band, type SectorFilter, type SectorSort, type SectorStage2Result, type SectorStage2Row,
} from "@/lib/screen/sectorStage2";
import type { DataHealth } from "@/lib/market/historyQuality";
import { DataQualityNotice } from "./DataQualityNotice";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero, WorkspaceTabs } from "./WorkspaceShell";

interface Payload extends SectorStage2Result, DataHealth {
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  covered: number;
}

type View = "ranking" | "heat";
const R = SECTOR_STAGE2_RULES;
const WINDOWS = [20, 40, 60] as const;
const BAND_BG: Record<Band, string> = { red: "bg-rose-500", amber: "bg-amber-400", green: "bg-emerald-500" };
const BAND_TEXT: Record<Band, string> = { red: "text-rose-700", amber: "text-amber-700", green: "text-emerald-700" };
const BAND_CELL: Record<Band, string> = { red: "bg-rose-200 text-rose-900", amber: "bg-amber-200 text-amber-900", green: "bg-emerald-300 text-emerald-950" };

const dayLabel = (day: number) => new Date(day * 86_400_000).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const points = (n: number | null) => (n == null ? "—" : `${n > 0 ? "▲ +" : n < 0 ? "▼ −" : "▬ "}${Math.abs(n).toFixed(1)}`);

export function SectorStage2() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [view, setView] = useState<View>("ranking");
  const [windowSessions, setWindowSessions] = useState<number>(40);
  const [filter, setFilter] = useState<SectorFilter>({ ...NO_SECTOR_FILTER, minNames: 5 });
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SectorSort>("share");
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = 5 * 60_000;
      try {
        const response = await fetch("/api/market/sector-stage-2", { cache: "no-store", signal: controller.signal });
        if (response.status === 503) {
          const body: { warming?: boolean; error?: string } = await response.json();
          if (body.warming) {
            if (alive) { setProgress(body.error ?? "Loading price history."); setError(null); }
            delay = 5_000;
            return;
          }
          throw new Error(body.error ?? "Price history unavailable.");
        }
        if (!response.ok) throw new Error(`Sector Stage 2 request failed (HTTP ${response.status}).`);
        const payload: Payload = await response.json();
        if (alive) { setData(payload); setError(null); setProgress(null); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        console.error("[sector-stage-2] Refresh failed:", failure);
        if (alive) { setError(failure instanceof Error ? failure.message : "Refresh failed."); setProgress(null); }
      } finally {
        if (alive) timer = setTimeout(load, delay);
      }
    };
    void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);

  const windowed = useMemo(() => (data ? windowResult(data, windowSessions) : null), [data, windowSessions]);
  const rows = useMemo(() => {
    if (!windowed) return [];
    const needle = search.trim().toLowerCase();
    return sortSectors(windowed.sectors.filter((row) => matchesSectorFilter(row, filter) && (!needle || row.sector.toLowerCase().includes(needle))), sortBy);
  }, [windowed, filter, search, sortBy]);
  const selected = rows.find((row) => row.sector === picked) ?? null;
  const windowLabel = `Over ${windowed?.days.length ?? windowSessions} sessions`;
  const set = (patch: Partial<SectorFilter>) => setFilter((current) => ({ ...current, ...patch }));

  return (
    <WorkspaceFrame id="sector-stage-2" className="scroll-mt-28">
      <WorkspaceHero eyebrow="Sector breadth" icon="setups" title="Sector Stage 2"
        description="Which sectors are carrying the uptrend, and which are falling behind: the share of each sector's stocks in a Stage 2 uptrend, session by session, against the whole market." />
      <WorkspaceTabs items={[
        { key: "ranking", icon: "≡", label: "Ranking", detail: "Share in Stage 2 now, the change over the window and a trend line" },
        { key: "heat", icon: "▦", label: "Heat map", detail: "Every sector across the sessions, coloured by share" },
      ]} active={view} onSelect={setView} />
      <div className="space-y-4 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}{data ? " Retained results may be stale." : " No results substituted."}</p>}
        {progress && data && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{progress} Retained results may be stale.</p>}
        <DataQualityNotice health={data} updatedAt={data?.updatedAt} />
        {!data || !windowed ? (error ? <EmptyState tone="error" title="Sector Stage 2 unavailable">The feed will retry automatically.</EmptyState> : <LoadingState rows={6} message={progress ?? "Measuring Stage 2 by sector."} />) : (<>
          <p className="text-xs leading-5 text-muted">
            {windowed.marketNow == null ? "Market share unavailable" : <>Whole market: <b className="text-foreground">{windowed.marketNow.toFixed(1)}%</b> of {windowed.marketNames.toLocaleString("en-IN")} liquid stocks in Stage 2</>}
            {" "}· {windowed.days.length ? `${dayLabel(windowed.days[0])} to ${dayLabel(windowed.days.at(-1)!)}` : "no sessions"} · {data.source.label} · completed sessions only.
          </p>
          <p className="rounded-xl border border-border bg-raised p-3 text-sm leading-6">{sectorSummary(rows, windowed.marketNow, windowLabel)}</p>
          <details className="rounded-xl border border-border bg-raised p-3 text-xs leading-5 text-muted">
            <summary className="cursor-pointer font-bold text-foreground">What Stage 2 means here</summary>
            <p className="mt-2">A stock is in Stage 2 when its close is above its {R.short}-day average, the {R.short}-day is above the {R.long}-day, and the {R.long}-day average is higher than it was {R.slopeLookback} sessions ago. The same test as the Stage 2 Bases scanner. A stock counts on a day only once it has {R.long + R.slopeLookback} sessions of history.</p>
            <p className="mt-2">Colour: red under {R.red}%, amber {R.red}–{R.green}%, green {R.green}% or more. Only liquid stocks with a published sector are counted in a sector; the market figure counts every liquid stock. A sector needs at least {R.minNames} scored stocks. This is a breadth reading, not a buy signal, and it has not been backtested.</p>
          </details>

          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-raised p-3 text-xs">
            <label className="block"><span className="font-bold text-foreground">Window</span>
              <select value={windowSessions} onChange={(e) => setWindowSessions(Number(e.target.value))} className="mt-1 block rounded-lg border border-border bg-white px-3 py-2">
                {WINDOWS.map((n) => <option key={n} value={n}>{n} sessions</option>)}</select></label>
            <label className="block"><span className="font-bold text-foreground">Names at least</span>
              <select value={filter.minNames} onChange={(e) => set({ minNames: Number(e.target.value) })} className="mt-1 block rounded-lg border border-border bg-white px-3 py-2">
                <option value={0}>Any</option><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select></label>
            <label className="block"><span className="font-bold text-foreground">Trend</span>
              <select value={filter.trend} onChange={(e) => set({ trend: e.target.value as SectorFilter["trend"] })} className="mt-1 block rounded-lg border border-border bg-white px-3 py-2">
                <option value="all">All</option><option value="gaining">Gaining</option><option value="losing">Losing</option></select></label>
            <label className="block"><span className="font-bold text-foreground">Against market</span>
              <select value={filter.market} onChange={(e) => set({ market: e.target.value as SectorFilter["market"] })} className="mt-1 block rounded-lg border border-border bg-white px-3 py-2">
                <option value="all">All</option><option value="above">Above</option><option value="below">Below</option></select></label>
            <label className="block"><span className="font-bold text-foreground">Sort by</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SectorSort)} className="mt-1 block rounded-lg border border-border bg-white px-3 py-2">
                <option value="share">Share in Stage 2</option><option value="change">Change over window</option><option value="names">Names</option></select></label>
            <label className="block min-w-40 flex-1"><span className="font-bold text-foreground">Search</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sector name" className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2" /></label>
            <p className="pb-2 text-muted">Showing {rows.length} of {windowed.sectors.length} sectors</p>
          </div>

          {!rows.length ? <EmptyState title="No sector matches these filters">Loosen a filter.</EmptyState> : view === "ranking" ? (
            <div className="overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-xs">
                <thead className="bg-raised text-[11px] uppercase tracking-wide text-muted"><tr>
                  <th className="px-4 py-3">Sector</th><th className="px-3 py-3">Share in Stage 2</th><th className="px-3 py-3">Names</th><th className="px-3 py-3">{windowSessions}-session change</th><th className="px-3 py-3">Vs market</th><th className="px-3 py-3">Trend</th>
                </tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.sector} onClick={() => setPicked(picked === row.sector ? null : row.sector)} className={`cursor-pointer odd:bg-white even:bg-slate-50 hover:bg-emerald-50 ${picked === row.sector ? "outline outline-2 -outline-offset-2 outline-emerald-500" : ""}`}>
                    <td className="border-b border-border px-4 py-3 font-bold">
                      <button type="button" aria-expanded={picked === row.sector} onClick={(e) => { e.stopPropagation(); setPicked(picked === row.sector ? null : row.sector); }} className="text-left">{row.sector}</button>
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      <div className="flex items-center gap-2"><span className={`font-mono font-bold ${row.band ? BAND_TEXT[row.band] : ""}`}>{row.now == null ? "—" : `${row.now.toFixed(1)}%`}</span>
                        <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-200" aria-hidden><span className={`block h-full ${row.band ? BAND_BG[row.band] : ""}`} style={{ width: `${Math.min(100, row.now ?? 0)}%` }} /></span></div>
                    </td>
                    <td className="border-b border-border px-3 py-3 text-muted">{row.inStage2} of {row.names}</td>
                    <td className={`border-b border-border px-3 py-3 font-mono ${(row.change ?? 0) > 0 ? "text-emerald-700" : (row.change ?? 0) < 0 ? "text-rose-700" : "text-muted"}`}>{points(row.change)} pts</td>
                    <td className={`border-b border-border px-3 py-3 font-mono ${(row.vsMarket ?? 0) > 0 ? "text-emerald-700" : (row.vsMarket ?? 0) < 0 ? "text-rose-700" : "text-muted"}`}>{row.vsMarket == null ? "—" : `${row.vsMarket > 0 ? "+" : "−"}${Math.abs(row.vsMarket).toFixed(1)}`}</td>
                    <td className="border-b border-border px-3 py-3"><Trend share={row.share} market={windowed.market} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <HeatGrid rows={rows} days={windowed.days} market={windowed.market} onPick={(sector) => { setPicked(sector); setView("ranking"); }} />
          )}
          {selected && view === "ranking" && <Detail row={selected} days={windowed.days} market={windowed.market} marketNow={windowed.marketNow} onClose={() => setPicked(null)} />}
        </>)}
      </div>
    </WorkspaceFrame>
  );
}

/** Polyline for a series on a fixed 0-100 axis, skipping gaps. */
function linePath(series: (number | null)[], width: number, height: number): string {
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  let path = "";
  series.forEach((value, i) => {
    if (value == null) return;
    path += `${path && series[i - 1] != null ? "L" : "M"}${(i * step).toFixed(1)},${(height - (Math.min(100, value) / 100) * height).toFixed(1)} `;
  });
  return path.trim();
}

function Trend({ share, market }: { share: (number | null)[]; market: (number | null)[] }) {
  const w = 110, h = 28;
  const last = share.findLast((v) => v != null) ?? null;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Stage 2 share trend">
      <path d={linePath(market, w, h)} fill="none" stroke="var(--muted, #94a3b8)" strokeWidth="1" strokeDasharray="3 2" />
      <path d={linePath(share, w, h)} fill="none" stroke={last != null && bandOf(last) === "red" ? "#e11d48" : last != null && bandOf(last) === "amber" ? "#d97706" : "#059669"} strokeWidth="1.8" />
    </svg>
  );
}

function Detail({ row, days, market, marketNow, onClose }: { row: SectorStage2Row; days: number[]; market: (number | null)[]; marketNow: number | null; onClose: () => void }) {
  const w = 640, h = 160;
  const step = days.length > 1 ? w / (days.length - 1) : 0;
  const tickIdx = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => days.length && a.indexOf(v) === i);
  return (
    <section aria-label={`${row.sector} detail`} className="rounded-xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">{row.sector}</h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {row.now?.toFixed(1)}% of {row.names} names are in Stage 2 ({row.inStage2} names), {Math.abs(row.vsMarket ?? 0).toFixed(1)} points {(row.vsMarket ?? 0) >= 0 ? "above" : "below"} the whole market{marketNow == null ? "" : ` (${marketNow.toFixed(1)}%)`}.
            Over this window it moved {points(row.change)} points.
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Close</button>
      </div>
      <svg viewBox={`-32 -6 ${w + 44} ${h + 30}`} className="mt-3 w-full" role="img" aria-label={`${row.sector} share in Stage 2 against the market`}>
        {[R.red, R.green, 60].map((g) => <g key={g}><line x1={0} x2={w} y1={h - (g / 100) * h} y2={h - (g / 100) * h} stroke="#cbd5e1" strokeWidth="0.6" strokeDasharray="3 3" /><text x={-6} y={h - (g / 100) * h + 3} textAnchor="end" fontSize="9" fill="#64748b">{g}%</text></g>)}
        <path d={linePath(market, w, h)} fill="none" stroke="#94a3b8" strokeWidth="1.4" strokeDasharray="4 3" />
        <path d={linePath(row.share, w, h)} fill="none" stroke="#059669" strokeWidth="2" />
        {tickIdx.map((i) => <text key={i} x={i * step} y={h + 16} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} fontSize="9" fill="#64748b">{dayLabel(days[i])}</text>)}
      </svg>
      <p className="mt-1 text-[11px] text-muted"><span className="font-bold text-emerald-700">━</span> {row.sector} <span className="ml-3 font-bold text-slate-400">╌</span> Whole market</p>
    </section>
  );
}

function HeatGrid({ rows, days, market, onPick }: { rows: SectorStage2Row[]; days: number[]; market: (number | null)[]; onPick: (sector: string) => void }) {
  // About a dozen columns: sample evenly, always including the latest session.
  const target = Math.min(12, days.length);
  const cols = Array.from({ length: target }, (_, i) => (target === 1 ? days.length - 1 : Math.round((i * (days.length - 1)) / (target - 1))));
  return (
    <div className="overflow-auto rounded-xl border border-border">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-center text-[11px]">
        <thead className="bg-raised text-muted"><tr><th className="sticky left-0 bg-raised px-4 py-2 text-left uppercase tracking-wide">Sector</th>{cols.map((c) => <th key={c} className="px-1 py-2 font-normal">{dayLabel(days[c])}</th>)}</tr></thead>
        <tbody>
          <tr><td className="sticky left-0 border-b border-border bg-slate-50 px-4 py-2 text-left font-bold">Whole market</td>{cols.map((c) => <Cell key={c} value={market[c]} />)}</tr>
          {rows.map((row) => (
            <tr key={row.sector}>
              <td className="sticky left-0 border-b border-border bg-white px-4 py-2 text-left font-bold"><button type="button" onClick={() => onPick(row.sector)} className="text-left underline-offset-2 hover:underline">{row.sector}</button></td>
              {cols.map((c) => <Cell key={c} value={row.share[c]} />)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border bg-raised px-4 py-2 text-[11px] text-muted"><span className="mr-3 rounded bg-rose-200 px-2 py-0.5">under {R.red}%</span><span className="mr-3 rounded bg-amber-200 px-2 py-0.5">{R.red}–{R.green}%</span><span className="rounded bg-emerald-300 px-2 py-0.5">{R.green}%+</span> Click a sector for its line chart.</p>
    </div>
  );
}

function Cell({ value }: { value: number | null }) {
  return <td className={`border-b border-white px-1 py-2 font-mono ${value == null ? "bg-slate-100 text-slate-400" : BAND_CELL[bandOf(value)]}`}>{value == null ? "·" : value.toFixed(0)}</td>;
}
