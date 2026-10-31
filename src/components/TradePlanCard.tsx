"use client";

import { useEffect, useMemo, useState } from "react";
import { buildTradePlan, DEFAULT_RISK_BY_TIER, type PlanInputs, type TradePlan } from "@/lib/screen/tradePlan";
import type { Top5Size } from "@/lib/screen/weeklyTop5";
import { formatPrice } from "@/lib/format";
import { useAccountSize } from "@/hooks/useAccountSize";
import { useBreadth } from "@/hooks/useBreadth";
import { useNiftyTrend } from "@/hooks/useNiftyTrend";
import { useResultsDates } from "@/hooks/useResultsDates";
import { daysUntil } from "@/lib/market/boardMeetings";
import { checkOrder, verdictLine } from "@/lib/risk/riskGate";
import { setupStatus } from "@/lib/screen/setupGate";

interface PlanResponse {
  symbol: string;
  asOf: number;
  provisional: boolean;
  inputs: PlanInputs;
  breadth50: number | null;
  size: Top5Size;
}

const STORAGE_KEY = "traders-adda:plan-size";
const inr = (v: number) => `₹${formatPrice(v)}`;
const money = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const pct = (to: number, from: number) => {
  const p = ((to - from) / from) * 100;
  return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;
};

const SIZE_STYLE = {
  full: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  quarter: "bg-amber-50 text-amber-800 ring-amber-200",
  paper: "bg-rose-50 text-rose-800 ring-rose-200",
} as const;

