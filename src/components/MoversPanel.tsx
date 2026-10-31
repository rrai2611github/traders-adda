"use client";

import { useState } from "react";
import type { MoversPayload } from "@/lib/market/engine";
import { formatPercent, formatPrice, toneClass } from "@/lib/format";
import type { Quote } from "@/lib/market/types";

type Tab = "gainers" | "losers" | "mostActive";

const TABS: { id: Tab; label: string }[] = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "mostActive", label: "Most active" },
];

function tradedValueLabel(quote: Quote): string {
  const crore = (quote.volume * quote.ltp) / 10_000_000;
  return `₹${crore.toLocaleString("en-IN", { maximumFractionDigits: crore >= 100 ? 0 : 1 })} cr traded`;
}

function BreadthBar({ breadth }: { breadth: MoversPayload["breadth"] }) {
  const total = breadth.advancing + breadth.declining + breadth.unchanged || 1;
  const advPct = (breadth.advancing / total) * 100;
  const decPct = (breadth.declining / total) * 100;

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-up">{breadth.advancing} advancing</span>
        <span className="text-muted">Market breadth</span>
        <span className="text-down">{breadth.declining} declining</span>
      </div>
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={`${breadth.advancing} advancing, ${breadth.declining} declining`}
      >
        <div className="bg-up" style={{ width: `${advPct}%` }} />
        <div className="ml-auto bg-down" style={{ width: `${decPct}%` }} />
      </div>
    </div>
  );
}

function MoverRow({ quote, showValue }: { quote: Quote; showValue: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{quote.symbol}</div>
        <div className="truncate text-xs text-muted">{quote.name}</div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm">{formatPrice(quote.ltp)}</div>
        <div className={`font-mono text-xs ${toneClass(quote.change)}`}>
          {showValue ? tradedValueLabel(quote) : formatPercent(quote.changePercent)}
        </div>
      </div>
    </li>
  );
}

export function MoversPanel({ movers }: { movers: MoversPayload | null }) {
  const [tab, setTab] = useState<Tab>("gainers");

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === id
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {movers && movers.coverage?.equities === 0 ? (
        <p className="p-4 text-sm text-muted">Loading the NSE universe snapshot. Movers appear once the first pass completes.</p>
      ) : movers ? (
        <>
          <BreadthBar breadth={movers.breadth} />
          <ul>
            {movers[tab].map((quote) => (
              <MoverRow
                key={quote.symbol}
                quote={quote}
                showValue={tab === "mostActive"}
              />
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
            {movers.coverage.equities.toLocaleString("en-IN")} liquid NSE equities (median traded value ≥ ₹5 cr).
            Most active ranks by traded value.
          </p>
        </>
      ) : (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-raised" />
          ))}
        </div>
      )}
    </section>
  );
}
