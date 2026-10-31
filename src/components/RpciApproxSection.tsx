"use client";

import { StockSymbolButton } from "./StockDetailContext";
import { LivePrice } from "./LivePrice";
import { Fragment, useEffect, useState } from "react";
import type { ScanRow, ScreenScan } from "@/hooks/useScreenScan";
import { RPCI_APPROX_RULES, type RpciApproxResult } from "@/lib/screen/rpciApprox";
import { rpciFreshness } from "@/lib/screen/rpciFreshness";
import { formatPercent, toneClass } from "@/lib/format";
import { currentScanBuyingStatus } from "@/lib/screen/buyingStatus";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { EmptyState, LoadingState } from "./WorkspaceShell";

const STAGE_STYLES: Record<RpciApproxResult["stage"], { label: string; className: string }> = {
  breakout: { label: "Confirmed breakout", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  testing: { label: "Testing pivot", className: "border-amber-200 bg-amber-50 text-amber-800" },
  forming: { label: "Forming", className: "border-slate-200 bg-slate-50 text-slate-600" },
};
// Cells inherit the opaque row colour so sticky columns hide content scrolling beneath them.
const ROW_BG = "bg-inherit";

const priceLabel = (price: number) => `₹${price.toLocaleString("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;
const timestampLabel = (timestamp: number) => new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(timestamp) + " IST";

interface RpciApproxSectionProps {
  scan: ScreenScan | null;
  error: boolean;
  loadingMessage?: string | null;
  watchlistSymbols: string[];
  onAddToWatchlist: (symbol: string) => void;
}

export function RpciApproxSection({
  scan,
  error,
  loadingMessage,
  watchlistSymbols,
  onAddToWatchlist,
}: RpciApproxSectionProps) {
  const [now, setNow] = useState(0);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, []);
  const rows = (scan?.rows ?? [])
    .filter((row): row is ScanRow & { rpciApprox: RpciApproxResult } => row.rpciApprox != null)
    .sort((a, b) => a.rpciApprox.contractionRatio - b.rpciApprox.contractionRatio);
  const breadthPercent = movingAverageBreadth(scan?.marketRows ?? scan?.rows ?? [], "vs50").percent;

  return (
    <section aria-labelledby="rpci-title" className="rounded-2xl border border-[#cbe9d8] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-[#16894f]">Independent contraction scan</p>
          <h2 id="rpci-title" className="mt-1 text-2xl font-black tracking-tight">RPCI-style results · approximation</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Not the proprietary RPCI indicator or its exact signals. This screen finds liquid, strong stocks
            with two consecutive tightening ranges and declining volume near a recent high. Intraday crosses
            are only testing the pivot; a breakout requires a completed close above it on stronger volume.
          </p>
        </div>
        <span className="rounded-full bg-[#e7f6ee] px-3 py-1.5 text-sm font-black text-[#16894f]">
          {scan ? `${rows.length} of ${scan.eligible} eligible` : error ? "Unavailable" : "Loading"}
        </span>
      </div>
      <details className="group mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs leading-5 text-muted">
        <summary className="cursor-pointer select-none font-black text-slate-700 marker:text-slate-400">Rules &amp; data source</summary>
        <p className="mt-2">
          Rules: three consecutive 20-session ranges, middle ≤{RPCI_APPROX_RULES.maxPriorContractionRatio}×
          oldest, newest ≤{RPCI_APPROX_RULES.maxContractionRatio}× middle and ≤{RPCI_APPROX_RULES.maxRangePercent}%;
          newest average volume ≤{RPCI_APPROX_RULES.maxVolumeRatio}× middle;
          RS ≥{RPCI_APPROX_RULES.minRs}, above 50/200-day averages, within {RPCI_APPROX_RULES.maxFromHighPercent}%
          of the 52-week high and {RPCI_APPROX_RULES.maxBelowPivotPercent}% below to {RPCI_APPROX_RULES.maxAbovePivotPercent}%
          above the recent high. Confirmation needs a completed close above the pivot with volume ≥{RPCI_APPROX_RULES.minBreakoutVolumeRatio}×
          the recent 20-session average. Existing liquidity floor applies. Incomplete daily candles are excluded;
          live quotes are used only for pivot proximity.
        </p>
        {scan && (
          <p className="mt-2">
            Universe: {scan.universe.total.toLocaleString("en-IN")} {scan.universe.source}, list dated {scan.universe.generatedAt.slice(0, 10)} · Source: {scan.source.label} · Scan: {timestampLabel(scan.updatedAt)} · Expected completed session: {scan.sessionDateKey}
            {scan.source.id === "yahoo" ? " · Public-feed delay is not guaranteed" : ""}
            {scan.unavailable.length > 0
              ? ` · Skipped ${scan.unavailable.length} symbol${scan.unavailable.length === 1 ? "" : "s"} with no provider data: ${scan.unavailable.slice(0, 12).join(", ")}${scan.unavailable.length > 12 ? ` and ${scan.unavailable.length - 12} more` : ""}`
              : ""}
            {scan.insufficientHistory?.length
              ? ` · Not scored (under 20 sessions of history): ${scan.insufficientHistory.length}`
              : ""}
          </p>
        )}
      </details>
      {error && scan && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-800">Scan refresh failed; results may be stale.</p>}
      {!scan && error ? (
        <EmptyState tone="error" title="Contraction results unavailable">The scan will retry automatically.</EmptyState>
      ) : !scan ? (
        <LoadingState message={loadingMessage ?? "Loading contraction results…"} />
      ) : rows.length === 0 ? (
        <EmptyState title="No contraction setups">No stocks currently meet all the approximation rules.</EmptyState>
      ) : (
        <div className="mt-5 max-h-[calc(100vh-260px)] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#f7f9fa] text-[10px] uppercase tracking-[0.08em] text-slate-400 shadow-[0_1px_0_#e2e8f0]">
                <th scope="col" className="sticky left-0 z-30 bg-[#f7f9fa] px-3 py-3 text-center">#</th>
                <th scope="col" className="sticky left-[48px] z-30 bg-[#f7f9fa] px-3 py-3 text-left">Instrument</th>
                <th scope="col" className="px-3 py-3 text-right">Price / day</th>
                <th scope="col" className="px-3 py-3 text-left">Stage</th>
                <th scope="col" className="px-3 py-3 text-left">Buy status</th>
                <th scope="col" className="px-3 py-3 text-right">20D range</th>
                <th scope="col" className="px-3 py-3 text-right">Contraction</th>
                <th scope="col" className="px-3 py-3 text-right">Vol ratio</th>
                <th scope="col" className="px-3 py-3 text-right">Breakout vol</th>
                <th scope="col" className="px-3 py-3 text-right">From pivot</th>
                <th scope="col" className="px-3 py-3 text-right">RS</th>
                <th scope="col" className="px-3 py-3 text-left">Data</th>
                <th scope="col" className="px-3 py-3 text-left">Plan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const result = row.rpciApprox;
                const symbol = `NSE:${row.symbol}`;
                const added = watchlistSymbols.includes(row.symbol);
                const freshness = rpciFreshness({
                  updatedAt: scan.updatedAt,
                  sessionDateKey: scan.sessionDateKey,
                  marketOpen: scan.marketOpen,
                  sourceId: scan.source.id,
                  quoteTimestamp: row.quoteTimestamp,
                  candleTimestamp: result.lastCompletedCandleTimestamp,
                }, now || scan.updatedAt);
                const buyingStatus = currentScanBuyingStatus(row, breadthPercent);
                const stage = STAGE_STYLES[result.stage];
                const cell = "border-b border-slate-100 px-3 py-3";
                const planOpen = openPlan === row.symbol;
                return (
                  <Fragment key={row.symbol}>
                  <tr className="odd:bg-white even:bg-[#fafbfc] hover:bg-[#f0f9f4]">
                    <td className={`sticky left-0 z-10 w-[48px] min-w-[48px] text-center font-mono text-xs font-bold text-slate-400 ${ROW_BG} ${cell}`}>{String(index + 1).padStart(2, "0")}</td>
                    <td className={`sticky left-[48px] z-10 shadow-[1px_0_0_#eef2f4] ${ROW_BG} ${cell}`}>
                      <StockSymbolButton symbol={row.symbol} className="block font-black text-slate-900">{row.symbol}</StockSymbolButton>
                      <div className="max-w-[220px] truncate text-xs text-muted" title={row.name}>{row.name}</div>
                    </td>
                    <td className={`text-right font-mono ${ROW_BG} ${cell}`}>
                      <LivePrice symbol={row.symbol} fallbackPrice={row.price} fallbackChange={row.changePercent} stacked className="font-black" />
                    </td>
                    <td className={`${ROW_BG} ${cell}`}>
                      <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${stage.className}`}>{stage.label}</span>
                    </td>
                    <td className={`${ROW_BG} ${cell}`}><BuyingStatusBadge status={buyingStatus} /></td>
                    <td className={`text-right font-mono ${ROW_BG} ${cell}`}>{result.rangePercent.toFixed(1)}%</td>
                    <td className={`whitespace-nowrap text-right font-mono ${ROW_BG} ${cell}`} title="Prior / recent contraction ratio">
                      {result.priorContractionRatio.toFixed(2)}× <span className="text-slate-400">/</span> {result.contractionRatio.toFixed(2)}×
                    </td>
                    <td className={`whitespace-nowrap text-right font-mono ${ROW_BG} ${cell}`}>{result.volumeRatio.toFixed(2)}×</td>
                    <td className={`whitespace-nowrap text-right font-mono ${ROW_BG} ${cell}`}>
                      {result.breakoutVolumeRatio == null ? "—" : `${result.breakoutVolumeRatio.toFixed(2)}×`}
                    </td>
                    <td className={`text-right font-mono ${toneClass(result.distanceToPivotPercent)} ${ROW_BG} ${cell}`}>{formatPercent(result.distanceToPivotPercent)}</td>
                    <td className={`text-right font-mono font-black ${ROW_BG} ${cell}`}>{row.rs}</td>
                    <td className={`${ROW_BG} ${cell}`}>
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${freshness.actionable ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
                        title={`Candle: ${timestampLabel(result.lastCompletedCandleTimestamp)}\nQuote: ${row.quoteTimestamp == null ? "Unavailable" : timestampLabel(row.quoteTimestamp)}`}
                      >
                        {freshness.label}
                      </span>
                    </td>
                    <td className={`${ROW_BG} ${cell}`}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={added}
                          onClick={() => onAddToWatchlist(symbol)}
                          className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-[#16894f] transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          {added ? "✓ Watching" : "+ Watch"}
                        </button>
                        <button
                          type="button"
                          aria-expanded={planOpen}
                          onClick={() => setOpenPlan(planOpen ? null : row.symbol)}
                          className="whitespace-nowrap py-1 text-[11px] font-bold text-[#16894f]"
                        >
                          {planOpen ? "▾ Plan" : "▸ Plan"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {planOpen && (
                    <tr>
                      <td colSpan={13} className="border-b border-slate-100 bg-emerald-50/40 px-4 py-3">
                        <div className="sticky left-4 grid max-w-[900px] grid-cols-2 gap-x-8 gap-y-1.5 text-xs text-foreground">
                          <p className="col-span-2 font-black">Illustrative only · not an order</p>
                          <p>Entry trigger: above <b className="font-mono">{priceLabel(result.entryTriggerPrice)}</b> (pivot)</p>
                          <p>Structural invalidation: <b className="font-mono text-rose-700">{priceLabel(result.baseLowPrice)}</b> (20-session base low)</p>
                          <p>Risk at pivot: <b className="font-mono">{priceLabel(result.riskPerShare)}</b> per share ({result.riskPercent.toFixed(1)}%)</p>
                          <p>Current price vs trigger: <b className="font-mono">{formatPercent(result.distanceToPivotPercent)}</b></p>
                          <p className="col-span-2 text-muted">Base ended {timestampLabel(result.baseCandleTimestamp)}. No quantity, slippage, fees or execution price included.</p>
                          {!freshness.actionable && (
                            <p className="col-span-2 font-bold text-amber-700">
                              {freshness.label}: verify current prices and the setup before considering any trade.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
