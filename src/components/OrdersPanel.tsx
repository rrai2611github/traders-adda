"use client";

import { useCallback, useEffect, useState } from "react";

interface PanelOrder {
  order: { symbol: string; shares: number; buy: number; skipAbove: number; stop: number; stopPercent: number; invested: number; atRisk: number; warnings: string[] };
  payload: { limitPrice: number; offlineOrder: boolean };
}
interface Result { symbol: string; status: string; detail: string; orderId?: string }
interface OrdersView {
  mode: "dry-run" | "live";
  planDay: string | null;
  orders: PanelOrder[];
  skipped: { symbol: string; reason: string }[];
  fingerprint: string | null;
  afterMarket: boolean;
  blocks: string[];
  alreadySent: boolean;
  sentResults: Result[] | null;
  fyers: { configured: boolean; connected: boolean };
}

const px = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Tomorrow's orders": the plan's buys as broker orders, to review and approve with two clicks. A dry run unless the owner has switched
 * live orders on in .env.local; a dry run sends nothing. Only buys are sent: set each stop with your broker once the buy has filled.
 */
export function OrdersPanel() {
  const [view, setView] = useState<OrdersView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/orders", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<OrdersView>) : null))
      .then((next) => { if (next) setView(next); })
      .catch(() => { /* the panel keeps what it has */ });
  }, []);
  useEffect(() => {
    const id = setTimeout(load, 0);
    const timer = setInterval(load, 120_000);
    return () => { clearTimeout(id); clearInterval(timer); };
  }, [load]);

  const approve = async () => {
    if (!view?.fingerprint) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fingerprint: view.fingerprint }) });
      const body = await res.json();
      if (res.ok) setResults(body.results as Result[]); else setError(String(body?.error ?? "That did not work."));
    } catch { setError("Could not reach the server."); }
    setBusy(false); setConfirming(false); load();
  };

  if (!view) return null;
  const live = view.mode === "live";
  const shown = results ?? view.sentResults;
  const n = view.orders.length;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4" aria-label="Tomorrow's orders">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-extrabold text-slate-900">Tomorrow&apos;s orders{view.planDay ? <span className="ml-2 text-[11.5px] font-semibold text-slate-500">from the close of {view.planDay}</span> : null}</h2>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${live ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-700"}`} title={live ? "Approve places real orders with Fyers." : "Approve only checks and logs the orders. Nothing is sent to the broker."}>{live ? "Live: real orders" : "Dry run: nothing is sent"}</span>
      </div>

      {n === 0 ? (
        <p className="text-[12.5px] text-slate-600">{view.blocks.find((b) => !b.startsWith("There is nothing")) ?? "No buys fit for the next open. The plan only lists a buy when the market check passes and a breakout fits your account."}</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 text-[12.5px]">
            {view.orders.map(({ order, payload }) => (
              <li key={order.symbol} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <b className="w-28 text-slate-900">{order.symbol}</b>
                <span>Buy <b>{order.shares.toLocaleString("en-IN")}</b> shares</span>
                <span className="text-slate-600">planned ₹{px(order.buy)}, will not pay more than <b>₹{px(payload.limitPrice)}</b></span>
                <span className="text-slate-600">stop ₹{px(order.stop)} (−{order.stopPercent}%)</span>
                <span className="text-slate-600">₹{order.invested.toLocaleString("en-IN")} in, ₹{order.atRisk.toLocaleString("en-IN")} at risk</span>
                {order.warnings.length > 0 && <span className="w-full text-[11.5px] font-semibold text-amber-800">{order.warnings.join(" ")}</span>}
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] leading-5 text-slate-600">
            {view.afterMarket ? "The market is closed, so these go out as after-market orders for the next open. " : ""}
            Only the buys are sent. After a buy fills, set its stop with your broker (the stop price is shown above), then tap &quot;I bought it&quot; below so the exits are watched.
          </p>
        </>
      )}

      {view.skipped.length > 0 && <p className="text-[11.5px] text-slate-500">Not on the list: {view.skipped.map((s) => `${s.symbol} (${s.reason})`).join("; ")}.</p>}

      {n > 0 && view.blocks.length > 0 && !view.alreadySent && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">Cannot send yet: {view.blocks.join(" ")}</p>}
      {view.alreadySent && <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-700">These orders were already sent. Check your broker&apos;s order list.</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-800">{error}</p>}

      {n > 0 && view.blocks.length === 0 && !view.alreadySent && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white hover:bg-emerald-700">Review and approve {n} order{n === 1 ? "" : "s"}</button>
          ) : (
            <>
              <span className="text-[12px] font-semibold text-slate-800">{live ? `Place ${n} real order${n === 1 ? "" : "s"} with Fyers now?` : `Run a dry run of ${n} order${n === 1 ? "" : "s"}? Nothing will be sent.`}</span>
              <button type="button" disabled={busy} onClick={() => void approve()} className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60 ${live ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>{busy ? "Working…" : live ? "Yes, place them" : "Yes, run it"}</button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
            </>
          )}
        </div>
      )}

      {shown && shown.length > 0 && (
        <ul className="space-y-0.5 text-[12px]" aria-label="What happened to each order">
          {shown.map((r) => (
            <li key={r.symbol} className={r.status === "placed" ? "text-emerald-800" : r.status === "dry-run" ? "text-slate-700" : "font-semibold text-rose-800"}>
              <b>{r.symbol}</b>: {r.status === "placed" ? "placed" : r.status === "dry-run" ? "dry run" : r.status}. {r.detail}{r.orderId ? ` (order ${r.orderId})` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
