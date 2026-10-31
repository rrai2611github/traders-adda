"use client";

import { StockSymbolButton } from "./StockDetailContext";
import { useEffect, useState, type ReactNode } from "react";
import {
  SCANNERS,
  type ScannerKey,
  type ScannerMode,
  type ScannerPayload,
  type ScannerRow,
  type ScannerValue,
} from "@/lib/screen/chartinkScans";
import { BUY_READY_RULES, SCORE_CHECKED, buyCheckLabels, type BuyCheckKey } from "@/lib/screen/buyReady";
import { scannerBuyingStatus, type BuyingStatus } from "@/lib/screen/buyingStatus";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { TRADE_STATUS } from "@/lib/screen/tradeStatus";
import { TRADE_STATUS_STYLE } from "./TradeStatusBadge";
import backtest from "@/lib/screen/scannerBacktest.json";
import { formatPercent, toneClass } from "@/lib/format";
import { staleLabel, useLiveQuotes } from "@/hooks/useLiveQuotes";
import type { AlertTable } from "@/lib/alerts/scannerAlert";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";
import { StyleTag } from "./ScannerDirectory";
import { PaRatingPill } from "./PriceActionRating";

const priceLabel = (price: number) => `₹${price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (timestamp: number) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }).format(timestamp);

const num = (v: ScannerValue) => (typeof v === "number" ? v : null);
const pctCell = (v: ScannerValue) => {
  const n = num(v);
  return n == null ? "—" : <span className={toneClass(n)}>{formatPercent(n)}</span>;
};
const priceCell = (v: ScannerValue) => (num(v) == null ? "—" : priceLabel(num(v)!));
const ratioCell = (v: ScannerValue) => (num(v) == null ? "—" : `${num(v)!.toFixed(2)}×`);
const yesNo = (v: ScannerValue, yes: string, no: string) =>
  v === true ? <span className="font-bold text-[#16894f]">{yes}</span> : <span className="text-muted">{no}</span>;

interface Column {
  label: string;
  title?: string;
  render: (row: ScannerRow) => ReactNode;
}

/** Each scanner shows the measures its own conditions are built on. */
const COLUMNS: Record<ScannerKey, Column[]> = {
  swing: [
    { label: "From 52w high", render: (r) => pctCell(r.values.fromHigh) },
    { label: "vs 50 EMA", render: (r) => pctCell(r.values.vsEma50) },
    { label: "Market cap", render: (r) => (num(r.values.marketCapCr) == null ? <span className="text-muted">Unknown</span> : `₹${num(r.values.marketCapCr)!.toLocaleString("en-IN")} cr`) },
    {
      label: "Fundamentals",
      render: (r) => (
        <a
          href={`https://www.screener.in/company/${r.symbol}/`}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap text-xs font-bold text-amber-700 underline"
        >
          Not checked · verify ↗
        </a>
      ),
    },
  ],
  range: [
    { label: "Range", title: "Today's high–low as % of yesterday's close", render: (r) => (num(r.values.rangePercent) == null ? "—" : `${num(r.values.rangePercent)!.toFixed(2)}%`) },
    { label: "vs prior 4-day avg", render: (r) => ratioCell(r.values.rangeVsPrior) },
    { label: "Close in range", title: "0% = closed at the low, 100% = at the high", render: (r) => (num(r.values.closeInRange) == null ? "—" : `${num(r.values.closeInRange)}%`) },
    { label: "vs week open", render: (r) => pctCell(r.values.vsWeeklyOpen) },
    { label: "vs month open", render: (r) => pctCell(r.values.vsMonthlyOpen) },
    { label: "Traded today", render: (r) => (num(r.values.tradedCr) == null ? "—" : `₹${num(r.values.tradedCr)!.toFixed(1)} cr`) },
  ],
  nr7: [
    { label: "NR7 day", render: (r) => (num(r.values.nr7Date) == null ? "—" : dateLabel(num(r.values.nr7Date)!)) },
    { label: "Buy above (NR7 high)", render: (r) => <b className="text-[#16894f]">{priceCell(r.values.nr7High)}</b> },
    { label: "Stop (NR7 low)", render: (r) => <b className="text-down">{priceCell(r.values.nr7Low)}</b> },
    { label: "NR7 range", render: (r) => (num(r.values.nr7RangePercent) == null ? "—" : `${num(r.values.nr7RangePercent)!.toFixed(2)}%`) },
    { label: "vs 7-day avg range", render: (r) => ratioCell(r.values.nr7VsAvg) },
    {
      label: "Today",
      render: (r) =>
        r.values.brokeHigh === true ? <span className="font-bold text-[#16894f]">Closed above NR7 high</span>
          : r.values.brokeLow === true ? <span className="font-bold text-down">Closed below NR7 low</span>
          : <span className="text-muted">Inside NR7 range</span>,
    },
    { label: "vs 50 SMA", render: (r) => pctCell(r.values.vsSma50) },
  ],
  fall4: [
    { label: "4-day fall", title: "From the high 5 sessions ago to yesterday's low", render: (r) => pctCell(r.values.fallPercent) },
    { label: "Reversal high", render: (r) => <b className="text-[#16894f]">{priceCell(r.values.reversalHigh)}</b> },
    { label: "Pullback low", render: (r) => <b className="text-down">{priceCell(r.values.pullbackLow)}</b> },
    { label: "vs 200 EMA", render: (r) => pctCell(r.values.vsEma200) },
  ],
  up3: [
    { label: "Day 1", render: (r) => pctCell(r.values.day1) },
    { label: "Day 2", render: (r) => pctCell(r.values.day2) },
    { label: "Day 3 (latest)", render: (r) => pctCell(r.values.day3) },
    { label: "3-day gain", render: (r) => <b>{pctCell(r.values.gain3d)}</b> },
    {
      label: "vs 21 EMA",
      title: "More than ~8% above the 21 EMA is extended",
      render: (r) => {
        const n = num(r.values.vsEma21);
        return n == null ? "—" : <span className={n > 8 ? "font-bold text-amber-700" : toneClass(n)}>{formatPercent(n)}{n > 8 ? " · extended" : ""}</span>;
      },
    },
  ],
  ema21: [
    { label: "21 EMA", render: (r) => priceCell(r.values.ema21) },
    { label: "Above 21 EMA by", render: (r) => pctCell(r.values.vsEma21) },
    { label: "21 EMA slope", render: (r) => yesNo(r.values.emaRising, "Rising", "Falling") },
    { label: "vs 200 SMA", title: "Positive = long-term uptrend", render: (r) => pctCell(r.values.vsSma200) },
  ],
  inside: [
    { label: "True inside bar", title: "High below and low above yesterday's", render: (r) => yesNo(r.values.trueInside, "Yes", "No") },
    { label: "Mother high", render: (r) => priceCell(r.values.motherHigh) },
    { label: "Mother low", render: (r) => priceCell(r.values.motherLow) },
    { label: "Range vs mother", render: (r) => ratioCell(r.values.rangeVsMother) },
  ],
  rsidiv: [
    { label: "RSI(14)", render: (r) => (num(r.values.rsi) == null ? "—" : num(r.values.rsi)!.toFixed(1)) },
    { label: "RSI change 2d", render: (r) => (num(r.values.rsiChange2d) == null ? "—" : <span className="text-[#16894f]">+{num(r.values.rsiChange2d)!.toFixed(1)}</span>) },
    { label: "High change 2d", render: (r) => pctCell(r.values.highChange2d) },
  ],
  high52: [
    { label: "Prior 52w high", render: (r) => priceCell(r.values.priorHigh) },
    { label: "Close vs it", render: (r) => pctCell(r.values.vsPriorHigh) },
    { label: "Volume", title: "Today's volume vs the 50-day average", render: (r) => <b className="text-[#16894f]">{ratioCell(r.values.volumeRatio)}</b> },
    { label: "Close in range", title: "0% = closed at the low, 100% = at the high", render: (r) => (num(r.values.closeInRange) == null ? "—" : `${num(r.values.closeInRange)}%`) },
    { label: "vs 50 SMA", render: (r) => pctCell(r.values.vsSma50) },
  ],
  pullback20: [
    { label: "20 EMA", render: (r) => priceCell(r.values.ema20) },
    { label: "Close vs 20 EMA", render: (r) => pctCell(r.values.vsEma20) },
    { label: "Off 10-day high", render: (r) => pctCell(r.values.offRecentHigh) },
    { label: "Buy above (day high)", render: (r) => <b className="text-[#16894f]">{priceCell(r.values.dayHigh)}</b> },
    { label: "Stop (day low)", render: (r) => <b className="text-down">{priceCell(r.values.dayLow)}</b> },
  ],
  leader: [
    { label: "RS line vs 52w high", title: "Close ÷ Nifty 50, against its highest level of the prior 252 sessions", render: (r) => pctCell(r.values.rsLineVsHigh) },
    { label: "From 52w high", title: "Price vs its own 52-week high", render: (r) => pctCell(r.values.fromHigh) },
    { label: "vs 50 SMA", render: (r) => pctCell(r.values.vsSma50) },
  ],
  ath: [
    { label: "Prior high", render: (r) => priceCell(r.values.priorHigh) },
    { label: "Close vs it", render: (r) => pctCell(r.values.vsPriorHigh) },
    { label: "RSI(14)", render: (r) => (num(r.values.rsi) == null ? "—" : num(r.values.rsi)!.toFixed(1)) },
    { label: "History", title: "Years of daily data the high is measured over", render: (r) => (num(r.values.historyYears) == null ? "—" : `${num(r.values.historyYears)} yrs`) },
  ],
  pocket: [
    { label: "Volume vs down days", title: "Today's volume vs the biggest down-day volume of the prior 10 sessions", render: (r) => <b className="text-[#16894f]">{ratioCell(r.values.volumeVsDown)}</b> },
    { label: "vs 10 SMA", render: (r) => pctCell(r.values.vsSma10) },
    { label: "vs 50 SMA", render: (r) => pctCell(r.values.vsSma50) },
    { label: "Close in range", render: (r) => (num(r.values.closeInRange) == null ? "—" : `${num(r.values.closeInRange)}%`) },
  ],
  arbm: [
    { label: "Upper band", title: "Today's top of the 50-day regression channel", render: (r) => priceCell(r.values.upperBand) },
    { label: "Squeeze rank", title: "Yesterday's channel width within its 100-day range (0% = narrowest)", render: (r) => (num(r.values.squeezeRank) == null ? "—" : `${num(r.values.squeezeRank)}%`) },
    { label: "Band stop", title: "The indicator's stop: yesterday's lower band", render: (r) => <b className="text-down">{priceCell(r.values.bandStop)}</b> },
    {
      label: "Stop distance",
      title: "Close to the indicator's stop; often too wide for 1% risk sizing",
      render: (r) => {
        const n = num(r.values.bandStopPercent);
        return n == null ? "—" : <span className={n > 10 ? "font-bold text-amber-700" : ""}>{n.toFixed(1)}%{n > 10 ? " · wide" : ""}</span>;
      },
    },
    { label: "TP1 / TP2 / TP3", title: "1×, 2× and 3× yesterday's channel width above the close", render: (r) => <span className="whitespace-nowrap text-[#16894f]">{priceCell(r.values.tp1)} · {priceCell(r.values.tp2)} · {priceCell(r.values.tp3)}</span> },
  ],
};

