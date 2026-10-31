/**
 * When the owner is emailed about the "Ready to run" list:
 *   - a stock that was on the list at the last close breaks out through its breakout level (once per stock per day);
 *   - after the close, stocks newly on the list (the first list ever seen is only the baseline).
 * Pure: the caller reads the state and sends the email.
 */
export interface ReadyAlertState {
  /** The list as of the last after-close check. */
  lastReady: string[];
  lastListDay: string | null;
  /** IST day each stock's breakout was last announced. */
  announced: Record<string, string>;
}

export interface ReadyReading {
  day: string;
  afterClose: boolean;
  ready: Array<{ symbol: string; rs: number; underPivot: number }>;
  /** Strong stocks that have just closed or traded through their breakout level. */
  broke: Array<{ symbol: string; rs: number; ext: number }>;
}

export type ReadyAlert =
  | { kind: "breakout"; symbol: string; rs: number; ext: number }
  | { kind: "new"; added: Array<{ symbol: string; rs: number; underPivot: number }> };

export const EMPTY_READY_STATE: ReadyAlertState = { lastReady: [], lastListDay: null, announced: {} };

export function decideReadyAlert(prev: ReadyAlertState, now: ReadyReading): { state: ReadyAlertState; alerts: ReadyAlert[] } {
  const alerts: ReadyAlert[] = [];
  const announced: Record<string, string> = {};
  // Keep only marks from the current month so the file does not grow.
  for (const [symbol, day] of Object.entries(prev.announced)) if (day.slice(0, 7) === now.day.slice(0, 7)) announced[symbol] = day;
  let state: ReadyAlertState = { ...prev, announced };

  const was = new Set(prev.lastReady);
  for (const stock of now.broke) {
    if (!was.has(stock.symbol) || announced[stock.symbol] === now.day) continue;
    alerts.push({ kind: "breakout", symbol: stock.symbol, rs: stock.rs, ext: stock.ext });
    announced[stock.symbol] = now.day;
  }

  if (now.afterClose && prev.lastListDay !== now.day) {
    const added = now.ready.filter((r) => !was.has(r.symbol));
    if (prev.lastListDay != null && added.length) alerts.push({ kind: "new", added });
    state = { ...state, lastReady: now.ready.map((r) => r.symbol), lastListDay: now.day };
  }
  return { state, alerts };
}

export interface ReadyMailContext {
  breadth50: number | null;
  /** Days to the next results announcement by symbol, when known. */
  resultsInDays?: Record<string, number>;
}

const results = (symbol: string, ctx: ReadyMailContext) => {
  const d = ctx.resultsInDays?.[symbol];
  return d != null && d <= 14 ? ` ⚠ results in ${d} day${d === 1 ? "" : "s"}` : "";
};

/** Subject and plain lines for one alert. */
export function readyAlertMessage(alert: ReadyAlert, ctx: ReadyMailContext): { subject: string; lines: string[] } {
  const market = ctx.breadth50 == null ? "" : ctx.breadth50 >= 50
    ? `Market check: ${Math.round(ctx.breadth50)}% of stocks are above their 50-day average, so the tested setup is allowed.`
    : `Market check: only ${Math.round(ctx.breadth50)}% of stocks are above their 50-day average, below the 50% the test needed. Paper trade or stay out.`;
  const tail = "Plan: stop about 12% below the buy price (a smaller position keeps the money at risk the same); exit when it closes under its 50-day average (100-day for multi-year breakouts). Open the stock in the app for its checklist. Research output, not advice.";
  if (alert.kind === "breakout") {
    return {
      subject: `Ready to run: ${alert.symbol} is breaking out`,
      lines: [`${alert.symbol} (RS ${Math.round(alert.rs)}) was on the Ready to run list and is now ${alert.ext.toFixed(1)}% through its breakout level. Beyond about 5% it is already extended; do not chase.${results(alert.symbol, ctx)}`, market, tail],
    };
  }
  return {
    subject: `Ready to run: ${alert.added.length} new stock${alert.added.length === 1 ? "" : "s"}`,
    lines: [
      `New on the Ready to run list after the close:\n${alert.added.map((s) => `• ${s.symbol} · RS ${Math.round(s.rs)} · ${s.underPivot.toFixed(1)}% under its breakout level${results(s.symbol, ctx)}`).join("\n")}`,
      market,
      tail,
    ],
  };
}
