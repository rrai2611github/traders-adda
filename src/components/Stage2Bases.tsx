"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEPTH_BUCKETS, DISTANCE_BUCKETS, LENGTH_BUCKETS, NO_BASE_FILTER, STAGE2_BASE_RULES, bucketCounts, matchesBaseFilter,
  type BaseFilter, type Bucket, type Stage2BasePick, type Stage2BasesPayload,
} from "@/lib/screen/stage2Bases";
import { formatPrice } from "@/lib/format";
import { StockSymbolButton } from "./StockDetailContext";
import { LivePrice } from "./LivePrice";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero, WorkspaceTabs } from "./WorkspaceShell";
import { DataQualityNotice } from "./DataQualityNotice";
import { ListChangeNote, NewTag } from "./ListChangeNote";
import { useListChanges } from "@/hooks/useListChanges";
import { useHeaderSort } from "@/hooks/useHeaderSort";
import type { ListChanges } from "@/lib/listChanges";

type Tab = "breakouts" | "explorer";
type Axis = "distance" | "length" | "depth";

const R = STAGE2_BASE_RULES;
const QUICK_PICKS: { label: string; filter: BaseFilter }[] = [
  { label: "Within 2%, 20+ sessions", filter: { ...NO_BASE_FILTER, maxToHigh: 2, minSessions: 20 } },
  { label: "Long bases, 60+ sessions", filter: { ...NO_BASE_FILTER, minSessions: 60 } },
  { label: "New bases, under 20 sessions", filter: { ...NO_BASE_FILTER, maxSessions: 19 } },
  { label: "Tight: under 10% deep, within 5%", filter: { ...NO_BASE_FILTER, maxDepth: 10, maxToHigh: 5 } },
];

const sameFilter = (a: BaseFilter, b: BaseFilter) => JSON.stringify(a) === JSON.stringify(b);

/** Applies one clicked bucket on top of the current filter (clicking it again clears that axis). */
function withBucket(filter: BaseFilter, axis: Axis, bucket: Bucket): BaseFilter {
  const max = bucket.max === Infinity ? null : bucket.max;
  const min = bucket.min === -Infinity ? null : bucket.min;
  if (axis === "distance") return { ...filter, maxToHigh: max };
  if (axis === "length") return { ...filter, minSessions: min, maxSessions: max == null ? null : max - 1 };
  return { ...filter, maxDepth: max };
}

function bucketActive(filter: BaseFilter, axis: Axis, bucket: Bucket): boolean {
  const max = bucket.max === Infinity ? null : bucket.max;
  const min = bucket.min === -Infinity ? null : bucket.min;
  if (axis === "distance") return filter.maxToHigh === max;
  if (axis === "length") return filter.minSessions === min && filter.maxSessions === (max == null ? null : max - 1);
  return filter.maxDepth === max;
}

const clearAxis = (filter: BaseFilter, axis: Axis): BaseFilter =>
  axis === "distance" ? { ...filter, maxToHigh: null } : axis === "length" ? { ...filter, minSessions: null, maxSessions: null } : { ...filter, maxDepth: null };

