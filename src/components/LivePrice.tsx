"use client";

import { useEffect } from "react";
import { registerLiveSymbols, staleLabel, useLiveQuotes } from "@/hooks/useLiveQuotes";

const money = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (value: number) => (value > 0 ? "text-emerald-600" : value < 0 ? "text-rose-600" : "text-slate-500");

/**
 * A stock's latest market price with today's move. It shows the live quote when one has arrived and
 * the scan's own price until then; an old quote while the market is open is flagged. Prices come from
 * the shared poller, so many of these on a page cost one request per refresh, not one each.
 */
export function LivePrice({ symbol, fallbackPrice, fallbackChange, stacked = false, className = "" }: {
  symbol: string;
  fallbackPrice: number;
  fallbackChange: number | null;
  /** Put the move under the price instead of beside it. */
  stacked?: boolean;
  className?: string;
}) {
  useEffect(() => registerLiveSymbols([symbol]), [symbol]);
  const { quotes, live } = useLiveQuotes([]);
  const quote = quotes.get(symbol);
  const price = quote?.ltp ?? fallbackPrice;
  const change = quote ? quote.changePercent : fallbackChange;
  const old = staleLabel(quote, live);
  const move = change == null ? null : <span className={`${stacked ? "block" : "ml-1"} text-xs ${tone(change)}`}>{change > 0 ? "+" : ""}{change.toFixed(2)}%</span>;
  return (
    <span className={`font-mono ${className}`} title={quote ? "Latest market price" : "Price from the last scan"}>
      {money(price)}
      {move}
      {old && <span className="block text-[10px] font-bold text-amber-600">{old}</span>}
    </span>
  );
}
