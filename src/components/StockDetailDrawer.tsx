"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TradePlanCard } from "./TradePlanCard";
import { TradeChecklist } from "./TradeChecklist";
import { PlanRehearsal } from "./PlanRehearsal";
import { FundamentalsPanel } from "./FundamentalsPanel";
import { useDailyCandles } from "@/hooks/useDailyCandles";
import { useFyersChartCandles } from "@/hooks/useFyersChartCandles";
import type { ScreenScan } from "@/hooks/useScreenScan";
import { formatPercent, formatPrice } from "@/lib/format";
import { isFnO } from "@/lib/market/indexUniverses";
import type { Quote } from "@/lib/market/types";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { SETUP_BREADTH_MIN, setupStatus } from "@/lib/screen/setupGate";
import type { RatedCheck } from "@/lib/screen/buyingStatus";
import type { ScannerPayload } from "@/lib/screen/chartinkScans";
import { groupScanBySector } from "@/lib/screen/commandCenter";
import { SCAN_STAGE_LABELS, stockConfluence, type SignalTone } from "@/lib/screen/confluence";
import { HORIZON_HOLDING, HORIZON_RESEARCH_NOTE, horizonBuySignal, targetOddsLines, type BuyHorizon, type HorizonPlan } from "@/lib/screen/horizonSignal";
import { horizonTargetOdds } from "@/lib/screen/horizonOdds";
import { macroSector, UNCLASSIFIED } from "@/lib/industry";
import { timeframeAgreement } from "@/lib/screen/multiTimeframe";
import { TimeframeAgreementBadge } from "./TimeframeAgreementBadge";
import type { RsiEdgeSourcePayload } from "@/lib/screen/rsiEdgeSource";
import { currentScanShortSellingStatus } from "@/lib/screen/shortSellingStatus";
import { LIQUIDITY_FLOOR } from "@/lib/screen/metrics";
import { basicStats, MIN_RATED_SESSIONS, unratedReason, type UnratedReason } from "@/lib/screen/unrated";
import type { ReferenceRating } from "@/lib/screen/referenceRating";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { ConfluenceBadge } from "./ConfluenceBadge";
import { MarketGateBanner } from "./MarketGateBanner";
import { ShortSellingStatusBadge } from "./ShortSellingStatusBadge";
import { PaRatingCard } from "./PriceActionRating";
import { ProChart, type ChartLevel } from "./ProChart";

const HORIZONS: { key: BuyHorizon; label: string; holding: string }[] = [
  { key: "short", label: "Short term", holding: HORIZON_HOLDING.short },
  { key: "mid", label: "Mid term", holding: HORIZON_HOLDING.mid },
  { key: "long", label: "Long term", holding: HORIZON_HOLDING.long },
];

const STAGE_LABELS = SCAN_STAGE_LABELS;
// The full snapshot history (about 3 years) so weekly and monthly charts have depth.
const CHART_HISTORY_SESSIONS = 750;

const signed = (value: number | null, suffix = "%") =>
  value == null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}${suffix}`;


function Kpi({ label, value, tone = "text-slate-900", hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm" title={hint}>
      <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={`mt-1 font-mono text-base font-black tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function CheckList({ checks }: { checks: RatedCheck[] }) {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {checks.map((check) => (
        <li key={check.key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
          check.pass ? "border-emerald-100 bg-emerald-50/60 text-emerald-800" : "border-rose-100 bg-rose-50/60 text-rose-800"
        }`}>
          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white ${check.pass ? "bg-emerald-500" : "bg-rose-500"}`} aria-hidden>
            {check.pass ? "✓" : "✕"}
          </span>
          <span>{check.label}</span>
          <span className="sr-only">{check.pass ? "passes" : "fails"}</span>
        </li>
      ))}
    </ul>
  );
}