export function Stage2Bases({ keep }: { keep: ((symbol: string) => boolean) | null }) {
  const [data, setData] = useState<Stage2BasesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("breakouts");
  const [filter, setFilter] = useState<BaseFilter>(NO_BASE_FILTER);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = 60_000;
      try {
        const response = await fetch("/api/market/stage-2-bases", { cache: "no-store", signal: controller.signal });
        if (response.status === 503) {
          const body: { warming?: boolean; error?: string } = await response.json();
          if (body.warming) {
            if (alive) { setProgress(body.error ?? "Loading price history."); setError(null); }
            delay = 5_000;
            return;
          }
          throw new Error(body.error ?? "Price history unavailable.");
        }
        if (!response.ok) throw new Error(`Stage 2 bases request failed (HTTP ${response.status}).`);
        const payload: Stage2BasesPayload = await response.json();
        if (alive) { setData(payload); setError(null); setProgress(null); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        console.error("[stage-2-bases] Refresh failed:", failure);
        if (alive) { setError(failure instanceof Error ? failure.message : "Refresh failed."); setProgress(null); }
      } finally {
        if (alive) timer = setTimeout(load, delay);
      }
    };
    void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);

  const inView = useMemo(() => (data?.rows ?? []).filter((row) => !keep || keep(row.symbol)), [data, keep]);
  const breakouts = useMemo(() => inView.filter((row) => row.kind === "breakout"), [inView]);
  const forming = useMemo(() => inView.filter((row) => row.kind === "forming"), [inView]);
  const nearCount = (pct: number) => forming.filter((row) => row.toHighPercent <= pct).length;
  const rows = useMemo(
    () => (tab === "breakouts" ? breakouts : inView.filter((row) => row.kind === "forming" && matchesBaseFilter(row, filter))),
    [tab, breakouts, inView, filter],
  );
  // Each bucket row counts against the OTHER two filters, so a count says what you would get by clicking it.
  const countsFor = (axis: Axis, buckets: Bucket[]) => {
    const others = clearAxis(filter, axis);
    const pool = forming.filter((row) => matchesBaseFilter(row, others));
    const pick = (row: Stage2BasePick) => (axis === "distance" ? row.toHighPercent : axis === "length" ? row.lengthSessions : row.depthPercent);
    return bucketCounts(pool.map(pick), buckets);
  };
  const { bindTable, rows: sortedRows } = useHeaderSort(rows, (row) => row.symbol);
  const changes = useListChanges(`stage2-${tab}-${data?.provisional ? "live" : "done"}`, data ? rows.map((row) => row.symbol) : null);
  const filtered = !sameFilter(filter, NO_BASE_FILTER);

  return (
    <WorkspaceFrame id="stage-2-bases" className="scroll-mt-28">
      <WorkspaceHero eyebrow="Breakout research" icon="setups" title="Stage 2 Bases"
        description="Uptrending stocks consolidating under a recent high. See which just closed above their base and which are closest to doing it. A watch list, not a buy call." />
      <WorkspaceTabs items={[
        { key: "breakouts", icon: "▲", label: `Broke out today (${breakouts.length})`, detail: `Closed above the base high after a base of ${R.minBreakoutSessions}+ sessions` },
        { key: "explorer", icon: "◇", label: `Base explorer (${forming.length})`, detail: "Bases still forming, filtered by distance, length and depth" },
      ]} active={tab} onSelect={setTab} />
      <div className="space-y-4 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}{data ? " Retained results may be stale." : " No results substituted."}</p>}
        {progress && data && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{progress} Retained results may be stale.</p>}
        <DataQualityNotice health={data} updatedAt={data?.updatedAt} />
        {data && <p className="text-xs leading-5 text-muted">
          {breakouts.length} broke out · {nearCount(3)} within 3% of their base high · {nearCount(5)} within 5% · {forming.length} bases forming, from {data.eligible} liquid stocks · Source: {data.source.label}.
          {" "}Snapshot {new Date(data.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST, {data.provisional ? "including today's forming candle, so a stock can fall back under its base before the close" : "completed sessions only"}.
          {data.source.id === "mock" && " SIMULATED DATA — not actual market signals."}
        </p>}
        <details className="rounded-xl border border-border bg-raised p-3 text-xs leading-5 text-muted">
          <summary className="cursor-pointer font-bold text-foreground">Rules</summary>
          <p className="mt-2">Stage 2 trend: close above the {R.trendAverageShort}-day average, the {R.trendAverageShort} above the {R.trendAverageLong}, and the {R.trendAverageLong}-day average higher than {R.slopeLookbackSessions} sessions ago. Liquid stock, price ≥ ₹{R.minPrice}.</p>
          <p className="mt-2">Base high is the highest high of the last year before today; the base starts on that session. Base low is the lowest low since. Depth is high over low. A breakout needs a close above the base high after at least {R.minBreakoutSessions} sessions.</p>
          <p className="mt-2"><b className="text-foreground">Volume-confirmed</b> means a breakout on volume at least {R.confirmVolumeRatio}× its {R.volumeAverageSessions}-day average. Backtest, 2022–26 (about 650 breakouts, next-open entry, 0.25% costs, −8% stop / +16% target): thin-volume breakouts lost −0.28R per trade and were the worst group in both halves of the period; volume-confirmed ones were close to breakeven (−0.03R, 38% win rate, 556 trades; −0.08R in the first half, +0.02R in the second). Base depth made no difference, so it is shown but does not filter. There is no proven edge here: treat it as a watch list, size small and use a stop.</p>
        </details>
        {tab === "explorer" && data && (
          <div className="space-y-3 rounded-xl border border-border bg-raised p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-foreground">Quick picks</span>
              {QUICK_PICKS.map((pick) => (
                <button key={pick.label} type="button" aria-pressed={sameFilter(filter, pick.filter)} onClick={() => setFilter(sameFilter(filter, pick.filter) ? NO_BASE_FILTER : pick.filter)}
                  className={`rounded-full border px-3 py-1 ${sameFilter(filter, pick.filter) ? "border-emerald-600 bg-emerald-50 font-bold text-emerald-800" : "border-border bg-white text-muted hover:border-emerald-300"}`}>{pick.label}</button>
              ))}
              {filtered && <button type="button" onClick={() => setFilter(NO_BASE_FILTER)} className="ml-auto font-bold text-accent underline">Clear all</button>}
            </div>
            <BucketRow title="Distance to base high" hint="Close below the base high" axis="distance" buckets={DISTANCE_BUCKETS} counts={countsFor("distance", DISTANCE_BUCKETS)} filter={filter} onChange={setFilter} />
            <BucketRow title="Base length" hint="Trading sessions in the base" axis="length" buckets={LENGTH_BUCKETS} counts={countsFor("length", LENGTH_BUCKETS)} filter={filter} onChange={setFilter} />
            <BucketRow title="Base depth" hint="Base high over base low" axis="depth" buckets={DEPTH_BUCKETS} counts={countsFor("depth", DEPTH_BUCKETS)} filter={filter} onChange={setFilter} />
            <p className="text-muted">{rows.length} of {forming.length} bases match{filtered ? "" : " · no filters"}.</p>
          </div>
        )}
        {data && <div className="overflow-hidden rounded-xl"><ListChangeNote changes={changes} /></div>}
        {!data ? error ? <EmptyState tone="error" title="Stage 2 bases unavailable">The feed will retry automatically.</EmptyState> : <LoadingState rows={5} message={progress ?? "Scanning for Stage 2 bases."} /> :
          !rows.length ? <EmptyState title={tab === "breakouts" ? "No base breakouts at this close" : "No bases match these filters"}>{tab === "breakouts" ? "No Stage 2 stock closed above a base of four weeks or more. Empty results are valid; none are manufactured." : "Loosen a filter or clear all."}</EmptyState> :
            <div className="max-h-[650px] overflow-auto rounded-xl border border-border">
              <table ref={bindTable} className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-xs">
                <thead className="sticky top-0 z-20 bg-raised text-[11px] uppercase tracking-wide text-muted"><tr>
                  <th className="sticky left-0 z-30 bg-raised px-4 py-3">Stock / RS</th><th className="px-3 py-3">{tab === "breakouts" ? "Above base high" : "To base high"}</th><th className="px-3 py-3">Base</th><th className="px-3 py-3">Depth</th><th className="px-3 py-3">Volume</th><th className="px-3 py-3">Breakout volume</th>
                </tr></thead>
                <tbody>{sortedRows.map((row) => <BaseRow key={row.symbol} row={row} changes={changes} />)}</tbody>
              </table>
            </div>}
      </div>
    </WorkspaceFrame>
  );
}

function BucketRow({ title, hint, axis, buckets, counts, filter, onChange }: {
  title: string; hint: string; axis: Axis; buckets: Bucket[]; counts: number[]; filter: BaseFilter; onChange: (filter: BaseFilter) => void;
}) {
  return (
    <div>
      <div className="mb-1 font-bold text-foreground">{title} <span className="font-normal text-muted">· {hint}</span></div>
      <div className="flex flex-wrap gap-2">
        {buckets.map((bucket, index) => {
          const active = bucketActive(filter, axis, bucket);
          return (
            <button key={bucket.label} type="button" aria-pressed={active} disabled={!counts[index] && !active}
              onClick={() => onChange(active ? clearAxis(filter, axis) : withBucket(filter, axis, bucket))}
              className={`rounded-lg border px-3 py-1.5 disabled:opacity-40 ${active ? "border-emerald-600 bg-emerald-50 font-bold text-emerald-800" : "border-border bg-white hover:border-emerald-300"}`}>
              {bucket.label} <span className="ml-1 font-mono text-muted">{counts[index]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BaseRow({ row, changes }: { row: Stage2BasePick; changes: ListChanges }) {
  const breakout = row.kind === "breakout";
  const weeks = (row.lengthSessions / 5).toFixed(1);
  return (
    <tr data-sort-key={row.symbol} className="odd:bg-white even:bg-slate-50 hover:bg-emerald-50">
      <td className="sticky left-0 z-10 max-w-[220px] border-b border-border bg-inherit px-4 py-3">
        <StockSymbolButton symbol={row.symbol} className="font-bold">{row.symbol}</StockSymbolButton>
        {changes.added.has(row.symbol) && <NewTag />}
        {row.fresh && <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] font-bold text-slate-700">new</span>}
        <div className="mt-1 truncate text-muted">{row.name}</div>
        <div className="mt-1 font-mono text-accent">RS {row.rs ?? "—"}</div>
      </td>
      <td className="border-b border-border px-3 py-3">
        <div className={`font-mono font-bold ${breakout ? "text-emerald-700" : "text-foreground"}`}>{breakout ? `+${Math.abs(row.toHighPercent).toFixed(2)}%` : `−${row.toHighPercent.toFixed(2)}%`}</div>
        <div className="mt-1"><LivePrice symbol={row.symbol} fallbackPrice={row.close} fallbackChange={row.dayChangePercent} /></div>
        <div className="text-[11px] text-muted">signal close ₹{formatPrice(row.close)}</div>
      </td>
      <td className="border-b border-border px-3 py-3"><div>High ₹{formatPrice(row.baseHigh)} · Low ₹{formatPrice(row.baseLow)}</div><div className="mt-1 text-muted">{row.lengthSessions} sessions · {weeks} wk</div><div className="mt-1 text-muted">since {new Date(row.beganAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div></td>
      <td className={`border-b border-border px-3 py-3 font-mono ${row.depthPercent > R.deepBasePercent ? "text-amber-700" : ""}`}>{row.depthPercent.toFixed(1)}%</td>
      <td className={`border-b border-border px-3 py-3 font-mono ${row.volumeRatio >= R.confirmVolumeRatio ? "text-emerald-700" : "text-muted"}`}>{row.volumeRatio.toFixed(2)}× avg<div className="mt-1 text-[11px] text-muted">₹{(row.turnoverCr ?? 0).toFixed(1)} Cr/day</div></td>
      <td className="border-b border-border px-3 py-3">{!breakout ? <span className="text-muted">—</span> : row.quality ? <span className="font-bold text-emerald-700">✓ Volume-confirmed</span> : <span className="font-bold text-rose-700">Thin volume</span>}</td>
    </tr>
  );
}
