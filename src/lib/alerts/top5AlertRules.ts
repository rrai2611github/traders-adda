/**
 * When the owner is emailed about the Weekly Top 5. The rule only pays in strong markets, so the useful events are:
 *   - the market tier changes (for example paper-only to normal size), confirmed by two readings in a row so a
 *     breadth reading that flickers around 60% does not send a string of emails;
 *   - after the close, the Top 5 itself changed since the last list sent, unless the market is in the paper-only tier.
 * Pure: the caller reads the state and sends the email.
 */
export type Top5Tier = "full" | "quarter" | "paper";

export interface Top5AlertState {
  tier: Top5Tier | null;
  pendingTier: Top5Tier | null;
  pendingCount: number;
  lastSymbols: string[];
  /** IST date of the last after-close list check, so it runs once a day. */
  lastListDay: string | null;
}

export interface Top5Reading {
  tier: Top5Tier;
  symbols: string[];
  /** True once the session has closed, when the list is final for the day. */
  afterClose: boolean;
  /** IST date, YYYY-MM-DD. */
  day: string;
}

export type Top5Alert =
  | { kind: "tier"; from: Top5Tier; to: Top5Tier }
  | { kind: "list"; added: string[]; removed: string[] };

export const EMPTY_TOP5_STATE: Top5AlertState = { tier: null, pendingTier: null, pendingCount: 0, lastSymbols: [], lastListDay: null };
/** Readings in a row (about 15 minutes apart) before a tier change counts. */
export const TIER_CONFIRMATIONS = 2;

export function decideTop5Alert(prev: Top5AlertState, now: Top5Reading): { state: Top5AlertState; alerts: Top5Alert[] } {
  const alerts: Top5Alert[] = [];
  let state: Top5AlertState = { ...prev };

  if (prev.tier == null) {
    state = { ...state, tier: now.tier, pendingTier: null, pendingCount: 0 };
  } else if (now.tier === prev.tier) {
    state = { ...state, pendingTier: null, pendingCount: 0 };
  } else {
    const count = prev.pendingTier === now.tier ? prev.pendingCount + 1 : 1;
    if (count >= TIER_CONFIRMATIONS) {
      alerts.push({ kind: "tier", from: prev.tier, to: now.tier });
      state = { ...state, tier: now.tier, pendingTier: null, pendingCount: 0 };
    } else {
      state = { ...state, pendingTier: now.tier, pendingCount: count };
    }
  }

  if (now.afterClose && prev.lastListDay !== now.day) {
    const before = new Set(prev.lastSymbols);
    const after = new Set(now.symbols);
    const added = now.symbols.filter((s) => !before.has(s));
    const removed = prev.lastSymbols.filter((s) => !after.has(s));
    // The first list ever seen is the baseline, and a paper-only market gets no list emails.
    if (prev.lastListDay != null && (added.length || removed.length) && now.tier !== "paper") alerts.push({ kind: "list", added, removed });
    state = { ...state, lastSymbols: [...now.symbols], lastListDay: now.day };
  }
  return { state, alerts };
}

const TIER_LABEL: Record<Top5Tier, string> = { full: "Normal size", quarter: "Quarter size or paper only", paper: "Paper trade only" };

export interface Top5MailPick { symbol: string; rs: number; close: number; stop: number; target: number }

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 0 : 1 })}`;

/** Subject and plain lines for one alert, with the current list so the email stands on its own. */
export function top5AlertMessage(alert: Top5Alert, picks: ReadonlyArray<Top5MailPick>, breadth50: number | null): { subject: string; lines: string[] } {
  const list = picks.length
    ? `Weekly Top 5 now:\n${picks.map((p, i) => `${i + 1}. ${p.symbol} · RS ${Math.round(p.rs)} · last ${inr(p.close)} · stop ${inr(p.stop)} · part profit (3R) ${inr(p.target)} · hold while above 50-day average`).join("\n")}`
    : "No stock passes every rule right now.";
  const breadth = breadth50 != null ? ` Breadth is ${Math.round(breadth50)}%.` : "";
  if (alert.kind === "tier") {
    const better = alert.to === "full" || (alert.to === "quarter" && alert.from === "paper");
    return {
      subject: `Weekly Top 5: market is now "${TIER_LABEL[alert.to]}"`,
      lines: [
        `${better ? "📈" : "📉"} Market tier changed from "${TIER_LABEL[alert.from]}" to "${TIER_LABEL[alert.to]}".${breadth}`,
        alert.to === "full"
          ? "The market is back in the zone where this rule was tested to work (60%+ of stocks in an uptrend). Normal size, about 1% risk per trade."
          : alert.to === "quarter"
            ? "Breadth is 50–60%, a coin flip in the backtest. Quarter size or paper only."
            : "Breadth is under 50%. The picks lost money on average in the backtest. Paper trade only, or at most 0.25% risk.",
        list,
      ],
    };
  }
  return {
    subject: `Weekly Top 5 changed: ${alert.added.length} in, ${alert.removed.length} out`,
    lines: [
      `Weekly Top 5 changed after the close.${breadth}${alert.added.length ? `\nNew: ${alert.added.join(", ")}` : ""}${alert.removed.length ? `\nDropped: ${alert.removed.join(", ")}` : ""}`,
      list,
    ],
  };
}
