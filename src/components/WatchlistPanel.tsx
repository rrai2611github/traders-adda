"use client";

import { StockSymbolButton } from "./StockDetailContext";
import { useMemo, useState, type ReactNode } from "react";
import { Sparkline } from "./Sparkline";
import { SymbolSearch } from "./SymbolSearch";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import {
  formatPercent,
  formatPrice,
  formatSigned,
  formatVolume,
  toneClass,
} from "@/lib/format";
import type { PricePoint, Quote } from "@/lib/market/types";
import type { ScreenScan } from "@/hooks/useScreenScan";
import type { BuyingStatus } from "@/lib/screen/buyingStatus";
import type { RelativeVolume } from "@/lib/screen/riskFlags";
import { RvolPill } from "./RiskSignals";
import {
  currentScanShortSellingStatus,
  type ShortSellingStatus,
} from "@/lib/screen/shortSellingStatus";
import { HEALTHY_BREADTH_PERCENT, movingAverageBreadth } from "@/lib/screen/breadth";
import { NIFTY50_SYMBOLS } from "@/lib/market/defaults";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { MarketGateBanner } from "./MarketGateBanner";
import { ShortSellingStatusBadge } from "./ShortSellingStatusBadge";
import { combinedStatusKey, TRADE_STATUS, TRADE_STATUS_ORDER, type TradeStatusKey } from "@/lib/screen/tradeStatus";
import { TradeStatusLegend } from "./TradeStatusBadge";
import {
  HORIZON_HOLDING,
  HORIZON_RESEARCH_NOTE,
  type HorizonPlan,
  horizonBuySignal,
  type BuyHorizon,
  type NoTrade,
} from "@/lib/screen/horizonSignal";
import { horizonTargetOdds } from "@/lib/screen/horizonOdds";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";

type SortKey = "symbol" | "ltp" | "changePercent" | "volume" | "buyRating";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | TradeStatusKey;

const HORIZONS: { key: BuyHorizon; label: string; holding: string }[] = [
  { key: "short", label: "Short term", holding: HORIZON_HOLDING.short },
  { key: "mid", label: "Mid term", holding: HORIZON_HOLDING.mid },
  { key: "long", label: "Long term", holding: HORIZON_HOLDING.long },
];

interface WatchlistPanelProps {
  symbols: string[];
  quotes: Record<string, Quote>;
  series: Record<string, PricePoint[]>;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onReset: () => void;
  scan: ScreenScan | null;
}

