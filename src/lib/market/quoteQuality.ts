import type { Quote } from "./types.ts";

export type QuoteTiming = Pick<Quote, "timestamp" | "source" | "fetchedAt" | "tradeTimestamp" | "timestampBasis">;

export function quoteEntryIssue(quote: QuoteTiming, now: number, maxAge: number): string | null {
  if (quote.source === "mock") return "Simulated quote: new paper entries blocked.";
  const tradeAt = quote.tradeTimestamp === undefined ? quote.source === "fyers" ? null : quote.timestamp : quote.tradeTimestamp;
  if (tradeAt == null || quote.timestampBasis === "session" || quote.timestampBasis === "fetch") {
    return "Trade-time freshness unverified: new paper entries blocked.";
  }
  if (!Number.isFinite(tradeAt) || tradeAt > now) return "Invalid/future trade time: new paper entries blocked.";
  if (now - tradeAt > maxAge) return "Stale quote: new paper entries blocked.";
  return null;
}

export function quoteSourceLabel(quote: QuoteTiming): string {
  const source = quote.source === "fyers" ? "Fyers" : quote.source === "yahoo" ? "Yahoo / fallback" :
    quote.source === "kite" ? "Kite" : quote.source === "mock" ? "Simulated" : "Source not recorded";
  return `${source} · ${(quote.source === "fyers" && quote.tradeTimestamp == null) || quote.tradeTimestamp === null || quote.timestampBasis === "fetch" || quote.timestampBasis === "session"
    ? "trade-time freshness unverified" : "provider timestamp; latency not guaranteed"}`;
}
