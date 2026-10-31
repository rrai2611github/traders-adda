"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useDailyCandles } from "@/hooks/useDailyCandles";
import { useIndexQuotes } from "@/hooks/useIndexQuotes";
import { formatPercent, formatPrice, formatSigned, toneClass } from "@/lib/format";
import { mergeQuoteIntoCandles } from "@/lib/market/candleMerge";
import type { AnalysisTone } from "@/lib/market/indexAnalysis";
import { useIndexContext } from "@/hooks/useIndexContext";
import { IndexParticipationPanel } from "./IndexParticipationPanel";
import { IndexOutlookJournalPanel } from "./IndexOutlookJournalPanel";
import type { Candle } from "@/lib/market/types";

const INDEX_OPTIONS = [
  { symbol: "NIFTY50", name: "Nifty 50" },
  { symbol: "BANKNIFTY", name: "Nifty Bank" },
  { symbol: "NIFTYMIDCAP", name: "Nifty Midcap 100" },
  { symbol: "NIFTYIT", name: "Nifty IT" },
  { symbol: "INDIAVIX", name: "India VIX" },
] as const;

const RANGES = [
  { label: "1M", sessions: 22 },
  { label: "3M", sessions: 66 },
  { label: "6M", sessions: 126 },
  { label: "1Y", sessions: 252 },
] as const;

const dateLabel = (timestamp: number) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(timestamp);

const timeLabel = (timestamp: number) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);

const toneStyles: Record<AnalysisTone, string> = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-900",
  neutral: "border-slate-200 bg-slate-50 text-slate-800",
  caution: "border-amber-200 bg-amber-50 text-amber-950",
};

const metric = (value: number | null, suffix = "") =>
  value == null ? "—" : `${value.toFixed(2)}${suffix}`;

function movingAverage(candles: Candle[], sessions: number): Array<number | null> {
  let sum = 0;
  return candles.map((candle, index) => {
    sum += candle.close;
    if (index >= sessions) sum -= candles[index - sessions].close;
    return index + 1 >= sessions ? sum / sessions : null;
  });
}