function LevelCell({ label, value, sub, odds, tone }: { label: string; value: string; sub: string; odds?: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={`mt-1 font-mono text-base font-black tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
      {odds && <div className="mt-1 text-[11px] font-bold text-slate-700">{odds}</div>}
    </div>
  );
}

/** Horizon entry/stop/targets with how often each target was reached in the backtest. */
function ReferenceLevels({ plan, horizon }: { plan: HorizonPlan; horizon: BuyHorizon }) {
  const odds = horizonTargetOdds(horizon);
  const lines = odds ? targetOddsLines(odds) : null;
  const move = (value: number) => `${value >= plan.entry ? "+" : "−"}${Math.abs((value / plan.entry - 1) * 100).toFixed(1)}%`;
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Reference levels · not a recommendation</div>
      <div className="grid gap-2 sm:grid-cols-4">
        <LevelCell label="Entry above" value={`₹${formatPrice(plan.entry)}`} sub={`Zone to ₹${formatPrice(plan.buyZoneHigh)}`} tone="text-blue-700" />
        <LevelCell label="Stop-loss" value={`₹${formatPrice(plan.stop)}`} sub={`Risk ${plan.riskPercent.toFixed(1)}%`} odds={lines?.stop} tone="text-rose-700" />
        <LevelCell label="Target 1" value={`₹${formatPrice(plan.target1)}`} sub={`${move(plan.target1)} · ${plan.rewardRisk1}R`} odds={lines?.t1} tone="text-emerald-700" />
        <LevelCell label="Target 2" value={`₹${formatPrice(plan.target2)}`} sub={`${move(plan.target2)} · ${plan.rewardRisk2}R`} odds={lines?.t2} tone="text-emerald-800" />
      </div>
      <p className="text-[11px] text-slate-500">
        {plan.stopBasis && <>{plan.stopBasis} </>}
        {plan.targetBasis && <>{plan.targetBasis} </>}
        {lines
          ? <>Hit rates: {lines.sample}, Buy ready signals, after costs; book half at T1 and move the stop to entry. Average {odds!.avgR >= 0 ? "+" : "−"}{Math.abs(odds!.avgR).toFixed(2)}R a trade.</>
          : "No backtest sample for this horizon yet."}
      </p>
    </div>
  );
}

function Card({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const SIGNAL_TONES: Record<SignalTone, string> = {
  bull: "border-emerald-200 bg-emerald-50 text-emerald-800",
  bear: "border-rose-200 bg-rose-50 text-rose-800",
  neutral: "border-amber-200 bg-amber-50 text-amber-900",
  muted: "border-slate-200 bg-slate-50 text-slate-500",
};

function UnratedNotice({ symbol, reason }: { symbol: string; reason: UnratedReason | null }) {
  if (!reason || reason.kind === "loading") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Ratings will appear once the NSE universe scan has loaded.
      </div>
    );
  }
  if (reason.kind === "recent-listing") {
    const stats = reason.stats;
    return (
      <Card
        title="Recently listed — not rated yet"
        subtitle={`${symbol} has ${reason.sessions} of the ${MIN_RATED_SESSIONS} daily sessions needed before bases, moving averages and oscillators can be measured. Ratings, trade plans and scanner matches start in about ${reason.remaining} more session${reason.remaining === 1 ? "" : "s"}.`}
        action={<span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-sky-700">New listing</span>}
      >
        {stats ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              <Kpi label="Listing open" value={`₹${formatPrice(stats.listingOpen)}`} hint="Open of the first traded session" />
              <Kpi label="Since listing" value={signed(stats.changeFromListing)} tone={stats.changeFromListing >= 0 ? "text-emerald-700" : "text-rose-700"} />
              <Kpi label="High since listing" value={`₹${formatPrice(stats.highSinceListing)}`} hint={`${stats.fromHigh.toFixed(1)}% below the high`} />
              <Kpi label="Low since listing" value={`₹${formatPrice(stats.lowSinceListing)}`} />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {stats.fromHigh <= 3
                ? "Trading near its post-listing high. "
                : stats.lastClose < stats.listingOpen
                  ? "Trading below its listing open. "
                  : `${stats.fromHigh.toFixed(1)}% below its post-listing high. `}
              Once rated, it becomes eligible for the IPO base and Blue sky setups. Reference only, not a buy signal.
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-500">Loading daily history…</p>
        )}
      </Card>
    );
  }
  if (reason.kind === "below-floor") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {symbol} is below the liquidity floor (median daily turnover ≥ ₹{LIQUIDITY_FLOOR.turnoverCr} Cr and market cap ≥ ₹{LIQUIDITY_FLOOR.mcapCr} Cr)
        {reason.turnoverCr != null ? `; its median turnover is about ₹${reason.turnoverCr.toFixed(2)} Cr` : ""}. Thinly traded stocks give unreliable signals and are hard to exit, so it gets no Buy/Short status, trade levels, picks or emails. RS and PA above are reference ratings only (shown from ₹1 Cr a day); RVOL and oscillators are not computed.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      Loading daily history… If this message stays, the data provider has no daily history for {symbol}, so it cannot be rated.
    </div>
  );
}

/** Display-only RS/PA for a stock below the liquidity floor; null while loading or when it is under ₹1 Cr a day. */
function useReferenceRating(symbol: string, enabled: boolean): ReferenceRating | null {
  const [result, setResult] = useState<{ symbol: string; rating: ReferenceRating | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch(`/api/market/reference-rating?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<ReferenceRating>) : null))
      .catch(() => null)
      .then((rating) => { if (alive) setResult({ symbol, rating }); });
    return () => { alive = false; };
  }, [enabled, symbol]);
  return enabled && result?.symbol === symbol ? result.rating : null;
}

