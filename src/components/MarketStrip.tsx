"use client";

import { useEffect, useState } from "react";
import type { BreadthDay, MarketMode } from "@/lib/screen/breadthHistory";
import { breadthExtreme, OVERBOUGHT_PERCENT, OVERSOLD_PERCENT } from "@/lib/screen/breadthHistory";
import { useNiftyTrend } from "@/hooks/useNiftyTrend";
import { SETUP_BREADTH_MIN, setupStatus } from "@/lib/screen/setupGate";

interface BreadthPayload {
  updatedAt: number;
  source: { id: string; label: string; isRealtime: boolean };
  covered: number;
  latest: BreadthDay | null;
  mode: MarketMode | null;
  history: BreadthDay[];
}

interface FyersStatus {
  configured: boolean;
  connected: boolean;
  feed?: { freshestQuoteAgeMs: number | null };
}

const WINDOWS = [
  { w: 10, label: "Last 2 weeks" },
  { w: 20, label: "Last month" },
  { w: 50, label: "Last 2.5 months" },
  { w: 200, label: "Last year" },
] as const;

/** What the market mode means in a sentence a beginner can act on. */
const VERDICT = {
  "risk-on": { dot: "bg-emerald-500", edge: "border-l-emerald-500", box: "border-emerald-200 bg-emerald-50", text: "text-emerald-900", head: "Strong market today. You can buy normally.", todo: "Buy only stocks marked Buy ready, with your normal position size." },
  selective: { dot: "bg-amber-500", edge: "border-l-amber-500", box: "border-amber-200 bg-amber-50", text: "text-amber-900", head: "Mixed market today. The tested setup is allowed, but the market is only just healthy.", todo: "Buy only stocks marked Buy now or Buy on breakout, keep to your risk limits, and skip weak setups." },
  "risk-off": { dot: "bg-rose-500", edge: "border-l-rose-500", box: "border-rose-200 bg-rose-50", text: "text-rose-900", head: "Weak market today. Do not buy new stocks.", todo: "Only watch the lists below and plan your entries. Wait for the market to improve." },
} as const;

const ageLabel = (ms: number | null) =>
  ms == null ? null : ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} seconds old` : `${Math.round(ms / 60_000)} minutes old`;

/** The % of stocks above the 50-day average over time, with the 20 and 80 bands. */
function Trend({ history }: { history: BreadthDay[] }) {
  const points = history.map((day) => day.above[50]).filter((value): value is number => value != null);
  if (points.length < 2) return null;
  const width = 320;
  const height = 64;
  const path = points.map((value, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * width).toFixed(1)},${(height - (value / 100) * height).toFixed(1)}`).join(" ");
  const y = (band: number) => height - (band / 100) * height;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full max-w-md" role="img" aria-label={`Share of stocks in an uptrend over the last ${points.length} sessions`}>
      <line x1="0" x2={width} y1={y(OVERBOUGHT_PERCENT)} y2={y(OVERBOUGHT_PERCENT)} stroke="currentColor" strokeDasharray="3 3" className="text-amber-400" />
      <line x1="0" x2={width} y1={y(OVERSOLD_PERCENT)} y2={y(OVERSOLD_PERCENT)} stroke="currentColor" strokeDasharray="3 3" className="text-rose-400" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" className="text-accent" />
    </svg>
  );
}

/**
 * The first thing on every page: one sentence saying whether to buy today, and why. The numbers, the
 * price source and the trend chart sit behind "Show details".
 */
