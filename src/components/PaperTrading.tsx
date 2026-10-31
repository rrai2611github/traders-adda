"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/format";
import { isDemoPaperOrder, type PaperFill, type PaperOrder } from "@/lib/screen/paperTrading";
import type { PaperSnapshot } from "@/lib/paper/paperServer";
import { StockSymbolButton } from "./StockDetailContext";

const currency = (amount: number) => `₹${formatPrice(amount)}`;
const signed = (amount: number) => `${amount > 0 ? "+" : amount < 0 ? "−" : ""}₹${formatPrice(Math.abs(amount))}`;
const pnlTone = (amount: number) => (amount > 0 ? "text-emerald-700" : amount < 0 ? "text-rose-700" : "text-slate-600");
const dateTime = (timestamp: number) => new Date(timestamp).toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
const STATUS_STYLE: Record<PaperOrder["status"], string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  open: "bg-sky-50 text-sky-800 ring-sky-200",
  closed: "bg-slate-100 text-slate-700 ring-slate-200",
  cancelled: "bg-slate-50 text-slate-500 ring-slate-200",
  expired: "bg-slate-50 text-slate-500 ring-slate-200",
};
const STATUS_LABEL: Record<PaperOrder["status"], string> = {
  pending: "Order pending",
  open: "Holding",
  closed: "Exited",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Money figures for one order: cost of the BUY, value still held at the last seen price, and P&L. */
function orderMoney(order: PaperOrder) {
  const invested = order.entryPrice === null ? 0 : order.entryPrice * order.filledQuantity;
  const holding = order.status === "open" ? order.remainingQuantity : 0;
  const lastPrice = order.lastObservedPrice ?? order.entryPrice;
  const holdingCost = holding * (order.entryPrice ?? 0);
  const currentValue = holding * (lastPrice ?? 0);
  const unrealized = currentValue - holdingCost;
  const total = order.realizedPnl + unrealized;
  return { invested, holding, holdingCost, currentValue, unrealized, total, lastPrice, totalPercent: invested ? (total / invested) * 100 : 0 };
}

function portfolioStats(orders: PaperOrder[], initialCapital: number) {
  let realized = 0, holdingCost = 0, currentValue = 0, blocked = 0;
  for (const order of orders) {
    const money = orderMoney(order);
    realized += order.realizedPnl;
    holdingCost += money.holdingCost;
    currentValue += money.currentValue;
    if (order.status === "pending") blocked += order.quantity * order.plan.buyZoneHigh;
  }
  return { realized, holdingCost, currentValue, unrealized: currentValue - holdingCost, blocked, cash: initialCapital + realized - holdingCost - blocked };
}

export function PaperTrading({
  orders,
  initialCapital,
  onCapitalChange,
  onCancel,
  onCloseNow,
  onRemoveDemo,
  error,
  onClearError,
  connected,
  ready,
  snapshot,
}: {
  orders: PaperOrder[];
  initialCapital: number;
  onCapitalChange: (value: number) => void;
  onCancel: (id: string) => void;
  onCloseNow: (id: string, exitPrice: number) => void;
  onRemoveDemo: () => void;
  error: string | null;
  onClearError: () => void;
  connected: boolean;
  ready: boolean;
  snapshot: PaperSnapshot | null;
}) {
  const [capitalInput, setCapitalInput] = useState(String(initialCapital));
  const [closingId, setClosingId] = useState<string | null>(null);
  const demo = orders.filter(isDemoPaperOrder);
  const real = orders.filter((o) => !isDemoPaperOrder(o));
  // With only demo orders loaded, the summary illustrates them (labelled); real orders always take precedence.
  const showingDemo = real.length === 0 && demo.length > 0;
  const stats = portfolioStats(showingDemo ? demo : real, initialCapital);
  const pending = real.filter((o) => o.status === "pending").length;
  const open = real.filter((o) => o.status === "open").length;
  const trades = orders
    .flatMap((order) => order.fills.map((fill) => ({ order, fill })))
    .sort((a, b) => b.fill.timestamp - a.fill.timestamp);

  return (
    <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm" aria-label="Paper trading">
      <header className="border-b border-violet-100 bg-violet-50 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-black text-violet-950">Paper trading · simulation only</h2>
          <span className="text-xs font-bold text-violet-700">{pending} pending · {open} holding</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-violet-900">
          Approve a confirmed Buy ready setup in Today&apos;s Picks (Last close). A simulated entry waits for a later live quote above the trigger.
          No broker orders are sent. The server engine watches live quotes for pending and open orders every few seconds, even when this page is closed, and emails fills, stops and a day summary to you.
          The current swing selection has no proven positive backtest edge. For Nifty and Bank Nifty futures, long or short, use the <a href="/scalp/index-paper" className="font-bold underline">Index Paper Desk</a>.
        </p>
        {pending + open === 0
          ? <p className="mt-2 font-bold text-slate-600">No pending or open paper orders, so the engine is idle. It starts watching live quotes the moment you approve one.</p>
          : !connected && <p className="mt-2 font-bold text-amber-700">Paper fills are paused: {snapshot?.engine.pausedReason ?? (snapshot ? "the engine is waiting for its next check" : "loading the engine status")}.</p>}
      </header>
      <div className="space-y-5 p-5">
        {error && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <span>{error}</span>
            <button type="button" onClick={onClearError} className="font-bold underline">Dismiss</button>
          </div>
        )}
        {demo.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-900">
            <span>
              <b>{demo.length} DEMO order{demo.length === 1 ? "" : "s"}</b>: replays of past Buy ready signals on real 5-minute prices, shown only to illustrate the records.
              They are not live, never fill or exit, and are excluded from your real paper capital and P&amp;L.
            </span>
            <button type="button" onClick={onRemoveDemo} className="font-bold underline">Remove demo data</button>
          </div>
        )}

        <div>
          {showingDemo && <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-fuchsia-700">Summary of demo orders</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Starting capital" value={currency(initialCapital)} />
            <Stat label="Available cash" value={currency(stats.cash)} hint={stats.blocked ? `${currency(stats.blocked)} blocked for pending orders` : undefined} />
            <Stat label="Invested (holdings)" value={currency(stats.holdingCost)} />
            <Stat label="Current value" value={currency(stats.currentValue)} hint="At the last price seen" />
            <Stat label="Unrealized P&L" value={signed(stats.unrealized)} tone={pnlTone(stats.unrealized)} />
            <Stat label="Realized P&L" value={signed(stats.realized)} tone={pnlTone(stats.realized)} />
          </div>
        </div>

        {snapshot && <EnginePanel snapshot={snapshot} />}

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="grid gap-1 font-bold text-slate-700">
            Paper capital (₹)
            <input
              type="number"
              min="1"
              step="1000"
              value={capitalInput}
              onChange={(event) => setCapitalInput(event.target.value)}
              className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 font-mono"
            />
          </label>
          <button
            type="button"
            onClick={() => onCapitalChange(Number(capitalInput))}
            disabled={!ready || real.length > 0 || !Number.isFinite(Number(capitalInput)) || Number(capitalInput) <= 0}
            className="rounded-lg bg-violet-700 px-3 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Set capital
          </button>
          <p className="max-w-3xl text-[11px] text-slate-500">
            Quantity is limited by 1% capital at risk, available cash and the skip price. A quote crossing a stop can fill worse than the stop.
            After T1, half is sold and the rest has a break-even stop; any remaining position is time-exited after 30 trading sessions.
            The headline P&amp;L figures are gross; the panel above shows P&amp;L net of estimated charges and slippage. Neither is evidence of an executable fill.
          </p>
        </div>

        {orders.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No paper orders yet. Open Today&apos;s Picks, choose Last close and approve a Buy ready stock.
          </p>
        ) : (
          <>
            <div>
              <h3 className="mb-2 text-sm font-black text-slate-900">Positions &amp; orders</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[1320px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Stock</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Order placed</th>
                      <th className="px-3 py-2">Bought</th>
                      <th className="px-3 py-2 text-right">Amount invested</th>
                      <th className="px-3 py-2">Sold</th>
                      <th className="px-3 py-2 text-right">Holding · last price</th>
                      <th className="px-3 py-2 text-right">P&amp;L</th>
                      <th className="px-3 py-2">Plan</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        onCancel={onCancel}
                        onCloseNow={onCloseNow}
                        closing={closingId === order.id}
                        onStartClose={() => setClosingId(order.id)}
                        onStopClose={() => setClosingId(null)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-black text-slate-900">Trade book <span className="font-semibold text-slate-500">· every simulated buy and sell, newest first</span></h3>
              {trades.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">No executions yet. Pending orders appear here once the trigger fills.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[860px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Date &amp; time (IST)</th>
                        <th className="px-3 py-2">Stock</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Reason</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {trades.map(({ order, fill }, index) => (
                        <TradeRow key={`${order.id}-${fill.timestamp}-${index}`} order={order} fill={fill} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const ago = (ms: number | null) => (ms == null ? "—" : ms < 1500 ? "live" : ms < 60_000 ? `${Math.round(ms / 1000)}s old` : `${Math.round(ms / 60_000)} min old`);

/** What the server engine is doing, how much of each loss limit is used, and results after costs. */
function EnginePanel({ snapshot }: { snapshot: PaperSnapshot }) {
  const { engine, risk, totals, stats, settings } = snapshot;
  const used = (value: number, limit: number) => (limit > 0 ? Math.max(0, Math.min(100, (-value / limit) * 100)) : 0);
  const bar = (percent: number) => (
    <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-200"><div className={`h-full ${percent >= 100 ? "bg-rose-600" : percent >= 60 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${percent}%` }} /></div>
  );
  return (
    <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-700">
        <span className={`font-black ${engine.running ? "text-emerald-700" : "text-rose-700"}`}>● Engine {engine.running ? "running on the server" : "not running"}</span>
        <span>Source: {engine.source || "—"}</span>
        <span>Freshest quote: {ago(engine.quoteAgeMs)}</span>
        <span>Email alerts: {engine.alerts ? "on" : "not configured"}</span>
        {engine.lastError && <span className="font-bold text-rose-700">Last error: {engine.lastError}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Today vs loss limit</div>
          <div className={`font-mono text-sm font-black ${pnlTone(risk.dayPnl)}`}>{signed(risk.dayPnl)} <span className="text-[10px] font-bold text-slate-500">of −{currency(risk.dayLimit)}</span></div>
          {bar(used(risk.dayPnl, risk.dayLimit))}
        </div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">This week vs loss limit</div>
          <div className={`font-mono text-sm font-black ${pnlTone(risk.weekPnl)}`}>{signed(risk.weekPnl)} <span className="text-[10px] font-bold text-slate-500">of −{currency(risk.weekLimit)}</span></div>
          {bar(used(risk.weekPnl, risk.weekLimit))}
        </div>
        <Stat label="Pending + open" value={`${risk.openCount} of ${settings.maxOpenPositions}`} hint="Position cap" />
        <Stat label="Net P&L after costs" value={signed(totals.net)} tone={pnlTone(totals.net)} hint={`gross ${signed(totals.gross)} · costs ${currency(totals.charges + totals.slippage)}`} />
      </div>
      {risk.reasons.length > 0 && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">{risk.reasons.join(" ")} {risk.entryBlocked ? "Pending orders will not enter; open positions keep their stops and targets." : "New approvals are blocked."}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Closed trades" value={String(stats.closed)} />
        <Stat label="Win rate" value={stats.winRate == null ? "—" : `${stats.winRate.toFixed(0)}%`} />
        <Stat label="Expectancy" value={stats.expectancyR == null ? "—" : `${stats.expectancyR.toFixed(2)}R`} hint="Net, per trade" />
        <Stat label="Profit factor" value={stats.profitFactor == null ? "—" : stats.profitFactor.toFixed(2)} />
        <Stat label="Max drawdown" value={currency(stats.maxDrawdown)} hint="Closed trades, net" />
      </div>
      <p className="text-[10px] leading-4 text-slate-500">
        Costs are estimates: delivery brokerage taken as ₹0, STT 0.1% each side, exchange, SEBI, stamp duty, GST and a depository charge per sale day, plus {settings.slippagePercent}% slippage per fill.
        Today and week figures count exits plus open P&amp;L on positions entered in that period. Loss limits: {settings.dailyLossPercent}% a day, {settings.weeklyLossPercent}% a week of starting capital.
      </p>
    </div>
  );
}

function Stat({ label, value, hint, tone = "text-slate-900" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-black ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

function SymbolCell({ order }: { order: PaperOrder }) {
  return (
    <>
      <StockSymbolButton symbol={order.symbol} className="font-black">{order.symbol}</StockSymbolButton>
      {isDemoPaperOrder(order) && <span className="ml-1.5 rounded bg-fuchsia-600 px-1.5 py-0.5 text-[9px] font-black uppercase text-white">Demo</span>}
    </>
  );
}

function OrderRow({
  order,
  onCancel,
  onCloseNow,
  closing,
  onStartClose,
  onStopClose,
}: {
  order: PaperOrder;
  onCancel: (id: string) => void;
  onCloseNow: (id: string, exitPrice: number) => void;
  closing: boolean;
  onStartClose: () => void;
  onStopClose: () => void;
}) {
  const money = orderMoney(order);
  const buy = order.fills.find((fill) => fill.side === "buy");
  const sells = order.fills.filter((fill) => fill.side === "sell");
  const demo = isDemoPaperOrder(order);
  return (
    <tr className={demo ? "bg-fuchsia-50/40 align-top" : "align-top odd:bg-white even:bg-[#fafbfc]"}>
      <td className="px-3 py-3">
        <SymbolCell order={order} />
        <div className="text-slate-500">{order.source} · signal {order.signalDate}</div>
      </td>
      <td className="px-3 py-3">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-bold ring-1 ${STATUS_STYLE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
      </td>
      <td className="px-3 py-3 text-slate-600">
        <div className="whitespace-nowrap font-mono">{dateTime(order.approvedAt)}</div>
        <div>Buy {order.quantity} above {currency(order.plan.entry)}</div>
      </td>
      <td className="px-3 py-3">
        {buy ? (
          <>
            <div className="whitespace-nowrap font-mono text-slate-600">{dateTime(buy.timestamp)}</div>
            <div className="font-mono font-bold">{buy.quantity} × {currency(buy.price)}</div>
          </>
        ) : <span className="text-slate-400">Not filled</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-bold">{buy ? currency(money.invested) : "—"}</td>
      <td className="whitespace-nowrap px-3 py-3">
        {sells.length === 0 ? <span className="text-slate-400">—</span> : sells.map((fill, index) => (
          <div key={`${fill.timestamp}-${index}`} className="mb-1 last:mb-0">
            <span className="font-mono font-bold">{fill.quantity} × {currency(fill.price)}</span>
            <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-600">{fill.label}</span>
            <div className="whitespace-nowrap font-mono text-[11px] text-slate-500">{dateTime(fill.timestamp)}</div>
          </div>
        ))}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
        {order.status === "open" ? (
          <>
            <div className="font-bold">{money.holding} sh · {money.lastPrice == null ? "—" : currency(money.lastPrice)}</div>
            <div className="text-slate-500">Value {currency(money.currentValue)}</div>
            {order.lastQuoteTimestamp && <div className="text-[10px] text-slate-400">as of {dateTime(order.lastQuoteTimestamp)}</div>}
          </>
        ) : <span className="text-slate-400">—</span>}
      </td>
      <td className={`whitespace-nowrap px-3 py-3 text-right font-mono font-bold ${pnlTone(money.total)}`}>
        {buy ? (
          <>
            <div>{signed(money.total)}</div>
            <div className="text-[11px]">{money.totalPercent > 0 ? "+" : money.totalPercent < 0 ? "−" : ""}{Math.abs(money.totalPercent).toFixed(2)}%</div>
            {order.status === "open" && <div className="text-[10px] font-semibold text-slate-500">Booked {signed(order.realizedPnl)}</div>}
          </>
        ) : "—"}
      </td>
      <td className="px-3 py-3 text-slate-600">
        <div className="whitespace-nowrap font-mono">SL {currency(order.activeStop)}{order.activeStop !== order.plan.stop ? " (cost)" : ""}</div>
        <div className="whitespace-nowrap font-mono">T1 {currency(order.plan.target1)} · T2 {currency(order.plan.target2)}</div>
        <details className="mt-1">
          <summary className="cursor-pointer font-bold text-violet-700">Timeline ({order.events.length})</summary>
          <ol className="mt-2 w-72 space-y-1 border-l-2 border-violet-200 pl-3">
            {order.events.map((event, index) => (
              <li key={`${event.timestamp}-${index}`}>
                <span className="font-mono text-[10px] text-slate-400">{dateTime(event.timestamp)}</span> {event.message}
              </li>
            ))}
          </ol>
        </details>
      </td>
      <td className="px-3 py-3">
        {order.status === "pending" && !demo && (
          <button type="button" className="font-bold text-rose-700 underline" onClick={() => onCancel(order.id)}>Cancel</button>
        )}
        {order.status === "open" && !demo && (
          closing ? (
            <CloseNowForm
              defaultPrice={money.lastPrice ?? order.entryPrice ?? order.plan.entry}
              onConfirm={(price) => { onCloseNow(order.id, price); onStopClose(); }}
              onCancel={onStopClose}
            />
          ) : (
            <button type="button" className="font-bold text-violet-700 underline" onClick={onStartClose}>Close now</button>
          )
        )}
      </td>
    </tr>
  );
}

/** Lets you take an open position's profit (or cut a loss) at any price, instead of only at the automatic stop/T1/T2/time-exit. */
function CloseNowForm({ defaultPrice, onConfirm, onCancel }: { defaultPrice: number; onConfirm: (price: number) => void; onCancel: () => void }) {
  const [price, setPrice] = useState(String(Math.round(defaultPrice * 100) / 100));
  const valid = Number.isFinite(Number(price)) && Number(price) > 0;
  return (
    <div className="flex flex-col items-start gap-1.5 whitespace-nowrap">
      <input
        type="number"
        step="0.01"
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        className="w-24 rounded border border-violet-200 bg-white px-1.5 py-1 font-mono text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!valid}
          onClick={() => onConfirm(Number(price))}
          className="font-bold text-violet-700 underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
        >
          Confirm
        </button>
        <button type="button" className="font-bold text-slate-500 underline" onClick={onCancel}>Dismiss</button>
      </div>
    </div>
  );
}

function TradeRow({ order, fill }: { order: PaperOrder; fill: PaperFill }) {
  const amount = fill.quantity * fill.price;
  const pnl = fill.side === "sell" && order.entryPrice !== null ? (fill.price - order.entryPrice) * fill.quantity : null;
  return (
    <tr className={isDemoPaperOrder(order) ? "bg-fuchsia-50/40" : "odd:bg-white even:bg-[#fafbfc]"}>
      <td className="whitespace-nowrap px-3 py-2 font-mono">{dateTime(fill.timestamp)}</td>
      <td className="px-3 py-2"><SymbolCell order={order} /></td>
      <td className="px-3 py-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${fill.side === "buy" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
          {fill.side === "buy" ? "BUY" : "SELL"}
        </span>
      </td>
      <td className="px-3 py-2 text-slate-600">{fill.label === "Entry" ? "Entry trigger" : fill.label}</td>
      <td className="px-3 py-2 text-right font-mono">{fill.quantity}</td>
      <td className="px-3 py-2 text-right font-mono">{currency(fill.price)}</td>
      <td className="px-3 py-2 text-right font-mono font-bold">{currency(amount)}</td>
      <td className={`px-3 py-2 text-right font-mono font-bold ${pnl === null ? "text-slate-400" : pnlTone(pnl)}`}>{pnl === null ? "—" : signed(pnl)}</td>
    </tr>
  );
}
