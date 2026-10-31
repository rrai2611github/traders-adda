"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BacktestResult } from "@/lib/backtest/types";
import { EquityChart, Stat, money, num } from "./BacktestPage";
import { StockSymbolButton } from "./StockDetailContext";
import { PageNav } from "./PageNav";
import { StrategyHealthCard } from "./StrategyHealthCard";
import { useResultsDates } from "@/hooks/useResultsDates";
import { daysUntil } from "@/lib/market/boardMeetings";
import { checkBatch, RISK_LIMITS, verdictLine, type RiskVerdict } from "@/lib/risk/riskGate";

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
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const px = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const signedMoney = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
const tone = (v: number) => (v >= 0 ? "text-emerald-700" : "text-rose-700");

/** The live strategy check: the backtest rules followed day by day on real, finished prices. */
export function TrackerPage() {
  const [data, setData] = useState<TrackerPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [capital, setCapital] = useState(1_000_000);
  const [niftyGate, setNiftyGate] = useState(false);
  const [smoother, setSmoother] = useState(true);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const results = useResultsDates();

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const res = await fetch("/api/tracker", { cache: "no-store", ...init });
      const body = (await res.json()) as TrackerPayload;
      if (!res.ok) setMessage(body.error ?? "That did not work.");
      else setMessage(null);
      if (body.rules) setData(body);
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
      timer.current = setTimeout(loop, fast ? 3000 : 60_000);
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
  const closed = result ? result.trades.filter((t) => t.exitReason !== "end") : [];
  const wins = closed.filter((t) => t.pnl > 0).length;
  const profit = result && config ? result.markedValue - config.capital : 0;
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
    <main className="mx-auto w-full min-w-0 max-w-[1180px] space-y-5 px-4 py-6 lg:px-6">
      <PageNav current="tracker" />
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-slate-900">Live strategy check</h1>
          <p className="text-[12.5px] text-slate-500">Follows the backtested rules day by day on real, finished prices, so you can see whether they work now, not only in the past. Paper money only.</p>
        </div>
      </header>

      {message && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">{message}</p>}

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4" aria-label="Rules">
        <h2 className="text-[13px] font-extrabold text-slate-900">{data?.rules.name ?? "The rules"}</h2>
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-slate-700">{data?.rules.lines.map((line) => <li key={line}>{line}</li>)}</ul>
        <p className="text-[11.5px] text-slate-500">In the 10-year backtest these rules made about 46% a year with a worst drop of about 21%, but only about 45% of trades win and the last few years were weaker. The history only includes stocks listed today, so real results are likely lower. A few weeks of live results prove nothing; judge it after at least 30 closed trades.</p>
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
            <button type="button" disabled={busy} onClick={() => void act("start")} className="btn-gold h-10 rounded-xl px-5 text-sm font-extrabold">Start following from today</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-[12.5px] text-slate-600">
            <span><b className="text-slate-900">Following since {dayLabel(config.startDate)}</b> with {money(config.capital)}{config.niftyGate ? " · Nifty 200-day check on" : ""}{config.stopPercent === 12 ? " · 12% stop" : ""}. Prices are up to {data?.history.lastCandleDay ? dayLabel(data.history.lastCandleDay) : "—"}.</span>
            <button type="button" disabled={busy || data?.history.status === "running"} onClick={() => void act("refresh")} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-500 disabled:opacity-60">{data?.history.status === "running" ? `Updating… ${data.history.message}` : "Update prices now"}</button>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm("Stop following and clear this check? Its trades will be lost.")) void act("stop"); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:border-rose-400 disabled:opacity-60">Stop and reset</button>
            {data?.history.status === "failed" && <span className="font-semibold text-rose-700">The last update failed: {data.history.message}</span>}
          </div>
        )}
      </section>

      {config && data?.job.status === "waiting" && <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-slate-700">{data.job.message} Prices update automatically after the close, or press &quot;Update prices now&quot; once the market is closed.</p>}
      {config && data?.job.status === "running" && <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-slate-700">Working out the positions… {data.job.message}. The first calculation after a price update takes a minute or two.</p>}
      {config && data?.job.status === "failed" && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Could not calculate: {data.job.error}</p>}

      <StrategyHealthCard />

      {config && result && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Account value" value={money(result.markedValue)} tone={profit >= 0 ? "good" : "bad"} note={`${profit >= 0 ? "+" : "−"}${money(Math.abs(profit))} (${signedPct((profit / config.capital) * 100)}) since the start`} />
            <Stat label="Nifty 50 over the same days" value={nifty == null ? "—" : signedPct(nifty * 100)} note={`${sessions} session${sessions === 1 ? "" : "s"} followed`} />
            <Stat label="Open positions" value={`${result.openPositions.length} of 10`} note={`${money(result.openPositions.reduce((a, p) => a + p.quantity * p.last, 0))} in shares`} />
            <Stat label="Closed trades" value={`${closed.length}`} note={closed.length ? `${wins} won · ${closed.length - wins} lost` : "none yet"} />
          </div>

          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Next buys">
            <h3 className="text-[13px] font-extrabold text-slate-900">What the rules would buy at the next open</h3>
            <p className="mb-2 text-[11.5px] text-slate-500">
              Market check on {dayLabel(result.data.lastDay)}: {result.pending.breadth50 != null ? `${result.pending.breadth50}% of stocks above their 50-day average` : "breadth unavailable"} ({result.pending.breadthOk ? "allowed" : "below the 35% the rules need"}){result.pending.niftyOk == null ? "" : `, Nifty 50 ${result.pending.niftyOk ? "above" : "under"} its 200-day average`}. {result.pending.slotsFree} of 10 slots free.
            </p>
            {result.pending.signals.length === 0 ? (
              <p className="text-sm text-slate-600">{!result.pending.breadthOk || result.pending.niftyOk === false ? "No buys: the market check is red, which is exactly when the rules stay out." : result.pending.slotsFree === 0 ? "No buys: every slot is full." : "No qualifying breakout on the last close."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[12.5px]"><thead className="text-[10.5px] uppercase tracking-[0.06em] text-slate-500"><tr><th className="py-1">Stock</th><th>RS</th><th className="text-right">Last close</th><th className="text-right">Stop</th><th className="text-right">Shares</th><th className="text-right">Amount</th><th className="pl-3">Risk check</th></tr></thead><tbody>
                  {result.pending.signals.map((s, i) => <tr key={s.symbol} className="border-t border-border"><td className="py-1.5 font-bold"><StockSymbolButton symbol={s.symbol} className="font-bold text-slate-900">{s.symbol}</StockSymbolButton></td><td>{s.rs}</td><td className="text-right tabular-nums">₹{px(s.close)}</td><td className="text-right tabular-nums">₹{px(s.stop)}</td><td className="text-right tabular-nums">{s.quantity}</td><td className="text-right tabular-nums">{money(s.amount)}</td><td className="pl-3 text-[11.5px]"><span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-black ${verdicts[i]?.verdict === "PASS" ? "bg-emerald-600 text-white" : verdicts[i]?.verdict === "WARN" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>{verdicts[i]?.verdict ?? "—"}</span>{verdicts[i] ? verdictLine(verdicts[i]) : ""}</td></tr>)}
                </tbody></table>
                <p className="mt-1 text-[11px] text-slate-400">The real buy is tomorrow&apos;s opening price, so the stop, shares and amount are approximate.</p>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Open positions">
            <h3 className="text-[13px] font-extrabold text-slate-900">Open positions</h3>
            <p className="mb-2 text-[11.5px] text-slate-500">If every holding fell to its sell level at once (the higher of its stop and its 50-day line) the account would lose <b className={openRiskPercent > RISK_LIMITS.maxOpenRiskPercent ? "text-rose-700" : "text-slate-800"}>{openRiskPercent.toFixed(1)}%</b> (limit {RISK_LIMITS.maxOpenRiskPercent}%).</p>
            {result.openPositions.length === 0 ? <p className="text-sm text-slate-600">Nothing is held right now.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[12.5px]"><thead className="text-[10.5px] uppercase tracking-[0.06em] text-slate-500"><tr><th className="py-1">Stock</th><th>Bought</th><th className="text-right">Buy price</th><th className="text-right">Now</th><th className="text-right">Gain</th><th className="text-right">Profit</th><th className="text-right">Stop</th><th className="text-right">Sell if it closes under</th></tr></thead><tbody>
                  {result.openPositions.map((p) => {
                    const gain = (p.last / (p.spent / p.quantity) - 1) * 100;
                    return (
                      <tr key={p.symbol} className="border-t border-border">
                        <td className="py-1.5 font-bold"><StockSymbolButton symbol={p.symbol} className="font-bold text-slate-900">{p.symbol}</StockSymbolButton></td>
                        <td>{dayLabel(p.entryDay)}</td>
                        <td className="text-right tabular-nums">₹{px(p.spent / p.quantity)}</td>
                        <td className="text-right tabular-nums">₹{px(p.last)}</td>
                        <td className={`text-right tabular-nums ${tone(gain)}`}>{signedPct(gain)}</td>
                        <td className={`text-right tabular-nums ${tone(gain)}`}>{gain >= 0 ? "+" : "−"}{money(Math.abs(p.quantity * p.last - p.spent))}</td>
                        <td className="text-right tabular-nums">₹{px(p.stop)}</td>
                        <td className="text-right tabular-nums">{p.exitLevel != null ? `₹${px(p.exitLevel)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody></table>
              </div>
            )}
          </section>

          {sessions > 1 && <EquityChart result={result} />}

          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Closed trades">
            <h3 className="mb-2 text-[13px] font-extrabold text-slate-900">Closed trades</h3>
            {closed.length === 0 ? <p className="text-sm text-slate-600">No trade has closed yet. The backtest averaged about 30 trades a year, so expect this list to fill slowly, and most of the profit to come from a few long holds.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-[12px] [&_td]:px-2 [&_th]:px-2"><thead className="text-[10.5px] uppercase tracking-[0.06em] text-slate-500"><tr><th className="py-1">Stock</th><th>Bought</th><th className="text-right">Price</th><th>Sold</th><th className="text-right">Price</th><th>Why</th><th className="text-right">R</th><th className="text-right">Profit</th></tr></thead><tbody>
                  {[...closed].reverse().map((t, i) => <tr key={`${t.symbol}${t.entryDay}${i}`} className="border-t border-border"><td className="py-1 font-bold">{t.symbol}</td><td>{t.entryDay}</td><td className="text-right tabular-nums">{t.entryPrice.toFixed(1)}</td><td>{t.exitDay}</td><td className="text-right tabular-nums">{t.exitPrice.toFixed(1)}</td><td>{t.exitReason}</td><td className={`text-right tabular-nums ${tone(t.r)}`}>{t.r.toFixed(2)}</td><td className={`text-right tabular-nums ${tone(t.pnl)}`}>{signedMoney(t.pnl)}</td></tr>)}
                </tbody></table>
              </div>
            )}
          </section>

          <p className="text-[11.5px] leading-5 text-slate-500">
            How to read this: the rules are replayed from {dayLabel(config.startDate)} to {dayLabel(result.data.lastDay)} on finished daily prices, so a position opens at the next day&apos;s open after its signal, exits on a close under the 50-day average or at the stop (no adding to winners), and costs of 0.25% a side are charged. Average per closed trade so far: {num(result.stats.avgR)}R ({closed.length} trade{closed.length === 1 ? "" : "s"}; the backtest averaged about +1.0R). {closed.length < 30 ? "That is too few trades to say anything yet." : ""}
          </p>
        </>
      )}
    </main>
  );
}
