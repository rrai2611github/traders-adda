"use client";

import { StockSymbolButton } from "./StockDetailContext";
import { LivePrice } from "./LivePrice";
import { EmptyState, LoadingState } from "./WorkspaceShell";
import { useEffect, useState } from "react";
import type { ScanRow, ScreenScan } from "@/hooks/useScreenScan";
import { MOMENTUM_RULES, type MomentumSetup } from "@/lib/screen/oscillators";
import {
  OSCILLATOR_COUNT,
  OSCILLATOR_DEFS,
  SCORE_BANDS,
  SCORE_JUMP_SESSIONS,
  SCORE_SMOOTH_SESSIONS,
  type OscillatorScore,
  type ScoreVerdict,
} from "@/lib/screen/oscillatorScore";
import { rpciFreshness } from "@/lib/screen/rpciFreshness";
import { LEVEL_RULES, levelStatus, type LevelStatus, type TradeLevels } from "@/lib/screen/tradeLevels";
import { formatPercent, toneClass } from "@/lib/format";
import { HEALTHY_BREADTH_PERCENT, movingAverageBreadth } from "@/lib/screen/breadth";
import { currentScanBuyingStatus } from "@/lib/screen/buyingStatus";
import { BuyingStatusBadge } from "./BuyingStatusBadge";

