import { isTradingDay, istDateKey } from "../market/marketHours.ts";

export class MarketEmailBlockedError extends Error {}

export function marketEmailCalendarWarning(now = Date.now()): string | null {
  const year = Number(istDateKey(now).slice(0, 4));
  return year >= 2024 && year <= 2026
    ? null
    : `The built-in NSE holiday calendar covers 2024-2026, not ${year}. Update it from the exchange circular before relying on market-day emails; MARKET_HOLIDAYS can add extra closures.`;
}

export function marketEmailBlockReason(now = Date.now()): string | null {
  if (!isTradingDay(now)) return `Market email blocked: ${istDateKey(now)} is a weekend or NSE trading holiday. Use an explicitly labelled test email for testing.`;
  if (process.env.MARKET_FORCE_LIVE === "1") return "Market email blocked during a simulated session. Use an explicitly labelled test email for testing.";
  return null;
}

/** Manual customer sends may bypass the clock window, but never a closed day or simulation. */
export function requireMarketEmailDay(now = Date.now()): void {
  const reason = marketEmailBlockReason(now);
  if (reason) throw new MarketEmailBlockedError(reason);
}