export function MarketStrip() {
  const [breadth, setBreadth] = useState<BreadthPayload | null>(null);
  const [fyers, setFyers] = useState<FyersStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const nifty = useNiftyTrend();

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const [b, f] = await Promise.all([
          fetch("/api/market/breadth", { cache: "no-store", signal: controller.signal }),
          fetch("/api/fyers/status", { cache: "no-store", signal: controller.signal }).catch(() => null),
        ]);
        if (!alive) return;
        if (b.ok) { setBreadth((await b.json()) as BreadthPayload); setFailed(false); }
        else if (b.status !== 503) setFailed(true);
        if (f?.ok) setFyers((await f.json()) as FyersStatus);
      } catch {
        if (alive && !controller.signal.aborted) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, []);

  if (!breadth?.latest || !breadth.mode) {
    return failed ? <p role="status" className="rounded-xl border border-border bg-surface px-4 py-2 text-xs text-muted">Market check is unavailable right now. It retries every minute.</p> : null;
  }
  const { latest, mode } = breadth;
  // The same setup check the Top picks and the emails use: breadth at least 35% (the Nifty's 200-day average is shown for information only).
  const gate = setupStatus(latest.above[50], nifty);
  const key: keyof typeof VERDICT = !gate.allowed ? "risk-off" : (latest.above[50] ?? 0) >= 50 && mode.key === "risk-on" ? "risk-on" : "selective";
  const verdict = VERDICT[key];
  const uptrend = latest.above[50] != null ? Math.round(latest.above[50]) : null;
  const extreme = breadthExtreme(latest.above[50]);
  const quoteAge = fyers?.connected ? ageLabel(fyers.feed?.freshestQuoteAgeMs ?? null) : null;
  const feed = fyers?.connected
    ? `Live prices from Fyers${quoteAge ? `, newest ${quoteAge}` : ""}.`
    : `Prices from ${breadth.source.id === "yahoo" ? "Yahoo" : breadth.source.label}, up to a minute behind. Log in to Fyers for live prices.`;

  return (
    <section aria-label="Is it a good day to buy" className={`rounded-xl border border-l-4 shadow-sm ${verdict.box} ${verdict.edge}`}>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${verdict.dot}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`text-[13.5px] font-extrabold leading-5 ${verdict.text}`}>{verdict.head}</p>
          <p className="text-[11.5px] leading-4 text-slate-600">
            {uptrend != null ? `${uptrend}% of stocks are above their 50-day average` : "Market check unavailable"} · {gate.allowed ? "buys are allowed" : `buys need ${SETUP_BREADTH_MIN}%`}
          </p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="shrink-0 rounded-lg border border-slate-300/80 bg-white/80 px-2.5 py-1 text-[11.5px] font-bold text-slate-800 hover:bg-white">
          {open ? "Hide details" : "Show details"}
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-black/10 px-3.5 pb-3 pt-3 text-xs text-slate-700">
          {extreme && (
            <p className={`font-bold ${extreme === "overbought" ? "text-amber-800" : "text-rose-800"}`}>
              {extreme === "overbought"
                ? "Almost every stock has already run up, so there is little room left. Be careful with new buys."
                : "Almost every stock is down. Bounces can be sharp but fail often, so keep positions small."}
            </p>
          )}
          <p><b className="text-slate-900">What to do:</b> {verdict.todo}</p>
          <p><b className="text-slate-900">Setup check {gate.allowed ? "passed" : "not passed"}:</b> {gate.reason}.</p>
          <div>
            <p className="font-black text-slate-900">Out of 100 stocks, how many are above their average price?</p>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-4">
              {WINDOWS.map(({ w, label }) => (
                <div key={w} className="rounded-lg bg-white/70 px-3 py-2">
                  <div className="font-mono text-lg font-black text-slate-900">{latest.above[w] != null ? Math.round(latest.above[w]!) : "—"}</div>
                  <div className="text-[11px] text-slate-600">{label}</div>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Higher is healthier. The first two move fastest, the last two show the bigger trend. The buy/no-buy decision uses the last two and a half months and the last year.
            </p>
          </div>
          <p><b className="text-slate-900">Today:</b> {latest.advancing} stocks up, {latest.declining} down.</p>
          <p><b className="text-slate-900">Prices:</b> {feed}</p>
          <div>
            <p className="font-black text-slate-900">How the last {breadth.history.length} trading days looked</p>
            <Trend history={breadth.history} />
            <p className="mt-1 text-[11px] text-slate-500">
              Line = stocks in an uptrend (last 2.5 months). Above the top dashed line ({OVERBOUGHT_PERCENT}) the market is stretched. Below the bottom one ({OVERSOLD_PERCENT}) it is badly beaten down.
              Based on {breadth.covered} liquid stocks. While the market is open, today&apos;s number can still change before the close.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
