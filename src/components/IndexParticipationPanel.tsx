"use client";

import type { IndexContext } from "@/lib/market/indexContext";

const pct = (value: number | null) => value == null ? "Unavailable" : `${value.toFixed(1)}%`;

export function IndexParticipationPanel({ context, symbol }: { context: IndexContext; symbol: string }) {
  const participation = context.breadthByIndex[symbol];
  const coverage = context.historyCoverage[symbol];
  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black">Participation &amp; data quality</h2>
      {coverage ? <p className={`mt-2 text-sm ${coverage.reason ? "text-amber-700" : "text-muted"}`}>
        History: {coverage.bars} daily bars · latest session {coverage.session ?? "unavailable"} · expected {coverage.expectedSession}.
        {coverage.reason ? ` ${coverage.reason}` : ""}
      </p> : null}
      {participation ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["20-day average", participation.current.above20, participation.current.coverage20],
              ["50-day average", participation.current.above50, participation.current.coverage50],
              ["200-day average", participation.current.above200, participation.current.coverage200],
            ].map(([label, value, covered]) => (
              <div key={String(label)} className="rounded-xl border border-border p-3">
                <div className="text-xs font-bold text-muted">Members above {label}</div>
                <div className="mt-1 text-2xl font-black">{typeof value === "number" ? pct(value) : "Unavailable"}</div>
                <p className="text-xs text-muted">Coverage {covered}/{participation.current.total}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm">
            <b>Five-session breadth direction: {participation.direction}.</b>{" "}
            {participation.change50pp == null
              ? "Insufficient common coverage for a reliable comparison (minimum 80%)."
              : `${participation.change50pp >= 0 ? "+" : ""}${participation.change50pp.toFixed(1)} percentage points above 50 DMA since ${participation.comparisonDate}; same ${participation.comparisonCoverage} members at both dates.`}
          </p>
          <p className="mt-2 text-sm text-muted">
            Session {participation.asOf}: advances {participation.current.advances}, declines {participation.current.declines}, unchanged {participation.current.unchanged}.
            {" "}Covered {participation.current.covered}/{participation.current.total} members.
          </p>
        </>
      ) : <p className="mt-3 text-sm text-amber-700">Constituent participation unavailable{symbol === "INDIAVIX" ? ": VIX has no equity constituents." : ": waiting for session-aligned index and constituent history."}</p>}
      <p className="mt-3 text-xs text-muted">
        Official membership snapshot: {context.membershipAsOf}. Historical breadth uses this current membership, not historical index constituents.
        {" "}Data refresh: {new Date(context.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.
        {context.membershipSources[symbol] ? <>{" "}<a href={context.membershipSources[symbol]} target="_blank" rel="noopener noreferrer" className="text-accent underline">Official constituent source</a>.</> : null}
      </p>
      <p className="mt-3 text-sm"><b>Leadership:</b> {context.leadership}</p>
      <p className="mt-2 text-sm"><b>Risk:</b> {context.volatility}</p>
      {context.unavailable.length ? <p className="mt-2 text-xs text-amber-700">Unavailable: {context.unavailable.join(", ")}.</p> : null}
    </section>
  );
}
