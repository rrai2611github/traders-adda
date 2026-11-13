"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BacktestResult } from "@/lib/backtest/types";
import { EquityChart, Stat, money, num } from "./BacktestPage";
import { StockSymbolButton } from "./StockDetailContext";
import { StrategyHealthCard } from "./StrategyHealthCard";
import { useResultsDates } from "@/hooks/useResultsDates";
import { daysUntil } from "@/lib/market/boardMeetings";
import { checkBatch, RISK_LIMITS, verdictLine, type RiskVerdict } from "@/lib/risk/riskGate";
import { Term } from "./Term";
import { TradeCards } from "./TradeCards";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useNow } from "@/hooks/useNow";
import { trackerValuation } from "@/lib/backtest/trackerValuation";

interface TrackerPayload {
  config: { startDate: string; startedAt: number; capital: number; niftyGate: boolean; stopPercent: 8 | 12 } | null;
  history: { lastDay: string | null; lastRunAt: number | null; status: "idle" | "running" | "failed"; message: string; lastCandleDay: string | null };
  job:
    | { status: "none" }
    | { status: "waiting"; message: string }
    | { status: "running"; id: string; message: string }
    | { status: "failed"; id: string; error: string }
    | { status: "done"; id: string; result: BacktestResult };
  rules: { name: string; lines: string[] };
  error?: string;
  alertStatus?: string;
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const px = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const exactMoney = (v: number) => `₹${px(v)}`;
const signedMoney = (v: number) => `${v >= 0 ? "+" : "−"}${exactMoney(Math.abs(v))}`;
const tone = (v: number) => (v >= 0 ? "text-emerald-700" : "text-rose-700");
const quoteTime = (at: number | null) => at == null ? "unverified" : new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";

/** The live strategy check: the backtest rules followed day by day on real, finished prices. */
export function TrackerPage() {
  const [data, setData] = useState<TrackerPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [capital, setCapital] = useState(1_000_000);
  const [niftyGate, setNiftyGate] = useState(false);
  const [smoother, setSmoother] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const results = useResultsDates();

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const res = await fetch("/api/tracker", { cache: "no-store", ...init });
      const body = (await res.json()) as TrackerPayload;
      if (!res.ok) setMessage(body.error ?? "That did not work.");
      else setMessage(null);
      if (body.rules) {
        setData(body);
        setLastCheckedAt(Date.now());
      }
      return body;
    } catch {
      setMessage("Could not reach the server.");
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      const body = await load();
      if (!alive) return;
      const fast = body && (body.job.status === "running" || body.history.status === "running");
      timer.current = setTimeout(loop, fast ? 3000 : 30_000);
    };
    void loop();
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  const act = async (action: "start" | "stop" | "refresh") => {
    setBusy(true);
    await load({ method: "POST", body: JSON.stringify({ action, capital, niftyGate, stopPercent: smoother ? 12 : 8 }) });
    setBusy(false);
  };

