import type { Quote } from "../market/types.ts";
import { quoteEntryIssue, quoteSourceLabel } from "../market/quoteQuality.ts";

export function trackerValuation(position: { quantity: number; spent: number }, quote: Quote | undefined,
  live: boolean, now: number) {
  if (!quote || !Number.isFinite(quote.ltp) || quote.ltp <= 0 || quote.source === "mock") {
    return { price: null, value: null, pnl: null, gain: null, label: "Quote unavailable", tradeAt: null, fetchedAt: null };
  }
  const value = position.quantity * quote.ltp;
  const issue = quoteEntryIssue(quote, now, 120_000);
  const fetchedAt = quote.fetchedAt ?? null;
  const staleFetch = fetchedAt != null && now - fetchedAt > 120_000;
  const label = live && (staleFetch || issue?.startsWith("Stale")) ? "Stale quote"
    : !live ? "Market closed - last available quote"
      : quote.source === "yahoo" ? "Delayed / fallback"
        : issue ? "Exact trade time unavailable" : "Recent provider quote";
  return {
    price: quote.ltp, value, pnl: value - position.spent,
    gain: position.spent > 0 ? (value / position.spent - 1) * 100 : null,
    label: `${label} · ${quote.source === "fyers" ? "Fyers" : quote.source === "yahoo" ? "Yahoo" : quote.source === "kite" ? "Kite" : quoteSourceLabel(quote)}`,
    tradeAt: quote.tradeTimestamp ?? (quote.timestampBasis === "trade" ? quote.timestamp : null),
    fetchedAt,
  };
}
