"use client";

import Link from "next/link";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import { formatPercent, formatPrice, formatSigned, toneClass } from "@/lib/format";
import type { Quote } from "@/lib/market/types";

const timeLabel = (timestamp: number) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);

function IndexCard({ quote }: { quote: Quote }) {
  const flash = usePriceFlash(quote.ltp);

  return (
    <Link
      href={`/indices/${quote.symbol.toLowerCase()}`}
      aria-label={`Open detailed analysis for ${quote.name}`}
      className={`index-snapshot-card group min-w-[172px] flex-1 rounded-xl border border-border bg-surface px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${flash}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[11px] uppercase tracking-wide text-muted">
          {quote.name}
        </div>
        <span className="text-xs text-slate-400 transition group-hover:text-accent" aria-hidden>↗</span>
      </div>
      <div className="mt-1 font-mono text-lg font-semibold">
        {formatPrice(quote.ltp)}
      </div>
      <div className={`mt-2 inline-flex rounded-md bg-raised px-2 py-1 font-mono text-[11px] font-semibold ${toneClass(quote.change)}`}>
        {formatSigned(quote.change)} ({formatPercent(quote.changePercent)})
      </div>
      <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-accent">
        View analysis <span aria-hidden>→</span>
      </div>
    </Link>
  );
}

export function IndexStrip({ quotes, lastUpdate, error }: {
  quotes: Quote[];
  lastUpdate: number | null;
  error: boolean;
}) {
  if (quotes.length === 0) {
    return (
      <div className="flex gap-3 overflow-x-auto" role="status" aria-label="Loading index snapshot">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[86px] min-w-[168px] flex-1 animate-pulse rounded-lg border border-border bg-surface"
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted">
        <span className="font-bold uppercase tracking-wide">Index snapshot · refresh every 5 seconds</span>
        <span className={error ? "font-semibold text-down" : ""}>
          {error ? "Refresh retrying…" : lastUpdate ? `Updated ${timeLabel(lastUpdate)}` : "Connecting…"}
        </span>
      </div>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {quotes.map((quote) => (
          <div key={quote.symbol} className="flex min-w-[172px] flex-1 snap-start">
            <IndexCard quote={quote} />
          </div>
        ))}
      </div>
    </div>
  );
}