function Rung({ kind, tone, title, price, delta, note }: { kind: string; tone: "up" | "buy" | "down"; title: string; price: string; delta?: string; note: string }) {
  const style = tone === "up" ? "border-emerald-200 bg-emerald-50/60" : tone === "buy" ? "border-sky-200 bg-sky-50/70" : "border-rose-200 bg-rose-50/60";
  const badge = tone === "up" ? "bg-emerald-600" : tone === "buy" ? "bg-sky-600" : "bg-rose-600";
  const text = tone === "up" ? "text-emerald-800" : tone === "buy" ? "text-sky-800" : "text-rose-800";
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${style}`}>
      <span className={`w-12 shrink-0 rounded-md py-1 text-center text-[11px] font-black uppercase tracking-wide text-white ${badge}`}>{kind}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-black text-slate-800">{title}</div>
        <div className="truncate text-[11px] text-slate-500">{note}</div>
      </div>
      <div className="text-right">
        <div className={`font-mono text-base font-black ${text}`}>{price}</div>
        {delta && <div className="font-mono text-[11px] font-bold text-slate-500">{delta}</div>}
      </div>
    </div>
  );
}

/**
 * Buy near, stop, two targets and a trailing exit for one stock, with a position-size calculator. The stop and the 3R target are
 * the tested rule; every level is computed from the last daily candles (the forming candle while the market is open).
 */
/** The real positions from My positions, in the shape the risk check wants, so it can enforce the position and open-risk limits. */
function useHeldPositions(): Array<{ symbol: string; quantity: number; last: number; stop: number }> {
  const [held, setHeld] = useState<Array<{ symbol: string; quantity: number; last: number; stop: number }>>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/positions", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((view: { open?: Array<{ holding: { symbol: string; qty: number; buyPrice: number; stop: number }; assessment: { last: number | null } }> } | null) => {
        if (alive && view?.open) setHeld(view.open.map((p) => ({ symbol: p.holding.symbol, quantity: p.holding.qty, last: p.assessment.last ?? p.holding.buyPrice, stop: p.holding.stop })));
      })
      .catch(() => { /* the check then assumes nothing is held, as before */ });
    return () => { alive = false; };
  }, []);
  return held;
}

export function TradePlanCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One account size for the whole app (shared with the position-size calculator and My positions).
  const { accountSize: capital, setAccountSize: setCapital } = useAccountSize();
  const [riskOverride, setRiskOverride] = useState<number | null>(null);

  // The saved risk is read in the browser once the card is on screen (it is not known on the server).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { risk?: number | null } | null;
        if (saved?.risk && saved.risk > 0) setRiskOverride(saved.risk);
      } catch { /* private window: defaults are fine */ }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    // The drawer keys this card by symbol, so a new stock mounts it fresh: no data and no error to clear here.
    (async () => {
      try {
        const response = await fetch(`/api/market/trade-plan?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!alive) return;
        if (!response.ok) { setError(body.error ?? `Plan unavailable (HTTP ${response.status}).`); return; }
        setData(body as PlanResponse);
      } catch (failure) {
        if (!controller.signal.aborted && alive) setError(failure instanceof Error ? failure.message : "Plan unavailable.");
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [symbol]);

  const risk = riskOverride ?? (data ? DEFAULT_RISK_BY_TIER[data.size.key] : 0.25);
  const plan: TradePlan | null = useMemo(() => (data ? buildTradePlan(data.inputs, { capital, riskPercent: risk }, { kind: "percent", percent: 12 }) : null), [data, capital, risk]);
  const { data: breadth } = useBreadth();
  const nifty = useNiftyTrend();
  const results = useResultsDates();
  const held = useHeldPositions();

  const save = (nextRisk: number | null) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ risk: nextRisk })); } catch { /* not saved */ }
  };

  if (error) return <section className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-sm"><b className="text-slate-800">Trade plan.</b> {error}</section>;
  if (!data || !plan) return <section className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-sm">Working out the trade plan…</section>;

  const s = plan.sizing;
  const marketOk = (() => { const gate = setupStatus(breadth?.latest?.above[50] ?? null, nifty); return gate.breadthOk == null && gate.niftyOk == null ? null : gate.allowed; })();
  const gate = s && s.quantity > 0
    ? checkOrder(
      { symbol, quantity: s.quantity, entry: plan.entry, stop: plan.stop, resultsInDays: results ? (results.dates[symbol] ? daysUntil(results.dates[symbol], results.today) : null) : null },
      { accountValue: capital, openPositions: held, newToday: 0, dayChangePercent: null, marketOk },
    )
    : null;
  return (
    <section aria-label="Trade plan" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">Trade plan</h3>
          <p className="text-[11px] text-slate-500">From the {data.provisional ? "forming candle (market open)" : "last close"}. Buy near the price, never above the skip level.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-black ring-1 ${SIZE_STYLE[data.size.key]}`} title={data.size.detail}>{data.size.label}</span>
      </div>

      <div className="mt-3 space-y-1.5">
        {plan.trailSma50 != null && <Rung kind="Sell" tone="up" title="Exit · close under 50-day average" price={inr(plan.trailSma50)} note="Hold while it closes above this line, sell after a close below it. This is the tested exit" />}
        <Rung kind="Sell" tone="up" title="Optional · book part at 2R" price={inr(plan.t1)} delta={pct(plan.t1, plan.entry)} note="Sell some here if you like locking profit; the backtest did better holding all of it" />
        <Rung kind="Buy" tone="buy" title="Buy near" price={inr(plan.entry)} note={`Skip it if the stock opens above ${inr(plan.skipAbove)} (+5%)`} />
        <Rung kind="Stop" tone="down" title={plan.stopKind === "percent" ? "Stop loss · 12% below" : "Stop loss · 2 × ATR"} price={inr(plan.stop)} delta={pct(plan.stop, plan.entry)} note={`Exit everything if it trades below. Risk ${inr(plan.riskPerShare)} a share`} />
      </div>

      {plan.stopKind === "percent" && plan.atrStopPercent > 12 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
          ⚠ This stock swings a lot: its normal daily range puts a 2 × ATR stop {plan.atrStopPercent.toFixed(1)}% away ({inr(plan.atrStop)}), so even the 12% stop can be hit by ordinary moves. Expect more stop-outs, or buy fewer shares.
        </p>
      )}
      {plan.wideStop && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
          ⚠ The stop is {plan.stopPercent.toFixed(1)}% away, wider than most. That is a volatile stock, not a bad one. Buy fewer shares so the stop costs the same.
        </p>
      )}
      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        Other references: 2 × ATR stop {inr(plan.atrStop)} ({pct(plan.atrStop, plan.entry)}), swing-low stop {inr(plan.swingStop)} ({pct(plan.swingStop, plan.entry)}). The 12% stop is the one the live strategy check follows: in the 10-year test it stopped out less often than 8% and had a shallower worst drop.
        {plan.resistance ? ` The 52-week high is ${inr(plan.resistance.price)} (${pct(plan.resistance.price, plan.entry)} away), where sellers may appear.` : " It is at its 52-week high, so there is no old high above it."}
      </p>

      <div className="mt-3 rounded-xl bg-slate-50 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] font-bold text-slate-600">
            Capital ₹
            <input
              type="number" min={1000} step={10000} value={capital}
              onChange={(event) => { const v = Number(event.target.value); if (v > 0) setCapital(v); }}
              className="mt-1 block w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-900"
            />
          </label>
          <label className="text-[11px] font-bold text-slate-600">
            Risk per trade %
            <input
              type="number" min={0.05} max={2} step={0.05} value={risk}
              onChange={(event) => { const v = Number(event.target.value); if (v > 0) { setRiskOverride(v); save(v); } }}
              className="mt-1 block w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-900"
            />
          </label>
          <p className="min-w-0 flex-1 text-[11px] leading-5 text-slate-500">Default for today&apos;s market: {DEFAULT_RISK_BY_TIER[data.size.key]}%. {data.size.detail}</p>
        </div>
        {s && s.quantity > 0 ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
            <div><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Shares</dt><dd className="font-mono text-base font-black text-slate-900">{s.quantity.toLocaleString("en-IN")}</dd></div>
            <div><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Invested</dt><dd className="font-mono font-black text-slate-900">{money(s.invested)}</dd></div>
            <div><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Loss at stop</dt><dd className="font-mono font-black text-rose-700">−{money(s.maxLoss)}</dd></div>
            <div><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Gain at T1 (half)</dt><dd className="font-mono font-black text-emerald-700">+{money(s.gainT1 / 2)}</dd></div>
            <div><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Gain at T2 (all)</dt><dd className="font-mono font-black text-emerald-700">+{money(s.gainT2)}</dd></div>
          </dl>
        ) : (
          <p className="mt-3 text-xs text-slate-500">Capital is too small for one share at this price and risk.</p>
        )}
        {s?.cappedByCapital && <p className="mt-2 text-[11px] text-amber-800">The position is capped by your capital, so the stop will cost less than {risk}%.</p>}
        {gate && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-[11.5px] leading-5 ${gate.verdict === "PASS" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : gate.verdict === "WARN" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
            <b>Risk check: {gate.verdict}.</b> {verdictLine(gate)}
            <span className="mt-0.5 block text-[11px] opacity-70">This checks the one order against your capital. Positions you already hold are not counted here; the Live strategy check counts them.</span>
          </div>
        )}
      </div>

      <a
        href={`/positions?symbol=${encodeURIComponent(symbol)}&buy=${plan.entry}&stop=${plan.stop}`}
        className="mt-3 block rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-sm hover:border-emerald-500 hover:text-emerald-700"
      >
        Bought it? Add it to My positions with this plan filled in →
      </a>

      <p className="mt-2 text-[11px] leading-4 text-slate-400">
        10-year backtest (2016–2026): buying Blue sky and Multi-year breakouts with a 12% stop and the exit under the 50-day average made about 46% a year with a worst drop of about 21%, but only about 45% of trades win. The history only includes stocks listed today, so real results are likely lower. Fixed targets did worse than holding with the exit. Research output, not advice.
      </p>
    </section>
  );
}
