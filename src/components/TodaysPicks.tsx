"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPercent, formatPrice } from "@/lib/format";
import type { ScannerMode, ScannerPayload } from "@/lib/screen/chartinkScans";
import { HEALTHY_BREADTH_PERCENT } from "@/lib/screen/breadth";
import { todaysPicks, TODAYS_PICKS_LIMIT, WATCH_RULES, type TodaysPick } from "@/lib/screen/todaysPicks";
import { istDateKey } from "@/lib/market/marketHours";
import { staleLabel, useLiveQuotes } from "@/hooks/useLiveQuotes";
import { SCANNER_KEY_BY_LABEL, scannerBacktestSentence, scannerBacktestStat } from "@/lib/screen/scannerBacktest";
import { StockSymbolButton } from "./StockDetailContext";
import { ListChangeNote, NewTag } from "./ListChangeNote";
import { WeeklyTop5 } from "./WeeklyTop5";
import { useListChanges } from "@/hooks/useListChanges";
import type { ListChanges } from "@/lib/listChanges";
import { TradeStatusLegend, TradeStatusPill } from "./TradeStatusBadge";
import { EmptyState, LoadingState, WorkspaceFrame, WorkspaceHero } from "./WorkspaceShell";

const WIDE_RISK_PERCENT = 6;

const MODES: { key: ScannerMode; label: string; detail: string }[] = [
  { key: "completed", label: "Last close", detail: "Same list as the 09:00 pre-open email" },
  { key: "live", label: "Live session", detail: "Same list as the hourly email" },
];

/** The honest backtest sentence from the email footer, when the server has one. */
function useBacktestLine(): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/alerts/email", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { preview?: { footer?: string[] } | null } | null) => {
        const found = body?.preview?.footer?.find((text) => text.startsWith("Backtest"));
        if (alive && found) setLine(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return line;
}

