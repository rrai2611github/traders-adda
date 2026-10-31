"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { FeedEvent, ScanRow, ScreenScan } from "@/hooks/useScreenScan";
import { formatPercent, formatPrice } from "@/lib/format";
import { isFnO } from "@/lib/market/indexUniverses";
import {
  groupScanBySector,
  IDEA_MIN_TURNOVER_CR,
  marketRegime,
  nearestBuyIdeas,
  rankBuyIdeas,
  rankShortIdeas,
  sessionChanges,
  type BuyIdea,
  type RegimeKey,
} from "@/lib/screen/commandCenter";
import { HORIZON_RESEARCH_NOTE, type BuyHorizon } from "@/lib/screen/horizonSignal";
import { horizonTargetOdds } from "@/lib/screen/horizonOdds";

import type { ScannerPayload } from "@/lib/screen/chartinkScans";
import { buildConfluence, rankConfluence, type Confluence } from "@/lib/screen/confluence";
import { marketPulse } from "@/lib/screen/marketPulse";
import { dashboardMetricRows, type DashboardMetric } from "@/lib/screen/dashboardMetrics";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import type { MorningBriefIdea } from "@/lib/screen/morningBrief";
import { useGlobalCues } from "@/hooks/useGlobalCues";
import type { RsiEdgeSourcePayload } from "@/lib/screen/rsiEdgeSource";
import type { DirectoryTarget } from "@/lib/screen/scannerDirectory";
import { BuyingStatusBadge } from "./BuyingStatusBadge";
import { ConfluenceBadge } from "./ConfluenceBadge";
import { MarketPulseCard } from "./MarketPulseCard";
import { DataQualityNotice } from "./DataQualityNotice";
import { MorningBriefCard } from "./MorningBriefCard";
import { RiskFlagChips, RvolPill } from "./RiskSignals";
import { ScannerDirectory } from "./ScannerDirectory";
import { ShortSellingStatusBadge } from "./ShortSellingStatusBadge";
import { StockSymbolButton } from "./StockDetailContext";
import { NavIcon } from "./NavIcons";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";
import { TodayBoard } from "./TodayBoard";

export type CommandCenterTarget = "today" | "journal" | "research" | "directory" | "picks" | "screens" | "watchlist" | "breakouts" | "sectors" | "breadth" | DirectoryTarget;

const IDEA_LIMIT = 8;
const NEAREST_LIMIT = 6;
const METRIC_LABELS: Record<DashboardMetric, string> = {
  above50: "Stocks at or above 50 DMA",
  above200: "Stocks at or above 200 DMA",
  advancing: "Advancing stocks",
  buyReady: "Buy ready · research",
  shortReady: "Short ready · F&O research",
};

/** Ranked confluence restricted to liquid stocks in the scan universe, joined to their scan row. */
function liquidConfluence(
  rows: ReadonlyArray<ScanRow>,
  confluence: ReadonlyMap<string, Confluence>,
  direction: "bull" | "bear",
): { row: ScanRow; confluence: Confluence }[] {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return rankConfluence(confluence, direction, 2)
    .map((item) => ({ row: bySymbol.get(item.symbol), confluence: item }))
    .filter((item): item is { row: ScanRow; confluence: Confluence } =>
      item.row != null && item.row.turnoverCr != null && item.row.turnoverCr >= IDEA_MIN_TURNOVER_CR);
}

const HORIZONS: { key: BuyHorizon; label: string }[] = [
  { key: "short", label: "Short" },
  { key: "mid", label: "Mid" },
  { key: "long", label: "Long" },
];

const REGIME_STYLES: Record<RegimeKey, { pill: string; dot: string }> = {
  "risk-on": { pill: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  selective: { pill: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  "risk-off": { pill: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
};

const sessionLabel = (dateKey: string | null | undefined) => {
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(Date.UTC(year, month - 1, day));
};

function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-x-auto">{children}</div>
    </section>
  );
}

function LinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-50">
      {label} →
    </button>
  );
}

