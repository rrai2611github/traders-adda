/**
 * Where the latest price sits against a recommendation's trigger. A plan is built on the last completed
 * (or, in the hourly email, the forming) candle, so the price that matters when you read it is today's:
 * above the skip level the setup should not be chased, at or above the trigger it has fired, below it is still waiting.
 */

export type EntryKind = "skip" | "triggered" | "waiting";

export interface EntryState {
  kind: EntryKind;
  /** Percent the trigger is above the price (waiting), or the price is above the trigger (otherwise). */
  gapPercent: number;
}

export function entryState(price: number, entry: number, buyZoneHigh?: number | null): EntryState {
  if (buyZoneHigh != null && price > buyZoneHigh) return { kind: "skip", gapPercent: (price / entry - 1) * 100 };
  if (price >= entry) return { kind: "triggered", gapPercent: (price / entry - 1) * 100 };
  return { kind: "waiting", gapPercent: (entry / price - 1) * 100 };
}

export function entryNoteText(state: EntryState | undefined): string {
  if (!state) return "";
  return state.kind === "skip" ? "now above the skip level, do not chase"
    : state.kind === "triggered" ? "trigger reached"
      : `${state.gapPercent.toFixed(1)}% below the trigger`;
}

const COLOR: Record<EntryKind, string> = { skip: "#b91c1c", triggered: "#15803d", waiting: "#64748b" };

/** The note as an HTML line (starts with a line break) for the sub-line of a stock card. Digits and fixed words only, so no escaping is needed. */
export const entryNoteHtml = (state: EntryState | undefined): string =>
  state ? `<br><b style="color:${COLOR[state.kind]}">${entryNoteText(state).replace(/^./, (c) => c.toUpperCase())}</b>` : "";

/** The note as a suffix for a plain-text line. */
export const entryNoteSuffix = (state: EntryState | undefined): string => (state ? ` · ${entryNoteText(state)}` : "");
