"use client";

import { useMemo, useState } from "react";
import type { ScanRow } from "@/hooks/useScreenScan";
import {
  buildSectorHeatmap,
  formatHeatValue,
  HEAT_METRICS,
  heatLevel,
  type HeatLevel,
  type HeatMetric,
} from "@/lib/screen/sectorHeatmap";
import { MIN_SECTOR_MEMBERS } from "@/lib/screen/commandCenter";
import { useOpenStock } from "./StockDetailContext";
import { EmptyState } from "./WorkspaceShell";

// Palette steps that read well in both themes (see the dark-theme notes in globals.css).
const LEVEL_CLASS: Record<HeatLevel, string> = {
  3: "bg-emerald-600 text-white",
  2: "bg-emerald-500 text-white",
  1: "bg-emerald-100 text-emerald-900",
  0: "bg-slate-100 text-slate-700",
  [-1]: "bg-red-100 text-red-900",
  [-2]: "bg-red-500 text-white",
  [-3]: "bg-red-600 text-white",
};
const LEGEND: HeatLevel[] = [-3, -2, -1, 0, 1, 2, 3];
const MEMBER_PREVIEW = 48;

/** Tile footprint by traded-value rank: the two biggest sectors get a 2×2 tile, the next four 2×1. */
function tileSpan(rank: number): string {
  if (rank < 2) return "col-span-2 row-span-2";
  if (rank < 6) return "col-span-2";
  return "";
}

export function SectorHeatmap({ rows }: { rows: ReadonlyArray<ScanRow> }) {
  const [metric, setMetric] = useState<HeatMetric>("change");
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const openStock = useOpenStock();
  const sectors = useMemo(() => buildSectorHeatmap(rows, metric), [rows, metric]);
  const selected = sectors.find((sector) => sector.sector === picked) ?? null;
  const members = selected ? (showAll ? selected.members : selected.members.slice(0, MEMBER_PREVIEW)) : [];
  const info = HEAT_METRICS[metric];

  if (!sectors.length) {
    return <EmptyState title="No sector data yet">The market scan hasn&apos;t produced sector data yet.</EmptyState>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Colour sectors by" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {(Object.keys(HEAT_METRICS) as HeatMetric[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                metric === key ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {HEAT_METRICS[key].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
          <span>Weaker</span>
          <div className="flex overflow-hidden rounded-md">
            {LEGEND.map((level) => <span key={level} className={`h-3 w-6 ${LEVEL_CLASS[level].split(" ")[0]}`} />)}
          </div>
          <span>Stronger</span>
        </div>
      </div>
      <p className="text-xs text-muted">
        {info.sectorRule} Tile size follows the sector&apos;s traded value. NSE sectors with at least {MIN_SECTOR_MEMBERS} eligible equities. Click a sector to see its stocks.
      </p>

      <div className="grid auto-rows-[92px] grid-flow-dense grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        {sectors.map((sector, rank) => {
          const level = heatLevel(metric, sector.value, "sector");
          const isPicked = sector.sector === picked;
          return (
            <button
              key={sector.sector}
              type="button"
              aria-pressed={isPicked}
              onClick={() => { setPicked(isPicked ? null : sector.sector); setShowAll(false); }}
              title={`${sector.sector}: ${sector.advancing} of ${sector.total} up · ₹${Math.round(sector.turnoverCr).toLocaleString("en-IN")} cr/day traded`}
              className={`flex min-w-0 flex-col justify-between rounded-xl p-3 text-left transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${tileSpan(rank)} ${LEVEL_CLASS[level]} ${
                isPicked ? "ring-2 ring-slate-900" : ""
              }`}
            >
              <span className={`font-black leading-tight ${rank < 2 ? "text-sm" : "line-clamp-2 text-xs"}`}>{sector.sector}</span>
              {rank < 2 && (
                <span className="space-y-0.5 font-mono text-[11px] font-bold opacity-85">
                  {sector.members.slice(0, 4).map((stock) => (
                    <span key={stock.symbol} className="flex justify-between gap-2">
                      <span className="truncate">{stock.symbol}</span>
                      <span>{formatHeatValue(metric, stock.value, "stock")}</span>
                    </span>
                  ))}
                </span>
              )}
              <span>
                <span className={`block font-mono font-black ${rank < 2 ? "text-3xl" : rank < 6 ? "text-xl" : "text-base"}`}>
                  {formatHeatValue(metric, sector.value, "sector")}
                </span>
                <span className="block text-[11px] font-bold opacity-80">{sector.advancing}/{sector.total} up</span>
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <section aria-label={`${selected.sector} stocks`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-black tracking-tight text-slate-900">{selected.sector}</h3>
            <span className="text-xs font-semibold text-slate-500">
              {selected.total} stocks by traded value · {info.stockRule} Click a stock for its analysis.
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {members.map((stock) => {
              const level = heatLevel(metric, stock.value, "stock");
              return (
                <button
                  key={stock.symbol}
                  type="button"
                  disabled={!openStock}
                  onClick={() => openStock?.(stock.symbol)}
                  title={`${stock.name} · 1D ${formatHeatValue("change", stock.changePercent, "stock")} · RS ${stock.rs ?? "—"}`}
                  className={`min-w-0 rounded-lg px-2 py-2 text-left transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${LEVEL_CLASS[level]}`}
                >
                  <span className="block truncate font-mono text-xs font-black">{stock.symbol}</span>
                  <span className="block font-mono text-[11px] font-bold opacity-90">{formatHeatValue(metric, stock.value, "stock")}</span>
                </button>
              );
            })}
          </div>
          {selected.members.length > MEMBER_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="mt-3 text-xs font-black text-emerald-700 hover:underline"
            >
              {showAll ? "Show the largest only" : `Show all ${selected.members.length} stocks`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
