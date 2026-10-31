"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBreadth, type BreadthPayload } from "@/hooks/useBreadth";
import { useNiftyTrend } from "@/hooks/useNiftyTrend";
import { useResultsDates } from "@/hooks/useResultsDates";
import { daysUntil } from "@/lib/market/boardMeetings";
import { useWeeklyTop5 } from "@/hooks/useWeeklyTop5";
import type { FeedEvent, ScanRow } from "@/hooks/useScreenScan";
import { formatPercent, formatPrice } from "@/lib/format";
import { OVERBOUGHT_PERCENT, OVERSOLD_PERCENT } from "@/lib/screen/breadthHistory";
import type { SectorSummary } from "@/lib/screen/commandCenter";
import { READY_RULES } from "@/lib/screen/readyToRun";
import { analysePick, type PickVerdict } from "@/lib/screen/pickAnalysis";
import { setupStatus } from "@/lib/screen/setupGate";
import { STAT_TITLES, statItems, type StatItem, type StatKey } from "@/lib/screen/statLists";
import { buildTopPicks, PICK_RULES, type PickTag } from "@/lib/screen/topPicks";
import { CompanyHealthTag } from "./FundamentalsPanel";
import { TodayStrip } from "./TodayStrip";
import { LivePrice } from "./LivePrice";
import { StockSymbolButton } from "./StockDetailContext";

/** Eases a number from 0 to its target on first show and between updates; shows the target at once for reduced motion. */
function useCountUp(target: number, ms = 900): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    let frame = 0;
    const from = shown;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);
  return shown;
}

const money = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;

