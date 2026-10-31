"use client";

import { ScalpNav } from "./ScalpNav";
import { useCallback, useEffect, useState } from "react";
import type { PaperDay, PaperLeg, PaperSummary } from "@/lib/scalp/paperStraddle";
import type { PaperStraddleReport } from "@/lib/scalp/paperStraddleRun";
import type { ScalpIndex } from "@/lib/scalp/scalpLogic";

type Report = PaperStraddleReport & {
  fyers: { configured: boolean; connected: boolean };
  refreshError: string | null;
};

const NAMES: Record<ScalpIndex, string> = { NIFTY: "Nifty 50", BANKNIFTY: "Bank Nifty" };
const REFRESH_MS = 60_000;

const rs = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const text = `₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
  return value < 0 ? `−${text}` : value > 0 ? `+${text}` : text;
};
const tone = (value: number | null | undefined) => (value == null ? "text-slate-300" : value > 0 ? "text-emerald-400" : value < 0 ? "text-rose-400" : "text-slate-300");
const time = (t: number | null) => (t == null ? "" : new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }));
const shortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });

export function PaperStraddle() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/scalp/paper", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReport((await response.json()) as Report);
      setError(null);
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  return (
    <main className="min-h-screen bg-[#060b16] text-slate-200">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-3 py-3 sm:px-5">
        <ScalpNav current="paper" />
        <header className="rounded-xl border border-slate-800 bg-[#0b1220] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-white">Paper straddle</h1>
            <span className="rounded-full bg-amber-900/60 px-2 py-0.5 text-[10px] font-bold text-amber-200">PAPER · NO REAL ORDERS</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            The 09:20 short straddle from the backtest, tracked with <b className="text-slate-200">real Fyers option prices</b>: sell the ATM call and put of the
            nearest expiry at 09:20, stop each leg 25% above its sale price, buy back the rest at 15:15. One lot each, after Fyers charges and slippage.
            It also records what the backtest model would have sold for, to measure how far the model is from reality.
          </p>
        </header>

        {report && !report.fyers.connected ? (
          <div className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            Fyers is not connected today, so nothing new can be recorded. <a href="/api/fyers/login" className="font-bold underline">Connect Fyers</a>.
            Connect before 15:15 on expiry days: once a contract expires its prices are gone. Other days in the current expiry cycle are filled in automatically later.
          </div>
        ) : null}
        {report?.refreshError || report?.lastError ? (
          <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-200">{report.refreshError ?? report.lastError}</div>
        ) : null}
        {error ? <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-200">{error}</div> : null}
        {!report && !error ? (
          <div className="rounded-xl border border-slate-800 bg-[#0b1220] px-4 py-8 text-center text-sm text-slate-400">Loading the paper record…</div>
        ) : null}

        {report ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {(["NIFTY", "BANKNIFTY"] as const).map((index) => (
                <SummaryCard key={index} index={index} summary={report.summary[index]} today={report.days.find((d) => d.index === index && d.status === "open")} />
              ))}
            </div>
            <DayTable days={report.days} />
            <p className="text-[11px] text-slate-500">
              Last updated {report.lastRunAt ? new Date(report.lastRunAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "never"}.
              While Fyers is connected, the app follows today&apos;s trade from 09:21 every 5 minutes (every minute while this page is open) and closes it after 15:15.
              Fills use the 1-minute candle open (stops: the stop price, or the open if it gapped past), plus ₹0.5 (Nifty) / ₹1 (Bank Nifty) slippage per side in the costs.
              Real fills at the bid/ask can be worse. Margin for a naked straddle is roughly ₹2–3 lakh per lot.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}

function SummaryCard({ index, summary, today }: { index: ScalpIndex; summary: PaperSummary; today?: PaperDay }) {
  const enough = summary.closedDays >= summary.needed;
  const ratio = summary.realToModel;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-[#0b1220] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-black text-white">{NAMES[index]}</h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${enough ? (summary.netRs > 0 ? "bg-emerald-900/60 text-emerald-200" : "bg-rose-900/60 text-rose-200") : "bg-slate-800 text-slate-300"}`}>
          {enough ? (summary.netRs > 0 ? "Profitable on paper" : "Losing on paper") : `${summary.closedDays} of ${summary.needed} days`}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Net, after costs" value={rs(summary.netRs)} className={tone(summary.netRs)} />
        <Stat label="Winning days" value={summary.closedDays ? `${summary.winDays}/${summary.closedDays}` : "—"} />
        <Stat label="Max drawdown" value={summary.maxDrawdown ? rs(-summary.maxDrawdown) : "—"} className="text-rose-400" />
        <Stat label="Real ÷ model premium" value={ratio == null ? "—" : `${ratio.toFixed(2)}×`} className={ratio == null ? "text-white" : ratio >= 1 ? "text-emerald-400" : "text-amber-300"} />
      </div>
      <p className="text-[11px] text-slate-400">
        {ratio == null
          ? "Real ÷ model compares the actual 09:20 premiums with the backtest's estimate."
          : ratio >= 1
            ? "Real premiums have been at or above the model's estimate, so the backtest was not too generous on entry prices so far."
            : `Real premiums have been ${Math.round((1 - ratio) * 100)}% below the model's estimate. In the backtest, selling 5% cheaper already turned the result into a loss.`}
        {enough ? "" : ` Judge it only after ${summary.needed} closed days.`}
      </p>
      {today ? <TodayCard day={today} /> : null}
    </section>
  );
}

