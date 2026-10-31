"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScreenScan } from "@/hooks/useScreenScan";
import type { MonthlySetupsPayload } from "@/lib/screen/monthlySetups";
import { horizonBuySignal } from "@/lib/screen/horizonSignal";
import { marketRegime } from "@/lib/screen/commandCenter";
import { formatPercent, formatPrice } from "@/lib/format";
import { StockSymbolButton } from "./StockDetailContext";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero, WorkspaceTabs } from "./WorkspaceShell";
import { DataQualityNotice } from "./DataQualityNotice";

export function MonthlySetups({ scan, scanError, keep }: {
  scan: ScreenScan | null;
  scanError: boolean;
  keep: ((symbol: string) => boolean) | null;
}) {
  const [data, setData] = useState<MonthlySetupsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [tab, setTab] = useState<"breakout" | "compression">("breakout");
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = 60_000;
      try {
        const response = await fetch("/api/market/monthly-setups", { cache: "no-store", signal: controller.signal });
        if (response.status === 503) {
          const body: { warming?: boolean; error?: string } = await response.json();
          if (body.warming) {
            if (alive) { setProgress(body.error ?? "Loading monthly history."); setError(null); }
            delay = 5_000;
            return;
          }
          throw new Error(body.error ?? "Monthly history unavailable.");
        }
        if (!response.ok) throw new Error(`Monthly setups request failed (HTTP ${response.status}).`);
        const payload: MonthlySetupsPayload = await response.json();
        if (alive) { setData(payload); setError(null); setProgress(null); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        console.error("[monthly-setups] Refresh failed:", failure);
        if (alive) { setError(failure instanceof Error ? failure.message : "Monthly refresh failed."); setProgress(null); }
      } finally {
        if (alive) timer = setTimeout(load, delay);
      }
    };
    void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);
  const rows = useMemo(() => (data?.rows ?? []).filter((row) => (!keep || keep(row.symbol)) && (tab === "breakout" ? row.setup.breakout : row.setup.compression)), [data, keep, tab]);
  const scanRows = useMemo(() => new Map((scan?.rows ?? []).map((row) => [row.symbol, row])), [scan]);
  const breadth = useMemo(() => marketRegime(scan?.marketRows ?? scan?.rows ?? []).breadth50, [scan]);
  const value = (number: number | null) => number == null ? "—" : number.toFixed(1);
  return (
    <WorkspaceFrame id="monthly" className="scroll-mt-28">
      <WorkspaceHero eyebrow="Higher-timeframe research" icon="setups" title="Monthly Setups"
        description="Completed-month breakouts and compression. Monthly structure is discovery, not daily entry readiness or a customer buy call." />
      <WorkspaceTabs items={[
        { key: "breakout", icon: "↗", label: "12-month breakouts", detail: "Completed close above prior 12 monthly highs" },
        { key: "compression", icon: "▦", label: "Mother-candle compression", detail: "At least two complete inside months" },
      ]} active={tab} onSelect={setTab} />
      <div className="space-y-4 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}{data ? " Retained results may be stale." : " No results substituted."}</p>}
        {progress && data && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{progress} Retained results may be stale.</p>}
        <DataQualityNotice health={data} updatedAt={data?.updatedAt} />
        {data && <p className="text-xs leading-5 text-muted">
          Signal month <strong>{data.signalMonth}</strong> · {rows.length} matching stocks in your view · {data.analyzed}/{data.eligible} eligible stocks have usable monthly history · Source: {data.source.label}.
          {" "}Snapshot {new Date(data.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Quote latency is unverified; monthly levels are not execution prices.
          {data.source.id === "mock" && " SIMULATED DATA — not actual market signals."}
        </p>}
        <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-800">
          Monthly labels describe completed-month structure, not a buy recommendation. Daily entry readiness is a separate short-term buy assessment: Avoid means no qualifying daily entry, not an invalid monthly setup. This is not a short-selling rating.
        </p>
        <details className="rounded-xl border border-border bg-raised p-3 text-xs leading-5 text-muted">
          <summary className="cursor-pointer font-bold text-foreground">Rules & data source</summary>
          <p className="mt-2">Breakout: the latest completed monthly close strictly exceeds the highest high of the preceding 12 completed months. Equality is not a breakout. Consecutive qualifying months can appear; this is not necessarily the first breakout in a run.</p>
          <p className="mt-2">Compression: the most recent mother candle with at least two following completed monthly candles fully inside its high/low range, including equality, through the signal month. No bullish trend is required. Range ± range-height projections are illustrative, not targets with a known probability, stops or trade plans.</p>
          <p className="mt-2">Only existing liquidity-floor stocks qualify (₹5 Cr median daily turnover; ₹500 Cr market cap when known). Complete start/end regular sessions and consecutive monthly buckets are required; the initial partial month is discarded. Monthly boundary checks include published NSE 2024–2026 holidays plus configured closures; genuine special-session bars are retained. Beyond these years, keep MARKET_HOLIDAYS current. This is boundary validation, not an audit of every historical session.</p>
          <p className="mt-2">Monthly Wilder DMI/ADX(14) is context only, never a membership gate. The shared calculation requires at least 29 monthly bars; unavailable indicators show —. Volume ratio compares the signal month&apos;s volume with the prior 12-month average, without a volume gate. Current-month observations are provisional and cannot confirm a monthly close.</p>
          <p className="mt-2">Daily entry readiness uses the existing short-term buy rules independently of monthly structure. Expand its checks to see stock-specific failures and the market breadth gate. No entry rules, emails or paper approvals change. Current constituents and provider history can contain survivorship/corporate-action limitations. No historical profitability or multibagger claim has been established.</p>
        </details>
        {data && (data.issues.length > 0 || data.unavailable.length > 0) && <details className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <summary className="cursor-pointer font-bold">Coverage limitations: {data.issues.length} monthly-history exclusions · {data.unavailable.length} provider-unavailable symbols</summary>
          <ul className="mt-2 max-h-48 overflow-auto">{data.issues.map((issue) => <li key={issue.symbol}>{issue.symbol}: {issue.reason}</li>)}</ul>
          {data.unavailable.length > 0 && <p className="mt-2">Provider unavailable: {data.unavailable.join(", ")}</p>}
        </details>}
        {!data ? error ? <EmptyState tone="error" title="Monthly analysis unavailable">The feed will retry automatically.</EmptyState> : <LoadingState rows={5} message={progress ?? "Building completed monthly setups."} /> :
          !rows.length ? <EmptyState title="No matching monthly setups">No stock meets these rules in the selected universe. Empty results are valid; no candidates are manufactured.</EmptyState> :
            <div className="max-h-[650px] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-xs">
                <thead className="sticky top-0 z-20 bg-raised text-[11px] uppercase tracking-wide text-muted"><tr>
                  <th className="sticky left-0 z-30 bg-raised px-4 py-3">Stock / RS</th><th className="px-3 py-3">Monthly structure</th><th className="px-3 py-3">Structure references</th><th className="px-3 py-3">Monthly DMI / ADX</th><th className="px-3 py-3">Liquidity / volume</th><th className="px-3 py-3">Current month · provisional</th><th className="px-3 py-3">Daily entry readiness</th>
                </tr></thead>
                <tbody>{rows.map(({ symbol, name, rs, turnoverCr, setup }) => {
                  const row = scanRows.get(symbol);
                  const aligned = scan && !scanError && scan.updatedAt === data.updatedAt;
                  const status = row && aligned ? horizonBuySignal(row, "short", breadth).status : null;
                  return <tr key={symbol} className="odd:bg-white even:bg-slate-50 hover:bg-emerald-50">
                    <td className="sticky left-0 z-10 max-w-[220px] border-b border-border bg-inherit px-4 py-3"><StockSymbolButton symbol={symbol} className="font-bold">{symbol}</StockSymbolButton><div className="mt-1 truncate text-muted">{name}</div><div className="mt-1 font-mono text-accent">RS {rs ?? "—"}</div></td>
                    <td className="border-b border-border px-3 py-3"><span className={`inline-flex rounded-lg border px-2 py-1 text-[11px] font-bold ${tab === "breakout" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>{tab === "breakout" ? "Monthly breakout confirmed" : "Monthly compression active"}</span><div className="mt-2 font-bold">As of {setup.signalMonth}</div><div className="mt-1 font-mono">Close ₹{formatPrice(setup.close)}</div><div className="mt-1 text-muted">{setup.completedMonths} complete months</div></td>
                    <td className="border-b border-border px-3 py-3">{tab === "breakout" && setup.breakout ? <><div>Prior high ₹{formatPrice(setup.breakout.level)}</div><div className="mt-1 font-mono">{formatPercent(setup.breakout.distancePercent)} above</div></> : setup.compression ? <><div>Mother {setup.compression.motherMonth} · {setup.compression.insideMonths} inside months</div><div className="mt-1">Range ₹{formatPrice(setup.compression.low)}–₹{formatPrice(setup.compression.high)}</div><div className="mt-1 text-muted">Projections ↑ ₹{formatPrice(setup.compression.upsideProjection)} / ↓ {setup.compression.downsideProjection == null ? "Unavailable" : `₹${formatPrice(setup.compression.downsideProjection)}`}</div></> : "—"}</td>
                    <td className="border-b border-border px-3 py-3 font-mono"><div>+DI {value(setup.dmi.plusDi)}</div><div>−DI {value(setup.dmi.minusDi)}</div><div>ADX {value(setup.dmi.adx)}</div></td>
                    <td className="border-b border-border px-3 py-3"><div>₹{turnoverCr.toFixed(1)} Cr/day</div><div className="mt-1 text-muted">Monthly volume {setup.breakout?.volumeRatio == null ? "—" : `${setup.breakout.volumeRatio.toFixed(2)}×`}</div></td>
                    <td className="border-b border-border px-3 py-3">{setup.provisional ? <><div>{setup.provisional.month} · as of {setup.provisional.asOf}</div><div className="mt-1">₹{formatPrice(setup.provisional.close)}</div><div className="mt-1 text-amber-700">{tab === "compression" ? `${setup.provisional.rangePosition} mother range` : setup.provisional.aboveBreakout ? "Above current 12-month reference" : "Not above current 12-month reference"}</div><div className="text-muted">No confirmed monthly signal</div></> : "No provisional month data"}</td>
                    <td className="min-w-[200px] max-w-[280px] border-b border-border px-3 py-3">
                      <div className="mb-2 text-[11px] font-bold text-muted">Short-term buy checks only</div>
                      {status ? <>
                        <BuyingStatusBadge status={status} showMissing={false} />
                        <details className="mt-2 text-[11px] leading-4 text-muted">
                          <summary className="cursor-pointer font-bold text-foreground">Why {status.label}? ({status.passed}/{status.total} checks)</summary>
                          <p className="mt-2">{status.detail}</p>
                          {status.failed.length > 0 && <><p className="mt-2 font-bold">Failed checks:</p><ul className="list-disc space-y-1 pl-4">{status.failed.map((label) => <li key={label}>{label}</li>)}</ul></>}
                          {status.riskFlags?.filter((flag) => flag.severity === "high").map((flag) => <p key={flag.label} className="mt-2 text-rose-600">{flag.label}: {flag.detail}</p>)}
                        </details>
                      </> : <span className="text-muted">Status unavailable / scan not aligned</span>}
                      <div className="mt-2 text-muted">Independent of monthly structure</div>
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}
      </div>
    </WorkspaceFrame>
  );
}
