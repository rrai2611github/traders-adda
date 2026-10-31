"use client";

import { useEffect, useMemo, useState } from "react";
import { PageNav } from "./PageNav";
import { Stat } from "./BacktestPage";
import { StockSymbolButton } from "./StockDetailContext";
import { ENOUGH, LIST_LABEL, TAG_LABEL, groupLabel, type GroupSummary, type RadarList, type ScoreState } from "@/lib/radar/radar";
import type { RadarView } from "@/lib/radar/radarServer";
import { Term } from "./Term";

const px = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const signed = (v: number | null, suffix = "%") => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(suffix === "R" ? 2 : 1)}${suffix}`);
const tone = (v: number | null) => (v == null || v === 0 ? "text-slate-500" : v > 0 ? "text-emerald-700" : "text-rose-700");
const whenLabel = (at: number) => new Date(at).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

const STATE: Record<ScoreState, { label: string; chip: string }> = {
  open: { label: "Still open", chip: "bg-sky-100 text-sky-800" },
  stopped: { label: "Stopped out", chip: "bg-rose-100 text-rose-800" },
  exited: { label: "Exit signal", chip: "bg-amber-100 text-amber-800" },
  "too-new": { label: "Too new", chip: "bg-slate-100 text-slate-600" },
  "no-data": { label: "No price file", chip: "bg-slate-100 text-slate-600" },
};

const th = "px-2.5 py-2 text-left text-[10px] font-black uppercase tracking-wide text-slate-500";
const td = "px-2.5 py-2 align-middle text-[12px]";

function GroupTable({ rows, empty }: { rows: GroupSummary[]; empty: string }) {
  if (!rows.length) return <p className="px-3 py-4 text-[12px] text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={th}>List</th>
            <th className={th}>Stocks</th>
            <th className={th}><Term k="winRate">Win rate</Term></th>
            <th className={th}><Term k="r">Avg R</Term></th>
            <th className={th} title="Average move from the email price to now (or to the exit)">Move so far</th>
            <th className={th} title="Plain price move after 5 and 20 sessions, ignoring the stop">After 5 / 20 days</th>
            <th className={th}><Term k="vsNifty">Vs Nifty</Term></th>
            <th className={th}><Term k="stop">Stopped out</Term></th>
            <th className={th}><Term k="target">Hit target 1</Term></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} className="border-b border-slate-100">
              <td className={`${td} font-bold text-slate-900`}>
                {g.label}
                {!g.enough && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-600" title={`Fewer than ${ENOUGH} stocks have had a finished session, so these numbers can easily be luck.`}>too few to judge</span>}
              </td>
              <td className={`${td} font-mono`}>{g.scored}<span className="text-slate-400"> / {g.count}</span></td>
              <td className={`${td} font-mono font-bold`}>{g.winRate == null ? "—" : `${g.winRate.toFixed(0)}%`}</td>
              <td className={`${td} font-mono font-bold ${tone(g.avgR)}`}>{signed(g.avgR, "R")}</td>
              <td className={`${td} font-mono font-bold ${tone(g.avgReturn)}`}>{signed(g.avgReturn)}</td>
              <td className={`${td} font-mono`}><span className={tone(g.avgRet5)}>{signed(g.avgRet5)}</span> <span className="text-slate-300">/</span> <span className={tone(g.avgRet20)}>{signed(g.avgRet20)}</span></td>
              <td className={`${td} font-mono ${tone(g.avgVsNifty)}`}>{signed(g.avgVsNifty)}</td>
              <td className={`${td} font-mono`}>{g.stopRate == null ? "—" : `${g.stopRate.toFixed(0)}%`}</td>
              <td className={`${td} font-mono`}>{g.hitTarget1 == null ? "—" : `${g.hitTarget1.toFixed(0)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RadarPage() {
  const [view, setView] = useState<RadarView | null>(null);
  const [failed, setFailed] = useState(false);
  const [list, setList] = useState<RadarList | "all">("all");

  useEffect(() => {
    let alive = true;
    const pull = () => {
      fetch("/api/radar", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<RadarView>) : Promise.reject(new Error("bad response"))))
        .then((next) => { if (alive) { setView(next); setFailed(false); } })
        .catch(() => { if (alive) setFailed(true); });
    };
    pull();
    const timer = setInterval(pull, 300_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const rows = useMemo(() => (view?.rows ?? []).filter((r) => list === "all" || r.entry.list === list), [view, list]);
  const lists = useMemo(() => [...new Set((view?.rows ?? []).map((r) => r.entry.list))], [view]);
  const overall = view?.overall ?? null;

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1180px] space-y-5 px-4 py-6 lg:px-6">
      <PageNav current="radar" />
      <header>
        <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-slate-900">Email track record</h1>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-slate-500">
          Every stock the pre-open and hourly emails give to the recipients is saved the first time it is listed, with the price and plan from that email.
          Each one is then followed with the finished daily prices, so you can see whether the picks we send actually work. Nothing here sends anything or changes a rule.
        </p>
      </header>

      {view?.lastRecorded && (
        <p className="text-[11.5px] text-slate-500">
          Last email recorded: <strong className="text-slate-700">{whenLabel(view.lastRecorded.at)} IST</strong> ({view.lastRecorded.email === "pre-open" ? "pre-open" : "hourly"}) · {view.lastRecorded.listed} stocks listed, {view.lastRecorded.added} new to the record.
        </p>
      )}
      {failed && !view && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">Could not load the track record. The page will try again.</p>}
      {!view && !failed && <p className="text-[12.5px] text-slate-500">Loading…</p>}

      {view && view.total === 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-[13px] text-slate-700">
          <h2 className="font-extrabold text-slate-900">Nothing recorded yet</h2>
          <p className="mt-1">The record starts with the next pre-open or hourly email that really goes out (test emails are not recorded). Once it has gone out, this page shows when it was recorded. Check back again after a few trading days: a stock needs at least one finished session before it can be scored.</p>
        </section>
      )}

      {view && view.total > 0 && overall && (
        <>
          <section aria-label="Overall" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Stocks emailed" value={String(view.total)} note={view.firstDay ? `since ${dayLabel(view.firstDay)}` : undefined} />
            <Stat label="Scored so far" value={String(overall.scored)} note="at least one finished session" />
            <Stat label="Win rate" value={overall.winRate == null ? "—" : `${overall.winRate.toFixed(0)}%`} note="of finished trades" tone={!overall.enough || overall.winRate == null ? undefined : overall.winRate >= 45 ? "good" : "bad"} />
            <Stat label="Average result" value={signed(overall.avgR, "R")} note="per finished trade" tone={!overall.enough || overall.avgR == null ? undefined : overall.avgR >= 0 ? "good" : "bad"} />
          </section>

          {!overall.enough && (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] leading-5 text-amber-900">
              Only {overall.scored} of the {view.total} stocks have had a finished session so far. With fewer than {ENOUGH} the numbers below can easily be luck, so use them to watch the trend, not to judge the picks yet. The backtest expects about 45% of trades to win.
            </p>
          )}

          <section aria-label="By list" className="rounded-2xl border border-slate-200 bg-white">
            <div className="px-3 pt-3">
              <h2 className="text-[13px] font-extrabold text-slate-900">How each list is doing</h2>
              <p className="text-[11.5px] text-slate-500">An entry is &ldquo;finished&rdquo; once the rules ended it: the stop was hit, or it closed under its 50-day average. The older lists have no proven edge, so they are here for comparison.</p>
            </div>
            <GroupTable rows={view.groups} empty="No stocks yet." />
          </section>

          <section aria-label="By market check" className="rounded-2xl border border-slate-200 bg-white">
            <div className="px-3 pt-3">
              <h2 className="text-[13px] font-extrabold text-slate-900">Does the market check matter?</h2>
              <p className="text-[11.5px] text-slate-500">The tested rule buys only while at least 35% of stocks are above their 50-day average. This splits the Ready and Just broke out picks by what that number was when the email went out.</p>
            </div>
            <GroupTable rows={view.byMarket} empty="No Ready or Just broke out picks yet." />
          </section>

          <section aria-label="Stocks emailed" className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
              <h2 className="mr-auto text-[13px] font-extrabold text-slate-900">Stocks we emailed <span className="font-mono text-slate-400">({rows.length})</span></h2>
              <div className="flex flex-wrap gap-1.5">
                {(["all", ...lists] as const).map((key) => (
                  <button key={key} type="button" aria-pressed={list === key} onClick={() => setList(key)} className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${list === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"}`}>
                    {key === "all" ? "All" : LIST_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="border-y border-slate-200">
                    <th className={th}>Stock</th>
                    <th className={th}>Listed as</th>
                    <th className={th}>First emailed</th>
                    <th className={th}>Price then</th>
                    <th className={th}>Stop</th>
                    <th className={th}>Status</th>
                    <th className={th}>Move so far</th>
                    <th className={th} title="Highest high and lowest low since the email">Best / worst</th>
                    <th className={th}>Vs Nifty</th>
                    <th className={th}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ entry, score }) => (
                    <tr key={entry.id} className="border-b border-slate-100">
                      <td className={td}>
                        <StockSymbolButton symbol={entry.symbol} className="block text-left text-[12px] font-black text-slate-900">{entry.symbol}</StockSymbolButton>
                        <span className="block max-w-[170px] truncate text-[10.5px] text-slate-500">{entry.name}</span>
                      </td>
                      <td className={`${td} text-slate-700`}>{groupLabel(entry)}{entry.tag && entry.list !== "top-picks" ? ` · ${TAG_LABEL[entry.tag] ?? entry.tag}` : ""}{entry.mentions > 1 && <span className="block text-[10px] text-slate-400">listed {entry.mentions} times</span>}</td>
                      <td className={`${td} text-slate-600`}>{dayLabel(entry.firstDay)}<span className="block text-[10px] text-slate-400">{entry.email === "pre-open" ? "pre-open" : "hourly"}{entry.breadth50 != null ? ` · market ${Math.round(entry.breadth50)}%` : ""}</span></td>
                      <td className={`${td} font-mono`}>₹{px(entry.price)}</td>
                      <td className={`${td} font-mono text-slate-600`}>{score.stop != null ? `₹${px(score.stop)}` : "—"}{entry.stop == null && score.stop != null && <span className="block text-[10px] text-slate-400">12% rule</span>}</td>
                      <td className={td}>
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATE[score.state].chip}`}>{STATE[score.state].label}</span>
                        {score.exitDay && <span className="block text-[10px] text-slate-400">on {dayLabel(score.exitDay)}</span>}
                        {score.state === "open" && <span className="block text-[10px] text-slate-400">{score.sessions} session{score.sessions === 1 ? "" : "s"}</span>}
                      </td>
                      <td className={`${td} font-mono font-bold ${tone(score.returnPercent)}`}>{signed(score.returnPercent)}</td>
                      <td className={`${td} font-mono text-[11px]`}><span className="text-emerald-700">{signed(score.best)}</span> <span className="text-slate-300">/</span> <span className="text-rose-700">{signed(score.worst)}</span>{score.hitTarget1 && <span className="block text-[10px] font-bold text-emerald-700">reached target 1</span>}</td>
                      <td className={`${td} font-mono ${tone(score.vsNifty)}`}>{signed(score.vsNifty)}</td>
                      <td className={`${td} font-mono font-bold ${tone(score.r)}`}>{signed(score.r, "R")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-3 py-3 text-[11px] leading-5 text-slate-500">
              How it is scored: the price in the email is the buy price; the stop is the email&rsquo;s own (12% under the price when it had none). The stock is &ldquo;stopped out&rdquo; if a day trades down to the stop (a gap under it counts at the open), and gets an &ldquo;exit signal&rdquo; if it closes under its 50-day average (only once it has been above it). If the stop and a target fall inside one day, the stop is assumed first. A pre-open email counts its own day; an hourly email counts from the next day. R means the profit or loss in units of the money risked: +1R is a gain equal to the stop distance. Prices are updated after the close{view.lastDay ? `; the latest finished day is ${dayLabel(view.lastDay)}` : ""}.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