function IndexChart({ candles, support, resistance }: {
  candles: Candle[];
  support: number | null;
  resistance: number | null;
}) {
  if (candles.length < 2) {
    return <div className="flex h-[360px] items-center justify-center text-sm text-muted">Loading chart history…</div>;
  }

  const width = 960;
  const height = 390;
  const left = 64;
  const right = 18;
  const top = 20;
  const bottom = 46;
  const ma20 = movingAverage(candles, 20);
  const ma50 = movingAverage(candles, 50);
  const values = candles.flatMap((candle, index) => [
    candle.close,
    ma20[index] ?? candle.close,
    ma50[index] ?? candle.close,
  ]);
  if (support != null) values.push(support);
  if (resistance != null) values.push(resistance);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.005);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = (index: number) => left + (index / (candles.length - 1)) * (width - left - right);
  const y = (value: number) => top + ((max - value) / (max - min || 1)) * (height - top - bottom);
  const path = (series: Array<number | null>) => series
    .map((value, index) => value == null ? "" : `${index === 0 || series[index - 1] == null ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .filter(Boolean)
    .join(" ");
  const closePath = path(candles.map((candle) => candle.close));
  const areaPath = `${closePath} L${x(candles.length - 1)},${height - bottom} L${x(0)},${height - bottom} Z`;
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
  const dateIndexes = [...new Set([0, Math.floor((candles.length - 1) / 2), candles.length - 1])];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[680px] w-full" role="img" aria-label="Daily closing price chart with 20-day and 50-day moving averages">
        <defs>
          <linearGradient id="index-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1d7a54" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#1d7a54" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} style={{ stroke: "var(--chart-grid)" }} strokeDasharray="4 5" />
            <text x={left - 9} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#64747b">{formatPrice(tick)}</text>
          </g>
        ))}
        {support != null && (
          <line x1={left} x2={width - right} y1={y(support)} y2={y(support)} stroke="#d6911d" strokeDasharray="7 5" />
        )}
        {resistance != null && (
          <line x1={left} x2={width - right} y1={y(resistance)} y2={y(resistance)} stroke="#d94a4a" strokeDasharray="7 5" />
        )}
        <path d={areaPath} fill="url(#index-area)" />
        <path d={closePath} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="3" strokeLinejoin="round" />
        <path d={path(ma20)} fill="none" stroke="#d6911d" strokeWidth="1.8" />
        <path d={path(ma50)} fill="none" stroke="#6674c8" strokeWidth="1.8" />
        {dateIndexes.map((index) => (
          <text key={index} x={x(index)} y={height - 15} textAnchor={index === 0 ? "start" : index === candles.length - 1 ? "end" : "middle"} fontSize="11" fill="#64747b">
            {dateLabel(candles[index].t)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function IndexAnalysisPage({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[2]);
  const [mode, setMode] = useState<"completed" | "live">("completed");
  const contextState = useIndexContext(mode);
  const indexState = useIndexQuotes();
  const history = useDailyCandles([symbol], 300);
  const quote = indexState.quotes.find((item) => item.symbol === symbol);
  const allCandles = useMemo(
    () => mergeQuoteIntoCandles(history[symbol] ?? [], quote),
    [history, quote, symbol],
  );
  const analysis = contextState.context?.analysis[symbol];
  const visibleCandles = allCandles.slice(-range.sessions);
  const option = INDEX_OPTIONS.find((item) => item.symbol === symbol)!;

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-9">
      <header className="rounded-2xl border border-border bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-sm font-bold text-accent hover:underline">← Back to dashboard</Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight">{option.name} analysis</h1>
            <p className="mt-1 text-sm text-muted">Live quote, daily chart, trend, momentum, levels and volatility.</p>
          </div>
          {quote ? (
            <div className="text-right">
              <div className="font-mono text-3xl font-black">{formatPrice(quote.ltp)}</div>
              <div className={`font-semibold ${toneClass(quote.change)}`}>
                {formatSigned(quote.change)} ({formatPercent(quote.changePercent)})
              </div>
              <div className="mt-1 text-xs text-muted">
                Quote as of {dateLabel(quote.timestamp)} {timeLabel(quote.timestamp)} · latency unverified
                {indexState.error ? " · refresh retrying" : ""}
              </div>
            </div>
          ) : (
            <div className="h-16 w-44 animate-pulse rounded-xl bg-slate-100" />
          )}
        </div>
      </header>

      <nav aria-label="Select index" className="flex gap-2 overflow-x-auto pb-1">
        {INDEX_OPTIONS.map((item) => (
          <Link
            key={item.symbol}
            href={`/indices/${item.symbol.toLowerCase()}`}
            aria-current={item.symbol === symbol ? "page" : undefined}
            className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-bold transition ${
              item.symbol === symbol
                ? "border-accent bg-accent text-white"
                : "border-border bg-white text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {item.name}
          </Link>
        ))}
      </nav>

      <section className="rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">Daily price chart</h2>
            <div className="mt-1 flex flex-wrap gap-4 text-xs font-semibold text-muted">
              <span className="text-accent">● Close</span>
              <span className="text-amber-600">● 20-day average</span>
              <span className="text-indigo-500">● 50-day average</span>
              <span>Dashed: 20-session levels</span>
            </div>
          </div>
          <div className="flex rounded-xl bg-slate-100 p-1">
            {RANGES.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setRange(item)}
                className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                  range.label === item.label ? "bg-white text-accent shadow-sm" : "text-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <IndexChart candles={visibleCandles} support={analysis?.support ?? null} resistance={analysis?.resistance ?? null} />
      </section>

      <div className="flex flex-wrap gap-2" aria-label="Analysis candle mode">
        {(["completed", "live"] as const).map((value) => (
          <button key={value} onClick={() => setMode(value)} aria-pressed={mode === value}
            className={`rounded-lg border px-3 py-2 text-xs font-bold ${mode === value ? "bg-accent text-white" : "text-muted"}`}>
            {value === "completed" ? "Last close" : "Live daily · provisional"}
          </button>
        ))}
      </div>
      {contextState.context ? <IndexParticipationPanel context={contextState.context} symbol={symbol} /> : null}
      {contextState.context ? <IndexOutlookJournalPanel journal={contextState.context.journal} symbol={symbol} /> : null}
      {analysis ? (
        <>
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black">{symbol === "INDIAVIX" ? "Volatility context" : analysis.summary}</h2>
            </div>
            <p className="mt-2 text-xs text-muted">
              {analysis.provisional ? "Incomplete daily candle" : "Completed daily candle"}: {dateLabel(analysis.asOf)}.
              Weekly trend uses completed weeks only; RSI and ATR use Wilder smoothing.
              Source: {contextState.context?.source}. Refreshes every minute; data latency is unverified.
            </p>
            {symbol !== "INDIAVIX" && (
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {Object.entries(analysis.scenarios).map(([name, text]) => (
                  <article key={name} className="rounded-xl border border-border p-3">
                    <h3 className="font-bold capitalize">{name} scenario</h3>
                    <p className="mt-1 text-sm leading-6">{text}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
          {symbol !== "INDIAVIX" ? (
            <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">Ranked structural zones</h2>
              <p className="mt-1 text-xs text-muted">Major swing/weekly and clustered references rank above minor daily levels. Ranking is a rule-based importance score, not a probability of holding.</p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted"><tr><th className="p-2">Rank · side</th><th className="p-2">Zone</th><th className="p-2">Distance</th><th className="p-2">References</th></tr></thead>
                  <tbody>{analysis.rankedLevels.slice(0, 8).map((level) => (
                    <tr key={`${level.low}-${level.high}`} className="border-t border-border">
                      <td className="p-2 font-bold">{level.strength} · {level.side}</td>
                      <td className="whitespace-nowrap p-2 font-mono">{formatPrice(level.low)}{level.high !== level.low ? ` – ${formatPrice(level.high)}` : ""}</td>
                      <td className="p-2">{level.distancePercent.toFixed(2)}%</td>
                      <td className="p-2 text-xs text-muted">{level.references.join(" + ")}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : null}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["RSI (14)", metric(analysis.rsi14), "Momentum; above 70 or below 30 is stretched"],
              ["5-session return", metric(analysis.return5d, "%"), "Short-term direction"],
              ["20-session return", metric(analysis.return20d, "%"), "Approximate one-month move"],
              ["ATR (14)", metric(analysis.atr14Percent, "%"), "Typical daily range as % of price"],
              ["20-day average", metric(analysis.sma20), "Short trend reference"],
              ["50-day average", metric(analysis.sma50), "Intermediate trend reference"],
              ["20-session support", metric(analysis.support), "Prior range low; not guaranteed to hold"],
              ["20-session resistance", metric(analysis.resistance), "Prior range high; not guaranteed to cap"],
              ["Nearby support", metric(analysis.nearbySupport?.price ?? null), analysis.nearbySupport?.label ?? "No nearby reference"],
              ["Nearby resistance", metric(analysis.nearbyResistance?.price ?? null), analysis.nearbyResistance?.label ?? "No nearby reference"],
            ].map(([label, value, description]) => (
              <div key={label} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
                <div className="mt-2 font-mono text-2xl font-black">{value}</div>
                <div className="mt-1 text-xs text-muted">{description}</div>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-xl font-black">Detailed technical reading</h2>
            <p className="mt-1 text-sm text-muted">Generated from {mode === "completed" ? "completed daily history" : "provisional daily history"}. Chart and quote above update independently.</p>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {analysis.observations.map((observation) => (
                <article key={observation.label} className={`rounded-xl border p-4 ${toneStyles[observation.tone]}`}>
                  <h3 className="font-black">{observation.label}</h3>
                  <p className="mt-1 text-sm leading-6">{observation.text}</p>
                </article>
              ))}
            </div>
            <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
              <div><b>52-week high</b><br />{metric(analysis.high52w)}</div>
              <div><b>52-week low</b><br />{metric(analysis.low52w)}</div>
              <div><b>Distance from high</b><br />{metric(analysis.from52wHighPercent, "%")}</div>
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-border bg-white p-8 text-center text-muted">
          {contextState.error ?? (contextState.context ? `Analysis unavailable for ${option.name}: insufficient valid provider history.` : `Building ${mode} index analysis…`)}
        </section>
      )}
      {contextState.error && analysis ? <p role="alert" className="text-sm text-amber-700">{contextState.error} Last successful analysis retained; it may be stale.</p> : null}

      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
        This is rule-based technical analysis for market context, not a prediction or investment advice. Support,
        resistance, RSI and moving averages can fail, especially around gaps and news. Confirm decisions with your
        own risk plan or a SEBI-registered adviser.
      </p>
    </main>
  );
}
