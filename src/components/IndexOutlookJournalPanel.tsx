"use client";

import type { IndexContext } from "@/lib/market/indexContext";
import { EmptyState } from "./WorkspaceShell";
import { formatPrice } from "@/lib/format";

export function IndexOutlookJournalPanel({ journal, symbol }: { journal: IndexContext["journal"]; symbol: string }) {
  const records = journal?.status === "available" ? journal.records.filter((record) => record.symbol === symbol) : [];
  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black">Saved pre-open outlooks</h2>
      <p className="mt-1 text-sm text-muted">
        First real outlook captured between 08:45 and 09:15 IST is frozen. After close, exact-date daily OHLC records what happened.
        No retrospective forecasts or trade win-rate claims.
      </p>
      {journal?.status === "error" ? (
        <EmptyState title="Journal unavailable" tone="error">{journal.reason}</EmptyState>
      ) : !records.length ? (
        <EmptyState title="No saved outlooks yet">Recording starts prospectively on the next trading morning while this server is running. Missed pre-open sessions are never backfilled.</EmptyState>
      ) : (
        <>
          <p className="mt-3 text-xs text-muted">{records.length} outlooks for this index · {records.filter((record) => record.evaluation).length} evaluated · {records.filter((record) => !record.evaluation).length} pending. Latest five below.</p>
          <div className="mt-3 space-y-3">
            {records.slice(0, 5).map((record) => (
              <details key={record.tradingDate} className="rounded-xl border border-border p-3">
                <summary className="cursor-pointer text-sm font-bold">
                  {record.tradingDate} · Daily {record.analysis.dailyTrend} / weekly {record.analysis.weeklyTrend}
                  {" · "}{record.evaluation ? record.evaluation.path === "ambiguous-intraday-sequence-unknown" ? "Both sides crossed · order unknown" : "Evaluated" : "Pending completed-session data"}
                </summary>
                <p className="mt-2 text-xs text-muted">Saved {new Date(record.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · source {record.source} · based on {new Date(record.signalSession).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} close.</p>
                <p className="mt-2 text-sm">{record.analysis.summary}</p>
                <p className="mt-2 text-sm"><b>Bullish:</b> {record.analysis.scenarios.bullish}</p>
                <p className="mt-1 text-sm"><b>Bearish:</b> {record.analysis.scenarios.bearish}</p>
                <p className="mt-1 text-sm"><b>Range:</b> {record.analysis.scenarios.range}</p>
                {record.evaluation ? (
                  <div className="mt-3 border-t border-border pt-2 text-sm">
                    <p>Actual O / H / L / C: {[
                      record.evaluation.bar.open, record.evaluation.bar.high, record.evaluation.bar.low, record.evaluation.bar.close,
                    ].map((price) => formatPrice(price)).join(" / ")}.</p>
                    {[
                      ["Resistance", record.evaluation.resistance],
                      ["Support", record.evaluation.support],
                    ].map(([label, outcome]) => typeof outcome === "object" && outcome ? (
                      <p key={String(label)} className="mt-1">
                        {String(label)} {formatPrice(outcome.level.price)}: {outcome.touched ? "touched" : "not touched"},
                        {" "}{outcome.broken ? "crossed" : "not crossed"}; close {outcome.closeStatus === "held" ? "at/above" : "below"} level.
                      </p>
                    ) : <p key={String(label)}>{String(label)} unavailable.</p>)}
                    <p className="mt-2 text-xs text-amber-700">Daily candles cannot prove intraday sequence, entry fills or breadth confirmation.</p>
                  </div>
                ) : <p className="mt-3 text-xs text-muted">Evaluation waits for this date&apos;s completed daily candle; unavailable data stays pending.</p>}
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