const priceLabel = (price: number) => `₹${price.toLocaleString("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;
const dateLabel = (timestamp: number) => new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
}).format(timestamp);

type Filter = "all" | MomentumSetup | "top";
type MinScore = 0 | 8 | 11;
type ScoredRow = ScanRow & { oscillatorScore: OscillatorScore };

interface MomentumOscillatorSectionProps {
  scan: ScreenScan | null;
  error: boolean;
  loadingMessage?: string | null;
  watchlistSymbols: string[];
  onAddToWatchlist: (symbol: string) => void;
}

const SETUP_LABEL: Record<MomentumSetup, string> = {
  continuation: "Momentum continuation",
  pullback: "Pullback turn",
};

const VERDICT: Record<ScoreVerdict, { label: string; className: string }> = {
  strong: { label: "Strong vote", className: "bg-[#16894f] text-white" },
  bullish: { label: "Bullish vote", className: "bg-[#e7f6ee] text-[#16894f]" },
  neutral: { label: "Neutral vote", className: "bg-[#f3f4f6] text-foreground" },
  bearish: { label: "Bearish vote", className: "bg-[#fdecec] text-down" },
};

/** Fresh = a new oscillator cross inside a trend setup, or the score just rose into the strong band. */
const isFresh = (row: ScoredRow) => Boolean(row.momentum?.fresh || row.oscillatorScore.freshJump);

/** A buy-watch needs both: a trend-aligned oscillator setup and a strong vote. */
const isBuyWatch = (row: ScanRow) =>
  row.momentum != null && row.oscillatorScore != null && row.oscillatorScore.score >= SCORE_BANDS.strong;

function ScoreCell({ score }: { score: OscillatorScore }) {
  const verdict = VERDICT[score.verdict];
  return (
    <details className="min-w-[150px]">
      <summary className="cursor-pointer list-none">
        <span className="font-mono text-base font-black">{score.score.toFixed(1)}</span>
        <span className="font-mono text-xs text-muted">/{OSCILLATOR_COUNT}</span>
        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${verdict.className}`}>{verdict.label}</span>
        <span className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-[#f3f4f6]" aria-hidden>
          <span className="bg-[#16894f]" style={{ width: `${(score.bullish / OSCILLATOR_COUNT) * 100}%` }} />
          <span className="bg-[#d1d5db]" style={{ width: `${(score.neutral / OSCILLATOR_COUNT) * 100}%` }} />
          <span className="bg-[#dc2626]" style={{ width: `${(score.bearish / OSCILLATOR_COUNT) * 100}%` }} />
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">
          {SCORE_SMOOTH_SESSIONS}-day avg of {score.dailyScores.join(", ")}
        </span>
        <span className="block text-[11px] text-muted">
          Today {score.todayScore}: {score.bullish} bull · {score.neutral} neutral · {score.bearish} bear
        </span>
      </summary>
      <ul className="mt-2 w-[300px] space-y-1 rounded-xl border border-border bg-[#f5f8fd] p-3 text-xs">
        {OSCILLATOR_DEFS.map((def, i) => {
          const vote = score.votes[i];
          return (
            <li key={def.key} title={def.rule} className="flex items-center justify-between gap-2">
              <span>{def.label}</span>
              <span className="whitespace-nowrap font-mono">
                {score.values[i].toFixed(2)}{" "}
                <span className={vote === 1 ? "font-bold text-[#16894f]" : vote === -1 ? "font-bold text-down" : "text-muted"}>
                  {vote === 1 ? "▲ Bull" : vote === -1 ? "▼ Bear" : "● Neutral"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const STATUS: Record<LevelStatus, { label: string; className: string }> = {
  wait: { label: "Price below trigger", className: "bg-[#e8effb] text-[#1f5fbf]" },
  triggered: { label: "In buy zone", className: "bg-[#16894f] text-white" },
  extended: { label: "Price above buy zone", className: "bg-amber-100 text-amber-800" },
  stopped: { label: "Price below stop", className: "bg-[#fdecec] text-down" },
};

const STOP_BASIS: Record<TradeLevels["stopBasis"], string> = {
  swing: `just below the ${LEVEL_RULES.swingSessions}-session swing low`,
  "atr-cap": `capped at ${LEVEL_RULES.maxStopAtr}× ATR (swing low too far)`,
  "atr-floor": `widened to ${LEVEL_RULES.minStopAtr}× ATR (swing low too close)`,
};

const WIDE_RISK_PERCENT = 8;

function LevelsCell({ levels, price, candle, freshness }: {
  levels: TradeLevels;
  price: number;
  candle: string;
  freshness: string;
}) {
  const status = STATUS[levelStatus(levels, price)];
  const pct = (v: number) => formatPercent(((v - levels.entry) / levels.entry) * 100);
  return (
    <div className="min-w-[250px] whitespace-nowrap font-mono text-xs leading-5">
      <span className={`mb-1 inline-block rounded-full px-2 py-0.5 font-sans text-[11px] font-bold ${status.className}`}>{status.label}</span>
      <div className="flex justify-between gap-3"><span className="font-sans text-muted">Buy above</span><b>{priceLabel(levels.entry)}</b></div>
      <div className="flex justify-between gap-3"><span className="font-sans text-muted">Buy zone to</span><span>{priceLabel(levels.buyZoneHigh)}</span></div>
      <div className="flex justify-between gap-3 text-down"><span className="font-sans">Stop loss</span><b>{priceLabel(levels.stop)} <span className="font-normal">({pct(levels.stop)})</span></b></div>
      <div className="flex justify-between gap-3 text-[#16894f]"><span className="font-sans">Target 1 · {LEVEL_RULES.target1R}R</span><b>{priceLabel(levels.target1)} <span className="font-normal">({pct(levels.target1)})</span></b></div>
      <div className="flex justify-between gap-3 text-[#16894f]"><span className="font-sans">Target 2 · {LEVEL_RULES.target2R}R</span><b>{priceLabel(levels.target2)} <span className="font-normal">({pct(levels.target2)})</span></b></div>
      <div className="mt-1.5 border-t border-dashed border-border pt-1">
        <span className="font-sans text-[11px] font-black text-[#6b4fbf]">High win-rate plan</span>
        <div className="flex justify-between gap-3 text-[#16894f]"><span className="font-sans">Quick target · +{LEVEL_RULES.highWinTargetR}R</span><b>{priceLabel(levels.highWinTarget)} <span className="font-normal">({pct(levels.highWinTarget)})</span></b></div>
        <div className="flex justify-between gap-3 text-down"><span className="font-sans">Wide SL · −{LEVEL_RULES.highWinStopR}R</span><b>{priceLabel(levels.highWinStop)} <span className="font-normal">({pct(levels.highWinStop)})</span></b></div>
      </div>
      {levels.riskPercent > WIDE_RISK_PERCENT && (
        <p className="mt-1 whitespace-normal font-sans text-[11px] font-bold text-amber-700">Wide SL ({levels.riskPercent.toFixed(1)}%) — size down or wait for a tighter base</p>
      )}
      <details className="mt-1 font-sans">
        <summary className="cursor-pointer font-bold text-[#1f5fbf]">Why these levels</summary>
        <div className="mt-1 w-[260px] space-y-1 whitespace-normal rounded-xl border border-border bg-[#f5f8fd] p-2.5 text-foreground">
          <p className="font-black">Illustrative only · not an order or advice</p>
          <p>Buy: above the last completed day&apos;s high; skip if price runs past +{LEVEL_RULES.buyZoneAtr}× ATR.</p>
          <p>SL: {STOP_BASIS[levels.stopBasis]} (swing low {priceLabel(levels.swingLow)}, ATR(14) {priceLabel(levels.atr)}).</p>
          <p>Risk {levels.riskPercent.toFixed(1)}% per share. Targets are {LEVEL_RULES.target1R}× and {LEVEL_RULES.target2R}× that risk; after T1, trail the SL to entry.</p>
          <p>High win-rate plan: book the whole position at +{LEVEL_RULES.highWinTargetR}R, SL {LEVEL_RULES.highWinStopR}R below entry ({levels.highWinStopPercent.toFixed(1)}%), exit at the close after 30 sessions. Wins often but small: one SL costs about four wins, so size for the wider SL.</p>
          {levels.resistance != null && (
            <p className="font-bold text-amber-700">52-week high {priceLabel(levels.resistance)} sits before T2 — expect supply there.</p>
          )}
          <p className="text-muted">Candle {candle} · {freshness}. Excludes quantity, slippage, fees and gaps through the SL.</p>
        </div>
      </details>
    </div>
  );
}

export function MomentumOscillatorSection({
  scan,
  error,
  loadingMessage,
  watchlistSymbols,
  onAddToWatchlist,
}: MomentumOscillatorSectionProps) {
  const [now, setNow] = useState(0);
  const [filter, setFilter] = useState<Filter>("top");
  const [freshOnly, setFreshOnly] = useState(true);
  const [minScore, setMinScore] = useState<MinScore>(SCORE_BANDS.strong);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, []);

  const scored = (scan?.rows ?? []).filter((row): row is ScoredRow => row.oscillatorScore != null);
  const setups = scored.filter((row) => row.momentum != null);
  const top = scored.filter((row) => row.oscillatorScore.score >= SCORE_BANDS.strong);
  const count = (setup: MomentumSetup) => setups.filter((row) => row.momentum!.setup === setup).length;
  const buyWatch = setups.filter(isBuyWatch).length;
  const breadth = movingAverageBreadth(scan?.marketRows ?? scan?.rows ?? [], "vs50");
  const healthy = breadth.percent != null && breadth.percent >= HEALTHY_BREADTH_PERCENT;
  const rows = (filter === "top" ? top : setups)
    .filter((row) => filter === "all" || filter === "top" || row.momentum!.setup === filter)
    .filter((row) => !freshOnly || isFresh(row))
    .filter((row) => row.oscillatorScore.score >= minScore)
    .sort((a, b) => b.oscillatorScore.score - a.oscillatorScore.score ||
      Number(isFresh(b)) - Number(isFresh(a)) || (b.rs ?? 0) - (a.rs ?? 0));
  const tab = (key: Filter, label: string, n: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === key ? "border-[#1f5fbf] bg-[#1f5fbf] text-white" : "border-border bg-white text-foreground"}`}
    >
      {label} · {n}
    </button>
  );
  const r = MOMENTUM_RULES;
  const fixed = (v: number | undefined, digits = 0) => (v == null ? "—" : v.toFixed(digits));

  return (
    <section aria-labelledby="momentum-title" className="mt-7 rounded-2xl border border-[#cfdcf3] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-[#1f5fbf]">Oscillator scan</p>
          <h2 id="momentum-title" className="mt-1 text-2xl font-black tracking-tight">Momentum oscillator</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Strong, uptrending stocks where the oscillators agree: either momentum is building (RSI, MACD) or a
            dip inside the trend is turning up (stochastic). Oscillators are timing tools, so every stock must
            first be in an uptrend with a trending ADX.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="rounded-full bg-[#e8effb] px-3 py-1.5 text-sm font-black text-[#1f5fbf]">
            {scan ? `${setups.length} setups of ${scan.eligible} eligible` : error ? "Unavailable" : "Loading"}
          </span>
          {scan && (
            healthy ? (
              <span className="rounded-full bg-[#16894f] px-3 py-1 text-xs font-black text-white">
                Buy-watch (setup + score ≥{SCORE_BANDS.strong}): {buyWatch}
              </span>
            ) : (
              <span className="rounded-full bg-[#fdecec] px-3 py-1 text-xs font-black text-down">
                Buy-watch paused · market weak ({buyWatch} would qualify)
              </span>
            )
          )}
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">
        Trend filter (both setups): RS ≥{r.minRs}, above the 50- and 200-day averages, ADX(14) ≥{r.minAdx} with
        +DI above −DI, weekly RSI(14) ≥{r.minWeeklyRsi}, close no more than {r.maxAboveEma21Percent}% above the 21-day EMA.
        {" "}<b>Momentum continuation:</b> daily RSI(14) {r.continuationRsi[0]}–{r.continuationRsi[1]}, MACD(12,26,9) above
        its signal line and above zero, stochastic %K below {r.maxStochK}.
        {" "}<b>Pullback turn:</b> stochastic(14,3,3) %K crossed above %D from below {r.pullbackStochBelow} within
        the last {r.signalSessions} sessions, RSI {r.pullbackRsi[0]}–{r.pullbackRsi[1]}.
        {" "}<b>Fresh</b> = the MACD or stochastic cross happened within the last {r.signalSessions} completed sessions, or the {SCORE_SMOOTH_SESSIONS}-day average oscillator score rose to ≥{SCORE_BANDS.strong} within the last {SCORE_JUMP_SESSIONS} sessions and held there.
        Completed daily candles only; existing liquidity floor applies.
      </p>
      <p className="mt-2 text-xs leading-5 text-muted">
        <b>Oscillator score (0–{OSCILLATOR_COUNT}):</b> {OSCILLATOR_COUNT} oscillators each vote bullish, neutral or bearish on the
        last completed candle; the daily score is the number of bullish votes, and the score shown is its {SCORE_SMOOTH_SESSIONS}-day average so a one-day spike cannot make a stock strong. ≥{SCORE_BANDS.strong} strong bullish,
        {" "}{SCORE_BANDS.bullish}–{SCORE_BANDS.strong - 1} bullish, {SCORE_BANDS.neutral}–{SCORE_BANDS.bullish - 1} neutral,
        below {SCORE_BANDS.neutral} bearish. Click a score for the vote of each oscillator. Our own transparent
        model in the style of broker oscillator ratings, not Motilal Oswal&apos;s formula. A high score alone is not a
        buy call — use it with a trend setup (Buy-watch).
      </p>
      <p className="mt-2 text-xs leading-5 text-muted">
        <b>Buy · SL · Targets:</b> buy above the last completed day&apos;s high, and don&apos;t chase more than
        {" "}{LEVEL_RULES.buyZoneAtr}× ATR(14) above it. SL just below the {LEVEL_RULES.swingSessions}-session swing low, kept between
        {" "}{LEVEL_RULES.minStopAtr}× and {LEVEL_RULES.maxStopAtr}× ATR from entry. Targets at {LEVEL_RULES.target1R}R and {LEVEL_RULES.target2R}R
        (R = entry − SL); trail the SL to entry after T1. <b>High win-rate plan:</b> book everything at +{LEVEL_RULES.highWinTargetR}R with the SL at −{LEVEL_RULES.highWinStopR}R — more frequent, smaller wins and bigger losses. Status compares the live price with the plan. Rule-based levels,
        not advice — size positions so a hit SL costs a fixed small share of capital.
      </p>
      {scan && breadth.percent != null && (
        <div
          role="status"
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${healthy ? "border-[#bfe3cf] bg-[#effaf3] text-[#0f6b3c]" : "border-[#f5c2c2] bg-[#fdf2f2] text-down"}`}
        >
          <b>Market breadth {breadth.percent}%</b> — {breadth.above} of {breadth.covered} liquid stocks are above their 50-day average.
          {" "}{healthy
            ? `At or above ${HEALTHY_BREADTH_PERCENT}%: Buy-watch is active.`
            : `Below ${HEALTHY_BREADTH_PERCENT}%: Buy-watch is paused, avoid new buys.`}
          <span className="mt-1 block text-xs text-muted">
            Backtest Oct 2024 – Sep 2026, 1,934 liquid NSE stocks, 0.25% costs: with breadth below {HEALTHY_BREADTH_PERCENT}% every filter lost
            money (Buy-watch 30% win, −0.32R per trade). Above it, Buy-watch won 46% at +0.08R with the 2R/3R plan, or 79% at
            +0.07R with the high win-rate plan. Past results only, not a guarantee.
          </span>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tab("all", "All setups", setups.length)}
        {tab("continuation", SETUP_LABEL.continuation, count("continuation"))}
        {tab("pullback", SETUP_LABEL.pullback, count("pullback"))}
        {tab("top", `Score ≥${SCORE_BANDS.strong} · all stocks`, top.length)}
        <label className="ml-2 inline-flex items-center gap-1.5 text-xs font-bold text-foreground">
          Min score
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value) as MinScore)}
            className="rounded-lg border border-border bg-white px-2 py-1 text-xs"
          >
            <option value={0}>Any</option>
            <option value={SCORE_BANDS.bullish}>≥{SCORE_BANDS.bullish}</option>
            <option value={SCORE_BANDS.strong}>≥{SCORE_BANDS.strong}</option>
          </select>
        </label>
        <label className="ml-2 inline-flex items-center gap-1.5 text-xs font-bold text-foreground">
          <input type="checkbox" checked={freshOnly} onChange={(e) => setFreshOnly(e.target.checked)} />
          Fresh signals only
        </label>
      </div>
      {error && scan && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-800">Scan refresh failed; results may be stale.</p>}
      {!scan && error ? (
        <EmptyState tone="error" title="Oscillator results unavailable">The scan will retry automatically.</EmptyState>
      ) : !scan ? (
        <LoadingState message={loadingMessage ?? "Loading oscillator results…"} />
      ) : rows.length === 0 ? (
        <EmptyState title="No oscillator setups">No stocks currently meet these oscillator rules.</EmptyState>
      ) : (
        <div className="mt-4 max-h-[620px] overflow-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-white text-xs font-black uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Stock</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Price</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Buying status / rating</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Osc score</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Setup</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Buy · SL · Targets</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">RSI D / W</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">MACD hist</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Stoch %K / %D</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">ADX (+DI/−DI)</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">vs 21 EMA</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">RS</th>
                <th scope="col" className="whitespace-nowrap px-3 py-3">Watchlist</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {rows.map((row) => {
                const o = row.momentum;
                const s = row.oscillatorScore;
                const symbol = `NSE:${row.symbol}`;
                const added = watchlistSymbols.includes(row.symbol);
                const freshness = rpciFreshness({
                  updatedAt: scan.updatedAt,
                  sessionDateKey: scan.sessionDateKey,
                  marketOpen: scan.marketOpen,
                  sourceId: scan.source.id,
                  quoteTimestamp: row.quoteTimestamp,
                  candleTimestamp: s.candleTimestamp,
                }, now || scan.updatedAt);
                const buyingStatus = currentScanBuyingStatus(row, breadth.percent);
                return (
                  <tr key={row.key} className="align-top hover:bg-[#f5f8fd]">
                    <td className="px-3 py-3">
                      <StockSymbolButton symbol={row.symbol} className="block font-bold text-foreground">{row.name}</StockSymbolButton>
                      <span className="text-xs text-muted">{symbol}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">
                      <LivePrice symbol={row.symbol} fallbackPrice={row.price} fallbackChange={row.changePercent} />
                    </td>
                    <td className="px-3 py-3"><BuyingStatusBadge status={buyingStatus} /></td>
                    <td className="px-3 py-3"><ScoreCell score={s} /></td>
                    <td className="px-3 py-3">
                      {o ? (
                        <>
                          <span className="block font-semibold text-[#1f5fbf]">{SETUP_LABEL[o.setup]}</span>
                          <span className="block text-xs text-muted">
                            {o.fresh && o.signalTimestamp != null
                              ? `Fresh ${o.setup === "pullback" ? "stochastic" : "MACD"} cross ${dateLabel(o.signalTimestamp)}`
                              : "Ongoing"}
                          </span>
                          {isBuyWatch(row) && (
                            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-black ${healthy ? "bg-[#16894f] text-white" : "bg-[#f3f4f6] text-muted"}`}>
                              {healthy ? "Buy-watch" : "Buy-watch · paused"}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="block text-xs text-muted">No trend setup — score only, not a buy-watch</span>
                      )}
                      {s.freshJump && s.jumpTimestamp != null && (
                        <span className="mt-1 block text-xs font-bold text-[#1f5fbf]">
                          Fresh score jump{s.scoreBefore != null ? ` ${s.scoreBefore.toFixed(1)}→${s.score.toFixed(1)}` : ""} · {dateLabel(s.jumpTimestamp)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {s.levels ? (
                        <LevelsCell levels={s.levels} price={row.price} candle={dateLabel(s.candleTimestamp)} freshness={freshness.label} />
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">{fixed(s.values[0])} / {fixed(o?.weeklyRsi)}</td>
                    <td className={`whitespace-nowrap px-3 py-3 font-mono ${o ? toneClass(o.macdHistPercent) : ""}`}>
                      {o ? formatPercent(o.macdHistPercent) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">{fixed(s.values[1])} / {fixed(o?.stochD)}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">
                      {fixed(s.values[7])}{o ? ` (${o.plusDi.toFixed(0)}/${o.minusDi.toFixed(0)})` : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">{o ? formatPercent(o.aboveEma21Percent) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">{row.rs ?? "—"}</td>
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
    </section>
  );
}
