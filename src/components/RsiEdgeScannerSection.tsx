"use client";

import { StockSymbolButton } from "./StockDetailContext";
import { useMemo, useState } from "react";
import type { ScreenScan } from "@/hooks/useScreenScan";
import type { RsiEdgeSourcePayload, RsiEdgeSourceRow, RsiEdgeScanKey } from "@/lib/screen/rsiEdgeSource";
import { RSI_EDGE_SCAN_KEYS, RSI_EDGE_SOURCES } from "@/lib/screen/rsiEdgeSource";
import { currentScanBuyingStatus } from "@/lib/screen/buyingStatus";
import { currentScanShortSellingStatus } from "@/lib/screen/shortSellingStatus";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { ShortSellingStatusBadge } from "./ShortSellingStatusBadge";
import { formatPercent, formatPrice, formatVolume, toneClass } from "@/lib/format";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";

const ICONS: Record<RsiEdgeScanKey, string> = {
  "daily-bullish": "D",
  "weekly-bullish": "W",
  bearish: "↓",
};

export function RsiEdgeScannerSection({
  scan,
  source,
  sourceError,
  sourceLoading,
  active,
  onTabChange,
}: {
  scan: ScreenScan | null;
  source: RsiEdgeSourcePayload | null;
  sourceError: string | null;
  sourceLoading: boolean;
  active: RsiEdgeScanKey;
  onTabChange: (key: RsiEdgeScanKey) => void;
}) {
  const [query, setQuery] = useState("");
  const breadth = useMemo(() => movingAverageBreadth(scan?.marketRows ?? scan?.rows ?? [], "vs50").percent, [scan]);
  const localRows = useMemo(
    () => new Map((scan?.rows ?? []).map((row) => [row.symbol.toUpperCase(), row])),
    [scan],
  );
  const selected = source?.scanners[active] ?? null;
  const rows = useMemo(() => (selected?.rows ?? []).filter((row) => {
    const q = query.trim().toLowerCase();
    const local = localRows.get(row.symbol);
    return !q || `${row.symbol} ${row.name} ${local?.sector ?? ""}`.toLowerCase().includes(q);
  }), [localRows, query, selected]);
  const scannerError = source?.errors[active] ?? null;

  return (
    <WorkspaceFrame id="rsi-edge">
      <WorkspaceHero
        eyebrow="RSI Edge · exact public results"
        title="Chartink RSI Edge Scanners"
        description="Scanner membership comes directly from the three public Chartink result sets shared by @RSIEdge. Chartink keeps the clauses hidden, so local indicators are shown only as supporting analysis and never decide membership."
        icon="rsi"
        action={<a href="https://x.com/RSIEdge/status/2104464920284954938" target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700">
          View source post ↗
        </a>}
      />

      <div className="grid grid-cols-3 border-b border-border bg-slate-50">
        {RSI_EDGE_SCAN_KEYS.map((key) => {
          const definition = RSI_EDGE_SOURCES[key];
          const count = source?.scanners[key]?.total;
          const failed = source?.errors[key] != null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTabChange(key)}
              className={`flex items-center gap-3 border-r border-border px-5 py-4 text-left last:border-r-0 ${
                active === key ? "bg-white shadow-[inset_0_-3px_0_#16894f]" : "hover:bg-white/70"
              }`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black ${
                key === "bearish" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
              }`}>{ICONS[key]}</span>
              <span className="min-w-0">
                <span className="block font-black text-slate-900">{definition.label}</span>
                <span className="block text-xs text-slate-500">
                  {failed ? "Source unavailable" : count == null ? "Loading source…" : `${count} Chartink match${count === 1 ? "" : "es"}`}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{RSI_EDGE_SOURCES[active].label}</h3>
            <p className="mt-1 text-sm text-muted">{RSI_EDGE_SOURCES[active].description}</p>
          </div>
          <a
            href={`https://chartink.com/screener/${RSI_EDGE_SOURCES[active].slug}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-black text-amber-700 underline"
          >
            Verify on Chartink ↗
          </a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">Exact source membership</span>
          <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">Chartink delayed market data</span>
          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">Hidden clauses — no guessed near matches</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-slate-50/60 px-5 py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find stock or sector"
          className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-400"
        />
        <div className="ml-auto text-xs font-bold text-slate-500">
          {rows.length} shown
          {source ? ` · last successful refresh ${new Date(source.updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          {breadth == null ? "" : ` · breadth ${breadth}%`}
        </div>
      </div>

      {sourceError && (
        <p className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-700">
          Refresh failed. Displayed results are stale as of {source ? new Date(source.updatedAt).toLocaleTimeString("en-IN") : "the last successful update"}. {sourceError}
        </p>
      )}
      {scannerError && (
        <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-800">
          This scanner could not be refreshed; the other RSI Edge tabs remain available. {scannerError}
        </p>
      )}
      {!source && sourceLoading ? (
        <LoadingState message="Loading the current Chartink scanner results…" />
      ) : !source ? (
        <EmptyState tone="error" title="Chartink unavailable">Current Chartink scanner results are unavailable.</EmptyState>
      ) : scannerError ? (
        <EmptyState>No unverified or partial membership is shown for this scanner.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState tone={query ? "search" : "neutral"} title={query ? "No matches" : "No stocks"}>
          {query ? "No source matches pass this search." : "No stocks to show for this scanner in the selected universe."}
        </EmptyState>
      ) : (
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="min-w-[1120px] w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#f7f9fa] text-[11px] uppercase tracking-[0.08em] text-slate-400 shadow-[0_1px_0_#e2e8f0]">
                <th className="sticky left-0 z-30 bg-[#f7f9fa] px-3 py-3 text-center">#</th>
                <th className="sticky left-[56px] z-30 bg-[#f7f9fa] px-3 py-3 text-left">Instrument</th>
                <th className="px-3 py-3 text-right">Chartink price / day</th>
                <th className="px-3 py-3 text-right">Chartink volume</th>
                <th className="px-3 py-3 text-right">Our RSI daily</th>
                <th className="px-3 py-3 text-right">Our RSI weekly</th>
                <th className="px-3 py-3 text-right">Our pivot position</th>
                <th className="px-3 py-3 text-left">{active === "bearish" ? "Short status" : "Buy status"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <RsiEdgeRow
                  key={`${row.symbol}-${index}`}
                  rank={index + 1}
                  sourceRow={row}
                  localRow={localRows.get(row.symbol)}
                  active={active}
                  breadth={breadth}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WorkspaceFrame>
  );
}

function RsiEdgeRow({
  rank,
  sourceRow,
  localRow,
  active,
  breadth,
}: {
  rank: number;
  sourceRow: RsiEdgeSourceRow;
  localRow: ScreenScan["rows"][number] | undefined;
  active: RsiEdgeScanKey;
  breadth: number | null;
}) {
  const facts = localRow?.rsiEdge;
  const pivotPercent = facts && facts.dailyPivot > 0
    ? (facts.dailyClose / facts.dailyPivot - 1) * 100
    : null;
  return (
    <tr className="odd:bg-white even:bg-[#fafbfc] hover:bg-[#f0f9f4]">
      <td className="sticky left-0 z-10 border-b border-slate-100 bg-inherit px-3 py-3 text-center font-mono text-xs font-bold text-slate-400">{String(rank).padStart(2, "0")}</td>
      <td className="sticky left-[56px] z-10 border-b border-slate-100 bg-inherit px-3 py-3">
        <StockSymbolButton symbol={sourceRow.symbol} className="block font-black text-slate-900">{sourceRow.symbol}</StockSymbolButton>
        <div className="max-w-[220px] truncate text-xs text-muted">{sourceRow.name}</div>
      </td>
      <td className="border-b border-slate-100 px-3 py-3 text-right font-mono">
        <div className="font-black">₹{formatPrice(sourceRow.price)}</div>
        <div className={`text-xs ${toneClass(sourceRow.changePercent)}`}>{formatPercent(sourceRow.changePercent)}</div>
      </td>
      <td className="border-b border-slate-100 px-3 py-3 text-right font-mono">{formatVolume(sourceRow.volume)}</td>
      <td className="border-b border-slate-100 px-3 py-3 text-right font-mono font-black">{facts ? facts.dailyRsi.toFixed(1) : "—"}</td>
      <td className="border-b border-slate-100 px-3 py-3 text-right font-mono font-black">{facts ? facts.weeklyRsi.toFixed(1) : "—"}</td>
      <td className={`border-b border-slate-100 px-3 py-3 text-right font-mono ${toneClass(pivotPercent ?? 0)}`}>
        {pivotPercent == null ? "—" : formatPercent(pivotPercent)}
      </td>
      <td className="border-b border-slate-100 px-3 py-3">
        {!localRow
          ? <span className="text-xs font-semibold text-slate-400">Local analysis unavailable</span>
          : active === "bearish"
            ? <ShortSellingStatusBadge status={currentScanShortSellingStatus(localRow, breadth)} />
            : <BuyingStatusBadge status={currentScanBuyingStatus(localRow, breadth)} />}
      </td>
    </tr>
  );
}
