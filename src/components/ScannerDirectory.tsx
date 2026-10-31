"use client";

import { useMemo } from "react";
import type { ScreenScan } from "@/hooks/useScreenScan";
import type { ScannerPayload } from "@/lib/screen/chartinkScans";
import type { RsiEdgeSourcePayload } from "@/lib/screen/rsiEdgeSource";
import {
  SCANNER_DIRECTORY,
  TRADING_STYLES,
  directoryCounts,
  type DirectoryDirection,
  type DirectoryEntry,
  type DirectoryFamily,
  type DirectoryTarget,
} from "@/lib/screen/scannerDirectory";

const FAMILY_ORDER: DirectoryFamily[] = ["Core Setups", "RPCI & Oscillators", "Trade Triggers", "RSI Edge", "Monthly Setups", "Reversals"];

const DIRECTION_STYLES: Record<DirectoryDirection, { label: string; chip: string; accent: string }> = {
  bull: { label: "Bullish", chip: "border-emerald-200 bg-emerald-50 text-emerald-800", accent: "bg-emerald-500" },
  bear: { label: "Bearish", chip: "border-rose-200 bg-rose-50 text-rose-800", accent: "bg-rose-500" },
  "counter-trend": { label: "Pullback buy", chip: "border-sky-200 bg-sky-50 text-sky-800", accent: "bg-sky-500" },
  experimental: { label: "Experimental", chip: "border-amber-200 bg-amber-50 text-amber-800", accent: "bg-amber-500" },
};

const HORIZON_CHIP: Record<DirectoryEntry["horizon"], string> = {
  short: "border-violet-200 bg-violet-50 text-violet-800",
  mid: "border-indigo-200 bg-indigo-50 text-indigo-800",
  long: "border-slate-300 bg-slate-100 text-slate-800",
};

export function StyleTag({ horizon }: { horizon: DirectoryEntry["horizon"] }) {
  const style = TRADING_STYLES[horizon];
  return (
    <span title={`Typical holding ${style.holding}`} className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black ${HORIZON_CHIP[horizon]}`}>
      {style.tag}
      <span className="truncate font-semibold opacity-70">· {style.holding}</span>
    </span>
  );
}

/** Every visible scanner as a card: what it looks for, its trading style and today's count. */
export function ScannerDirectory({
  scan,
  scanners,
  rsiEdge,
  onOpen,
}: {
  scan: ScreenScan | null;
  scanners: ScannerPayload | null;
  rsiEdge: RsiEdgeSourcePayload | null;
  onOpen: (target: DirectoryTarget) => void;
}) {
  const counts = useMemo(() => directoryCounts(scan, scanners, rsiEdge), [rsiEdge, scan, scanners]);

  return (
    <section aria-labelledby="scanner-directory-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 id="scanner-directory-title" className="text-sm font-black text-slate-900">Scanner directory</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            What each scanner looks for, its trading style and today&apos;s hit count (played-out setups and sub-floor triggers excluded). A hit is a candidate, not a recommendation.
          </p>
        </div>
      </header>
      <div className="space-y-4 p-4">
        {FAMILY_ORDER.map((family) => (
          <div key={family}>
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{family}</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {SCANNER_DIRECTORY.filter((entry) => entry.family === family).map((entry) => {
                const count = counts.get(entry.id);
                const direction = DIRECTION_STYLES[entry.direction];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onOpen(entry.target)}
                    className="group relative flex min-h-[9.5rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 pl-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                  >
                    <span className={`absolute inset-y-0 left-0 w-1 ${direction.accent}`} aria-hidden />
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-black leading-5 text-slate-900">{entry.name}</span>
                      <span className="text-right">
                        <span className="block font-mono text-xl font-black leading-6 tabular-nums text-slate-900">{count?.count ?? "—"}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <StyleTag horizon={entry.horizon} />
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${direction.chip}`}>{direction.label}</span>
                    </div>
                    <p className="mt-2 flex-1 text-[11px] leading-4 text-slate-600">{entry.rule}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate font-semibold text-slate-400">{count?.detail ?? (count?.count == null ? "Loading…" : "\u00a0")}</span>
                      <span className="shrink-0 font-black text-emerald-700 opacity-70 transition group-hover:opacity-100">Open →</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
