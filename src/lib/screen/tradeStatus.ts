/**
 * The one status vocabulary shown for a stock everywhere: scanner tables, the
 * drawer, Today, Watchlist, Today's Picks and the emails. Scores such as RS, the
 * PA rating, the oscillator score and confluence explain a status; they never
 * compete with it as separate verdicts.
 */
export type TradeStatusKey = "buy-ready" | "watch" | "extended" | "avoid" | "short-ready";

export interface TradeStatusMeta {
  label: string;
  emoji: string;
  /** One line for legends and tooltips. */
  meaning: string;
}

export const TRADE_STATUS: Record<TradeStatusKey, TradeStatusMeta> = {
  "buy-ready": { label: "Buy ready", emoji: "🟢", meaning: "Every check passes, market breadth included. Buy above the trigger with the plan's stop." },
  watch: { label: "Watch", emoji: "🔵", meaning: "Every stock check passes; waiting for market breadth or for a risk warning to clear." },
  extended: { label: "Extended", emoji: "🟠", meaning: "Good stock, but price has run past the buy zone. Don't chase; wait for a pullback." },
  avoid: { label: "Avoid", emoji: "⚪", meaning: "One or more stock checks fail. Not a trade today." },
  "short-ready": { label: "Short ready", emoji: "🔴", meaning: "Every bearish check passes. Research only; shorts are not sent to customers." },
};

export const TRADE_STATUS_ORDER: readonly TradeStatusKey[] = ["buy-ready", "watch", "extended", "short-ready", "avoid"];

/** Check keys that measure how far price has run past the buy zone. */
const EXTENSION_KEYS: ReadonlySet<string> = new Set(["extension", "notExtended"]);

export interface StatusCheck {
  key: string;
  pass: boolean;
}

/**
 * Long-side status from pass/fail checks: all pass → Buy ready; only market
 * breadth fails → Watch; only the extension check fails (breadth may fail too)
 * → Extended; any other stock check fails → Avoid.
 */
export function longStatusKey(checks: readonly StatusCheck[]): Exclude<TradeStatusKey, "short-ready"> {
  if (!checks.length) return "avoid";
  const failed = checks.filter((check) => !check.pass);
  if (!failed.length) return "buy-ready";
  const stockFailed = failed.filter((check) => check.key !== "breadth");
  if (!stockFailed.length) return "watch";
  if (stockFailed.every((check) => EXTENSION_KEYS.has(check.key))) return "extended";
  return "avoid";
}

/**
 * The single status of a stock that has both long and short assessments: a
 * live long status wins; otherwise Short ready when every bearish check passes;
 * otherwise Avoid.
 */
export function combinedStatusKey(
  long: TradeStatusKey | null | undefined,
  short: TradeStatusKey | null | undefined,
): TradeStatusKey {
  if (long && long !== "avoid" && long !== "short-ready") return long;
  if (short === "short-ready") return "short-ready";
  return "avoid";
}
