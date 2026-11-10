"use client";

import { useCallback, useEffect, useState } from "react";

interface PanelOrder {
  order: { symbol: string; shares: number; buy: number; skipAbove: number; stop: number; stopPercent: number; invested: number; atRisk: number; warnings: string[] };
  payload: { limitPrice: number; offlineOrder: boolean };
}
interface Result {
  symbol: string;
  status: string;
  detail: string;
  orderId?: string;
  brokerState?: "pending" | "partially-filled" | "filled" | "cancelled" | "rejected" | "expired" | "unknown";
  filledQty?: number;
  remainingQuantity?: number;
  tradedPrice?: number;
  brokerMessage?: string;
}
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
  orderStatusError?: string;
  fyers: { configured: boolean; connected: boolean };
}

const px = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brokerStateLabel: Record<NonNullable<Result["brokerState"]>, string> = {
  pending: "Pending at broker",
  "partially-filled": "Partially filled",
  filled: "Filled",
  cancelled: "Cancelled",
  rejected: "Rejected",
  expired: "Expired",
  unknown: "Status unresolved",
};
const resultTone = (result: Result) => {
  if (result.brokerState === "filled" || result.status === "placed" && !result.brokerState) return "text-emerald-800";
  if (result.brokerState === "partially-filled" || result.brokerState === "pending") return "font-semibold text-amber-800";
  if (result.brokerState === "cancelled" || result.brokerState === "rejected" || result.brokerState === "expired" || result.brokerState === "unknown" || result.status === "rejected" || result.status === "unknown") return "font-semibold text-rose-800";
  return "text-slate-700";
};

/**
 * "Tomorrow's orders": proposed buys require explicit review and confirmation. A dry run unless live orders are enabled; only buys are
 * sent, and confirmed live orders are reconciled against the broker's order book.
 */
export function OrdersPanel() {
  const [view, setView] = useState<OrdersView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (!res.ok) throw new Error(`Order plan refresh failed (${res.status}).`);
      setView((await res.json()) as OrdersView);
      setLoadError("");
    } catch {
      setLoadError("Could not refresh the order plan. The last displayed plan may be out of date.");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 30_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
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

  if (!view) return loadError ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{loadError}</p> : null;
  const live = view.mode === "live";
  const shown = results ?? view.sentResults;
  const n = view.orders.length;

  return (
    <section id="order-approvals" className="scroll-mt-20 space-y-3 rounded-2xl border border-border bg-surface p-4" aria-label="Order approvals">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-extrabold text-slate-900">Order approvals{view.planDay ? <span className="ml-2 text-[11.5px] font-semibold text-slate-500">· plan from {view.planDay}</span> : null}</h2>
          <p className="mt-1 text-[12px] text-slate-600">These are proposed real buys, separate from your paper strategy and position journal. No order is sent until you review and confirm.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${live ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"}`} title={live ? "A confirmed approval can place real orders with Fyers." : "Approval only checks and logs these orders. Nothing is sent to the broker."}>{live ? "Real orders enabled" : "Dry run · no broker order"}</span>
      </div>

      <details className="rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
        <summary className="cursor-pointer font-bold text-slate-800">How approval works</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-5">
          <li>Review each proposed buy, quantity, limit price and stop below.</li>
          <li>Select <b>Review and approve</b>, then confirm on the next prompt. That second confirmation is required for every submission.</li>
          <li>In dry-run mode, it only records a simulation. Real orders require live order mode and an active Fyers login; the confirm action then sends the listed buys to Fyers.</li>
          <li>After a real buy fills, verify the quantity and average price with Fyers, set its stop in your broker, then enter the actual fill under <b>Your real positions</b>. The app does not sync broker holdings or submit sell orders.</li>
        </ol>
      </details>

      {loadError && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">{loadError}</p>}
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
      {live && shown?.some((result) => result.orderId) && <p className="text-[11px] text-slate-500">Broker status is checked from today&apos;s Fyers order book every 30 seconds. Verify fills in Fyers before recording them in your positions.</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-800">{error}</p>}
      {view.orderStatusError && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">{view.orderStatusError} Do not submit the same orders again until you verify them with Fyers.</p>}

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
            <li key={r.symbol} className={resultTone(r)}>
              <b>{r.symbol}</b>: {r.brokerState ? brokerStateLabel[r.brokerState] : r.status === "placed" ? "Submitted to Fyers" : r.status === "dry-run" ? "Dry run; nothing sent" : r.status}. {r.detail}
              {r.filledQty != null ? ` Filled ${r.filledQty}${r.remainingQuantity != null ? ` · ${r.remainingQuantity} remaining` : ""}${r.tradedPrice ? ` at ₹${px(r.tradedPrice)}` : ""}.` : ""}
              {r.brokerMessage ? ` ${r.brokerMessage}` : ""}{r.orderId ? ` (order ${r.orderId})` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
