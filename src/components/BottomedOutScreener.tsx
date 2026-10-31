"use client";

import { useEffect, useMemo, useState } from "react";
import type { BottomedOutPayload, BottomedOutPick } from "@/lib/screen/bottomedOut";
import { BOTTOMED_OUT_RULES } from "@/lib/screen/bottomedOut";
import { formatPrice } from "@/lib/format";
import { StockSymbolButton } from "./StockDetailContext";
import { LivePrice } from "./LivePrice";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero, WorkspaceTabs } from "./WorkspaceShell";
import { DataQualityNotice } from "./DataQualityNotice";
import { ListChangeNote, NewTag } from "./ListChangeNote";
import { useListChanges } from "@/hooks/useListChanges";
import type { ListChanges } from "@/lib/listChanges";

type Tab = "deep" | "early";

const R = BOTTOMED_OUT_RULES;

export function BottomedOutScreener({ keep }: { keep: ((symbol: string) => boolean) | null }) {
  const [data, setData] = useState<BottomedOutPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [picked, setTab] = useState<Tab | null>(null);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = 60_000;
      try {
        const response = await fetch("/api/market/bottomed-out", { cache: "no-store", signal: controller.signal });
        if (response.status === 503) {
          const body: { warming?: boolean; error?: string } = await response.json();
          if (body.warming) {
            if (alive) { setProgress(body.error ?? "Loading price history."); setError(null); }
            delay = 5_000;
            return;
          }
          throw new Error(body.error ?? "Price history unavailable.");
        }
        if (!response.ok) throw new Error(`Bottomed-out request failed (HTTP ${response.status}).`);
        const payload: BottomedOutPayload = await response.json();
        if (alive) { setData(payload); setError(null); setProgress(null); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        console.error("[bottomed-out] Refresh failed:", failure);
        if (alive) { setError(failure instanceof Error ? failure.message : "Refresh failed."); setProgress(null); }
      } finally {
        if (alive) timer = setTimeout(load, delay);
      }
    };
    void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);
  const inView = useMemo(() => (data?.rows ?? []).filter((row) => !keep || keep(row.symbol)), [data, keep]);
  const count = (tier: Tab) => inView.filter((row) => row.tier === tier).length;
  // With no deep-base stock the page opens on Early base instead of an empty tab; a click on a tab always wins.
  const tab: Tab = picked ?? (data && count("deep") === 0 && count("early") > 0 ? "early" : "deep");
  const rows = useMemo(() => inView.filter((row) => row.tier === tab), [inView, tab]);
  // The live (market-open) and completed-session lists differ, so each keeps its own memory.
  const changes = useListChanges(`bottomed-${tab}-${data?.provisional ? "live" : "done"}`, data ? rows.map((row) => row.symbol) : null);
  return (
    <WorkspaceFrame id="bottomed-out" className="scroll-mt-28">
      <WorkspaceHero eyebrow="Reversal research" icon="setups" title="Bottomed Out"
        description="Stocks that fell hard, stopped making new lows, printed a higher low and reclaimed the 20 EMA. A watch list for reversals, not a buy call." />
      <WorkspaceTabs items={[
        { key: "deep", icon: "▼", label: `Deep base (${count("deep")})`, detail: `${R.deepDrawdownPercent}%+ below the 52-week high — the only tier that held up in the backtest` },
        { key: "early", icon: "◇", label: `Early base (${count("early")})`, detail: `${R.minDrawdownPercent}–${R.deepDrawdownPercent}% below the high — lost money in the backtest, watch only` },
      ]} active={tab} onSelect={setTab} />
      <div className="space-y-4 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}{data ? " Retained results may be stale." : " No results substituted."}</p>}
        {progress && data && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{progress} Retained results may be stale.</p>}
        <DataQualityNotice health={data} updatedAt={data?.updatedAt} />
        {data && <p className="text-xs leading-5 text-muted">
          {rows.length} stocks in this tier · {data.drawdowns} of {data.eligible} liquid stocks are {R.minDrawdownPercent}%+ off their high; the rest of the rules cut that to {data.rows.length} · Source: {data.source.label}.
          {" "}Snapshot {new Date(data.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST, {data.provisional ? "including today's forming candle, so a stock can drop off before the close" : "completed sessions only"}.
          {data.source.id === "mock" && " SIMULATED DATA — not actual market signals."}
        </p>}
        <p className={`rounded-xl border p-3 text-xs leading-5 ${tab === "deep" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
          {tab === "deep"
            ? "Backtest, Oct 2024 – Oct 2026 (about 400 trades with a fixed −8% stop / +16% target): +0.11R per trade after costs, 42% win rate. Both halves of the period were positive, but it is a thin edge on two years of data. Size small and use the stop; the exit is −8% stop, +16% target, 40 sessions."
            : "The early tier lost −0.11R per trade after costs over about 560 trades. It is listed so you can watch stocks as they deepen or recover, not as an entry list."}
        </p>
        <details className="rounded-xl border border-border bg-raised p-3 text-xs leading-5 text-muted">
          <summary className="cursor-pointer font-bold text-foreground">Rules & backtest</summary>
          <p className="mt-2">All must hold on the last completed session: liquid stock (₹5 Cr median turnover), price ≥ ₹{R.minPrice}, volume ≥ {R.minVolume.toLocaleString("en-IN")}; close ≥ {R.minDrawdownPercent}% below the {R.highSessions}-session high; the lowest low of the last {R.lowSessions} sessions was set {R.minLowAge}–{R.maxLowAge} sessions ago (selling has stopped but the low is recent); close {R.minOffLowPercent}–{R.maxOffLowPercent}% above that low; the lowest low of the last {R.higherLowSessions} sessions is more than {R.higherLowMarginPercent}% above the base low (a higher low); close above the 20 EMA.</p>
          <p className="mt-2">Volume ratio, EMA50 reclaim and RSI divergence are shown as context only. They did not improve the backtest consistently (volume 1.5× and the EMA50 filter helped under some exits and hurt under others), and a market-breadth gate did not help either, so none of them filter or rank the list.</p>
          <p className="mt-2">Backtest: scripts/backtest-bottom.mjs, next-open entry, 0.25% costs. All 35%+ drawdown stocks with a higher low scored −0.09R. For the deep tier: stop under the base low with half off at 2R and the rest at 3R gave +0.10R (123 trades); exit below the 50 EMA gave 0.00R; fixed −8% / +16% gave +0.11R (397 trades). Survivorship bias is likely, because the universe is today&apos;s listed stocks.</p>
        </details>
        {data && <div className="overflow-hidden rounded-xl"><ListChangeNote changes={changes} /></div>}
        {!data ? error ? <EmptyState tone="error" title="Bottomed-out scan unavailable">The feed will retry automatically.</EmptyState> : <LoadingState rows={5} message={progress ?? "Scanning for bottomed-out stocks."} /> :
          !rows.length ? <EmptyState title="No bottomed-out stocks in this tier">No stock meets these rules in the selected universe. Empty results are valid; no candidates are manufactured.</EmptyState> :
            <div className="max-h-[650px] overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-xs">
                <thead className="sticky top-0 z-20 bg-raised text-[11px] uppercase tracking-wide text-muted"><tr>
                  <th className="sticky left-0 z-30 bg-raised px-4 py-3">Stock / RS</th><th className="px-3 py-3">Fall</th><th className="px-3 py-3">Base</th><th className="px-3 py-3">Reclaim</th><th className="px-3 py-3">Context</th><th className="px-3 py-3">Tested exit</th>
                </tr></thead>
                <tbody>{rows.map((row) => <BottomRow key={row.symbol} row={row} changes={changes} />)}</tbody>
              </table>
            </div>}
      </div>
    </WorkspaceFrame>
  );
}

function BottomRow({ row, changes }: { row: BottomedOutPick; changes: ListChanges }) {
  return (
    <tr className="odd:bg-white even:bg-slate-50 hover:bg-emerald-50">
      <td className="sticky left-0 z-10 max-w-[220px] border-b border-border bg-inherit px-4 py-3">
        <StockSymbolButton symbol={row.symbol} className="font-bold">{row.symbol}</StockSymbolButton>
        {changes.added.has(row.symbol) && <NewTag />}
        <div className="mt-1 truncate text-muted">{row.name}</div>
        <div className="mt-1 font-mono text-accent">RS {row.rs ?? "—"}</div>
      </td>
      <td className="border-b border-border px-3 py-3"><div className="font-mono font-bold text-rose-700">−{row.fromHighPercent.toFixed(1)}%</div><div className="mt-1 text-muted">from 52-week high</div><div className="mt-1"><LivePrice symbol={row.symbol} fallbackPrice={row.close} fallbackChange={null} /></div><div className="text-[11px] text-muted">signal close ₹{formatPrice(row.close)}</div></td>
      <td className="border-b border-border px-3 py-3"><div>Low ₹{formatPrice(row.lowPrice)} · {row.lowAgeSessions} sessions ago</div><div className="mt-1">Higher low ₹{formatPrice(row.higherLow)}</div><div className="mt-1 font-mono text-emerald-700">+{row.offLowPercent.toFixed(1)}% off the low</div></td>
      <td className="border-b border-border px-3 py-3"><div>Above 20 EMA ₹{formatPrice(row.ema20)}</div><div className={`mt-1 ${row.aboveEma50 ? "text-emerald-700" : "text-muted"}`}>{row.ema50 == null ? "50 EMA n/a" : row.aboveEma50 ? `Above 50 EMA ₹${formatPrice(row.ema50)}` : `Below 50 EMA ₹${formatPrice(row.ema50)}`}</div></td>
      <td className="border-b border-border px-3 py-3"><div className={row.volumeRatio >= 1.5 ? "text-emerald-700" : "text-muted"}>Volume {row.volumeRatio.toFixed(2)}× avg</div><div className="mt-1 text-muted">RSI {row.rsi14 ?? "—"}{row.rsiDivergence ? " · bullish divergence" : ""}</div><div className="mt-1 text-muted">₹{(row.turnoverCr ?? 0).toFixed(1)} Cr/day</div></td>
      <td className="border-b border-border px-3 py-3"><div className="font-mono text-rose-700">Stop ₹{formatPrice(row.stop)} (−{R.stopPercent}%)</div><div className="mt-1 font-mono text-emerald-700">Target ₹{formatPrice(row.target)} (+{R.targetPercent}%)</div><div className="mt-1 text-muted">Base low ₹{formatPrice(row.lowPrice)} is a wider, structural stop</div></td>
    </tr>
  );
}
