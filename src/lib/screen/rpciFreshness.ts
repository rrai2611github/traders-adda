import { istDateKey } from "../market/marketHours.ts";

export interface RpciFreshnessInput {
  updatedAt: number;
  sessionDateKey: string;
  marketOpen: boolean;
  sourceId: string;
  quoteTimestamp: number | null;
  candleTimestamp: number;
}

export interface RpciFreshness {
  label: string;
  actionable: boolean;
}

// A full-universe sweep refreshes every minute and takes about a minute itself.
const MAX_SCAN_AGE_MS = 3 * 60_000;
// While the market is closed the snapshot refreshes every 15 minutes.
const MAX_CLOSED_SCAN_AGE_MS = 20 * 60_000;
const MAX_QUOTE_AGE_MS = 5 * 60_000;

export function rpciFreshness(input: RpciFreshnessInput, now: number): RpciFreshness {
  if (input.sourceId === "mock") {
    return { label: "Simulated data", actionable: false };
  }
  const maxScanAge = input.marketOpen ? MAX_SCAN_AGE_MS : MAX_CLOSED_SCAN_AGE_MS;
  if (!Number.isFinite(input.updatedAt) || now - input.updatedAt > maxScanAge ||
      input.updatedAt > now + MAX_QUOTE_AGE_MS) {
    return { label: "Stale scan", actionable: false };
  }
  if (!Number.isFinite(input.candleTimestamp) ||
      istDateKey(input.candleTimestamp) !== input.sessionDateKey) {
    return { label: "Stale daily candle", actionable: false };
  }
  if (input.quoteTimestamp == null || !Number.isFinite(input.quoteTimestamp)) {
    return { label: "No quote · candle close only", actionable: false };
  }
  if (istDateKey(input.quoteTimestamp) !== input.sessionDateKey ||
      input.quoteTimestamp > now + MAX_QUOTE_AGE_MS) {
    return { label: "Stale quote", actionable: false };
  }
  if (input.marketOpen) {
    if (now - input.quoteTimestamp > MAX_QUOTE_AGE_MS) {
      return { label: "Delayed quote", actionable: false };
    }
    return {
      label: input.sourceId === "yahoo" ? "Recent quote · delay unverified" : "Recent quote",
      actionable: true,
    };
  }
  return { label: "Last session · market closed", actionable: false };
}
