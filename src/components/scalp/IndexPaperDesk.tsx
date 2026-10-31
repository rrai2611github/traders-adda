"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { IndexPaperSnapshot, frameworkSignal } from "@/lib/paper/indexPaperServer";
import type { IndexKey, IndexSide, SquareOff } from "@/lib/paper/indexPaper";

type Signal = Awaited<ReturnType<typeof frameworkSignal>>;
type View = IndexPaperSnapshot["orders"][number];

const NAMES: Record<IndexKey, string> = { NIFTY: "Nifty 50", BANKNIFTY: "Bank Nifty" };
const rs = (v: number | null | undefined, sign = true) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const text = `₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
  return !sign ? text : v < 0 ? `−${text}` : v > 0 ? `+${text}` : text;
};
const tone = (v: number | null | undefined) => (v == null ? "text-slate-300" : v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-slate-300");
const px = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const clock = (t: number | null) => (t == null ? "" : new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }));
const ago = (ms: number | null) => (ms == null ? "—" : ms < 2000 ? "live" : ms < 60_000 ? `${Math.round(ms / 1000)}s old` : `${Math.round(ms / 60_000)} min old`);
const STATUS: Record<string, string> = { pending: "bg-amber-900/60 text-amber-200", open: "bg-sky-900/60 text-sky-200", closed: "bg-slate-800 text-slate-300", cancelled: "bg-slate-800 text-slate-500", expired: "bg-slate-800 text-slate-500" };

async function post(body: unknown): Promise<IndexPaperSnapshot> {
  const response = await fetch("/api/paper/index", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json()) as IndexPaperSnapshot & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `Request failed (${response.status}).`);
  return json;
}

interface Form { index: IndexKey; side: IndexSide; lots: string; type: "market" | "trigger"; trigger: string; stop: string; target: string; squareOff: SquareOff; source: "manual" | "framework" }
const BLANK: Form = { index: "NIFTY", side: "long", lots: "1", type: "market", trigger: "", stop: "", target: "", squareOff: "intraday", source: "manual" };

export function IndexPaperDesk() {
  const [snap, setSnap] = useState<IndexPaperSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signals, setSignals] = useState<Partial<Record<IndexKey, Signal | { error: string }>>>({});
  const [loadingSignal, setLoadingSignal] = useState<IndexKey | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/paper/index", { cache: "no-store" });
      const json = (await response.json()) as IndexPaperSnapshot & { error?: string };
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
      setSnap(json);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [refresh]);

  const act = async (body: unknown) => {
    setBusy(true);
    try { setSnap(await post(body)); setError(null); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); return false; }
    finally { setBusy(false); }
  };

  const check = async (index: IndexKey) => {
    setLoadingSignal(index);
    try {
      const response = await fetch(`/api/paper/index/signal?index=${index}`, { cache: "no-store" });
      const json = (await response.json()) as Signal & { error?: string };
      setSignals((s) => ({ ...s, [index]: response.ok ? json : { error: json.error ?? "Signal unavailable." } }));
    } catch {
      setSignals((s) => ({ ...s, [index]: { error: "Could not reach the server." } }));
    } finally { setLoadingSignal(null); }
  };

  const useProposal = (signal: Signal) => {
    if (!signal.proposal || !signal.setup) return;
    const p = signal.proposal;
    setForm({
      index: signal.index, side: signal.setup.dir === 1 ? "long" : "short", lots: String(Math.max(1, signal.sizing?.lots ?? 1)),
      type: p.entryType, trigger: p.entryType === "trigger" ? String(Math.round(p.entry * 100) / 100) : "", stop: String(Math.round(p.stop * 100) / 100),
      target: String(Math.round(p.target * 100) / 100), squareOff: "intraday", source: "framework",
    });
    document.getElementById("order-form")?.scrollIntoView({ behavior: "smooth" });
  };

  const lotSize = snap?.lotSizes[form.index] ?? 0;
  const live = snap?.quotes[form.index]?.price ?? null;
  const basis = form.type === "trigger" && Number(form.trigger) > 0 ? Number(form.trigger) : live;
  const estimate = useMemo(() => {
    const lots = Number(form.lots), stop = Number(form.stop);
    if (!basis || !lotSize || !(lots > 0) || !(stop > 0)) return null;
    return { risk: Math.abs(basis - stop) * lotSize * lots, margin: (basis * lotSize * lots * (snap?.settings.marginPercent ?? 12)) / 100 };
  }, [basis, lotSize, form.lots, form.stop, snap?.settings.marginPercent]);

  const place = async () => {
    const ok = await act({
      action: "place",
      order: { index: form.index, side: form.side, lots: Number(form.lots), trigger: form.type === "trigger" ? Number(form.trigger) : null, stop: Number(form.stop), target: form.target ? Number(form.target) : null, squareOff: form.squareOff, source: form.source },
    });
    if (ok) setForm((f) => ({ ...BLANK, index: f.index }));
  };

  const active = snap?.orders.filter((o) => o.status === "pending" || o.status === "open") ?? [];
  const history = snap?.orders.filter((o) => o.status !== "pending" && o.status !== "open") ?? [];
  const input = "w-full rounded-lg border border-slate-700 bg-[#060b16] px-2 py-1.5 font-mono text-sm text-slate-100";
  const label = "grid gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-400";

  return (
    <main className="min-h-screen bg-[#060b16] text-slate-200">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-3 py-3 sm:px-5">
        <header className="rounded-xl border border-slate-800 bg-[#0b1220] px-4 py-3">
          <div className="flex flex-wrap gap-3 text-xs font-bold text-sky-400">
            <Link href="/scalp" className="hover:underline">← Scalp Desk</Link>
            <Link href="/scalp/paper" className="hover:underline">Paper straddle →</Link>
            <Link href="/" className="hover:underline">Dashboard →</Link>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-white">Index Paper Desk</h1>
            <span className="rounded-full bg-amber-900/60 px-2 py-0.5 text-[10px] font-bold text-amber-200">PAPER · NO REAL ORDERS</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Nifty and Bank Nifty <b className="text-slate-200">near-month futures</b>, long or short, in lots, filled on live Fyers prices. The server engine manages stops, targets and the 15:15 square-off
            even with this page closed. Costs use the Scalp Desk futures model (brokerage, STT, exchange, GST, slippage). The checklist below is your daily-trend and hourly-entry framework; it is unproven, so this desk is how you test it.
          </p>
        </header>

        {snap && !snap.engine.fyers && (
          <div className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            Fyers is not connected today, so futures prices and fills are unavailable. <a href="/api/fyers/login" className="font-bold underline">Connect Fyers</a>.
          </div>
        )}
        {snap?.engine.pausedReason && snap.engine.fyers && <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">Engine paused: {snap.engine.pausedReason}.</div>}
        {snap && snap.risk.reasons.length > 0 && <div className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs font-bold text-rose-200">{snap.risk.reasons.join(" ")} New orders are blocked; open positions keep their stops and targets.</div>}
        {error && <div role="alert" className="flex justify-between gap-3 rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-200"><span>{error}</span><button type="button" className="font-bold underline" onClick={() => setError(null)}>Dismiss</button></div>}

        {snap && (
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Capital" value={rs(snap.capital, false)} />
            <Stat label="Free margin" value={rs(snap.freeMargin, false)} hint={`${rs(snap.risk.marginUsed, false)} used`} />
            <Stat label="Today" value={rs(snap.risk.dayPnl)} cls={tone(snap.risk.dayPnl)} hint={`limit −${rs(snap.risk.dayLimit, false)}`} />
            <Stat label="This week" value={rs(snap.risk.weekPnl)} cls={tone(snap.risk.weekPnl)} hint={`limit −${rs(snap.risk.weekLimit, false)}`} />
            <Stat label="Trades today" value={`${snap.risk.tradesToday} of ${snap.settings.maxTradesPerDay}`} hint={`${snap.risk.lossesToday} losers (max ${snap.settings.maxLossesPerDay})`} />
            <Stat label="Net after costs" value={rs(snap.stats.net)} cls={tone(snap.stats.net)} hint={`${snap.stats.closed} closed`} />
            <Stat label="Win rate" value={snap.stats.winRate == null ? "—" : `${snap.stats.winRate.toFixed(0)}%`} hint={snap.stats.expectancyR == null ? undefined : `${snap.stats.expectancyR.toFixed(2)}R expectancy`} />
            <Stat label="Futures price" value={(["NIFTY", "BANKNIFTY"] as IndexKey[]).map((i) => snap.quotes[i] ? `${i === "NIFTY" ? "N" : "BN"} ${px(snap.quotes[i]!.price)}` : "").filter(Boolean).join(" · ") || "—"} hint={`feed ${ago(snap.engine.quoteAgeMs)} · alerts ${snap.engine.alerts ? "email" : "off"}`} small />
          </section>
        )}

        {snap && (
          <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-black text-white">Auto-paper mode</h2>
              <button
                type="button"
                role="switch"
                aria-checked={snap.auto.enabled}
                disabled={busy}
                onClick={() => void act({ action: "auto", auto: { enabled: !snap.auto.enabled } })}
                className={`rounded-full px-3 py-1 text-xs font-black ${snap.auto.enabled ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
              >
                {snap.auto.enabled ? "ON" : "OFF"}
              </button>
              {(["NIFTY", "BANKNIFTY"] as IndexKey[]).map((index) => (
                <label key={index} className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={snap.auto.indexes.includes(index)}
                    onChange={(event) => {
                      const next = event.target.checked ? [...snap.auto.indexes, index] : snap.auto.indexes.filter((i) => i !== index);
                      if (next.length) void act({ action: "auto", auto: { indexes: next } });
                    }}
                  />
                  {NAMES[index]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              When ON, once per completed hourly bar (10:16 to 14:30) the server reads the framework below and places the <b className="text-slate-200">paper</b> order itself, but only if the daily regime is aligned,
              every hourly condition is measured and passing, at least one lot fits the 1% risk and free margin, no trade or loss limit is hit, and that index has no open order. Intraday only (15:15 square-off). Nothing real is ever sent.
            </p>
            {snap.auto.log.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px]">
                {snap.auto.log.slice(0, 6).map((entry) => (
                  <li key={`${entry.at}-${entry.index}`} className={entry.result === "placed" ? "text-emerald-300" : "text-slate-500"}>
                    {clock(entry.at)} · {NAMES[entry.index]} · {entry.result === "placed" ? "PLACED" : "skipped"}: {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="grid gap-3 lg:grid-cols-2">
          {(["NIFTY", "BANKNIFTY"] as IndexKey[]).map((index) => (
            <FrameworkCard key={index} index={index} signal={signals[index]} loading={loadingSignal === index} onCheck={() => void check(index)} onUse={useProposal} />
          ))}
        </section>

        <section id="order-form" className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
          <h2 className="text-sm font-black text-white">New paper order {form.source === "framework" && <span className="ml-2 rounded bg-sky-900/60 px-1.5 py-0.5 text-[10px] text-sky-200">from the framework</span>}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <label className={label}>Index<select className={input} value={form.index} onChange={(e) => setForm({ ...form, index: e.target.value as IndexKey })}><option value="NIFTY">Nifty</option><option value="BANKNIFTY">Bank Nifty</option></select></label>
            <label className={label}>Side<select className={input} value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as IndexSide })}><option value="long">Long (buy)</option><option value="short">Short (sell)</option></select></label>
            <label className={label}>Lots ({lotSize || "—"} each)<input className={input} type="number" min="1" step="1" value={form.lots} onChange={(e) => setForm({ ...form, lots: e.target.value })} /></label>
            <label className={label}>Entry<select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Form["type"] })}><option value="market">Market, now</option><option value="trigger">{form.side === "long" ? "Buy above" : "Sell below"}</option></select></label>
            <label className={label}>Trigger<input className={input} type="number" step="0.05" disabled={form.type === "market"} value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} /></label>
            <label className={label}>Stop loss<input className={input} type="number" step="0.05" value={form.stop} onChange={(e) => setForm({ ...form, stop: e.target.value })} /></label>
            <label className={label}>Target (optional)<input className={input} type="number" step="0.05" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>
            <label className={label}>Exit<select className={input} value={form.squareOff} onChange={(e) => setForm({ ...form, squareOff: e.target.value as SquareOff })}><option value="intraday">Square off 15:15</option><option value="carry">Carry overnight</option></select></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span>Price now: <b className="text-slate-200">{px(live)}</b></span>
            {estimate && <span>Risk to stop <b className={estimate.risk > (snap?.capital ?? 0) * (snap?.settings.riskPercent ?? 1) / 100 ? "text-rose-400" : "text-slate-200"}>{rs(estimate.risk, false)}</b> (limit {rs((snap?.capital ?? 0) * (snap?.settings.riskPercent ?? 1) / 100, false)}) · margin about <b className="text-slate-200">{rs(estimate.margin, false)}</b></span>}
            <button type="button" disabled={busy || !snap?.engine.fyers} onClick={() => void place()} className="ml-auto rounded-lg bg-sky-600 px-4 py-2 text-xs font-black text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40">Place paper order</button>
          </div>
          {form.squareOff === "carry" && <p className="mt-2 text-[11px] text-amber-300">A carried futures position can gap overnight past its stop and fills at the next price seen; near-month futures also expire, so close before expiry.</p>}
        </section>

        <OrdersTable title="Open and pending" orders={active} busy={busy} onCancel={(id) => void act({ action: "cancel", id })} onClose={(id) => void act({ action: "close", id })} empty="No open or pending index paper orders." />
        <OrdersTable title="History" orders={history} busy={busy} empty="No closed orders yet." />

        <p className="px-1 pb-4 text-[11px] leading-5 text-slate-500">
          Fills use the last futures price seen, about every 4 seconds, so a brief spike through a stop can be missed and a gap fills at the next price. Margin is estimated at {snap?.settings.marginPercent ?? 12}% of contract value.
          Costs are estimates. Paper results usually look better than real trading. Nothing here places a broker order.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value, hint, cls = "text-white", small }: { label: string; value: string; hint?: string; cls?: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0b1220] px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono font-black ${small ? "text-[11px]" : "text-sm"} ${cls}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

function Checks({ title, checks }: { title: string; checks: Array<{ label: string; value: string; pass: boolean | null }> }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{title}</div>
      <ul className="space-y-0.5 text-xs">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start justify-between gap-2">
            <span className={c.pass === true ? "text-emerald-300" : c.pass === false ? "text-slate-400" : "text-amber-300"}>
              {c.pass === true ? "✓" : c.pass === false ? "✗" : "–"} {c.label}
            </span>
            <span className="shrink-0 font-mono text-slate-400">{c.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FrameworkCard({ index, signal, loading, onCheck, onUse }: { index: IndexKey; signal: Signal | { error: string } | undefined; loading: boolean; onCheck: () => void; onUse: (s: Signal) => void }) {
  const ok = signal && !("error" in signal) ? signal : null;
  const regime = ok?.regime;
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black text-white">{NAMES[index]} · framework check</h2>
        <button type="button" onClick={onCheck} disabled={loading} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-sky-300 hover:bg-slate-700 disabled:opacity-50">{loading ? "Checking…" : signal ? "Re-check" : "Check now"}</button>
      </div>
      {signal && "error" in signal && <p className="mt-2 text-xs text-rose-300">{signal.error}</p>}
      {!signal && <p className="mt-2 text-xs text-slate-500">Reads the daily trend (six checks) and, when the daily regime is aligned, the hourly setup on live futures data.</p>}
      {ok && (
        <div className="mt-3 space-y-3">
          <p className={`rounded-lg px-3 py-2 text-xs font-bold ${ok.setup?.allPass ? "bg-emerald-950/60 text-emerald-200" : "bg-slate-900 text-slate-300"}`}>{ok.verdict}</p>
          {regime && <Checks title={`Daily regime · ${regime.state === "bull" ? "BULLISH" : regime.state === "bear" ? "BEARISH" : "not aligned"}`} checks={regime.state === "bear" ? regime.bear : regime.bull} />}
          {ok.setup && <Checks title={`Hourly ${ok.setup.dir === 1 ? "long" : "short"} setup${ok.setup.breakoutConfirmed ? " · breakout confirmed" : " · waiting for the breakout"}`} checks={ok.setup.checks} />}
          {ok.proposal && ok.setup && (
            <div className="rounded-lg border border-sky-900 bg-sky-950/30 p-3 text-xs">
              <b className="text-sky-200">{ok.setup.dir === 1 ? "Long" : "Short"} · {ok.proposal.entryType === "market" ? "enter at market" : `${ok.setup.dir === 1 ? "buy above" : "sell below"} ${px(ok.proposal.entry)}`}</b>
              <div className="mt-1 font-mono text-slate-300">Stop {px(ok.proposal.stop)} · target (2R) {px(ok.proposal.target)} · risk {px(ok.proposal.riskPoints)} pts</div>
              {ok.sizing && <div className="mt-1 text-slate-400">Size at 1% risk: <b className="text-slate-200">{ok.sizing.lots} lot{ok.sizing.lots === 1 ? "" : "s"}</b>{ok.sizing.limitedBy !== "none" ? ` (limited by ${ok.sizing.limitedBy})` : ""} · risk {rs(ok.sizing.riskAmount, false)}</div>}
              {ok.setup.unmeasured > 0 && <div className="mt-1 text-amber-300">{ok.setup.unmeasured} condition could not be measured and is not counted as a pass.</div>}
              <button type="button" disabled={ok.entryBlocked || (ok.sizing?.lots ?? 0) < 1} onClick={() => onUse(ok)} className="mt-2 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-black text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40">Fill the order form</button>
            </div>
          )}
          <p className="text-[10px] text-slate-500">Futures {ok.contract} at {px(ok.futuresPrice)} · breadth {ok.breadthPercent == null ? "n/a" : `${ok.breadthPercent.toFixed(0)}%`} · VWAP {px(ok.vwap)} · {clock(ok.asOf)} IST</p>
        </div>
      )}
    </div>
  );
}

function OrdersTable({ title, orders, busy, onCancel, onClose, empty }: { title: string; orders: View[]; busy: boolean; onCancel?: (id: string) => void; onClose?: (id: string) => void; empty: string }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-[#0b1220]">
      <h2 className="border-b border-slate-800 px-4 py-2.5 text-sm font-black text-white">{title}</h2>
      {orders.length === 0 ? <p className="px-4 py-3 text-xs text-slate-500">{empty}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Entry</th><th className="px-3 py-2 text-right">Stop</th><th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-right">Last / exit</th><th className="px-3 py-2 text-right">Gross</th><th className="px-3 py-2 text-right">Costs</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-slate-800">
                  <td className="px-3 py-2"><b className="text-white">{o.side === "long" ? "BUY" : "SELL"} {o.lots} × {NAMES[o.index]}</b><div className="text-[10px] text-slate-500">{clock(o.createdAt)}{o.source === "framework" ? " · framework" : ""} · {o.squareOff === "intraday" ? "15:15 square-off" : "carry"}{o.trigger != null ? ` · ${o.side === "long" ? "above" : "below"} ${px(o.trigger)}` : ""}</div></td>
                  <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS[o.status]}`}>{o.status}{o.exitReason ? ` · ${o.exitReason}` : ""}</span></td>
                  <td className="px-3 py-2 text-right font-mono">{px(o.entryPrice)}</td>
                  <td className="px-3 py-2 text-right font-mono text-rose-300">{px(o.stop)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300">{px(o.target)}</td>
                  <td className="px-3 py-2 text-right font-mono">{px(o.status === "closed" ? o.exitPrice : o.lastPrice)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${tone(o.grossPnl)}`}>{o.entryPrice == null ? "—" : rs(o.grossPnl)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">{o.entryPrice == null ? "—" : rs(o.costs, false)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${tone(o.netPnl)}`}>{o.entryPrice == null ? "—" : rs(o.netPnl)}</td>
                  <td className="px-3 py-2 text-right">
                    {o.status === "pending" && onCancel && <button type="button" disabled={busy} onClick={() => onCancel(o.id)} className="rounded bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-200 hover:bg-slate-700">Cancel</button>}
                    {o.status === "open" && onClose && <button type="button" disabled={busy} onClick={() => onClose(o.id)} className="rounded bg-rose-900/70 px-2 py-1 text-[11px] font-bold text-rose-100 hover:bg-rose-800">Close now</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