function WatchlistRow({
  rank,
  quote,
  points,
  onRemove,
  buyingStatus,
  noTrade,
  plan,
  shortSellingStatus,
  isIndexMember,
  isLiveQuote,
  rvol,
}: {
  rank: number;
  quote: Quote;
  points: PricePoint[];
  onRemove: (symbol: string) => void;
  buyingStatus: BuyingStatus | null;
  noTrade: NoTrade | null;
  plan: HorizonPlan | null;
  shortSellingStatus: ShortSellingStatus | null;
  isIndexMember: boolean;
  isLiveQuote: boolean;
  rvol: RelativeVolume | null;
}) {
  const flash = usePriceFlash(quote.ltp);

  return (
    <tr className={`group odd:bg-white even:bg-[#fafbfc] hover:bg-[#f0f9f4] ${flash}`}>
      <td className="sticky left-0 z-10 border-b border-slate-100 bg-inherit px-3 py-3 text-center font-mono text-[11px] font-bold text-slate-400">
        {String(rank).padStart(2, "0")}
      </td>
      <td className="sticky left-[56px] z-10 border-b border-slate-100 bg-inherit px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-black text-white shadow-sm">
            {quote.symbol.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <StockSymbolButton symbol={quote.symbol} className="block font-black text-slate-900">{quote.symbol}</StockSymbolButton>
            <div className="max-w-[190px] truncate text-xs text-muted">{quote.name}</div>
            {!isLiveQuote && <div className="mt-0.5 text-[10.5px] font-black uppercase tracking-wide text-amber-600">Scan snapshot</div>}
          </div>
        </div>
      </td>
      <td className="border-b border-slate-100 px-3 py-3 text-right">
        <div className="font-mono font-black text-slate-900">₹{formatPrice(quote.ltp)}</div>
        <div className={`mt-1 inline-flex rounded-md px-2 py-0.5 font-mono text-[11px] font-black ${
          quote.changePercent >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}>
          {formatPercent(quote.changePercent)}
        </div>
      </td>
      <td className={`border-b border-slate-100 px-3 py-3 text-right font-mono ${toneClass(quote.change)}`}>
        {formatSigned(quote.change)}
      </td>
      <td className="hidden border-b border-slate-100 px-3 py-3 text-right font-mono text-muted md:table-cell">
        {isLiveQuote ? formatPrice(quote.open) : "—"}
      </td>
      <td className="hidden border-b border-slate-100 px-3 py-3 text-right font-mono text-muted lg:table-cell">
        {isLiveQuote ? `${formatPrice(quote.high)} / ${formatPrice(quote.low)}` : "—"}
      </td>
      <td className="hidden border-b border-slate-100 px-3 py-3 text-right font-mono text-muted sm:table-cell">
        <div>{isLiveQuote ? formatVolume(quote.volume) : "—"}</div>
        <div className="mt-1"><RvolPill rvol={rvol} /></div>
      </td>
      <td className="hidden border-b border-slate-100 px-3 py-3 xl:table-cell">
        {isLiveQuote ? <Sparkline points={points} baseline={quote.previousClose} /> : <span className="text-xs text-slate-300">—</span>}
      </td>
      <td className="border-b border-slate-100 px-3 py-3">
        {buyingStatus && shortSellingStatus && buyingStatus.key === "avoid" && shortSellingStatus.key === "short-ready"
          ? <ShortSellingStatusBadge status={shortSellingStatus} />
          : buyingStatus ? <BuyingStatusBadge status={buyingStatus} /> : <span className="text-xs text-muted">Status unavailable</span>}
      </td>
      <td className="border-b border-slate-100 px-3 py-3 text-right text-xs" title={buyingStatus?.failed.join(", ") || undefined}>
        {buyingStatus ? <div className="font-mono font-black text-slate-800">{buyingStatus.passed}/{buyingStatus.total} pass</div> : <span className="text-slate-300">—</span>}
      </td>
      <td className="border-b border-slate-100 px-3 py-3 text-right font-mono text-[11px] leading-4">
        {plan ? (
          <>
            <div className="font-black text-slate-800">₹{formatPrice(plan.entry)}</div>
            <div className="text-rose-700">SL ₹{formatPrice(plan.stop)} · {plan.riskPercent.toFixed(1)}%</div>
            <div className="whitespace-nowrap text-emerald-700">T1 ₹{formatPrice(plan.target1)} · T2 ₹{formatPrice(plan.target2)}</div>
          </>
        ) : noTrade ? (
          <div className="font-sans text-[11px] font-bold text-rose-700" title={noTrade.detail}>{noTrade.reason}</div>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="sticky right-0 z-10 border-b border-slate-100 bg-inherit px-3 py-3 text-right">
        {isIndexMember ? (
          <span className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-black uppercase tracking-wide text-slate-500 shadow-sm">
            Nifty 50
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onRemove(quote.symbol)}
            aria-label={`Remove ${quote.symbol} from watchlist`}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-muted shadow-sm transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-down"
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}

export function WatchlistPanel({
  symbols,
  quotes,
  series,
  onAdd,
  onRemove,
  onReset,
  scan,
}: WatchlistPanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>("changePercent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [horizon, setHorizon] = useState<BuyHorizon>("mid");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [minimumRating, setMinimumRating] = useState("0");
  const [sectorFilter, setSectorFilter] = useState("all");
  const trackedSymbols = useMemo(() => [...new Set([...NIFTY50_SYMBOLS, ...symbols])], [symbols]);
  const breadthPercent = useMemo(() => movingAverageBreadth(scan?.rows ?? [], "vs50").percent, [scan]);
  const scanRows = useMemo(() => new Map((scan?.rows ?? []).map((row) => [row.symbol, row])), [scan]);
  const horizonSignals = useMemo(() => new Map((scan?.rows ?? []).map((row) => [
    row.symbol,
    horizonBuySignal(row, horizon, breadthPercent),
  ])), [breadthPercent, horizon, scan]);
  const buyRatings = useMemo(() => new Map([...horizonSignals].map(([symbol, signal]) => [
    symbol,
    signal.status,
  ])), [horizonSignals]);
  const shortRatings = useMemo(() => new Map((scan?.rows ?? []).map((row) => [
    row.symbol,
    currentScanShortSellingStatus(row, breadthPercent),
  ])), [breadthPercent, scan]);
  const rows = useMemo(() => {
    const available = trackedSymbols
      .map((symbol) => {
        const liveQuote = quotes[symbol];
        if (liveQuote) return { quote: liveQuote, isLiveQuote: true };
        const scanRow = scanRows.get(symbol);
        if (!scanRow) return null;
        const previousClose = scanRow.changePercent === -100
          ? scanRow.price
          : scanRow.price / (1 + scanRow.changePercent / 100);
        const quote: Quote = {
          symbol: scanRow.symbol,
          name: scanRow.name,
          kind: "EQUITY",
          sector: scanRow.sector,
          ltp: scanRow.price,
          previousClose,
          change: scanRow.price - previousClose,
          changePercent: scanRow.changePercent,
          open: scanRow.price,
          high: scanRow.price,
          low: scanRow.price,
          volume: 0,
          timestamp: scanRow.quoteTimestamp ?? scan?.updatedAt ?? 0,
        };
        return { quote, isLiveQuote: false };
      })
      .filter((item): item is { quote: Quote; isLiveQuote: boolean } => item != null)
      .map(({ quote, isLiveQuote }) => ({
        quote,
        isLiveQuote,
        signal: horizonSignals.get(quote.symbol) ?? null,
        sector: scanRows.get(quote.symbol)?.sector ?? "Unclassified",
        buyRating: buyRatings.get(quote.symbol)?.rating ?? -1,
        shortRating: shortRatings.get(quote.symbol)?.rating ?? -1,
        status: combinedStatusKey(buyRatings.get(quote.symbol)?.key, shortRatings.get(quote.symbol)?.key),
      }))
      .filter((row) => statusFilter === "all" || row.status === statusFilter)
      .filter((row) => row.buyRating >= (Number(minimumRating) || 0))
      .filter((row) => sectorFilter === "all" || row.sector === sectorFilter);

    const factor = sortDir === "asc" ? 1 : -1;
    return [...available].sort((a, b) => {
      if (sortKey === "symbol") return a.quote.symbol.localeCompare(b.quote.symbol) * factor;
      if (sortKey === "buyRating") return (a[sortKey] - b[sortKey]) * factor;
      return (a.quote[sortKey] - b.quote[sortKey]) * factor;
    });
  }, [
    buyRatings,
    horizonSignals,
    minimumRating,
    quotes,
    scanRows,
    sectorFilter,
    shortRatings,
    sortDir,
    sortKey,
    statusFilter,
    trackedSymbols,
    scan,
  ]);
  const buyReadyCount = trackedSymbols.filter((symbol) => buyRatings.get(symbol)?.key === "buy-ready").length;
  const shortReadyCount = trackedSymbols.filter((symbol) => shortRatings.get(symbol)?.key === "short-ready").length;
  const personalCount = trackedSymbols.length - NIFTY50_SYMBOLS.length;
  const sectors = useMemo(() => [...new Set(
    trackedSymbols.map((symbol) => scanRows.get(symbol)?.sector).filter((sector): sector is string => Boolean(sector)),
  )].sort(), [scanRows, trackedSymbols]);
  const activeHorizon = HORIZONS.find((option) => option.key === horizon)!;
  const odds = horizonTargetOdds(horizon);
  const liveQuoteCount = trackedSymbols.filter((symbol) => Boolean(quotes[symbol])).length;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  };

  const header = (key: SortKey, label: string, extraClass = "") => (
    <th
      scope="col"
      className={`px-3 py-3 font-black ${extraClass}`}
      aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
      >
        {label}
        <span className="text-[11px]">
          {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );

  return (
    <WorkspaceFrame id="watchlist-workspace">
      <WorkspaceHero
        eyebrow="Trading watchlist"
        title="Nifty 50 Watchlist"
        description={`All 50 index constituents${personalCount > 0 ? ` · ${personalCount} personal addition${personalCount === 1 ? "" : "s"}` : ""} · one live status per stock`}
        icon="watchlist"
        action={<div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
          <SymbolSearch onSelect={onAdd} existing={symbols} />
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
          >
            Reset personal
          </button>
        </div>}
      />

      <div className="grid grid-cols-4 gap-3 border-b border-border bg-slate-50/70 px-5 py-4">
        <Summary label="Index members" value="50" tone="text-slate-900" />
        <Summary label="Live quotes" value={`${liveQuoteCount}/${trackedSymbols.length}`} tone="text-blue-700" />
        <Summary label="Buy ready" value={String(buyReadyCount)} tone="text-emerald-700" />
        <Summary label="Short ready" value={String(shortReadyCount)} tone="text-rose-700" />
      </div>
      <div className="border-b border-border px-5 py-3">
        <MarketGateBanner breadth={breadthPercent} healthy={breadthPercent != null && breadthPercent >= HEALTHY_BREADTH_PERCENT} compact />
      </div>
      <p className="border-b border-border bg-amber-50/70 px-5 py-2.5 text-xs text-amber-900">
        Status is decided by pass/fail checks, not probability. {HORIZON_RESEARCH_NOTE} Short ready does not assess borrow availability, margin, entry price or stop-loss placement.
      </p>
      <div className="border-b border-border bg-white px-5 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-slate-400">Buy horizon</div>
            <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {HORIZONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setHorizon(option.key)}
                  className={`px-4 py-2 text-xs font-black transition ${
                    horizon === option.key ? "bg-[#16894f] text-white" : "text-slate-500 hover:bg-white"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <FilterLabel label="Status">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
              <option value="all">All statuses</option>
              {TRADE_STATUS_ORDER.map((key) => <option key={key} value={key}>{TRADE_STATUS[key].label}</option>)}
            </select>
          </FilterLabel>
          <FilterLabel label="Minimum rating">
            <input value={minimumRating} onChange={(event) => setMinimumRating(event.target.value)} type="number" min="0" max="100" className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700" />
          </FilterLabel>
          <FilterLabel label="Sector">
            <select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)} className="max-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
              <option value="all">All sectors</option>
              {sectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
            </select>
          </FilterLabel>
          <button
            type="button"
            onClick={() => {
              setStatusFilter("all");
              setMinimumRating("0");
              setSectorFilter("all");
            }}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-500 hover:bg-white"
          >
            Clear filters
          </button>
          <div className="ml-auto rounded-xl bg-emerald-50 px-3 py-2 text-right">
            <div className="text-[11px] font-black uppercase tracking-wide text-emerald-700">{activeHorizon.label}</div>
            <div className="text-xs font-bold text-emerald-900">Hold {activeHorizon.holding} · {rows.length} matches</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 bg-white px-5 py-3 text-[11px] font-semibold text-slate-500">
        <TradeStatusLegend />
        <span className="ml-auto rounded-lg bg-slate-100 px-2.5 py-1 font-mono font-black text-slate-600">
          Sorted: {sortKey === "changePercent" ? "Day change" : sortKey === "buyRating" ? "Checks passed" : sortKey} {sortDir === "desc" ? "↓" : "↑"}
        </span>
      </div>

      {rows.length === 0 ? (
        scan == null
          ? <LoadingState message="Loading Nifty 50 analysis…" rows={6} />
          : <EmptyState tone="search" title="No matches">No stocks match the selected horizon filters.</EmptyState>
      ) : (
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <table className="min-w-[1700px] w-full border-separate border-spacing-0 text-sm">
            <colgroup>
              <col className="w-[56px]" />
              <col className="w-[250px]" />
              <col className="w-[130px]" />
              <col className="w-[100px]" />
              <col className="w-[100px]" />
              <col className="w-[150px]" />
              <col className="w-[120px]" />
              <col className="w-[150px]" />
              <col className="w-[190px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[100px]" />
              <col className="w-[100px]" />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#f7f9fa] text-[11px] uppercase tracking-[0.08em] text-slate-400 shadow-[0_1px_0_#e2e8f0]">
                <th scope="col" className="sticky left-0 z-30 bg-[#f7f9fa] px-3 py-3 text-center font-black">#</th>
                <th scope="col" className="sticky left-[56px] z-30 bg-[#f7f9fa] px-3 py-3 text-left font-black">
                  <button
                    type="button"
                    onClick={() => toggleSort("symbol")}
                    className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                  >
                    Instrument
                    <span className="text-[11px]">
                      {sortKey === "symbol" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
                {header("ltp", "Last price / Day", "text-right font-black")}
                <th scope="col" className="px-3 py-3 text-right font-black">
                  <button type="button" onClick={() => toggleSort("changePercent")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Net chg
                    <span className="text-[11px]">{sortKey === "changePercent" ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
                <th scope="col" className="hidden px-3 py-3 text-right font-black md:table-cell">
                  Open
                </th>
                <th scope="col" className="hidden px-3 py-3 text-right font-black lg:table-cell">
                  High / Low
                </th>
                {header("volume", "Volume", "hidden text-right sm:table-cell")}
                <th scope="col" className="hidden px-3 py-3 text-left font-black xl:table-cell">
                  Trend
                </th>
                <th scope="col" className="px-3 py-3 text-left font-black">
                  <button type="button" onClick={() => toggleSort("buyRating")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Status
                    <span className="text-[11px]">{sortKey === "buyRating" ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
                <th scope="col" className="px-3 py-3 text-right font-black">Checks</th>
                <th scope="col" className="px-3 py-3 text-right font-black" title={odds ? `Backtest ${odds.trades} trades: T1 reached ${Math.round(odds.t1HitPercent)}%, T2 ${Math.round(odds.t2HitPercent)}% within ${odds.maxHoldSessions} trading days` : undefined}>
                  Reference levels{odds ? <span className="block text-[10.5px] normal-case tracking-normal text-slate-500">T1 hit {Math.round(odds.t1HitPercent)}% · T2 {Math.round(odds.t2HitPercent)}%</span> : null}
                </th>
            <th scope="col" className="sticky right-0 z-30 bg-[#f7f9fa] px-3 py-3 text-right font-black">
                  Membership
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ quote, signal, isLiveQuote }, index) => (
                <WatchlistRow
                  key={quote.symbol}
                  rank={index + 1}
                  quote={quote}
                  points={series[quote.symbol] ?? []}
                  onRemove={onRemove}
                  buyingStatus={buyRatings.get(quote.symbol) ?? null}
                  noTrade={signal?.noTrade ?? null}
                  plan={signal?.plan ?? null}
                  shortSellingStatus={shortRatings.get(quote.symbol) ?? null}
                  isIndexMember={(NIFTY50_SYMBOLS as readonly string[]).includes(quote.symbol)}
                  isLiveQuote={isLiveQuote}
                  rvol={scanRows.get(quote.symbol)?.rvol ?? null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WorkspaceFrame>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-black ${tone}`}>{value}</div>
    </div>
  );
}

function FilterLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}