  const config = data?.config ?? null;
  const result = data?.job.status === "done" ? data.job.result : null;
  const liveQuotes = useLiveQuotes(result ? [...result.openPositions.map((p) => p.symbol), ...result.pending.signals.map((p) => p.symbol)] : []);
  const now = useNow(5_000);
  const quoteNow = Math.max(now ?? 0, liveQuotes.asOf ?? 0);
  const valuations = new Map(result?.openPositions.map((p) =>
    [p.symbol, trackerValuation(p, liveQuotes.quotes.get(p.symbol), liveQuotes.live, quoteNow)]));
  const allQuoted = result != null && result.openPositions.every((p) => valuations.get(p.symbol)?.value != null);
  const quoteValue = allQuoted && result ? result.openPositions.reduce((sum, p) => sum + valuations.get(p.symbol)!.value!, 0) : null;
  const missingQuotes = result?.openPositions.filter((p) => valuations.get(p.symbol)?.value == null).length ?? 0;
  const currentProfit = quoteValue == null ? null : quoteValue - (result?.openPositions.reduce((sum, p) => sum + p.spent, 0) ?? 0);
  const closed = result ? result.trades.filter((t) => t.exitReason !== "end") : [];
  const wins = closed.filter((t) => t.pnl > 0).length;
  const profit = result && config ? result.markedValue - config.capital : 0;
  const amountInvested = result?.openPositions.reduce((total, position) => total + position.spent, 0) ?? 0;
  const sharesMarketValue = result?.openPositions.reduce((total, position) => total + position.quantity * position.last, 0) ?? 0;
  const openPnl = sharesMarketValue - amountInvested;
  const nifty = result && result.equity.benchmark.length > 1 ? result.equity.benchmark[result.equity.benchmark.length - 1] / result.equity.benchmark[0] - 1 : null;
  const sessions = result?.data.sessions ?? 0;
  // The risk gate: tomorrow's buys, checked in order against the account, the open positions, and the day's result.
  // A holding's working stop is the higher of its stop and its 50-day exit line: that is where the position would really be sold.
  const working = (p: BacktestResult["openPositions"][number]) => Math.max(p.stop, p.exitLevel ?? 0);
  const openRisk = result ? result.openPositions.reduce((a, p) => a + Math.max(0, p.last - working(p)) * p.quantity, 0) : 0;
  const openRiskPercent = result && result.markedValue > 0 ? (openRisk / result.markedValue) * 100 : 0;
  const verdicts: RiskVerdict[] = result
    ? checkBatch(
      result.pending.signals.map((s) => ({ symbol: s.symbol, quantity: s.quantity, entry: s.close, stop: s.stop, resultsInDays: results?.dates[s.symbol] ? daysUntil(results.dates[s.symbol], results.today) : null })),
      {
        accountValue: result.markedValue,
        openPositions: result.openPositions.map((p) => ({ symbol: p.symbol, quantity: p.quantity, last: p.last, stop: working(p) })),
        newToday: 0,
        dayChangePercent: result.equity.account.length > 1 ? (result.markedValue / result.equity.account[result.equity.account.length - 2] - 1) * 100 : null,
        marketOk: result.pending.breadthOk && result.pending.niftyOk !== false,
      },
    )
    : [];

