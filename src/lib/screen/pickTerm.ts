import holding from "./pickHolding.json" with { type: "json" };

/**
 * The "term" of a Top pick: Short, Mid or Long, on the app's own definitions (the limits the horizon backtest uses:
 * short up to 30 trading sessions, mid up to 63 (about 3 months), long up to 250 (about a year)).
 *
 * Top picks follow one strategy with one exit rule (the stop, or a close under the 50-day average), so the term is not
 * a per-stock opinion. It is how long that strategy actually held its trades in the ten-year test
 * (`scripts/backtest-holding.mjs`, saved in pickHolding.json). The label describes typical behaviour, never a time stop.
 */
export const TERM_LIMITS = { short: 30, mid: 63, long: 250 } as const;
export type Term = "short" | "mid" | "long";
export const TERM_LABEL: Record<Term, string> = { short: "Short term", mid: "Mid term", long: "Long term" };

/** The shortest term whose limit covers this many sessions. */
export function termForHold(sessions: number): Term {
  return sessions <= TERM_LIMITS.short ? "short" : sessions <= TERM_LIMITS.mid ? "mid" : "long";
}

const weeks = (sessions: number) => Math.round(sessions / 5);

export interface PickTerm {
  term: Term;
  label: string;
  /** One short line for the card chip's tooltip and the page. */
  headline: string;
  /** The evidence behind it, in plain words. */
  detail: string;
}

/** Why every pick shares the term, from the saved test of what is knowable at entry. */
function evidence(data: typeof holding): string {
  const p = (data as { predictors?: { matchedTrades: number; noiseLevel: number; strongest: { label: string; spearman: number } } | null }).predictors;
  if (!p) return "";
  return perStockTermJustified(data)
    ? ` One trait, ${p.strongest.label.toLowerCase()}, did relate to how long trades lasted (correlation ${p.strongest.spearman}), so terms could differ by stock.`
    : ` Nothing known at entry predicted how long a trade lasted: the strongest trait, ${p.strongest.label.toLowerCase()}, correlated ${p.strongest.spearman} with the hold across ${p.matchedTrades} trades, which is within chance (about ±${p.noiseLevel}). So every pick gets the same term.`;
}

export function pickTerm(data: typeof holding = holding): PickTerm {
  const term = termForHold(data.hold.median);
  return {
    term,
    label: TERM_LABEL[term],
    headline: `${TERM_LABEL[term]}: usually held about ${weeks(data.hold.median)} weeks`,
    detail: `In the ${data.from.slice(0, 4)}–present test of these rules (${data.trades} trades) the median hold was ${data.hold.median} sessions (about ${weeks(data.hold.median)} weeks). Winners were held a median ${data.winnersMedian} sessions (about ${weeks(data.winnersMedian)} weeks); stopped-out trades about ${data.losersMedian}. ${Math.round(data.shareLonger.mid)}% lasted past 3 months and ${data.shareLonger.long === 0 ? "none" : `${Math.round(data.shareLonger.long)}%`} past a year. The stop or a close under the 50-day average decides the real exit, not this label.${evidence(data)}`,
  };
}

/**
 * True only when a trait known at entry predicted the holding time beyond noise in the saved test. While it is false (it is today),
 * every Top pick honestly shares one term; if it ever turns true, per-stock terms become worth building and the test says so.
 */
export function perStockTermJustified(data: typeof holding = holding): boolean {
  const p = (data as { predictors?: { noiseLevel: number; strongest: { spearman: number } } | null }).predictors;
  return !!p && Math.abs(p.strongest.spearman) >= p.noiseLevel;
}

export type HoldPositionKey = "new" | "early" | "typical" | "long" | "very-long";

export interface HoldPosition {
  key: HoldPositionKey;
  text: string;
}

/** Where a call's age sits among the past trades: how many sessions it has run against how long such trades usually lasted. */
export function holdPosition(sessions: number, data: typeof holding = holding): HoldPosition {
  const { p25, p75, p90 } = data.hold;
  const middle = `The middle half of past trades lasted ${p25}–${p75} sessions.`;
  if (!(sessions > 0)) return { key: "new", text: `Called today. ${middle}` };
  if (sessions > p90) return { key: "very-long", text: `Session ${sessions}: longer than nine in ten past trades (over ${p90}). The rules still hold it until the stop or a close under the 50-day average.` };
  if (sessions > p75) return { key: "long", text: `Session ${sessions}: longer than three quarters of past trades (over ${p75}).` };
  if (sessions < p25) return { key: "early", text: `Session ${sessions}. ${middle}` };
  return { key: "typical", text: `Session ${sessions}. ${middle}` };
}
