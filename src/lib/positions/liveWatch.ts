import type { Holding } from "./positions.ts";

/**
 * Live checks on the user's real positions while the market is open. The exit rules are written for finished daily candles, but one of
 * them, the stop, can be hit at any moment, so it is worth knowing about at once rather than that evening.
 */
export type LiveAlertKind = "stop" | "below-50dma";

export interface LiveAlert {
  holdingId: string;
  symbol: string;
  kind: LiveAlertKind;
  price: number;
  level: number;
  text: string;
}

export interface LiveQuote {
  ltp: number;
  /** Epoch milliseconds of the last update. */
  timestamp: number;
}

const MAX_QUOTE_AGE_MS = 5 * 60_000;
const rupees = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Alerts for open positions given the latest prices. A stop at or under the stop price is the rule firing. A price under the 50-day
 * average is only a heads-up (the rule acts on the close) and is skipped unless `includeFiftyDay` (late in the session). Stale, missing
 * or invalid prices never produce an alert: better silent than wrong.
 */
export function liveAlerts(
  items: ReadonlyArray<{ holding: Holding; sma50: number | null }>,
  quotes: ReadonlyMap<string, LiveQuote>,
  now: number,
  includeFiftyDay: boolean,
): LiveAlert[] {
  const out: LiveAlert[] = [];
  for (const { holding: h, sma50 } of items) {
    if (h.sold) continue;
    const q = quotes.get(h.symbol);
    if (!q || !Number.isFinite(q.ltp) || !(q.ltp > 0) || !Number.isFinite(q.timestamp) || q.timestamp > now + 60_000 || now - q.timestamp > MAX_QUOTE_AGE_MS) continue;
    if (q.ltp <= h.stop) {
      out.push({
        holdingId: h.id, symbol: h.symbol, kind: "stop", price: q.ltp, level: h.stop,
        text: `${h.symbol} is trading at ${rupees(q.ltp)}, at or under your ${rupees(h.stop)} stop. The rules say you are out: sell if you have not, then mark it sold in the app.`,
      });
    } else if (includeFiftyDay && sma50 != null && q.ltp < sma50) {
      out.push({
        holdingId: h.id, symbol: h.symbol, kind: "below-50dma", price: q.ltp, level: sma50,
        text: `${h.symbol} is trading at ${rupees(q.ltp)}, under its 50-day average of ${rupees(sma50)}. The rule acts only if it closes there, so nothing to do yet: check again near the close.`,
      });
    }
  }
  return out;
}

export const alertKey = (a: Pick<LiveAlert, "holdingId" | "kind">) => `${a.holdingId}:${a.kind}`;

/** The alerts not yet sent today. */
export function unsentAlerts(alerts: ReadonlyArray<LiveAlert>, sent: ReadonlyArray<string>): LiveAlert[] {
  const done = new Set(sent);
  return alerts.filter((a) => !done.has(alertKey(a)));
}