export function StockDetailDrawer({
  symbol,
  onClose,
  scan,
  quote,
  scanners,
  rsiEdge,
  inWatchlist,
  onAddToWatchlist,
}: {
  symbol: string;
  onClose: () => void;
  scan: ScreenScan | null;
  quote: Quote | null;
  scanners: ScannerPayload | null;
  rsiEdge: RsiEdgeSourcePayload | null;
  inWatchlist: boolean;
  onAddToWatchlist: (symbol: string) => void;
}) {
  const [horizon, setHorizon] = useState<BuyHorizon>("mid");
  const [linkCopiedFor, setLinkCopiedFor] = useState<string | null>(null);
  const linkCopied = linkCopiedFor === symbol;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const history = useDailyCandles([symbol], CHART_HISTORY_SESSIONS);
  const candles = useMemo(() => history[symbol] ?? [], [history, symbol]);
  // Chart only: Fyers candles when logged in; ratings and levels stay on the scan's data.
  const fyersCandles = useFyersChartCandles(symbol, CHART_HISTORY_SESSIONS);
  const chartCandles = fyersCandles ?? candles;

  const row = useMemo(() => scan?.rows.find((item) => item.symbol === symbol) ?? null, [scan, symbol]);
  const extraRows = useMemo(() => (scan?.extraRows ?? []).filter((item) => item.symbol === symbol), [scan, symbol]);
  const breadthPercent = useMemo(() => movingAverageBreadth(scan?.rows ?? [], "vs50").percent, [scan]);
  const signal = useMemo(() => row ? horizonBuySignal(row, horizon, breadthPercent) : null, [breadthPercent, horizon, row]);
  const shortStatus = useMemo(() => row ? currentScanShortSellingStatus(row, breadthPercent) : null, [breadthPercent, row]);
  const confluence = useMemo(() => stockConfluence(symbol, row, extraRows, scanners, rsiEdge), [extraRows, row, rsiEdge, scanners, symbol]);
  const signals = confluence.signals;
  /** Same ranking as the Sector strength page (average change), so the two views can never disagree. */
  const sectorRank = useMemo(() => {
    const sector = row ? macroSector(row.sector) : null;
    if (!scan?.rows || !sector || sector === UNCLASSIFIED) return null;
    const groups = groupScanBySector(scan.rows);
    const index = groups.findIndex((group) => group.sector === sector);
    if (index === -1) return null;
    return { sector, rank: index + 1, total: groups.length, avgChange: groups[index].avgChange };
  }, [row, scan]);
  const agreement = useMemo(() => timeframeAgreement(candles), [candles]);
  const unrated = useMemo(() => row ? null : unratedReason(symbol, scan, candles), [candles, row, scan, symbol]);
  // Unrated stocks still get descriptive price stats from their own daily candles.
  const basic = useMemo(() => row ? null : basicStats(candles), [candles, row]);
  const vs50 = row?.vs50 ?? basic?.vs50 ?? null;
  const vs200 = row?.vs200 ?? basic?.vs200 ?? null;
  const fromHigh = row?.fromHigh ?? basic?.fromHigh ?? null;
  const turnoverCr = row?.turnoverCr ?? basic?.turnoverCr ?? null;
  const notRated = !row && unrated != null && unrated.kind !== "loading" ? "Not rated" : "—";
  const notRatedHint = unrated?.kind === "below-floor"
    ? `Not rated: below the liquidity floor (median turnover ≥ ₹${LIQUIDITY_FLOOR.turnoverCr} Cr and market cap ≥ ₹${LIQUIDITY_FLOOR.mcapCr} Cr)`
    : unrated?.kind === "recent-listing" ? `Not rated: needs ${MIN_RATED_SESSIONS} sessions of history` : undefined;
  const reference = useReferenceRating(symbol, unrated?.kind === "below-floor");
  const refPa = reference?.paRating.status === "rated" ? reference.paRating : null;
  const refHint = "Reference only: below the liquidity floor, so no Buy/Short status, trade levels, picks or emails. RS shows where it would rank among liquid stocks.";

  const price = quote?.ltp ?? row?.price ?? candles.at(-1)?.close ?? null;
  const changePercent = quote?.changePercent ?? row?.changePercent ?? null;
  const name = quote?.name ?? row?.name ?? symbol;
  const sector = quote?.sector ?? row?.sector;
  const fno = isFnO(symbol);

  const levels = useMemo<ChartLevel[]>(() => {
    const result: ChartLevel[] = [];
    const plan = signal?.plan;
    if (plan) {
      result.push(
        { label: "Entry", value: plan.entry, color: "#2563eb" },
        { label: "Stop", value: plan.stop, color: "#e11d48" },
        { label: "T1", value: plan.target1, color: "#16a34a" },
        { label: "T2", value: plan.target2, color: "#15803d" },
      );
    }
    const pivot = row?.pivotPrice;
    if (pivot != null && !result.some((level) => Math.abs(level.value - pivot) / pivot < 0.002)) {
      result.push({ label: "Pivot", value: pivot, color: "#d97706" });
    }
    return result;
  }, [row, signal]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeHorizon = HORIZONS.find((option) => option.key === horizon)!;

  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("stock", symbol);
    try {
      await navigator.clipboard.writeText(url.toString());
      setLinkCopiedFor(symbol);
    } catch {
      setLinkCopiedFor(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[2px] drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} stock details`}
        className="flex h-full w-[min(1020px,94vw)] flex-col overflow-hidden bg-[#f4f7f6] shadow-[-30px_0_80px_rgba(15,23,42,0.35)] drawer-panel"
      >
        <header className="shrink-0 bg-gradient-to-r from-slate-950 to-slate-800 px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap sm:gap-4">
            <div className="flex min-w-0 flex-1 basis-[200px] items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f0c14b]/15 text-sm font-black text-[#f0c14b] ring-1 ring-[#f0c14b]/30">
                {symbol.slice(0, 2)}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f0c14b]">
                  {sector ?? "NSE equity"}{row?.stage ? ` · ${STAGE_LABELS[row.stage]}` : ""}
                  {sectorRank && (
                    <span
                      title={`${sectorRank.sector} sector: ranked ${sectorRank.rank} of ${sectorRank.total} by average move today (${signed(sectorRank.avgChange)}). Same ranking as the Sector strength page.`}
                      className={`ml-2 rounded px-1.5 py-0.5 tracking-normal ring-1 ${
                        sectorRank.rank <= Math.ceil(sectorRank.total / 3)
                          ? "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30"
                          : sectorRank.rank > sectorRank.total - Math.ceil(sectorRank.total / 3)
                            ? "bg-rose-400/15 text-rose-300 ring-rose-400/30"
                            : "bg-slate-400/15 text-slate-300 ring-slate-400/30"
                      }`}
                    >
                      Sector #{sectorRank.rank}/{sectorRank.total}
                    </span>
                  )}
                  {fno && (
                    <span title="Has NSE stock futures & options; can be shorted positionally" className="ml-2 rounded bg-sky-400/15 px-1.5 py-0.5 tracking-normal text-sky-300 ring-1 ring-sky-400/30">
                      F&amp;O
                    </span>
                  )}
                </p>
                <h2 className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-2xl font-black tracking-tight sm:text-3xl">
                  {symbol}
                  <span className="truncate text-sm font-semibold text-slate-400">{name !== symbol ? name : ""}</span>
                </h2>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void copyLink()}
                title="Copy a link that opens this stock on the current page"
                className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
              >
                {linkCopied ? "✓ Link copied" : "Copy link"}
              </button>
              <button
                type="button"
                disabled={inWatchlist}
                onClick={() => onAddToWatchlist(symbol)}
                className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10 disabled:cursor-default disabled:border-emerald-400/30 disabled:text-emerald-300 disabled:hover:bg-transparent"
              >
                {inWatchlist ? "✓ In watchlist" : "+ Watchlist"}
              </button>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close stock details"
                className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                ✕ <span className="ml-1 font-mono text-[10px] text-slate-500">Esc</span>
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div className="font-mono text-3xl font-black tabular-nums">{price != null ? `₹${formatPrice(price)}` : "—"}</div>
            {changePercent != null && (
              <span className={`mb-1 rounded-md px-2 py-0.5 font-mono text-sm font-black ${changePercent >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                {formatPercent(changePercent)}
              </span>
            )}
            <span className="mb-1 text-xs text-slate-400">
              {quote ? "Live quote" : row ? "Scan snapshot" : "Last daily close"}
            </span>
            <TimeframeAgreementBadge agreement={agreement} dark />
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">
          <MarketGateBanner label="Setup check" breadth={breadthPercent} healthy={setupStatus(breadthPercent).allowed} threshold={SETUP_BREADTH_MIN} allowedText="real buys allowed" blockedText="paper trade only" compact />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Kpi label={reference?.rs != null ? "RS · reference" : "RS rating"} value={row?.rs != null ? String(Math.round(row.rs)) : reference?.rs != null ? String(reference.rs) : notRated} tone={row?.rs != null && row.rs >= 70 ? "text-emerald-700" : row?.rs != null && row.rs <= 30 ? "text-rose-700" : "text-slate-900"} hint={row ? "Relative strength percentile versus the NSE universe" : reference?.rs != null ? refHint : notRatedHint} />
            <Kpi
              label={refPa ? "PA · reference" : "PA rating"}
              value={row?.paRating?.score != null ? `${row.paRating.score} ${row.paRating.grade}` : row ? "—" : refPa ? `${refPa.score} ${refPa.grade}` : notRated}
              tone={row?.paRating?.score != null && row.paRating.score >= 70 ? "text-emerald-700" : row?.paRating?.score != null && row.paRating.score < 35 ? "text-rose-700" : "text-slate-900"}
              hint={row ? "Price Action Rating 0–100: trend, momentum, leadership, volume and stability. 85+ is about the top 5%." : refPa ? refHint : notRatedHint}
            />
            <Kpi
              label={row?.rvol?.projected ? "RVOL (proj.)" : "RVOL"}
              value={row?.rvol ? `${row.rvol.ratio.toFixed(1)}×` : "—"}
              tone={row?.rvol && row.rvol.ratio >= 1.5 ? "text-emerald-700" : row?.rvol && row.rvol.ratio < 1 ? "text-slate-500" : "text-slate-900"}
              hint={row?.rvol?.projected ? "Projected full-session volume vs the 50-day average, from volume so far" : "Session volume vs the 50-day average"}
            />
            <Kpi label="vs 50 DMA" value={signed(vs50)} tone={(vs50 ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"} />
            <Kpi label="vs 200 DMA" value={signed(vs200)} tone={(vs200 ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"} />
            <Kpi label="From 52W high" value={signed(fromHigh != null ? -fromHigh : null)} tone={fromHigh != null && fromHigh <= 15 ? "text-emerald-700" : "text-slate-900"} />
            <Kpi label="Turnover" value={turnoverCr != null ? `₹${turnoverCr.toFixed(turnoverCr < 10 ? 2 : 1)} Cr` : "—"} tone={turnoverCr != null && turnoverCr >= LIQUIDITY_FLOOR.turnoverCr ? "text-slate-900" : "text-amber-700"} hint={row ? undefined : "Median daily traded value, last 50 sessions"} />
            <Kpi label="Oscillators" value={row?.oscillatorScore ? `${row.oscillatorScore.score.toFixed(1)}/15` : "—"} tone={row?.oscillatorScore && row.oscillatorScore.score >= 8 ? "text-emerald-700" : "text-slate-900"} />
          </div>

          {!row && unrated?.kind === "below-floor" && <UnratedNotice symbol={symbol} reason={unrated} />}

          <div>
            <ProChart candles={chartCandles} levels={levels} symbol={symbol} intraday={fyersCandles != null} />
            <p className="mt-1 text-right text-[11px] text-slate-500">
              {fyersCandles
                ? "Chart data: Fyers (NSE). Daily/weekly/monthly plus 1m–1h intraday. Ratings and levels use the scanner's data."
                : "Chart data: Yahoo Finance (delayed). Log in to Fyers on the Index Scalp Desk for Fyers charts."}
            </p>
          </div>

          <TradePlanCard key={symbol} symbol={symbol} />
          {row && <TradeChecklist row={row} candles={candles} />}
          <FundamentalsPanel symbol={symbol} sector={sector} />
          <PlanRehearsal key={symbol} symbol={symbol} />
          <a href={`/backtest?symbol=${encodeURIComponent(symbol)}`} className="block rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-sm hover:border-emerald-500 hover:text-emerald-700">How would the rules have traded {symbol} over 10 years? →</a>

          {!row ? (
            unrated?.kind !== "below-floor" ? <UnratedNotice symbol={symbol} reason={unrated} /> : refPa ? <PaRatingCard rating={refPa} /> : null
          ) : (
            <>
              {row.riskFlags && row.riskFlags.length > 0 && (
                <section className={`rounded-2xl border p-4 ${row.riskFlags.some((flag) => flag.severity === "high") ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60"}`}>
                  <h3 className="text-sm font-black text-slate-900">Risk flags</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Red flags hold a Buy ready setup at Watch; amber ones are cautions.</p>
                  <ul className="mt-2 space-y-1.5">
                    {row.riskFlags.map((flag) => (
                      <li key={flag.key} className="flex items-start gap-2 text-xs">
                        <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${flag.severity === "high" ? "bg-rose-600 text-white" : "bg-amber-400 text-amber-950"}`}>
                          {flag.label}
                        </span>
                        <span className="text-slate-700">{flag.detail}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <PaRatingCard rating={row.paRating} />
              <Card
                title="Buy checklist"
                subtitle={`${activeHorizon.label} · hold ${activeHorizon.holding}. Rating = share of required checks passing, not a probability.`}
                action={
                  <div className="flex items-center gap-3">
                    <ConfluenceBadge confluence={confluence} compact />
                    <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      {HORIZONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setHorizon(option.key)}
                          className={`px-3 py-1.5 text-[11px] font-black transition ${horizon === option.key ? "bg-[#16894f] text-white" : "text-slate-500 hover:bg-white"}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                }
              >
                {signal && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <BuyingStatusBadge status={signal.status} showMissing={false} />
                      <p className="text-xs text-slate-500">{signal.status.detail}</p>
                    </div>
                    {confluence.conflict && (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Scanners disagree on this stock: {confluence.bull.length} famil{confluence.bull.length === 1 ? "y" : "ies"} bullish,{" "}
                        {confluence.bear.length} bearish. Treat this stock with extra caution.
                      </p>
                    )}
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{HORIZON_RESEARCH_NOTE}</p>
                    {signal.noTrade && (
                      <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                        <span className="font-black">{signal.noTrade.reason}.</span> {signal.noTrade.detail}
                      </p>
                    )}
                    {signal.plan && <ReferenceLevels plan={signal.plan} horizon={horizon} />}
                    <CheckList checks={signal.status.checks} />
                  </div>
                )}
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <Card title="Short checks" subtitle="Short ready only when every bearish check passes. Research only; borrow, margin and stop placement are not assessed.">
                  {shortStatus && (
                    <div className="space-y-3">
                      <ShortSellingStatusBadge status={shortStatus} />
                      {!fno && (
                        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold leading-4 text-amber-800">
                          Not in F&amp;O: a cash short must be closed the same day, so this cannot be a swing short.
                        </p>
                      )}
                      <CheckList checks={shortStatus.checks} />
                    </div>
                  )}
                </Card>
                <Card
                  title="Scanner matches"
                  subtitle={`${signals.length} signal${signals.length === 1 ? "" : "s"} · ${confluence.bull.length} of 5 families bullish`}
                  action={<ConfluenceBadge confluence={confluence} compact />}
                >
                  {signals.length ? (
                    <ul className="space-y-1.5">
                      {signals.map((item) => (
                        <li key={`${item.family}-${item.label}`} className={`flex items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-xs ${SIGNAL_TONES[item.tone]}`}>
                          <span className="min-w-0">
                            <span className="block text-[9px] font-black uppercase tracking-[0.12em] opacity-60">{item.family}</span>
                            <span className="font-black">{item.label}</span>
                          </span>
                          {item.detail && <span className="shrink-0 text-[10px] font-semibold capitalize opacity-80">{item.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                      No scanner currently includes {symbol}.
                    </p>
                  )}
                  {(!scanners || !rsiEdge) && (
                    <p className="mt-2 text-[10px] text-slate-400">
                      {!scanners ? "Trade Trigger results loading… " : ""}{!rsiEdge ? "RSI Edge results loading…" : ""}
                    </p>
                  )}
                </Card>
              </div>

              {(row.baseWk != null || row.pivotPrice != null) && (
                <Card title="Base structure">
                  <div className="grid grid-cols-5 gap-2">
                    <Kpi label="Pivot" value={row.pivotPrice != null ? `₹${formatPrice(row.pivotPrice)}` : "—"} />
                    <Kpi label="From pivot" value={signed(row.ext)} tone={row.ext != null && row.ext > 10 ? "text-amber-700" : "text-slate-900"} />
                    <Kpi label="Base length" value={row.baseWk != null ? `${row.baseWk} wk` : "—"} />
                    <Kpi label="Base depth" value={row.baseDepth != null ? `${row.baseDepth.toFixed(1)}%` : "—"} />
                    <Kpi label="Volume dry-up" value={row.dry != null ? `${row.dry.toFixed(2)}×` : "—"} />
                  </div>
                </Card>
              )}
            </>
          )}

          <p className="pb-2 text-[11px] leading-5 text-slate-400">
            Technical analytics only — not investment advice. Validate every setup and size positions to your own risk.
          </p>
        </div>
      </aside>
    </div>
  );
}