export function TodaysPicks({
  data,
  error,
  loadingMessage,
  mode,
  onModeChange,
  onPaperApprove,
  paperSymbols,
  paperReady,
}: {
  data: ScannerPayload | null;
  error: boolean;
  loadingMessage: string | null;
  mode: ScannerMode;
  onModeChange: (mode: ScannerMode) => void;
  onPaperApprove: (pick: TodaysPick, signalDate: string) => void;
  paperSymbols: ReadonlySet<string>;
  paperReady: boolean;
}) {
  const result = useMemo(() => (data ? todaysPicks(data) : null), [data]);
  const paperSignalDate = mode === "completed" && data?.mode === "completed" && data.candleTimestamp != null
    ? istDateKey(data.candleTimestamp) : null;
  const backtest = useBacktestLine();
  const buyChanges = useListChanges(`picks-buy-${mode}`, result ? result.picks.map((pick) => pick.symbol) : null);
  const watchChanges = useListChanges(`picks-watch-${mode}`, result ? result.watch.map((pick) => pick.symbol) : null);
  const activeMode = MODES.find((item) => item.key === mode)!;

  return (
    <WorkspaceFrame id="picks" className="scroll-mt-28">
      <WorkspaceHero
        eyebrow="One list to act on"
        title="Today's Picks"
        icon="picks"
        description={`Market gate first, then only Buy ready stocks, ranked by relative strength. Top ${TODAYS_PICKS_LIMIT}. ${activeMode.detail}.`}
        action={
          <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50" role="group" aria-label="Scan mode">
            {MODES.map((item) => (
              <button
                key={item.key}
                type="button"
                title={item.detail}
                aria-pressed={mode === item.key}
                onClick={() => onModeChange(item.key)}
                className={`px-4 py-2 text-xs font-black transition ${mode === item.key ? "bg-[#16894f] text-white" : "text-slate-500 hover:bg-white"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="border-b border-slate-100 bg-slate-50/60 p-5"><WeeklyTop5 /></div>

      {!result ? (
        error
          ? <EmptyState tone="error" title="Scanner data unavailable">The scanners could not be loaded. Try again in a minute.</EmptyState>
          : <LoadingState message={loadingMessage ?? "Running the scanners…"} />
      ) : (
        <div className="space-y-5 bg-slate-50/60 p-5">

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-black text-slate-900">Buy ready</h2>
                <p className="text-xs text-slate-500">Every check passes, market breadth included. Enter only above the trigger. Paper approvals use confirmed last-close setups only.</p>
              </div>
              <span className="font-mono text-xs font-black text-slate-500">
                {result.picks.length} of {result.buyReadyTotal}
              </span>
            </header>
            <ListChangeNote changes={buyChanges} />
            {result.picks.length ? (
              <PicksTable
                picks={result.picks}
                changes={buyChanges}
                onPaperApprove={paperSignalDate ? (pick) => onPaperApprove(pick, paperSignalDate) : undefined}
                paperSymbols={paperSymbols}
                paperReady={paperReady}
              />
            ) : (
              <div className="px-5 py-6 text-sm text-slate-600">
                <b className="text-slate-900">No buys today.</b>{" "}
                {result.healthy
                  ? "Breadth is healthy, but no stock passes every check. Not buying is the plan."
                  : "The market gate is closed, so no stock can be Buy ready. Not buying is the plan."}
              </div>
            )}
          </section>

          {result.watch.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-sky-100 bg-sky-50/60 px-5 py-4">
                <div>
                  <h2 className="text-base font-black text-slate-900">Strong stocks waiting for the market: not a buy</h2>
                  <p className="text-xs text-slate-600">
                    {result.healthy
                      ? "Every stock check passes but a risk warning is open. Wait for it to clear."
                      : `Watch stocks from every scanner that are also liquid (₹${WATCH_RULES.minTurnoverCr} Cr+), PA ${WATCH_RULES.minPa}+, RS ${WATCH_RULES.minRs}+ with a stop within ${WATCH_RULES.maxRiskPercent}%; at most ${WATCH_RULES.maxPerSector} per sector. Buying this list on weak-breadth days lost −0.14R a trade in our 2022–26 backtest, so the emails show names and triggers only.`}
                  </p>
                </div>
                <span className="font-mono text-xs font-black text-sky-700">
                  {result.watch.length} {result.watch.length === 1 ? "stock" : "stocks"} · ranked by RS
                </span>
              </header>
              <ListChangeNote changes={watchChanges} />
              <PicksTable picks={result.watch} changes={watchChanges} />
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs leading-6 text-slate-600 shadow-sm">
            <h2 className="mb-1 text-sm font-black text-slate-900">Rules</h2>
            <ol className="list-decimal space-y-0.5 pl-5">
              <li>Buy only when market breadth is at least {HEALTHY_BREADTH_PERCENT}% (share of liquid stocks above their 50-day average).</li>
              <li>Buy only Buy ready stocks. Sources: Relative Leader, 4-Day Fall, All-Time High, RPCI and Oscillator — the same as the customer emails. Every scanner source here has a positive average R in its own backtest.</li>
              <li>Highest RS first; take at most {TODAYS_PICKS_LIMIT}. Stocks found by more than one source are listed once. PA (chart quality) is shown for context only: ranking by PA did not beat RS in the backtest.</li>
              <li>Enter above the trigger and inside the buy zone; skip if it opens above the zone. Risk about 1% of capital per trade.</li>
              <li>Sell half at T1 and move the stop to entry; exit the rest at T2 or the stop.</li>
            </ol>
            {backtest && (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                {backtest}{" "}
                <span className="text-slate-400">This blends all sources — see each source&rsquo;s own backtest in the Source column below.</span>
              </p>
            )}
            {result.quiet.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-400">No Buy ready or Watch stock from: {result.quiet.join(", ")}.</p>
            )}
            <div className="mt-3 border-t border-slate-100 pt-3">
              <TradeStatusLegend keys={["buy-ready", "watch", "extended", "avoid"]} />
            </div>
          </section>
        </div>
      )}
    </WorkspaceFrame>
  );
}

const signedR = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`;

/**
 * Each source's own backtest, not the blended average: "Range Breakout" and
 * "4-Day Fall & Reversal" can carry opposite verdicts even on the same day's
 * pick list, and that difference is the point — a stock with two sources
 * behind it should show two numbers, not one.
 */
function SourceEdgeBadges({ sources }: { sources: string[] }) {
  const stats = sources
    .map((label) => SCANNER_KEY_BY_LABEL[label])
    .filter((key): key is NonNullable<typeof key> => key != null)
    .map((key) => scannerBacktestStat(key))
    .filter((stat): stat is NonNullable<typeof stat> => stat != null);
  if (!stats.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {stats.map((stat) => (
        <span
          key={stat.key}
          title={scannerBacktestSentence(stat)}
          className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${
            stat.edge === "proven" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {signedR(stat.avgR)} · {stat.trades}t
        </span>
      ))}
    </div>
  );
}

function PicksTable({
  picks,
  changes,
  onPaperApprove,
  paperSymbols,
  paperReady = true,
}: {
  picks: TodaysPick[];
  changes?: ListChanges;
  onPaperApprove?: (pick: TodaysPick) => void;
  paperSymbols?: ReadonlySet<string>;
  paperReady?: boolean;
}) {
  const { quotes, live } = useLiveQuotes(picks.map((pick) => pick.symbol));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.1em] text-slate-400">
          <tr>
            <th className="px-5 py-2.5">#</th>
            <th className="px-3 py-2.5">Stock</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Source</th>
            <th className="px-3 py-2.5 text-right">RS</th>
            <th className="px-3 py-2.5 text-right" title="Price Action rating: chart quality, shown for context. Ranking stays on RS.">PA</th>
            <th className="px-3 py-2.5 text-right" title="Latest market price, refreshed every few seconds while the market is open. The plan below is built on the last completed close.">CMP · live</th>
            <th className="px-3 py-2.5 text-right">Buy above</th>
            <th className="px-3 py-2.5 text-right">Stop loss</th>
            <th className="px-3 py-2.5 text-right">T1</th>
            <th className="px-5 py-2.5 text-right">T2</th>
            {onPaperApprove && <th className="px-3 py-2.5">Paper only</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {picks.map((pick, index) => {
            const wide = pick.plan.riskPercent > WIDE_RISK_PERCENT;
            return (
              <tr key={pick.symbol} className="hover:bg-slate-50/70">
                <td className="px-5 py-3 font-mono text-xs font-black text-slate-400">{index + 1}</td>
                <td className="px-3 py-3">
                  <StockSymbolButton symbol={pick.symbol} className="font-black text-slate-900">{pick.symbol}</StockSymbolButton>
                  {changes?.added.has(pick.symbol) && <NewTag />}
                  <div className="max-w-[220px] truncate text-xs text-slate-500">{pick.name}</div>
                </td>
                <td className="px-3 py-3"><TradeStatusPill status={pick.status} /></td>
                <td className="px-3 py-3 text-xs text-slate-600">
                  {pick.sources.join(" + ")}
                  <SourceEdgeBadges sources={pick.sources} />
                  {pick.note && <div className="max-w-[220px] truncate text-[11px] text-slate-400" title={pick.note}>{pick.note}</div>}
                </td>
                <td className="px-3 py-3 text-right font-mono font-black text-emerald-700">{pick.rs != null ? Math.round(pick.rs) : "—"}</td>
                <td className="px-3 py-3 text-right font-mono">
                  {pick.pa ? (
                    <>
                      <div className="font-black text-slate-800">{pick.pa.score}</div>
                      <div className="text-[11px] font-bold text-slate-400">{pick.pa.grade}</div>
                    </>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  {(() => {
                    const quote = quotes.get(pick.symbol);
                    const cmp = quote?.ltp ?? pick.close;
                    const change = quote ? quote.changePercent : pick.changePercent;
                    const old = staleLabel(quote, live);
                    const state = !quote ? null
                      : cmp > pick.plan.buyZoneHigh ? { text: "Above skip level: do not chase", tone: "text-rose-700" }
                        : cmp >= pick.plan.entry ? { text: "Trigger reached", tone: "text-emerald-700" }
                          : { text: `${(((pick.plan.entry / cmp) - 1) * 100).toFixed(1)}% below trigger`, tone: "text-slate-500" };
                    return (
                      <>
                        <div className="font-bold text-slate-800">₹{formatPrice(cmp)}{quote && <span className="ml-1 align-middle text-[10.5px] font-black text-emerald-600">{old ? "" : "●"}</span>}</div>
                        {change != null && <div className={`text-[11px] ${change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatPercent(change)}{quote ? " today" : ""}</div>}
                        {state && <div className={`text-[11px] font-bold ${state.tone}`}>{state.text}</div>}
                        {quote && <div className="text-[11px] text-slate-400">close ₹{formatPrice(pick.close)}</div>}
                        {old && <div className="text-[11px] font-bold text-amber-600">{old}</div>}
                      </>
                    );
                  })()}
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  <div className="font-black text-[#1f5fbf]">₹{formatPrice(pick.plan.entry)}</div>
                  <div className="text-[11px] text-slate-400">skip &gt; ₹{formatPrice(pick.plan.buyZoneHigh)}</div>
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  <div className="font-black text-rose-700">₹{formatPrice(pick.plan.stop)}</div>
                  <div className={`text-[11px] ${wide ? "font-bold text-amber-700" : "text-slate-400"}`} title={wide ? "Wide stop: use a smaller position" : undefined}>
                    −{pick.plan.riskPercent.toFixed(1)}%{wide ? " ⚠" : ""}
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-emerald-700">₹{formatPrice(pick.plan.target1)}</td>
                <td className="px-5 py-3 text-right font-mono font-bold text-emerald-700">₹{formatPrice(pick.plan.target2)}</td>
                {onPaperApprove && (
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={!paperReady || paperSymbols?.has(pick.symbol)}
                      onClick={() => onPaperApprove(pick)}
                      className="whitespace-nowrap rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      {paperSymbols?.has(pick.symbol) ? "Already tracking" : "Approve paper"}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