  return (
    <section id="strategy-check" aria-labelledby="strategy-check-title" className="scroll-mt-20 space-y-5 border-t border-border pt-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-blue-700">Simulated account · no real orders</p>
          <h2 id="strategy-check-title" className="text-[20px] font-extrabold tracking-[-0.02em] text-slate-900">Practice portfolio</h2>
          <p className="text-sm text-slate-500">Follow the strategy with practice money. Holding prices update automatically; trading decisions use completed daily prices.</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-surface px-3 py-1.5 text-[11px] font-semibold text-slate-600" role="status">
          {lastCheckedAt ? `Status checked ${new Date(lastCheckedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Checking status…"}
        </span>
      </header>

      {message && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">{message}</p>}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950" role="status">
        <p className="font-bold">Owner-email practice alerts</p>
        <p>{data?.alertStatus ?? "Checking email alert status..."}</p>
        <p className="mt-1 text-xs">Checked every 30 seconds while the server runs. Buys, exits and next-open candidates are emailed after daily replay detects them, not at execution time. Intraday stop messages are review warnings only, require recent verified provider trade times, and are limited to one per holding per trading day. No real orders are placed.</p>
      </div>
      <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] leading-5 text-blue-900">
        No real money is used and no real orders are placed. Prices may be delayed; current profit/loss is an estimate before costs.
      </p>

      {config && result && <section aria-label="Current practice portfolio summary" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Amount invested" value={exactMoney(amountInvested)} note="Buy cost of open practice holdings" />
          <Stat label="Current holdings value" value={quoteValue == null ? "Waiting for prices" : exactMoney(quoteValue)} note="Latest available quotes; may be delayed" />
          <Stat label="Current profit / loss" value={currentProfit == null ? "Waiting for prices" : signedMoney(currentProfit)} tone={currentProfit == null ? undefined : currentProfit >= 0 ? "good" : "bad"} note="Open holdings only, before costs" />
          <Stat label="Profit / loss %" value={currentProfit == null || amountInvested <= 0 ? "Not available" : signedPct(currentProfit / amountInvested * 100)} note="Compared with the amount invested" />
        </div>
        <p className="text-sm text-slate-500">Price check: {quoteTime(liveQuotes.asOf)}. {missingQuotes > 0 ? `Waiting for prices for ${missingQuotes} stock${missingQuotes === 1 ? "" : "s"}. Total profit will appear when all prices arrive.` : "See each holding for its price source and any delay."}</p>
      </section>}

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4" aria-label="Rules">
        <details key={config ? "following" : "setup"} open={!config} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <h2 className="text-[13px] font-extrabold text-slate-900">{data?.rules.name ?? "The rules"} <span className="ml-1 text-[11.5px] font-semibold text-slate-500">· the rules being followed</span></h2>
            <span className="shrink-0 text-[11.5px] font-bold text-accent group-open:hidden">How this works</span>
            <span className="hidden shrink-0 text-[11.5px] font-bold text-accent group-open:inline">Hide</span>
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-slate-700">{data?.rules.lines.map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="mt-2 text-sm text-slate-500">Trade emails arrive after the daily price refresh and calculation, not instantly. Current quotes do not change the recorded strategy trades.</p>
          <p className="mt-2 text-[11.5px] text-slate-500">In the 10-year backtest these rules made about 46% a year with a worst drop of about 21%, but only about 45% of trades win and the last few years were weaker. The history only includes stocks listed today, so real results are likely lower. A few weeks of live results prove nothing; judge it after at least 30 closed trades.</p>
        </details>
        {!config ? (
          <div className="flex flex-wrap items-end gap-4 border-t border-border pt-3">
            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">Paper capital ₹
              <input className="h-9 w-40 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-semibold normal-case text-slate-900" type="number" min={10000} step={100000} value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-2 pb-2 text-[12.5px] font-semibold text-slate-700">
              <input type="checkbox" checked={niftyGate} onChange={(e) => setNiftyGate(e.target.checked)} />
              Also buy only while the Nifty 50 is above its 200-day average (fewer losses, a little less profit in the test)
            </label>
            <label className="flex items-center gap-2 pb-2 text-[12.5px] font-semibold text-slate-700">
              <input type="checkbox" checked={smoother} onChange={(e) => setSmoother(e.target.checked)} />
              12% stop with smaller positions (the main plan: a higher win rate, about the same return and a shallower worst drop in the test). Untick for the tighter 8% stop.
            </label>
            <button type="button" disabled={busy} onClick={() => void act("start")} className="btn-gold h-10 rounded-xl px-5 text-sm font-extrabold">{busy ? "Starting…" : "Start paper test"}</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-[12.5px] text-slate-600">
            <span><b className="text-slate-900">Following since {dayLabel(config.startDate)}</b> with {exactMoney(config.capital)}{config.niftyGate ? " · Nifty 200-day check on" : ""}{config.stopPercent === 12 ? " · 12% stop" : ""}. Daily strategy data through {data?.history.lastCandleDay ? dayLabel(data.history.lastCandleDay) : "—"}.</span>
            <button type="button" disabled={busy || data?.history.status === "running"} onClick={() => void act("refresh")} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-500 disabled:opacity-60">{data?.history.status === "running" ? `Updating… ${data.history.message}` : "Refresh daily history"}</button>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm("Delete this practice portfolio history and stop following? Its recorded trades will be cleared. This does not sell any real holdings.")) void act("stop"); }} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:border-rose-400 disabled:opacity-60">Delete practice history</button>
            {data?.history.status === "failed" && <span className="font-semibold text-rose-700">The last update failed: {data.history.message}</span>}
          </div>
        )}
      </section>

      {config && (
        <details aria-label="Progress" className="rounded-2xl border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">Practice progress — {closed.length} of 30 closed trades</summary>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { done: true, title: "Started", note: dayLabel(config.startDate) },
              { done: sessions > 0, title: "First finished session", note: sessions > 0 ? `${sessions} session${sessions === 1 ? "" : "s"} followed` : "arrives after the next close" },
              { done: closed.length >= 30, title: "Enough trades to judge", note: `${closed.length} of 30 closed trades` },
            ].map((step, i) => (
              <li key={step.title} className="flex items-start gap-2.5">
                <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${step.done ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-500"}`}>{step.done ? "\u2713" : i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-extrabold text-slate-900">{step.title}</span>
                  <span className="block text-[11.5px] text-slate-500">{step.note}</span>
                  {i === 2 && <span className="mt-1.5 block h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-[#e6b53c]" style={{ width: `${Math.min(100, (closed.length / 30) * 100)}%` }} /></span>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {config && data?.job.status === "waiting" && <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-slate-700">{data.job.message} Daily history updates after the close, or press &quot;Refresh daily history&quot; once the market is closed.</p>}
      {config && data?.job.status === "running" && <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-slate-700">Working out the positions… {data.job.message}. The first calculation after a price update takes a minute or two.</p>}
      {config && data?.job.status === "failed" && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Could not calculate: {data.job.error}</p>}

      {config && result && (
        <>
          <details className="rounded-xl border border-border bg-surface p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-700">Last market-close results and progress</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Portfolio value at last market close" value={exactMoney(result.markedValue)} tone={profit >= 0 ? "good" : "bad"} note={`Includes uninvested cash · ${signedMoney(profit)} (${signedPct((profit / config.capital) * 100)}) · ${dayLabel(result.data.lastDay)}`} />
            <Stat label="Nifty 50 over the same days" value={nifty == null ? "—" : signedPct(nifty * 100)} note={`${sessions} session${sessions === 1 ? "" : "s"} followed`} />
            <Stat label="Holdings at last close" value={exactMoney(sharesMarketValue)} tone={openPnl >= 0 ? "good" : "bad"} note={`${signedMoney(openPnl)} open profit / loss at that close`} />
            <Stat label="Uninvested cash at last close" value={exactMoney(result.markedValue - sharesMarketValue)} note="Separate from the amount invested" />
            <Stat label="Open positions" value={`${result.openPositions.length} of 10`} note="paper trades currently held" />
            <Stat label="Closed trades" value={`${closed.length}`} note={closed.length ? `${wins} won · ${closed.length - wins} lost` : "none yet"} />
          </div>
          </details>

          <details className="rounded-xl border border-border bg-surface p-4" aria-label="Next buys">
            <summary className="cursor-pointer text-base font-extrabold text-slate-900">Daily strategy decisions — {dayLabel(result.data.lastDay)}</summary>
            <p className="mb-2 text-xs text-slate-500">Candidates for the next session after that close, not new intraday signals. Sizes and risk checks below use completed daily prices.</p>
            <p className="mb-2 text-[11.5px] text-slate-500">
              <Term k="marketCheck">Market check</Term> on {dayLabel(result.data.lastDay)}: {result.pending.breadth50 != null ? `${result.pending.breadth50}% of stocks above their 50-day average` : "breadth unavailable"} ({result.pending.breadthOk ? "allowed" : "below the 35% the rules need"}){result.pending.niftyOk == null ? "" : `, Nifty 50 ${result.pending.niftyOk ? "above" : "under"} its 200-day average`}. {result.pending.slotsFree} of 10 slots free.
            </p>
            {result.pending.signals.length === 0 ? (
              <p className="text-sm text-slate-600">{!result.pending.breadthOk || result.pending.niftyOk === false ? "No buys: the market check is red, which is exactly when the rules stay out." : result.pending.slotsFree === 0 ? "No buys: every slot is full." : "No qualifying breakout on the last close."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[12.5px]"><thead className="text-[11.5px] uppercase tracking-[0.06em] text-slate-500"><tr><th className="py-1">Stock</th><th>RS</th><th className="text-right">Last close</th><th className="text-right">Stop</th><th className="text-right">Shares</th><th className="text-right">Amount</th><th className="pl-3">Risk check</th></tr></thead><tbody>
                  {result.pending.signals.map((s, i) => <tr key={s.symbol} className="border-t border-border"><td className="py-1.5 font-bold"><StockSymbolButton symbol={s.symbol} className="font-bold text-slate-900">{s.symbol}</StockSymbolButton></td><td>{s.rs}</td><td className="text-right tabular-nums">₹{px(s.close)}</td><td className="text-right tabular-nums">₹{px(s.stop)}</td><td className="text-right tabular-nums">{s.quantity}</td><td className="text-right tabular-nums">{money(s.amount)}</td><td className="pl-3 text-[11.5px]"><span className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-black ${verdicts[i]?.verdict === "PASS" ? "bg-emerald-600 text-white" : verdicts[i]?.verdict === "WARN" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>{verdicts[i]?.verdict ?? "—"}</span>{verdicts[i] ? verdictLine(verdicts[i]) : ""}</td></tr>)}
                </tbody></table>
                <p className="mt-1 text-[11px] text-slate-400">The simulated entry uses the next session&apos;s opening price after the signal, so the stop, shares and amount are approximate.</p>
              </div>
            )}
          </details>

          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Open positions">
            <h3 className="text-base font-extrabold text-slate-900">Your practice holdings</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">Prices and profit update automatically. Daily strategy decisions stay separate. A price below a stop is a reason to review, not proof that a sale happened.</p>
            <details className="my-3 text-sm text-slate-500">
              <summary className="cursor-pointer font-semibold">Price updates and daily risk explained</summary>
            <p className="mt-1 text-xs leading-5 text-slate-500">Quotes are checked every 5 seconds while this tab is visible; Fyers quotes may be cached for 15 seconds. Current profit/loss is an estimate before costs.</p>
            <p className="mt-1 text-xs text-slate-500">Last quote check: {quoteTime(liveQuotes.asOf)}. A recent fetch is not proof of a real-time exchange tick.</p>
            <p className="my-2 text-[11.5px] text-slate-500">At the {dayLabel(result.data.lastDay)} close, if every holding fell to its sell level at once (the higher of its stop and its 50-day line) the account would lose <b className={openRiskPercent > RISK_LIMITS.maxOpenRiskPercent ? "text-rose-700" : "text-slate-800"}>{openRiskPercent.toFixed(1)}%</b> (limit {RISK_LIMITS.maxOpenRiskPercent}%). This is the daily replay risk, not intraday risk.</p>
            </details>
            {liveQuotes.error && <p role="alert" className="my-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{liveQuotes.error}</p>}
            {result.openPositions.length === 0 ? <p className="text-sm text-slate-600">Nothing is held right now.</p> : (
              <>
              <TradeCards label="Open positions" items={result.openPositions.map((p) => {
                const v = valuations.get(p.symbol)!;
                return {
                  key: p.symbol,
                  title: <StockSymbolButton symbol={p.symbol} className="font-black text-slate-900">{p.symbol}</StockSymbolButton>,
                  headline: v.pnl == null ? "Quote unavailable" : <span className={tone(v.pnl)}>{signedMoney(v.pnl)}</span>,
                  facts: [
                    { label: "Quantity", value: p.quantity.toLocaleString("en-IN") },
                    { label: "Amount invested", value: exactMoney(p.spent) },
                    { label: "Latest quote", value: v.price == null ? "Unavailable" : `₹${px(v.price)}` },
                    { label: "Price source / delay", value: <span className="block max-w-[190px] text-right font-sans text-xs">{v.label}</span> },
                    { label: "Price check", value: quoteTime(v.fetchedAt) },
                    { label: "Review", value: v.price == null ? "Price unavailable" : v.price <= p.stop ? "At or below stop - review" : "Above stop price" },
                  ],
                };
              })} />
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="py-3">Stock</th><th className="text-right">Quantity</th><th className="text-right">Invested</th><th className="text-right">Latest price</th><th className="text-right">Profit / loss</th></tr></thead><tbody>
                  {result.openPositions.map((p) => {
                    const v = valuations.get(p.symbol)!;
                    return (
                      <tr key={p.symbol} className="border-t border-border">
                        <td className="py-3 font-bold"><StockSymbolButton symbol={p.symbol} className="font-bold text-slate-900">{p.symbol}</StockSymbolButton><span className={`mt-1 block text-xs font-normal ${v.price != null && v.price <= p.stop ? "text-rose-700" : "text-slate-500"}`}>{v.price == null ? "Price unavailable" : v.price <= p.stop ? "At or below stop - review" : "Above stop price"}</span></td>
                        <td className="text-right tabular-nums">{p.quantity.toLocaleString("en-IN")}</td>
                        <td className="text-right tabular-nums">{exactMoney(p.spent)}</td>
                        <td className="py-3 text-right tabular-nums">{v.price == null ? "Unavailable" : `₹${px(v.price)}`}<span className="mt-1 block max-w-[220px] text-xs text-slate-500">{v.label}</span><span className="block text-xs text-slate-500">Received {quoteTime(v.fetchedAt)}</span></td>
                        <td className={`text-right tabular-nums ${v.pnl == null ? "text-slate-500" : tone(v.pnl)}`}>{v.pnl == null ? "Unavailable" : signedMoney(v.pnl)}</td>
                      </tr>
                    );
                  })}
                </tbody></table>
              </div>
              <details className="mt-4 rounded-xl border border-border p-3">
                <summary className="min-h-8 cursor-pointer text-sm font-bold text-slate-700">Show details — buy prices, stops and daily exit levels</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {result.openPositions.map((p) => {
                    const v = valuations.get(p.symbol)!;
                    return <article key={p.symbol} className="rounded-lg bg-slate-50 p-3 text-sm">
                      <h4 className="font-bold">{p.symbol}</h4>
                      <dl className="mt-2 space-y-2">
                        {[
                          ["Bought", dayLabel(p.entryDay)],
                          ["Buy price per share", exactMoney(p.spent / p.quantity)],
                          ["Change since buy", v.gain == null ? "Unavailable" : signedPct(v.gain)],
                          ["Stop price", exactMoney(p.stop)],
                          ["Daily exit level", p.exitLevel == null ? "Unavailable" : exactMoney(p.exitLevel)],
                          ["Last completed close", `${exactMoney(p.last)} on ${dayLabel(result.data.lastDay)}`],
                          ["Provider trade time", quoteTime(v.tradeAt)],
                        ].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
                      </dl>
                    </article>;
                  })}
                </div>
                <p className="mt-3 text-sm text-slate-500">The daily exit level is checked when the market closes. These reference levels and price observations are not confirmations of a sale.</p>
              </details>
              <div aria-label="Open holdings totals" className="mt-4 rounded-xl border border-border bg-slate-50 p-4">
                <h4 className="text-sm font-extrabold text-slate-900">Total open paper holdings</h4>
                <dl className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div><dt className="text-xs text-slate-500">Total quantity</dt><dd className="mt-1 font-bold tabular-nums">{result.openPositions.reduce((sum, p) => sum + p.quantity, 0).toLocaleString("en-IN")} shares</dd></div>
                  <div><dt className="text-xs text-slate-500">Total amount invested</dt><dd className="mt-1 font-bold tabular-nums">{exactMoney(amountInvested)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Current holdings value</dt><dd className="mt-1 font-bold tabular-nums">{quoteValue == null ? "Waiting for prices" : exactMoney(quoteValue)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Total profit / loss (estimate)</dt><dd className={`mt-1 font-bold tabular-nums ${quoteValue == null ? "text-slate-500" : tone(quoteValue - amountInvested)}`}>{quoteValue == null ? "Waiting for prices" : signedMoney(quoteValue - amountInvested)}</dd></div>
                </dl>
                <p className="mt-3 text-xs text-slate-500">Open holdings only, before costs. Latest value and profit use the quotes above, including any delayed or stale prices. {quoteValue == null ? "A complete total requires a quote for every holding." : "These totals update with the quotes."}</p>
              </div>
              </>
            )}
          </section>

          {sessions > 1 && <EquityChart result={result} />}

          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Closed trades">
            <h3 className="mb-2 text-[13px] font-extrabold text-slate-900">Closed trades</h3>
            {closed.length === 0 ? <p className="text-sm text-slate-600">No trade has closed yet. The backtest averaged about 30 trades a year, so expect this list to fill slowly, and most of the profit to come from a few long holds.</p> : (
              <>
              <TradeCards label="Closed trades" items={[...closed].reverse().map((t, i) => ({
                key: `${t.symbol}${t.entryDay}${i}`,
                title: t.symbol,
                headline: <span className={tone(t.pnl)}>{signedMoney(t.pnl)} · {t.r.toFixed(2)}R</span>,
                facts: [
                  { label: "Bought", value: `${t.entryDay} @ ${t.entryPrice.toFixed(1)}` },
                  { label: "Sold", value: `${t.exitDay} @ ${t.exitPrice.toFixed(1)}` },
                  { label: "Why", value: t.exitReason },
                ],
              }))} />
              <div className="hidden overflow-x-auto sm:block">
                <p className="mb-1 text-[11px] text-slate-500">Prices and profit in rupees (₹). R is the profit as a multiple of the amount risked on the trade (+2R means twice the risk).</p>
                <table className="w-full min-w-[700px] text-left text-[12px] [&_td]:px-2 [&_th]:px-2"><thead className="text-[11.5px] uppercase tracking-[0.06em] text-slate-500"><tr><th className="py-1">Stock</th><th>Bought</th><th className="text-right">Price</th><th>Sold</th><th className="text-right">Price</th><th>Why</th><th className="text-right">R</th><th className="text-right">Profit</th></tr></thead><tbody>
                  {[...closed].reverse().map((t, i) => <tr key={`${t.symbol}${t.entryDay}${i}`} className="border-t border-border"><td className="py-1 font-bold">{t.symbol}</td><td>{t.entryDay}</td><td className="text-right tabular-nums">{t.entryPrice.toFixed(1)}</td><td>{t.exitDay}</td><td className="text-right tabular-nums">{t.exitPrice.toFixed(1)}</td><td>{t.exitReason}</td><td className={`text-right tabular-nums ${tone(t.r)}`}>{t.r.toFixed(2)}</td><td className={`text-right tabular-nums ${tone(t.pnl)}`}>{signedMoney(t.pnl)}</td></tr>)}
                </tbody></table>
              </div>
              </>
            )}
          </section>

          <p className="text-[11.5px] leading-5 text-slate-500">
            How to read this: the rules are replayed from {dayLabel(config.startDate)} to {dayLabel(result.data.lastDay)} on finished daily prices, so a position opens at the next day&apos;s open after its signal, exits on a close under the 50-day average or at the stop (no adding to winners), and costs of 0.25% a side are charged. Average per closed trade so far: {num(result.stats.avgR)}R ({closed.length} trade{closed.length === 1 ? "" : "s"}; the backtest averaged about +1.0R). {closed.length < 30 ? "That is too few trades to say anything yet." : ""}
          </p>
        </>
      )}

      <StrategyHealthCard />
    </section>
  );
}