function Card({ title, hint, action, className = "", children }: { title: string; hint?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-black text-slate-900">{title}</h3>
          {hint && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/* ---------- market gauge ---------- */

const GAUGE = { cx: 110, cy: 104, r: 84 };
const point = (value: number, radius = GAUGE.r) => {
  const angle = Math.PI * (1 - value / 100);
  return [GAUGE.cx + radius * Math.cos(angle), GAUGE.cy - radius * Math.sin(angle)] as const;
};
const arc = (from: number, to: number) => {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M${x1.toFixed(1)},${y1.toFixed(1)} A${GAUGE.r},${GAUGE.r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
};

const MODE = {
  "risk-on": { head: "Strong market", text: "text-emerald-700", pill: "bg-emerald-100 text-emerald-800" },
  selective: { head: "Mixed market", text: "text-amber-700", pill: "bg-amber-100 text-amber-800" },
  "risk-off": { head: "Weak market", text: "text-rose-700", pill: "bg-rose-100 text-rose-800" },
} as const;

function MarketGauge({ breadth }: { breadth: BreadthPayload | null }) {
  const latest = breadth?.latest;
  const value = latest?.above[50];
  const counted = useCountUp(value ?? 0);
  if (!breadth || !latest || !breadth.mode || value == null) {
    return <Card title="Is it a good day to buy?" hint="Share of stocks in an uptrend"><div className="skeleton h-36 rounded-xl" /></Card>;
  }
  const mode = MODE[breadth.mode.key];
  return (
    <Card title="Is it a good day to buy?" hint="Out of 100 stocks, how many are above their 50-day average price">
      <svg viewBox="0 0 220 124" className="mx-auto w-full max-w-[280px]" role="img" aria-label={`${Math.round(value)} out of 100 stocks are in an uptrend. ${mode.head}.`}>
        <path d={arc(0, 100)} fill="none" stroke="#e2e8f0" strokeWidth="16" strokeLinecap="round" />
        <path d={arc(0, 40)} fill="none" stroke="#f87171" strokeWidth="16" strokeLinecap="butt" />
        <path d={arc(40, 60)} fill="none" stroke="#fbbf24" strokeWidth="16" strokeLinecap="butt" />
        <path d={arc(60, 100)} fill="none" stroke="#34d399" strokeWidth="16" strokeLinecap="butt" />
        <g style={{ transform: `rotate(${(counted / 100) * 180}deg)`, transformOrigin: `${GAUGE.cx}px ${GAUGE.cy}px` }}>
          <line x1={GAUGE.cx} y1={GAUGE.cy} x2={GAUGE.cx - (GAUGE.r - 14)} y2={GAUGE.cy} stroke="currentColor" className="text-slate-900" strokeWidth="3" strokeLinecap="round" />
        </g>
        <circle cx={GAUGE.cx} cy={GAUGE.cy} r="6" fill="currentColor" className="text-slate-900" />
        <text x="16" y="120" fontSize="9" fill="#64748b">0</text>
        <text x="204" y="120" fontSize="9" fill="#64748b" textAnchor="end">100</text>
        <text x={point(40, GAUGE.r + 12)[0]} y={point(40, GAUGE.r + 12)[1]} fontSize="8" fill="#64748b" textAnchor="middle">40</text>
        <text x={point(60, GAUGE.r + 12)[0]} y={point(60, GAUGE.r + 12)[1]} fontSize="8" fill="#64748b" textAnchor="middle">60</text>
      </svg>
      <div className="-mt-1 text-center">
        <div className={`font-mono text-4xl font-black ${mode.text}`}>{Math.round(counted)}<span className="text-lg">%</span></div>
        <div className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-black ${mode.pill}`}>{mode.head} · {breadth.mode.size}</div>
        <p className="mx-auto mt-2 max-w-xs text-[11px] leading-4 text-slate-500">{breadth.mode.note}</p>
      </div>
    </Card>
  );
}

/* ---------- breadth trend ---------- */

function TrendCard({ breadth }: { breadth: BreadthPayload | null }) {
  const points = useMemo(() => (breadth?.history ?? []).map((d) => d.above[50]).filter((v): v is number => v != null), [breadth]);
  if (!breadth?.latest || points.length < 2) return <Card title="Breadth, last 6 months"><div className="skeleton h-52 rounded-xl" /></Card>;
  const W = 360, H = 170;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - (v / 100) * H;
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const lo = Math.min(...points), hi = Math.max(...points);
  const bars = [
    { w: 10, label: "Last 2 weeks" }, { w: 20, label: "Last month" }, { w: 50, label: "Last 2.5 months" }, { w: 200, label: "Last year" },
  ] as const;
  return (
    <Card title="Breadth, last 6 months" hint={`Share of ${breadth.covered.toLocaleString("en-IN")} liquid stocks in an uptrend. It ranged from ${Math.round(lo)}% to ${Math.round(hi)}%.`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={`Breadth over the last ${points.length} sessions, now ${Math.round(last)} percent`}>
        <rect x="0" y={y(100)} width={W} height={y(60) - y(100)} fill="#34d399" opacity="0.12" />
        <rect x="0" y={y(40)} width={W} height={y(0) - y(40)} fill="#f87171" opacity="0.10" />
        <line x1="0" x2={W} y1={y(OVERBOUGHT_PERCENT)} y2={y(OVERBOUGHT_PERCENT)} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2={W} y1={y(OVERSOLD_PERCENT)} y2={y(OVERSOLD_PERCENT)} stroke="#ef4444" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2={W} y1={y(60)} y2={y(60)} stroke="#10b981" strokeWidth="1" opacity="0.7" vectorEffect="non-scaling-stroke" />
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="#0f766e" opacity="0.10" />
        <path d={line} fill="none" stroke="#0f766e" strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-3 rounded-sm bg-emerald-300" />60%+ buy zone</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-3 rounded-sm bg-rose-300" />under 40% weak</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0 w-3 border-t border-dashed border-amber-500" />80% stretched · 20% washed out</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
        {bars.map(({ w, label }) => {
          const v = breadth.latest!.above[w];
          return (
            <div key={w}>
              <div className="flex items-baseline justify-between text-xs text-slate-600"><span>{label}</span><b className="text-sm font-black tabular-nums text-slate-900">{v != null ? Math.round(v) : "—"}%</b></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${v != null && v >= 60 ? "bg-emerald-500" : v != null && v >= 40 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${v ?? 0}%` }} /></div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------- today in numbers ---------- */

function Stat({ label, value, sub, tone = "text-slate-900", onClick, active }: { label: string; value: string; sub?: string; tone?: string; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`font-mono text-xl font-black ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] leading-4 text-slate-500">{sub}</div>}
    </>
  );
  if (!onClick) return <div className="rounded-xl bg-slate-50 px-3 py-2.5">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c8951c] ${active ? "bg-white shadow-sm ring-2 ring-[#e6b53c]" : "bg-slate-50 hover:bg-white hover:shadow-sm hover:ring-1 hover:ring-slate-300"}`}
    >
      {body}
      <div className="mt-1 text-[10px] font-bold text-accent">{active ? "Hide stocks ▲" : "View stocks →"}</div>
    </button>
  );
}

const STAT_KEYS: ReadonlyArray<StatKey> = ["up", "down", "nearHigh", "nearLow", "strong", "above200", "breakouts", "failed"];
const STAT_PAGE = 25;

/** The stocks behind one tile: tap a stock to open its details. */
function StatList({ statKey, items, outOf, onClose }: { statKey: StatKey; items: ReadonlyArray<StatItem>; /** The total the count is a share of, when the tile shows a percentage. */ outOf?: number; onClose: () => void }) {
  const [shown, setShown] = useState(STAT_PAGE);
  const panel = useRef<HTMLDivElement>(null);
  // The tiles sit above and to the side, so bring the list into view when it opens.
  useEffect(() => { panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, []);
  const { title, about } = STAT_TITLES[statKey];
  const visible = items.slice(0, shown);
  return (
    <div ref={panel} role="region" aria-label={title} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h4 className="text-[12.5px] font-black text-slate-900">{title} <span className="font-mono text-accent">({items.length}{outOf != null ? ` of ${outOf}` : ""})</span></h4>
          <p className="text-[10.5px] text-slate-500">{about} Tap a stock for its details.</p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-md border border-slate-200 px-2 py-0.5 text-[10.5px] font-bold text-slate-600 hover:bg-slate-50">Close</button>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-[11.5px] text-slate-500">No stocks right now.</p>
      ) : (
        <ul className="mt-2 max-h-[26rem] overflow-y-auto px-4 pb-2 md:grid md:grid-cols-2 md:gap-x-8">
          {visible.map((item) => (
            <li key={item.symbol} className="flex items-center gap-2 border-t border-slate-100 py-1.5">
              <StockSymbolButton symbol={item.symbol} className="w-[104px] shrink-0 truncate text-left text-[12.5px] font-black text-slate-900">{item.symbol}</StockSymbolButton>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-slate-500">{item.name}</div>
                {item.note && <div className="truncate text-[10px] text-slate-400">{item.note}</div>}
              </div>
              <div className="shrink-0 text-right">
                {item.price != null && <div className="font-mono text-[11.5px] font-bold text-slate-800">₹{formatPrice(item.price)}</div>}
                {item.changePercent != null && <div className={`font-mono text-[10.5px] font-bold ${item.changePercent >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(item.changePercent)}</div>}
              </div>
              {item.rs != null && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600" title="Relative strength rating, 1 to 99">RS {Math.round(item.rs)}</span>}
            </li>
          ))}
        </ul>
      )}
      {items.length > shown && (
        <div className="border-t border-slate-100 px-3 py-2 text-center">
          <button type="button" onClick={() => setShown((n) => n + 50)} className="text-[11px] font-bold text-accent hover:underline">Show {Math.min(50, items.length - shown)} more (showing {shown} of {items.length})</button>
        </div>
      )}
    </div>
  );
}

function StatsCard({ lists, open, toggle, advancing, declining, qualifying, above200, onPicks }: {
  lists: Record<StatKey, StatItem[]>; open: StatKey | null; toggle: (key: StatKey) => void; advancing: number; declining: number; qualifying: number | null; above200: number | null; onPicks: () => void;
}) {
  const total = advancing + declining || 1;
  const nearHigh = lists.nearHigh.length;
  const nearLow = lists.nearLow.length;
  const failedCount = lists.failed.length;
  return (
    <Card title="Today in numbers" hint="From the latest scan of the liquid NSE universe. Tap any number to see the stocks.">
      <div>
        <div className="flex justify-between text-[11px] font-bold">
          <button type="button" onClick={() => toggle("up")} aria-pressed={open === "up"} className="text-emerald-700 hover:underline">{advancing} up</button>
          <button type="button" onClick={() => toggle("down")} aria-pressed={open === "down"} className="text-rose-700 hover:underline">{declining} down</button>
        </div>
        <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-rose-200">
          <div className="bg-emerald-500" style={{ width: `${(advancing / total) * 100}%` }} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Near 52-wk high" value={String(nearHigh)} sub="within 5% of the high" tone="text-emerald-700" onClick={() => toggle("nearHigh")} active={open === "nearHigh"} />
        <Stat label="Near 52-wk low" value={String(nearLow)} sub="within 5% of the low" tone={nearLow > nearHigh ? "text-rose-700" : "text-slate-900"} onClick={() => toggle("nearLow")} active={open === "nearLow"} />
        <Stat label="RS 80+" value={String(lists.strong.length)} sub="strongest stocks" onClick={() => toggle("strong")} active={open === "strong"} />
        <Stat label="Above 200-day" value={above200 != null ? `${Math.round(above200)}%` : "—"} sub="of stocks, the long trend" tone={above200 != null && above200 >= 50 ? "text-emerald-700" : "text-amber-700"} onClick={() => toggle("above200")} active={open === "above200"} />
        <Stat label="New breakouts" value={String(lists.breakouts.length)} sub="base breakouts today" tone="text-emerald-700" onClick={() => toggle("breakouts")} active={open === "breakouts"} />
        <Stat label="Failed" value={String(failedCount)} sub="breakouts that failed" tone={failedCount ? "text-rose-700" : "text-slate-900"} onClick={() => toggle("failed")} active={open === "failed"} />
      </div>
      {qualifying != null && (
        <p className="mt-2 text-[11px] text-slate-500">
          {qualifying} stocks pass the Weekly Top 5 rules.{" "}
          <button type="button" onClick={onPicks} className="font-bold text-accent hover:underline">See the picks →</button>
        </p>
      )}
    </Card>
  );
}

/* ---------- weekly top 5 ---------- */

const VERDICT_STYLE: Record<PickVerdict, { label: string; chip: string }> = {
  buy: { label: "Buy plan ready", chip: "bg-emerald-600 text-white" },
  paper: { label: "Paper trade", chip: "bg-rose-100 text-rose-800" },
  wait: { label: "Wait", chip: "bg-amber-100 text-amber-800" },
  skip: { label: "Do not chase", chip: "bg-slate-200 text-slate-700" },
};

const TAG: Record<PickTag, { label: string; chip: string; note: string }> = {
  ready: { label: "Ready", chip: "bg-emerald-100 text-emerald-800", note: "Just under its breakout level. Buy on a close above it." },
  broke: { label: "Just broke out", chip: "bg-sky-100 text-sky-800", note: "Through its level by less than 5%. Buy only if the market check is green." },
  watch: { label: "Watch", chip: "bg-slate-200 text-slate-700", note: "Strong, but it does not meet every buy rule yet (level, trend, volume or liquidity)." },
  extended: { label: "Extended", chip: "bg-amber-100 text-amber-800", note: "Already ran past its level. Wait for a pullback." },
};

/** One list: stocks about to break out, stocks that just did, then the strong ones to wait on. */
function TopPicksSection({ rows, onAll }: { rows: ReadonlyArray<ScanRow>; onAll: () => void }) {
  const { data, message, failed } = useWeeklyTop5();
  const results = useResultsDates();
  const nifty = useNiftyTrend();
  const picks = useMemo(() => buildTopPicks(rows, data?.picks ?? []), [rows, data]);
  const buyable = picks.filter((p) => p.tag === "ready" || p.tag === "broke");
  const gate = setupStatus(data?.breadth50 ?? null, nifty);
  return (
    <section aria-label="Top picks" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-black text-slate-900">Top picks</h3>
          <p className="text-[11px] text-slate-500">Strong stocks (RS {READY_RULES.minRs}+) in an uptrend. Stocks that just broke out on the Blue sky or Multi-year screens come first (the tested buy), then ones about to break out (tomorrow&apos;s watchlist); extended stocks are greyed so you do not chase them. Click one for the checklist and trade plan.</p>
        </div>
        <button type="button" onClick={onAll} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">All picks →</button>
      </header>
      {(data?.breadth50 != null || nifty) && (
        <p className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5 ${gate.allowed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${gate.allowed ? "bg-emerald-500" : "bg-rose-500"}`} aria-hidden />
          <span><b>Setup check {gate.allowed ? "passed" : "not passed"}.</b> {gate.reason.charAt(0).toUpperCase() + gate.reason.slice(1)}. {gate.allowed ? "Real buys are allowed for the stocks marked Buy now or Buy on breakout." : "Paper trade only until it passes: in the 10-year test the rules stayed out of exactly these markets."}</span>
        </p>
      )}
      {rows.length === 0 || (!data && !failed) ? (
        <p className="py-6 text-center text-sm text-slate-500">{message ?? "Loading the scan…"}</p>
      ) : picks.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nothing qualifies right now. Not picking is a valid answer.</p>
      ) : (
        <>
          {buyable.length === 0 && <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">No stock is under its breakout level or just through it right now. The strong ones below are ones to wait on.</p>}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {picks.map((p) => {
              const waits = p.tag === "watch" || p.tag === "extended";
              const days = results?.dates[p.symbol] ? daysUntil(results.dates[p.symbol], results.today) : null;
              const analysis = analysePick(p, { breadth50: data?.breadth50 ?? null, resultsInDays: results ? days : undefined, niftyAbove200: nifty ? nifty.above : undefined, niftyPercent: nifty?.percent });
              return (
                <li key={p.symbol} className={`flex min-w-0 flex-col rounded-xl border p-3 transition duration-200 hover:border-emerald-300 hover:bg-white hover:shadow-md ${waits ? "border-slate-200 bg-slate-50/40 opacity-75" : "border-slate-200 bg-slate-50/70"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <StockSymbolButton symbol={p.symbol} className="block truncate text-sm font-black text-slate-900">{p.symbol}</StockSymbolButton>
                      {p.name && <div className="truncate text-[10px] text-slate-500">{p.name}</div>}
                    </div>
                    <div className="shrink-0 text-center" title="Relative strength rating, 1 to 99">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-500 bg-white font-mono text-xs font-black text-emerald-700">{Math.round(p.rs)}</div>
                    </div>
                  </div>
                  <div className="mt-1.5"><LivePrice symbol={p.symbol} fallbackPrice={p.price} fallbackChange={null} /></div>
                  <p className="mt-2 text-[11.5px] font-bold leading-4 text-slate-800"><span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${VERDICT_STYLE[analysis.verdict].chip}`}>{analysis.status}</span>{analysis.headline}</p>
                  {p.ext != null && (
                    <p className="mt-1 text-[11px] text-slate-600">
                      <b className={p.ext <= 0 ? "text-emerald-700" : p.ext <= PICK_RULES.brokeMaxExt ? "text-sky-700" : "text-amber-700"}>{Math.abs(p.ext).toFixed(1)}%</b> {p.ext <= 0 ? "under" : "past"} its breakout level{p.pivotPrice != null ? ` (₹${formatPrice(p.pivotPrice)})` : ""}
                    </p>
                  )}
                  {p.buy != null && p.stop != null ? (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div><div className="font-black uppercase tracking-wide text-sky-700">Buy</div><div className="font-mono font-bold text-slate-800">₹{formatPrice(p.buy)}</div></div>
                      <div><div className="font-black uppercase tracking-wide text-rose-700">Stop</div><div className="font-mono font-bold text-slate-800">₹{formatPrice(p.stop)}</div><div className="text-[10px] text-slate-400">−{PICK_RULES.stopPercent}%</div></div>
                      {analysis.plan?.targets && <div className="text-right"><div className="font-black uppercase tracking-wide text-emerald-700">Target</div><div className="font-mono font-bold text-slate-800">₹{formatPrice(analysis.plan.targets.t1)}</div><div className="text-[10px] text-slate-400">+{analysis.plan.targets.t1Percent}% · T2 +{analysis.plan.targets.t2Percent}%</div></div>}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">{TAG[p.tag].note}</p>
                  )}
                  <details className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] leading-4 text-slate-700">
                    <summary className="cursor-pointer text-[11px] font-black text-emerald-700">Full analysis</summary>
                    <p className="mt-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">Why it is on the list</p>
                    <ul className="list-disc space-y-0.5 pl-4">{analysis.why.map((line) => <li key={line}>{line}</li>)}</ul>
                    {analysis.watchOut.length > 0 && (<><p className="mt-1.5 text-[10px] font-black uppercase tracking-wide text-amber-700">Watch out for</p><ul className="list-disc space-y-0.5 pl-4 text-amber-900">{analysis.watchOut.map((line) => <li key={line}>{line}</li>)}</ul></>)}
                    {analysis.plan && (<><p className="mt-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">Plan</p>{analysis.plan.tighter && <p className="mb-1"><b>Tighter option:</b> stop ₹{formatPrice(analysis.plan.tighter.stop)} (−{analysis.plan.tighter.percent}%). {analysis.plan.tighter.note}</p>}{analysis.plan.targets && <p className="mb-1"><b>Targets:</b> ₹{formatPrice(analysis.plan.targets.t1)} (+{analysis.plan.targets.t1Percent}%) and ₹{formatPrice(analysis.plan.targets.t2)} (+{analysis.plan.targets.t2Percent}%). {analysis.plan.targets.note}</p>}<p>{analysis.plan.exit}</p>{analysis.plan.example && <p className="mt-1 text-slate-500">Example with ₹{analysis.plan.example.capital.toLocaleString("en-IN")} risking {analysis.plan.example.riskPercent}%: {analysis.plan.example.quantity} shares (₹{analysis.plan.example.invested.toLocaleString("en-IN")}), about ₹{analysis.plan.example.maxLoss.toLocaleString("en-IN")} lost if the stop is hit.</p>}</>)}
                  </details>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.quiet && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">Volume dried up</span>}
                    {days != null && days <= 14 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200" title="A results announcement can gap the price through your stop. Wait for it, or take a smaller position.">⚠ Results in {days} day{days === 1 ? "" : "s"}</span>}
                    {p.sector && <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">{p.sector}</span>}
                    <CompanyHealthTag symbol={p.symbol} sector={p.sector} />
                    {p.buy != null && p.stop != null && (p.tag === "ready" || p.tag === "broke") && (
                      <a href={`/positions?symbol=${encodeURIComponent(p.symbol)}&buy=${p.buy}&stop=${p.stop}`} className="ml-auto rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-slate-700" title="Open My positions with this pick's symbol, buy price and stop filled in, once you have bought it">I bought it →</a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-3 text-[10px] leading-4 text-slate-400">
        The tested rule: buy a Blue sky or Multi-year breakout on the day it breaks out, only while at least 35% of stocks are above their 50-day average. Stop about {PICK_RULES.stopPercent}% below the buy price, with a smaller position so the money at risk stays the same; exit when the stock closes under its 50-day average. Hold at most 10 positions and add at most 3 a day. 10-year test: about 46% a year with a worst drop of about 21%, but only about 45% of trades win. The history only includes stocks listed today, so real results are likely lower. Stocks still under their level are the watchlist for tomorrow. Check results dates before buying. Research output, not advice.
      </p>
    </section>
  );
}

/* ---------- sectors ---------- */

const SHORT_SECTOR: Record<string, string> = {
  "Media Entertainment & Publication": "Media & Entertainment",
  "Oil Gas & Consumable Fuels": "Oil, Gas & Fuels",
  "Fast Moving Consumer Goods": "FMCG",
  "Automobile and Auto Components": "Auto & Components",
  "Information Technology": "IT",
  "Financial Services": "Financials",
  Telecommunication: "Telecom",
};
const shortSector = (name: string) => SHORT_SECTOR[name] ?? name;

function SectorColumn({ title, tone, list, scale }: { title: string; tone: "up" | "down"; list: ReadonlyArray<SectorSummary>; scale: number }) {
  const up = tone === "up";
  return (
    <div className="min-w-0">
      <div className={`mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide ${up ? "text-emerald-700" : "text-rose-700"}`}>
        <span aria-hidden>{up ? "▲" : "▼"}</span>{title}
      </div>
      {list.length === 0 ? <p className="text-xs text-slate-400">None today.</p> : (
        <ul className="space-y-3">
          {list.map((s) => (
            <li key={s.sector}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-[13px] font-semibold leading-tight text-slate-800" title={s.sector}>{shortSector(s.sector)}</span>
                <span className={`shrink-0 text-[13px] font-black tabular-nums ${up ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(s.avgChange)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${up ? "bg-gradient-to-r from-emerald-400 to-emerald-600" : "bg-gradient-to-r from-rose-400 to-rose-600"}`} style={{ width: `${Math.max(4, (Math.abs(s.avgChange) / scale) * 100)}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{s.advancing} of {s.total} stocks up</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectorCard({ sectors, onAll }: { sectors: ReadonlyArray<SectorSummary>; onAll: () => void }) {
  const sorted = useMemo(() => [...sectors].sort((a, b) => b.avgChange - a.avgChange), [sectors]);
  const leading = sorted.filter((s) => s.avgChange > 0).slice(0, 5);
  const lagging = [...sorted].reverse().filter((s) => s.avgChange < 0).slice(0, 5);
  const scale = Math.max(0.5, ...leading.map((s) => s.avgChange), ...lagging.map((s) => Math.abs(s.avgChange)));
  return (
    <Card title="Sectors today" hint="Average move of each sector's stocks since yesterday's close" action={<button type="button" onClick={onAll} className="whitespace-nowrap text-xs font-bold text-emerald-700 hover:underline">All sectors →</button>} className="lg:col-span-2">
      {sorted.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Sector data is loading.</p> : (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <SectorColumn title="Leading" tone="up" list={leading} scale={scale} />
          <SectorColumn title="Lagging" tone="down" list={lagging} scale={scale} />
        </div>
      )}
    </Card>
  );
}

/* ---------- what changed ---------- */

function ChangesCard({ breakouts, failed, onAll }: { breakouts: ReadonlyArray<FeedEvent>; failed: ReadonlyArray<FeedEvent>; onAll: () => void }) {
  const list = (events: ReadonlyArray<FeedEvent>, tone: string, empty: string) => events.length === 0 ? <li className="text-[11px] text-slate-400">{empty}</li> : events.slice(0, 4).map((e) => (
    <li key={`${e.type}-${e.symbol}`} className="flex items-baseline justify-between gap-2 text-xs">
      <StockSymbolButton symbol={e.symbol} className="font-bold text-slate-800">{e.symbol}</StockSymbolButton>
      <span className={`font-mono text-[11px] ${tone}`}>₹{formatPrice(e.price)}</span>
    </li>
  ));
  return (
    <Card title="What changed" hint="Base breakouts, latest session" action={<button type="button" onClick={onAll} className="whitespace-nowrap text-xs font-bold text-emerald-700 hover:underline">Record →</button>}>
      <div className="mb-1 flex justify-between text-[10px] font-black uppercase tracking-wide text-slate-400"><span>New breakouts</span><span className="text-emerald-700">{breakouts.length}</span></div>
      <ul className="space-y-1.5">{list(breakouts, "text-emerald-700", "None this session.")}</ul>
      <div className="mb-1 mt-3 flex justify-between border-t border-slate-100 pt-2 text-[10px] font-black uppercase tracking-wide text-slate-400"><span>Failed</span><span className="text-rose-700">{failed.length}</span></div>
      <ul className="space-y-1.5">{list(failed, "text-rose-700", "None this session.")}</ul>
    </Card>
  );
}

/* ---------- paper trades ---------- */

interface PaperLite {
  totals: { net: number; unrealized: number };
  risk: { openCount: number; dayPnl: number; weekPnl: number };
  stats: { closed: number; winRate: number | null };
  initialCapital: number;
}

function PaperCard({ onOpen }: { onOpen: () => void }) {
  const [paper, setPaper] = useState<PaperLite | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/paper", { cache: "no-store" });
        if (response.ok && alive) setPaper((await response.json()) as PaperLite);
      } catch { /* the card just stays empty */ }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const tone = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-rose-700" : "text-slate-900");
  return (
    <Card title="My paper trades" hint="Practice portfolio, net of costs" action={<button type="button" onClick={onOpen} className="text-xs font-bold text-emerald-700 hover:underline">Open →</button>}>
      {!paper ? <div className="skeleton h-24 rounded-xl" /> : (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Net P&L" value={money(paper.totals.net)} sub={`${((paper.totals.net / paper.initialCapital) * 100).toFixed(2)}% of capital`} tone={tone(paper.totals.net)} />
          <Stat label="Open orders" value={String(paper.risk.openCount)} sub="pending or open" />
          <Stat label="Today" value={money(paper.risk.dayPnl)} tone={tone(paper.risk.dayPnl)} />
          <Stat label="This week" value={money(paper.risk.weekPnl)} tone={tone(paper.risk.weekPnl)} />
          {paper.stats.closed === 0 && paper.risk.openCount === 0 && (
            <p className="col-span-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">No practice trades yet. Open a stock from the Weekly Top 5, then approve it in Today&apos;s Picks to start one. Nothing is spent: it uses live prices with simulated money.</p>
          )}
          {paper.stats.closed > 0 && <p className="col-span-2 text-[11px] text-slate-500">{paper.stats.closed} closed · {paper.stats.winRate != null ? `${Math.round(paper.stats.winRate * (paper.stats.winRate <= 1 ? 100 : 1))}% winners` : "no win rate yet"}</p>}
        </div>
      )}
    </Card>
  );
}

/* ---------- the board ---------- */

function LiveChip({ breadth }: { breadth: BreadthPayload | null }) {
  if (!breadth) return null;
  const time = new Date(breadth.updatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  const live = breadth.source.isRealtime;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <h2 className="text-lg font-black tracking-tight text-slate-900">Market overview</h2>
      <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-sm" title={breadth.source.label}>
        <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500 pulse-dot" : "bg-slate-400"}`} aria-hidden />
        {live ? "Live" : "Delayed"} · data as of {time} IST
      </span>
    </div>
  );
}

export function TodayBoard({ rows, sectors, advancing, declining, breakouts, failed, onNavigate }: {
  rows: ReadonlyArray<ScanRow>;
  sectors: ReadonlyArray<SectorSummary>;
  advancing: number;
  declining: number;
  breakouts: ReadonlyArray<FeedEvent>;
  failed: ReadonlyArray<FeedEvent>;
  onNavigate: (target: "picks" | "sectors" | "breakouts" | "journal") => void;
}) {
  const { data: breadth } = useBreadth();
  const { data: top5 } = useWeeklyTop5();
  // Which "Today in numbers" tile is open: its stocks show in a full-width panel under the three cards.
  const [openStat, setOpenStat] = useState<StatKey | null>(null);
  const statLists = useMemo(() => Object.fromEntries(STAT_KEYS.map((key) => [key, statItems(key, rows, breakouts, failed)])) as Record<StatKey, StatItem[]>, [rows, breakouts, failed]);
  const toggleStat = (key: StatKey) => setOpenStat((current) => (current === key ? null : key));
  return (
    <div className="space-y-4">
      <LiveChip breadth={breadth} />
      <TodayStrip />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
        <MarketGauge breadth={breadth} />
        <TrendCard breadth={breadth} />
        <StatsCard lists={statLists} open={openStat} toggle={toggleStat} advancing={advancing} declining={declining} qualifying={top5?.qualifying ?? null} above200={breadth?.latest?.above[200] ?? null} onPicks={() => onNavigate("picks")} />
      </div>
      {openStat && <StatList key={openStat} statKey={openStat} items={statLists[openStat]} outOf={openStat === "above200" ? rows.filter((r) => r.vs200 != null).length : undefined} onClose={() => setOpenStat(null)} />}
      <TopPicksSection rows={rows} onAll={() => onNavigate("picks")} />
      <div className="grid gap-4 lg:grid-cols-4">
        <SectorCard sectors={sectors} onAll={() => onNavigate("sectors")} />
        <ChangesCard breakouts={breakouts} failed={failed} onAll={() => onNavigate("breakouts")} />
        <PaperCard onOpen={() => onNavigate("journal")} />
      </div>
    </div>
  );
}