function TodayCard({ day }: { day: PaperDay }) {
  return (
    <div className="rounded-lg border border-sky-900 bg-sky-950/30 px-3 py-2 text-xs">
      <div className="flex justify-between gap-2">
        <b className="text-sky-200">Open now · {day.strike} straddle · expiry {shortDate(day.expiry)}</b>
        <b className={tone(day.netRs)}>{rs(day.netRs)}</b>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-slate-300">
        {day.legs.map((leg) => <LegCell key={leg.side} leg={leg} />)}
      </div>
    </div>
  );
}

function LegCell({ leg }: { leg: PaperLeg }) {
  const label = leg.side === "CE" ? "Call" : "Put";
  const exit = leg.bought ?? leg.mark;
  const status = leg.status === "stop" ? `stopped ${time(leg.boughtAt)}` : leg.status === "close" ? "15:15" : "open, last";
  return (
    <span title={leg.symbol}>
      {label} {leg.sold.toFixed(1)} → {exit.toFixed(1)} <span className={leg.status === "stop" ? "text-rose-300" : "text-slate-500"}>({status})</span>
    </span>
  );
}

function DayTable({ days }: { days: PaperDay[] }) {
  if (!days.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0b1220] px-4 py-6 text-center text-sm text-slate-400">
        No paper days yet. Days are recorded once Fyers is connected.
      </div>
    );
  }
  return (
    <section className="rounded-xl border border-slate-800 bg-[#0b1220] p-4">
      <h2 className="text-sm font-bold text-white">Day by day (1 lot)</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="text-left text-[10px] uppercase text-slate-500">
            <tr>
              <th className="py-1">Date</th><th>Index</th><th>Strike</th><th>Expiry</th><th>Call</th><th>Put</th>
              <th className="text-right">Real ÷ model</th><th className="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const real = d.legs.reduce((a, l) => a + l.sold, 0);
              const model = d.legs.reduce((a, l) => a + (l.modelSold ?? 0), 0);
              return (
                <tr key={`${d.index}-${d.day}`} className="border-t border-slate-800">
                  <td className="py-1.5">{shortDate(d.day)}{d.status === "open" ? <span className="ml-1 text-sky-300">· open</span> : null}</td>
                  <td>{NAMES[d.index]}</td>
                  <td>{d.strike}</td>
                  <td>{shortDate(d.expiry)}{d.expiry === d.day ? <span className="ml-1 text-amber-300">· expiry day</span> : null}</td>
                  {d.legs.map((leg) => <td key={leg.side}><LegCell leg={leg} /></td>)}
                  <td className="text-right text-slate-400">{model > 0 ? `${(real / model).toFixed(2)}×` : "—"}</td>
                  <td className={`text-right font-bold ${tone(d.netRs)}`}>{rs(d.netRs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value, className = "text-white" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm font-black ${className}`}>{value}</div>
    </div>
  );
}