function Stat({ label, value, detail, tone = "text-slate-900", bar, onClick }: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
  bar?: { percent: number; color: string; marker?: number };
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="dashboard-stat rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-black tabular-nums ${tone}`}>{value}</div>
      {bar && (
        <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${Math.max(0, Math.min(100, bar.percent))}%` }} />
          {bar.marker != null && <div className="absolute inset-y-0 w-0.5 bg-slate-500" style={{ left: `${bar.marker}%` }} title={`${bar.marker}% threshold`} />}
        </div>
      )}
      <div className="mt-1.5 text-[11px] leading-4 text-slate-500">{detail}</div>
      <div className="mt-2 text-[10px] font-bold text-accent">View stocks <span aria-hidden>→</span></div>
    </button>
  );
}

const Empty = EmptyState;

function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return <LoadingState rows={rows} />;
}

function Identity({ symbol, name, sector }: { symbol: string; name: string; sector?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-black text-white">{symbol.slice(0, 2)}</div>
      <div className="min-w-0">
        <StockSymbolButton symbol={symbol} className="block max-w-full truncate font-mono text-sm font-black text-slate-900">{symbol}</StockSymbolButton>
        <div className="truncate text-[11px] text-slate-500">{name}{sector ? ` · ${sector}` : ""}</div>
      </div>
    </div>
  );
}

const pctFrom = (entry: number, value: number) => `+${((value / entry - 1) * 100).toFixed(0)}%`;

function BuyIdeaTable({ ideas, horizon, muted = false, hypothetical = false }: { ideas: BuyIdea[]; horizon: BuyHorizon; muted?: boolean; hypothetical?: boolean }) {
  const odds = horizonTargetOdds(horizon);
  return (
    <table className={`w-full min-w-[620px] table-fixed text-left text-xs ${muted ? "opacity-80" : ""}`}>
      <colgroup>
        <col className="w-[32%]" />
        <col className="w-[20%]" />
        <col className="w-[16%]" />
        <col className="w-[32%]" />
      </colgroup>
      <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
        <tr>
          <th className="px-4 py-2">Stock</th>
          <th className="px-2 py-2">{hypothetical ? "Hypothetical status" : "Status"}</th>
          <th className="px-2 py-2 text-right">Checks</th>
          <th className="px-4 py-2 text-right" title={odds ? `Backtest ${odds.from.slice(0, 4)}–${odds.to.slice(0, 4)}, ${odds.trades} trades: T1 reached ${Math.round(odds.t1HitPercent)}%, T2 ${Math.round(odds.t2HitPercent)}%` : undefined}>
            Reference levels{odds ? ` · T1 hit ${Math.round(odds.t1HitPercent)}%` : ""}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {ideas.map(({ row, signal }) => (
          <tr key={row.key} className="hover:bg-emerald-50/40">
            <td className="px-4 py-2"><Identity symbol={row.symbol} name={row.name} sector={row.sector} /></td>
            <td className="px-2 py-2">
              {hypothetical && <div className="mb-1 text-[9px] font-bold text-amber-700">Breadth ignored · not actionable</div>}
              <BuyingStatusBadge status={signal.status} showMissing={false} />
              <div className="mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-400"><RvolPill rvol={row.rvol} /> RVOL</div>
            </td>
            <td className="px-2 py-2 text-right text-[10px] leading-4" title={signal.status.failed.join(", ") || undefined}>
              <div className="font-mono text-xs font-black text-slate-800">{signal.status.passed}/{signal.status.total} pass</div>
              <div className="text-slate-400">RS {row.rs ?? "—"}</div>
            </td>
            <td className="px-4 py-2 text-right font-mono text-[10px] leading-4">
              {signal.plan ? (
                <>
                  <div className="text-xs font-black text-slate-800">₹{formatPrice(signal.plan.entry)}</div>
                  <div className="text-rose-700">SL ₹{formatPrice(signal.plan.stop)} · {signal.plan.riskPercent.toFixed(1)}%</div>
                  <div className="text-emerald-700">
                    T1 ₹{formatPrice(signal.plan.target1)} ({pctFrom(signal.plan.entry, signal.plan.target1)}) · T2 ₹{formatPrice(signal.plan.target2)}
                  </div>
                </>
              ) : signal.noTrade ? (
                <div className="font-sans font-bold text-rose-700" title={signal.noTrade.detail}>{signal.noTrade.reason}</div>
              ) : <span className="text-slate-400">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function FeedList({ events, tone, empty }: { events: FeedEvent[]; tone: "up" | "down" | "muted"; empty: string }) {
  if (!events.length) return <p className="px-4 py-3 text-xs text-slate-400">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {events.slice(0, 6).map((event) => {
        const move = event.pivot > 0 ? ((event.price - event.pivot) / event.pivot) * 100 : null;
        return (
          <li key={`${event.type}-${event.symbol}`} className="flex items-center justify-between gap-3 px-4 py-2">
            <div className="min-w-0">
              <StockSymbolButton symbol={event.symbol} className="font-mono text-xs font-black text-slate-900">{event.symbol}</StockSymbolButton>
              <div className="truncate text-[10px] text-slate-500">
                {event.screens.join(" · ") || "Base breakout"}
                {event.type === "played_out" && event.why ? ` · ${event.why}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-right font-mono text-[11px]">
              <div className="font-black text-slate-800">₹{formatPrice(event.price)}</div>
              {event.type === "played_out" && event.retPct != null ? (
                <div className={event.retPct >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatPercent(event.retPct)} trade</div>
              ) : move != null ? (
                <div className={tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-slate-500"}>
                  {formatPercent(move)} vs pivot{event.volumeRatio != null && tone === "up" ? ` · ${event.volumeRatio.toFixed(1)}× vol` : ""}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CommandCenter({
  scan,
  error,
  loadingMessage,
  scanners,
  rsiEdge,
  onNavigate,
  view,
  metric,
  horizon,
  onHorizonChange,
  onOpenMetric,
}: {
  scan: ScreenScan | null;
  error: boolean;
  loadingMessage: string | null;
  scanners: ScannerPayload | null;
  rsiEdge: RsiEdgeSourcePayload | null;
  onNavigate: (target: CommandCenterTarget) => void;
  view: "today" | "metrics" | "research" | "directory";
  metric: DashboardMetric;
  horizon: BuyHorizon;
  onHorizonChange: (horizon: BuyHorizon) => void;
  onOpenMetric: (metric: DashboardMetric) => void;
}) {
  const selectedMetric = metric;
  const research = view === "research";
  const [ignoreResearchBreadth, setIgnoreResearchBreadth] = useState(false);
  const hypothetical = research && ignoreResearchBreadth;
  const rows = useMemo(() => scan?.rows ?? [], [scan]);
  const marketRows = useMemo(() => scan?.marketRows ?? scan?.rows ?? [], [scan]);
  const regime = useMemo(() => marketRegime(marketRows), [marketRows]);
  const confluence = useMemo(() => research ? buildConfluence(scan, scanners, rsiEdge) : new Map<string, Confluence>(), [research, rsiEdge, scan, scanners]);
  const bullConfluence = useMemo(() => research ? liquidConfluence(rows, confluence, "bull") : [], [research, confluence, rows]);
  const bearConfluence = useMemo(() => research ? liquidConfluence(rows, confluence, "bear") : [], [research, confluence, rows]);
  const confluencePartial = !scanners || !rsiEdge;
  const buyIdeas = useMemo(() => rankBuyIdeas(rows, horizon, regime.breadth50), [horizon, regime.breadth50, rows]);
  // A passing value simulates only the breadth gate; measured market context stays unchanged.
  const researchBreadth = hypothetical ? 100 : regime.breadth50;
  const researchBuyIdeas = useMemo(() => research ? rankBuyIdeas(rows, horizon, researchBreadth) : [], [research, rows, horizon, researchBreadth]);
  const nearestIdeas = useMemo(
    () => (!research || researchBuyIdeas.length ? [] : nearestBuyIdeas(rows, horizon, researchBreadth)),
    [research, researchBuyIdeas.length, horizon, researchBreadth, rows],
  );
  // Only F&O stocks can be held short beyond the session, so swing short ideas stay F&O-only.
  const shortIdeas = useMemo(
    () => rankShortIdeas(rows.filter((row) => isFnO(row.symbol)), regime.breadth50),
    [regime.breadth50, rows],
  );
  const sectors = useMemo(() => groupScanBySector(marketRows), [marketRows]);
  const changes = useMemo(() => sessionChanges(scan?.feed ?? []), [scan]);

  const buyReady = buyIdeas.filter((idea) => idea.signal.status.key === "buy-ready").length;
  const shortReady = shortIdeas.filter((idea) => idea.status.key === "short-ready").length;
  const heating = sectors.filter((sector) => sector.avgChange > 0).slice(0, 5);
  const cooling = [...sectors].filter((sector) => sector.avgChange < 0).sort((a, b) => a.avgChange - b.avgChange).slice(0, 5);
  const sectorScale = Math.max(0.5, ...sectors.map((sector) => Math.abs(sector.avgChange)));
  const styles = REGIME_STYLES[regime.key];
  const loading = !scan;
  const session = sessionLabel(scan?.feedDay ?? scan?.sessionDateKey);
  const advancePercent = regime.total ? Math.round((regime.advancing / regime.total) * 100) : null;
  const pulse = useMemo(
    () => marketPulse(regime, sectors, { buyReady, shortReady }),
    [buyReady, regime, sectors, shortReady],
  );
  const cues = useGlobalCues(view === "today");
  const briefIdeas = useMemo<MorningBriefIdea[]>(
    () =>
      buyIdeas.slice(0, 5).map(({ row, signal }) => ({
        symbol: row.symbol,
        name: row.name,
        statusLabel: signal.status.label,
        rating: signal.status.rating,
        // Horizon plans are not shown (see HORIZON_RESEARCH_NOTE).
        entry: null,
        stop: null,
        target: null,
      })),
    [buyIdeas],
  );
  const horizonLabel = `${HORIZONS.find((item) => item.key === horizon)!.label} horizon`;
  const metricRows = useMemo(
    () => view === "metrics" ? dashboardMetricRows(selectedMetric, marketRows, buyIdeas, shortIdeas) : [],
    [view, selectedMetric, marketRows, buyIdeas, shortIdeas],
  );
  const metricCoverage = selectedMetric === "above50" || selectedMetric === "above200"
    ? movingAverageBreadth(marketRows, selectedMetric === "above50" ? "vs50" : "vs200").covered
    : regime.total;
  return (
    <WorkspaceFrame id={view} className="scroll-mt-28">
      {view !== "today" && <WorkspaceHero
        eyebrow={`Daily briefing${session ? ` · ${session}` : ""}`}
        title={view === "metrics" ? METRIC_LABELS[metric] : research ? "Stock research & session changes" : "Scanner directory"}
        icon="today"
        description="Detailed screening context, not investment advice or the curated Today's Picks list."
        action={<button type="button" onClick={() => onNavigate("today")} className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-bold text-foreground">Back to Today</button>}
      />}

      <div className="space-y-4 bg-slate-50/60 p-3 sm:p-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-800">Scan refresh failed; figures may be stale. Retrying automatically.</p>}
        <DataQualityNotice health={scan} updatedAt={scan?.updatedAt} />
        {loading && <p className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">{loadingMessage ?? "Loading the NSE universe scan…"}</p>}

        {view === "today" && (
          <TodayBoard
            rows={marketRows}
            sectors={sectors}
            advancing={regime.advancing}
            declining={regime.declining}
            breakouts={changes.breakouts}
            failed={changes.failed}
            onNavigate={(target) => onNavigate(target)}
          />
        )}

        {view === "metrics" && <section id="dashboard-metric-results" aria-labelledby="dashboard-metric-title" className="overflow-hidden rounded-2xl border border-border bg-surface">
          {(
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
                <label htmlFor="metric-picker" className="text-sm font-bold">Stock list</label>
                <select id="metric-picker" value={metric} onChange={(event) => onOpenMetric(event.target.value as DashboardMetric)} className="min-w-0 max-w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                  {Object.entries(METRIC_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                {metric === "buyReady" && <label className="flex items-center gap-2 text-xs font-bold">Horizon
                  <select value={horizon} onChange={(event) => onHorizonChange(event.target.value as BuyHorizon)} className="rounded-lg border border-border bg-surface px-2 py-2">
                    {HORIZONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>}
              </div>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <h3 id="dashboard-metric-title" tabIndex={-1} className="scroll-mt-40 text-base font-bold text-foreground focus-visible:outline-2 focus-visible:outline-accent">
                    {METRIC_LABELS[selectedMetric]} <span className="font-mono text-accent">({loading ? "—" : metricRows.length})</span>
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Latest scan{session ? ` · ${session}` : ""}.
                    {selectedMetric === "buyReady" || selectedMetric === "shortReady"
                      ? ` Current universe filter${selectedMetric === "buyReady" ? ` · ${horizonLabel}` : " · F&O only"}. Research only, not the curated Today's Picks list.`
                      : ` Whole-market eligible equities, unaffected by the universe filter · ${metricRows.length} of ${metricCoverage} covered stocks.${selectedMetric === "advancing" ? " Unchanged stocks remain in the denominator." : " Includes stocks exactly at the moving average."}`}
                    {" "}Click a symbol for its chart and checks.
                  </p>
                </div>
              </header>
              {loading ? <LoadingState message={loadingMessage} rows={3} /> : metricRows.length === 0 ? (
                <EmptyState title="No matching stocks">No stock in the latest scan matches this metric. This is not a data substitution or a recommendation to trade.</EmptyState>
              ) : (
                <div className="max-h-[480px] overflow-auto">
                  <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-xs">
                    <thead className="sticky top-0 z-20 bg-raised text-[10px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="sticky left-0 z-30 bg-raised px-4 py-3">Stock</th>
                        <th className="px-3 py-3 text-right">Price</th>
                        <th className="px-3 py-3 text-right">Change</th>
                        <th className="px-3 py-3 text-right">vs 50 DMA</th>
                        <th className="px-3 py-3 text-right">vs 200 DMA</th>
                        <th className="px-3 py-3 text-right">RS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metricRows.map((row) => (
                        <tr key={row.key} className="odd:bg-white even:bg-[#fafbfc] hover:bg-[#f0f9f4]">
                          <td className="sticky left-0 z-10 max-w-[240px] border-b border-border bg-inherit px-4 py-3"><Identity symbol={row.symbol} name={row.name} sector={row.sector} /></td>
                          <td className="border-b border-border px-3 py-3 text-right font-mono">{formatPrice(row.price)}</td>
                          <td className={`border-b border-border px-3 py-3 text-right font-mono ${row.changePercent >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{Number.isFinite(row.changePercent) ? formatPercent(row.changePercent) : "—"}</td>
                          <td className="border-b border-border px-3 py-3 text-right font-mono">{row.vs50 != null && Number.isFinite(row.vs50) ? formatPercent(row.vs50) : "—"}</td>
                          <td className="border-b border-border px-3 py-3 text-right font-mono">{row.vs200 != null && Number.isFinite(row.vs200) ? formatPercent(row.vs200) : "—"}</td>
                          <td className="border-b border-border px-3 py-3 text-right font-mono">{row.rs != null && Number.isFinite(row.rs) ? Math.round(row.rs) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>}

        {view === "today" && <>
        <div className="flex flex-wrap gap-3 text-xs">
          <LinkButton label="Stock research" onClick={() => onNavigate("research")} />
          <LinkButton label="Scanner directory" onClick={() => onNavigate("directory")} />
        </div>

        <details className="dashboard-details">
          <summary><span className="dashboard-detail-icon"><NavIcon name="sun" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Morning brief & global cues</span><span className="mt-1 block text-xs font-normal text-muted">Opening context, overseas markets and reference levels</span></span><NavIcon name="chevron-down" /></summary>
          <div className="border-t border-border p-3 sm:p-4">
            <MorningBriefCard
              cues={cues.data}
              error={cues.error}
              sessionLabel={session ?? "latest session"}
              ideas={briefIdeas}
              horizonLabel={horizonLabel}
              ideasLoading={loading}
            />
          </div>
        </details>
        </>}

        {research && <details open className="dashboard-details">
          <summary><span className="dashboard-detail-icon"><NavIcon name="signals" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Stock research & session changes</span><span className="mt-1 block text-xs font-normal text-muted">Long / short ideas, confluence, sectors and breakout activity · not a recommendation list</span></span><NavIcon name="chevron-down" /></summary>
          <div className="space-y-4 border-t border-border p-3 sm:p-4">
        <section aria-label="Research breadth comparison" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
          <label className="flex cursor-pointer items-center gap-2 font-bold">
            <input type="checkbox" checked={ignoreResearchBreadth} onChange={(event) => setIgnoreResearchBreadth(event.target.checked)} className="h-4 w-4 accent-amber-600" />
            Ignore market breadth · long-idea comparison only
          </label>
          <p className="mt-2">Actual above-50-DMA breadth: {regime.breadth50 == null ? "Unavailable" : `${regime.breadth50}%`}. All stock-specific checks, liquidity, risk flags and plan requirements remain in place.</p>
          {!loading && <p className="mt-1 font-bold">With breadth: {buyReady} Buy ready · {buyIdeas.filter((idea) => idea.signal.status.key === "watch").length} Watch.
            {hypothetical && <> Ignoring breadth: {researchBuyIdeas.filter((idea) => idea.signal.status.key === "buy-ready").length} hypothetical Buy ready · {researchBuyIdeas.filter((idea) => idea.signal.status.key === "watch").length} Watch.</>}
            {" "}Counts cover the selected universe and {horizonLabel.toLowerCase()}; the table shows at most {IDEA_LIMIT} qualifying ideas.
          </p>}
          <p className="mt-1">{hypothetical ? "Comparison ON: displayed long-idea statuses are hypothetical, not approvals to trade." : "Comparison OFF: normal breadth rules apply."} Dashboard metrics, shorts, stock drawers, monthly setups, Today&apos;s Picks, emails and paper approvals keep their normal rules. This temporary setting is not saved and resets on reload.</p>
        </section>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title={hypothetical ? "Top long ideas · hypothetical" : "Top long ideas"}
            subtitle={hypothetical ? `Breadth ignored for comparison · ${HORIZON_RESEARCH_NOTE}` : HORIZON_RESEARCH_NOTE}
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {HORIZONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => onHorizonChange(option.key)}
                      className={`px-2.5 py-1 text-[11px] font-black transition ${horizon === option.key ? "bg-[#16894f] text-white" : "text-slate-500 hover:bg-white"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <LinkButton label="Today's Picks" onClick={() => onNavigate("picks")} />
              </div>
            }
          >
            {loading ? <SkeletonRows /> : researchBuyIdeas.length > 0 ? (
              <BuyIdeaTable ideas={researchBuyIdeas.slice(0, IDEA_LIMIT)} horizon={horizon} hypothetical={hypothetical} />
            ) : nearestIdeas.length > 0 ? (
              <>
                <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[11px] leading-4 text-amber-900">
                  <span className="font-black">Nothing qualifies yet.</span> Closest Extended or near-miss setups for this horizon — not entries.
                </p>
                <BuyIdeaTable ideas={nearestIdeas.slice(0, NEAREST_LIMIT)} horizon={horizon} muted hypothetical={hypothetical} />
              </>
            ) : (
              <Empty>
                {hypothetical ? "No liquid stock qualifies even when breadth is ignored. Stock-specific checks still apply." : `No liquid stock is Buy ready or on Watch for this horizon. In a ${regime.label.toLowerCase()} market that is normal — waiting is a position.`}
              </Empty>
            )}
          </Panel>

          <Panel
            title="Top short ideas"
            subtitle="Liquid F&O stocks only (cash shorts must close the same day) · borrow and margin not assessed"
            action={<LinkButton label="Watchlist" onClick={() => onNavigate("watchlist")} />}
          >
            {loading ? <SkeletonRows /> : shortIdeas.length === 0 ? (
              <Empty>No liquid F&amp;O stock currently has enough bearish evidence for a short setup.</Empty>
            ) : (
              <table className="w-full min-w-[480px] table-fixed text-left text-xs">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[27%]" />
                  <col className="w-[14%]" />
                  <col className="w-[7%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Stock</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2 text-right">Price</th>
                    <th className="px-1 py-2 text-right">RS</th>
                    <th className="py-2 pl-1 pr-4 text-right">vs 50</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shortIdeas.slice(0, IDEA_LIMIT).map(({ row, status }) => (
                    <tr key={row.key} className="hover:bg-rose-50/40">
                      <td className="px-4 py-2"><Identity symbol={row.symbol} name={row.name} sector={row.sector} /></td>
                      <td className="px-2 py-2"><ShortSellingStatusBadge status={status} /></td>
                      <td className="px-2 py-2 text-right font-mono">
                        <div className="font-black text-slate-800">₹{formatPrice(row.price)}</div>
                        <div className={row.changePercent >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatPercent(row.changePercent)}</div>
                      </td>
                      <td className="px-1 py-2 text-right font-mono font-black text-rose-700">{row.rs != null ? Math.round(row.rs) : "—"}</td>
                      <td className="py-2 pl-1 pr-4 text-right font-mono text-rose-700">{row.vs50 != null ? formatPercent(row.vs50) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {([
            ["bull", "Bullish confluence", "Liquid stocks where 2+ independent scanner families agree and none are bearish", bullConfluence],
            ["bear", "Bearish confluence", "Liquid stocks flagged bearish by both Oscillators and RSI Edge, with no bullish family", bearConfluence],
          ] as const).map(([direction, title, subtitle, list]) => (
            <Panel key={direction} title={title} subtitle={subtitle} action={<span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-black text-slate-600">{loading ? "—" : list.length}</span>}>
              {loading ? <SkeletonRows /> : list.length === 0 ? (
                <Empty title={direction === "bull" ? "No agreement yet" : "No bearish agreement"}>
                  {confluencePartial
                    ? "Trade Trigger and RSI Edge results are still loading, so confluence is partial."
                    : direction === "bull"
                      ? "No liquid stock is flagged bullish by two or more scanner families."
                      : "No liquid stock is flagged bearish by both Oscillators and RSI Edge."}
                </Empty>
              ) : (
                <table className="w-full min-w-[480px] table-fixed text-left text-xs">
                  <colgroup>
                    <col className="w-[36%]" />
                    <col className="w-[18%]" />
                    <col className="w-[46%]" />
                  </colgroup>
                  <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Stock</th>
                      <th className="px-2 py-2">Families</th>
                      <th className="px-4 py-2">Agreeing scanners</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {list.slice(0, IDEA_LIMIT).map(({ row, confluence }) => (
                      <tr key={row.key} className={direction === "bull" ? "hover:bg-emerald-50/40" : "hover:bg-rose-50/40"}>
                        <td className="px-4 py-2"><Identity symbol={row.symbol} name={row.name} sector={row.sector} /></td>
                        <td className="px-2 py-2">
                          {direction === "bull" ? <ConfluenceBadge confluence={confluence} compact /> : (
                            <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700">{confluence.bear.length}/2 bearish</span>
                          )}
                          <div className="mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-400"><RvolPill rvol={row.rvol} /> RVOL</div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {confluence.signals.filter((signal) => signal.tone === direction).map((signal) => (
                              <span
                                key={`${signal.family}-${signal.label}`}
                                title={`${signal.family}${signal.detail ? ` · ${signal.detail}` : ""}`}
                                className={`truncate rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${direction === "bull" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}
                              >
                                {signal.label}
                              </span>
                            ))}
                            {direction === "bull" && <RiskFlagChips flags={row.riskFlags?.filter((flag) => flag.severity === "high")} max={1} />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title="Sector heat"
            subtitle="Average 1-day move per NSE sector (3+ eligible names)"
            action={<LinkButton label="All sectors" onClick={() => onNavigate("sectors")} />}
          >
            {loading ? <SkeletonRows rows={6} /> : sectors.length === 0 ? <Empty>Sector data is unavailable.</Empty> : (
              <div className="grid grid-cols-2 divide-x divide-slate-100">
                {([["Heating up", heating, "bg-emerald-500", "text-emerald-700"], ["Cooling off", cooling, "bg-rose-500", "text-rose-700"]] as const).map(([label, list, bar, text]) => (
                  <div key={label} className="p-4">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
                    {list.length === 0 ? <p className="text-xs text-slate-400">None today.</p> : (
                      <ul className="space-y-2.5">
                        {list.map((sector) => (
                          <li key={sector.sector}>
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate font-bold text-slate-800">{sector.sector}</span>
                              <span className={`font-mono font-black ${text}`}>{formatPercent(sector.avgChange)}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className={`h-full rounded-full ${bar}`} style={{ width: `${(Math.abs(sector.avgChange) / sectorScale) * 100}%` }} />
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-400">{sector.advancing}/{sector.total} advancing</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="What changed"
            subtitle={`Base breakouts and failures on the latest session${session ? ` (${session})` : ""}`}
            action={<LinkButton label="Breakout record" onClick={() => onNavigate("breakouts")} />}
          >
            {loading ? <SkeletonRows rows={6} /> : (
              <div className="grid grid-cols-2 divide-x divide-slate-100">
                <div>
                  <div className="flex items-center justify-between px-4 pt-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                    <span>New breakouts</span><span className="font-mono text-emerald-700">{changes.breakouts.length}</span>
                  </div>
                  <FeedList events={changes.breakouts} tone="up" empty="No new base breakouts this session." />
                </div>
                <div>
                  <div className="flex items-center justify-between px-4 pt-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                    <span>Failed breakouts</span><span className="font-mono text-rose-700">{changes.failed.length}</span>
                  </div>
                  <FeedList events={changes.failed} tone="down" empty="No breakout failed this session." />
                  {changes.exits.length > 0 && (
                    <>
                      <div className="flex items-center justify-between border-t border-slate-100 px-4 pt-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                        <span>Played out</span><span className="font-mono text-slate-500">{changes.exits.length}</span>
                      </div>
                      <FeedList events={changes.exits} tone="muted" empty="" />
                    </>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </div>
          </div>
        </details>}

        {view === "directory" && <details open className="dashboard-details">
          <summary><span className="dashboard-detail-icon"><NavIcon name="triggers" /></span><span className="min-w-0 flex-1"><span className="block font-bold">Find a scanner</span><span className="mt-1 block text-xs font-normal text-muted">Browse setup rules and open the right tool</span></span><NavIcon name="chevron-down" /></summary>
          <div className="border-t border-border p-3 sm:p-4">
            <ScannerDirectory scan={scan} scanners={scanners} rsiEdge={rsiEdge} onOpen={onNavigate} />
          </div>
        </details>}

        <p className="text-[11px] leading-5 text-slate-400">
          Ratings are the share of required technical checks passing, not a probability of profit. Click any symbol for its chart, plan and checks.
        </p>
      </div>
    </WorkspaceFrame>
  );
}