type Sort = "checks" | "turnover" | "change" | "rs" | "pa";
type View = BuyingStatus["key"] | "all";

interface ChartinkScannerSectionProps {
  active: ScannerKey;
  mode: ScannerMode;
  onModeChange: (mode: ScannerMode) => void;
  data: ScannerPayload | null;
  error: boolean;
  loadingMessage?: string | null;
  watchlistSymbols: string[];
  onAddToWatchlist: (symbol: string) => void;
}

export function ChartinkScannerSection({
  active,
  mode,
  onModeChange,
  data,
  error,
  loadingMessage,
  watchlistSymbols,
  onAddToWatchlist,
}: ChartinkScannerSectionProps) {
  const [liquidOnly, setLiquidOnly] = useState(true);
  const [chosenView, setView] = useState<View | null>(null);
  const [sort, setSort] = useState<Sort>("checks");
  const def = SCANNERS[active];
  const all = data?.results[active] ?? [];
  const liquid = all.filter((r) => r.passesFloor);
  // Status filters count liquid hits only: an illiquid stock is never a trade.
  const byStatus = liquid.reduce<Record<BuyingStatus["key"], ScannerRow[]>>(
    (groups, row) => {
      groups[scannerBuyingStatus(row.readiness).key].push(row);
      return groups;
    },
    { "buy-ready": [], watch: [], extended: [], avoid: [] },
  );
  const ready = byStatus["buy-ready"];
  const breadth = data?.breadth.percent ?? null;
  const healthy = breadth != null && breadth >= BUY_READY_RULES.minBreadth;
  // Until the user picks a filter, open on the strictest list that has rows.
  const view: View = chosenView ?? (ready.length ? "buy-ready" : byStatus.watch.length ? "watch" : "all");
  const base = view === "all" ? (liquidOnly ? liquid : all) : byStatus[view];
  const rows = [...base].sort((a, b) =>
    sort === "change" ? b.changePercent - a.changePercent
      : sort === "rs" ? (b.rs ?? -1) - (a.rs ?? -1)
      : sort === "pa" ? (b.paRating?.score ?? -1) - (a.paRating?.score ?? -1)
      : sort === "checks" ? b.readiness.passed - a.readiness.passed || (b.rs ?? -1) - (a.rs ?? -1)
      : (b.turnoverCr ?? 0) - (a.turnoverCr ?? 0));
  // Latest prices for the rows on screen (the first 120); rows beyond them use the server's scan price.
  const { quotes: liveQuotes, live: marketLive } = useLiveQuotes(rows.slice(0, 120).map((row) => row.symbol));
  const columns = COLUMNS[active];
  const checkTotal = all[0]?.readiness.checks.length ?? (SCORE_CHECKED.has(active) ? 8 : 7);
  const chip = (key: View, label: string, count: number) => (
    <button
      type="button"
      aria-pressed={view === key}
      onClick={() => setView(key)}
      title={key === "all" ? "Every screener hit, whatever its status" : TRADE_STATUS[key].meaning}
      className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
        view === key ? "border-[#16894f] bg-[#e7f6ee] text-[#12814c]" : `border-border bg-white hover:text-foreground ${key === "all" ? "text-muted" : TRADE_STATUS_STYLE[key].text}`
      }`}
    >
      {label} <span className="ml-1 rounded-full bg-white/80 px-1.5">{data ? count : "…"}</span>
    </button>
  );

  return (
    <WorkspaceFrame id="scanners">
      <WorkspaceHero
        eyebrow={def.chartinkSlug ? "Trade trigger · published Chartink rules" : active === "arbm" ? "Trade trigger · GainzAlgo indicator port" : "Trade trigger · Scanner Pro-style scan"}
        icon="triggers"
        title={def.title}
        description={def.blurb}
        action={<div className="flex flex-col items-end gap-1.5">
          <div className="flex rounded-lg border border-border bg-[#f5f8fd] p-1" aria-label="Scanner candle mode">
            {([
              ["completed", "Completed candle"],
              ["live", "Live today"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                onClick={() => onModeChange(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-black transition ${
                  mode === key ? "bg-white text-[#1f5fbf] shadow-sm" : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="rounded-full bg-[#e8effb] px-3 py-1.5 text-sm font-black text-[#1f5fbf]">
            {data ? `${ready.length} Buy ready · ${liquid.length} liquid hits · ${all.length} total` : error ? "Unavailable" : "Loading"}
          </span>
          {data?.candleTimestamp != null && (
            <span className={`text-xs ${data.provisional ? "font-bold text-amber-700" : "text-slate-500"}`}>
              Daily candle {dateLabel(data.candleTimestamp)}
              {data.provisional ? " · provisional while market is open" : " · completed sessions only"}
            </span>
          )}
        </div>}
      />
      <div className="p-5">

      {mode === "live" && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
          Live today is an intraday preview rebuilt from the current quote, high, low and volume. Results can appear or disappear before the close.
          Backtests continue to use completed candles.
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-[#f5f8fd] p-3 text-xs leading-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-black text-foreground">Conditions</p>
            <StyleTag horizon="short" />
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-foreground">
            {def.rules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
          {def.notes.map((note) => <p key={note} className="mt-1.5 font-semibold text-amber-700">{note}</p>)}
        </div>
        <details className="rounded-xl border border-border bg-white p-3 text-xs leading-5 lg:self-start">
          <summary className="cursor-pointer font-black text-[#1f5fbf]">{def.chartinkSlug ? "Chartink clause" : "Formula"}</summary>
          <code className="mt-2 block whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">{def.clause}</code>
          {def.chartinkSlug ? (
            <a
              href={`https://chartink.com/screener/${def.chartinkSlug}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-bold text-[#1f5fbf] underline"
            >
              Open on Chartink ↗
            </a>
          ) : (
            <p className="mt-2 text-muted">Written in Chartink-like notation for reading; it runs in this app, not on Chartink.</p>
          )}
        </details>
      </div>

      <BuyRulesCard active={active} />
      <BacktestCard active={active} />
      <HourlyEmailPanel />

      {data && (
        <p
          role="status"
          className={`mt-4 rounded-xl border px-3 py-2 text-sm font-semibold ${
            healthy ? "border-[#bfe5cf] bg-[#effaf3] text-[#12814c]" : "border-amber-300 bg-amber-50 text-amber-800"
          }`}
        >
          Market breadth {breadth ?? "—"}% ({data.breadth.above} of {data.breadth.covered} liquid stocks above their 50-day average).{" "}
          {healthy
            ? "Healthy: Buy ready signals are active."
            : `Below ${BUY_READY_RULES.minBreadth}%: no stock can be Buy ready. ${
              chosenView == null && view !== "buy-ready"
                ? view === "watch"
                  ? "Showing Watch instead: stocks that pass every other check, for when the market recovers."
                  : "No hit passes every other check either, so all screener hits are shown for chart study."
                : "Use Watch as the list for when the market recovers."
            }`}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-foreground">
        {chip("buy-ready", TRADE_STATUS["buy-ready"].label, ready.length)}
        {chip("watch", TRADE_STATUS.watch.label, byStatus.watch.length)}
        {chip("extended", TRADE_STATUS.extended.label, byStatus.extended.length)}
        {chip("avoid", TRADE_STATUS.avoid.label, byStatus.avoid.length)}
        {chip("all", "All screener hits", liquidOnly ? liquid.length : all.length)}
        {view === "all" && (
          <label className="ml-2 inline-flex items-center gap-1.5">
            <input type="checkbox" checked={liquidOnly} onChange={(e) => setLiquidOnly(e.target.checked)} />
            Liquid only (median traded value ≥ ₹5 cr)
          </label>
        )}
        <label className="ml-auto inline-flex items-center gap-1.5">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-border bg-white px-2 py-1 text-xs">
            <option value="checks">Checks passed</option>
            <option value="turnover">Liquidity</option>
            <option value="change">Day change</option>
            <option value="rs">RS rating</option>
            <option value="pa">PA rating</option>
          </select>
        </label>
      </div>

      {error && data && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-800">Scanner refresh failed; results may be stale.</p>}
      {!data && error ? (
        <EmptyState tone="error" title="Scanner results unavailable">Retrying automatically.</EmptyState>
      ) : !data ? (
        <LoadingState message={loadingMessage ?? "Running scanners…"} />
      ) : rows.length === 0 ? (
        <EmptyState title={view === "all" ? "No matches" : `Nothing is ${TRADE_STATUS[view].label} here`}>
          {view === "buy-ready"
            ? healthy
              ? `No ${def.menuLabel} hit passes all ${checkTotal} checks today.`
              : `No stock can be Buy ready while market breadth is below ${BUY_READY_RULES.minBreadth}%. ${byStatus.watch.length} stock${byStatus.watch.length === 1 ? "" : "s"} pass every other check (see Watch).`
            : view === "all"
              ? "No stocks meet this screener on the latest completed session."
              : `No liquid ${def.menuLabel} hit is ${TRADE_STATUS[view].label} today.`}
        </EmptyState>
      ) : (
        <div className="mt-4 max-h-[640px] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-white text-xs font-black uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Stock</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3" title="Latest market price and today's move. The signal is built on the last completed close shown underneath.">CMP · today</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Status</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Trade plan</th>
                {columns.map((col) => (
                  <th key={col.label} scope="col" title={col.title} className="whitespace-nowrap px-3 py-3">{col.label}</th>
                ))}
                <th scope="col" className="whitespace-nowrap px-3 py-3">RS</th>
                <th scope="col" title="Price Action Rating 0–100 (hover a value for its breakdown)" className="whitespace-nowrap px-3 py-3">PA rating</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Liquidity</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Watchlist</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {rows.map((row) => {
                const symbol = `NSE:${row.symbol}`;
                const added = watchlistSymbols.includes(row.symbol);
                return (
                  <tr key={row.symbol} className="align-top hover:bg-[#f5f8fd]">
                    <td className="px-3 py-3">
                      <StockSymbolButton symbol={row.symbol} className="block font-bold text-foreground">{row.name}</StockSymbolButton>
                      <span className="text-xs text-muted">{symbol}{row.sector ? ` · ${row.sector}` : ""}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">
                      {(() => {
                        const quote = liveQuotes.get(row.symbol);
                        const cmp = quote?.ltp ?? row.price;
                        const change = quote ? quote.changePercent : row.livePercent;
                        const old = staleLabel(quote, marketLive);
                        return (
                          <>
                            {priceLabel(cmp)}
                            {change != null && <span className={`ml-1 text-xs ${toneClass(change)}`}>{formatPercent(change)}</span>}
                            <div className="text-[10px] text-muted">signal close {priceLabel(row.close)}{old ? <span className="ml-1 font-bold text-amber-600">· {old}</span> : null}</div>
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-3"><ChecksCell row={row} /></td>
                    <td className="whitespace-nowrap px-3 py-3"><PlanCell row={row} /></td>
                    {columns.map((col) => (
                      <td key={col.label} className="whitespace-nowrap px-3 py-3 font-mono">{col.render(row)}</td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-3 font-mono">{row.rs ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3"><PaRatingPill rating={row.paRating} /></td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">
                      {row.turnoverCr == null ? "—" : `₹${row.turnoverCr.toFixed(1)} cr/day`}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        disabled={added}
                        onClick={() => onAddToWatchlist(symbol)}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold text-[#1f5fbf] disabled:opacity-60"
                      >
                        {added ? "Added" : "Add"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs leading-5 text-muted">
        {def.chartinkSlug
          ? "Screener conditions re-implemented from Chartink's published clauses on our Yahoo daily data, so counts can differ slightly from Chartink."
          : "Scan idea from Scanner Pro's public catalogue; the exact formula is ours and runs on our Yahoo daily data."}{" "}
        A screener hit is a starting point for chart study, not a buy call.
      </p>
      </div>
    </WorkspaceFrame>
  );
}

const CHECK_SHORT: Record<BuyCheckKey, string> = {
  breadth: "Breadth", liquid: "Liquidity", rs: "RS", score: "Score", trend: "Trend", notExtended: "Extension", risk: "Risk", pattern: "Pattern",
};

function ChecksCell({ row }: { row: ScannerRow }) {
  const { checks } = row.readiness;
  const status = scannerBuyingStatus(row.readiness);
  const failed = checks.filter((c) => !c.pass && c.key !== "breadth");
  const onlyBreadth = failed.length === 0 && checks.some((c) => !c.pass);
  return (
    <div className="min-w-[150px]">
      <BuyingStatusBadge status={status} showMissing={false} />
      {failed.length > 0 && (
        <span className="mt-1 block text-[11px] leading-4 text-muted">Fails: {failed.map((c) => CHECK_SHORT[c.key]).join(", ")}</span>
      )}
      {onlyBreadth && <span className="mt-1 block text-[11px] font-bold leading-4 text-amber-700">Waits for market breadth</span>}
    </div>
  );
}

function PlanCell({ row }: { row: ScannerRow }) {
  const p = row.readiness.plan;
  if (!p) return <span className="text-xs text-muted">No plan (stop too wide)</span>;
  return (
    <div className="font-mono text-xs leading-5" title={p.basis}>
      <div>Buy &gt; <b className="text-[#16894f]">{priceLabel(p.entry)}</b> <span className="text-muted">(max {priceLabel(p.buyZoneHigh)})</span></div>
      <div>SL <b className="text-down">{priceLabel(p.stop)}</b> <span className="text-muted">−{p.riskPercent}%</span></div>
      <div>T1 {priceLabel(p.target1)} · T2 {priceLabel(p.target2)}</div>
      <div className="text-muted">Quick: +0.5R {priceLabel(p.highWinTarget)} / SL {priceLabel(p.highWinStop)}</div>
    </div>
  );
}

function BuyRulesCard({ active }: { active: ScannerKey }) {
  return (
    <details className="mt-3 rounded-xl border border-[#bfe5cf] bg-[#f4fbf7] p-3 text-xs leading-5">
      <summary className="cursor-pointer font-black text-[#12814c]">Buy ready filter: what has to pass</summary>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-foreground">
        {buyCheckLabels(active).map((c) => <li key={c.key}>{c.label}</li>)}
      </ol>
      <p className="mt-1.5 text-muted">
        Plan: buy on a move above the entry within 3 sessions, skip it if it gaps above the max price, SL as shown.
        {SCORE_CHECKED.has(active) ? "" : " The oscillator score is not required here: in the backtest it did not help this pullback-type scanner."}
      </p>
    </details>
  );
}

type Stat = { trades: number; winRate: number; avgR: number; profitFactor: number | null } | null;
type Split = { all: Stat; firstHalf: Stat; secondHalf: Stat };
const BT = backtest as unknown as {
  from: string; to: string; split: string; costPercent: number;
  scanners: Record<string, { raw: Record<"targets" | "highwin", Split>; ready: Record<"targets" | "highwin", Split> }>;
};

function statText(s: Stat) {
  if (!s) return <span className="text-muted">no trades</span>;
  return (
    <span>
      {s.trades} · <b>{s.winRate.toFixed(0)}%</b> win ·{" "}
      <b className={s.avgR > 0 ? "text-[#16894f]" : "text-down"}>{s.avgR >= 0 ? "+" : ""}{s.avgR.toFixed(2)}R</b>
    </span>
  );
}

function BacktestCard({ active }: { active: ScannerKey }) {
  const s = BT.scanners[active];
  if (!s) return null;
  const rows: [string, Split][] = [
    ["Screener hit, 2R/3R targets", s.raw.targets],
    ["Buy ready, 2R/3R targets", s.ready.targets],
    ["Screener hit, quick exit (+0.5R / −2R)", s.raw.highwin],
    ["Buy ready, quick exit (+0.5R / −2R)", s.ready.highwin],
  ];
  return (
    <details className="mt-3 rounded-xl border border-border bg-white p-3 text-xs leading-5">
      <summary className="cursor-pointer font-black text-foreground">Backtest of this scanner ({BT.from} → {BT.to})</summary>
      <table className="mt-2 w-full text-left">
        <thead className="text-muted">
          <tr><th className="py-1 pr-3">Rule</th><th className="py-1 pr-3">All</th><th className="py-1 pr-3">Before {BT.split}</th><th className="py-1">After {BT.split}</th></tr>
        </thead>
        <tbody>
          {rows.map(([label, v]) => (
            <tr key={label} className="border-t border-border/60">
              <td className="py-1 pr-3 font-semibold">{label}</td>
              <td className="py-1 pr-3 font-mono">{statText(v.all)}</td>
              <td className="py-1 pr-3 font-mono">{statText(v.firstHalf)}</td>
              <td className="py-1 font-mono">{statText(v.secondHalf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-muted">
        Cells: trades · win rate · average result in R (1R = entry − SL) after {BT.costPercent}% costs. Walk-forward on about 1,900 liquid NSE stocks.
        Average R, not win rate, decides profit: a 80% win rate at 0R still makes nothing. Past results do not guarantee future ones.
      </p>
    </details>
  );
}

interface EmailAlertInfo {
  configured: boolean;
  autoSend: boolean;
  recipient: string | null;
  lastSentSlotKey: string | null;
  lastSentAt: number | null;
  lastError: string | null;
  preview: AlertTable | null;
  previewError: string | null;
}

async function fetchEmailAlertInfo(): Promise<EmailAlertInfo | null> {
  try {
    const response = await fetch("/api/alerts/email", { cache: "no-store" });
    return (await response.json()) as EmailAlertInfo;
  } catch {
    return null;
  }
}

function HourlyEmailPanel() {
  const [info, setInfo] = useState<EmailAlertInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const next = await fetchEmailAlertInfo();
    if (next) setInfo(next);
    else setMessage("Could not reach the email alert service.");
  };
  useEffect(() => {
    let alive = true;
    fetchEmailAlertInfo().then((next) => {
      if (alive && next) setInfo(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const post = async (verify: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/alerts/email${verify ? "?verify=1" : ""}`, { method: "POST" });
      const body = (await response.json()) as { ok: boolean; error?: string; picks?: number };
      setMessage(body.ok
        ? verify ? "Gmail SMTP connection verified." : `Email sent (${body.picks ?? 0} Buy ready now).`
        : body.error ?? "Email failed.");
      await load();
    } catch {
      setMessage("Email failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-[#cfdcf3] bg-[#f5f8fd] p-3 text-xs leading-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-black text-foreground">Hourly email · index analysis + stock changes</span>
        {info && (
          <span className={`rounded-full px-2 py-0.5 font-bold ${info.configured ? "bg-[#e7f6ee] text-[#12814c]" : "bg-slate-200 text-muted"}`}>
            {info.configured ? `${info.autoSend ? "Automatic" : "Manual"} · ${info.recipient}` : "Not set up"}
          </span>
        )}
        {info?.lastSentAt && (
          <span className="text-muted">
            Last sent {new Intl.DateTimeFormat("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(info.lastSentAt)}
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={!info?.configured || busy}
            onClick={() => void post(true)}
            className="rounded-lg border border-border bg-white px-2.5 py-1.5 font-bold text-[#1f5fbf] disabled:opacity-50"
          >
            Verify SMTP
          </button>
          <button
            type="button"
            disabled={!info?.configured || busy}
            onClick={() => void post(false)}
            className="rounded-lg bg-[#1f5fbf] px-2.5 py-1.5 font-bold text-white disabled:opacity-50"
          >
            {busy ? "Working…" : "Send email now"}
          </button>
        </span>
      </div>
      <p className="mt-1.5 text-muted">
        Sends once per hourly NSE slot (09:15, 10:15, … 15:15 IST) while the app is running and the market is open.
        Index analysis is included even when stock lists are unchanged. Latest available data, not verified real time;
        analysis uses the forming daily candle, not hourly candles, and can change before the close.
      </p>
      {info?.preview && <p className="mt-1 font-semibold text-foreground">Current email contains {Math.min(10, info.preview.rows.length)} picks.</p>}
      {info?.previewError && <p className="mt-1 font-semibold text-down">{info.previewError}</p>}
      {info?.lastError && <p className="mt-1 font-semibold text-down">Last error: {info.lastError}</p>}
      {message && <p role="status" className="mt-1 font-semibold text-foreground">{message}</p>}
    </div>
  );
}
