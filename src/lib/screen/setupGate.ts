/**
 * The market check for the tested setup (Blue sky + Multi-year breakouts): buy only while at least 35% of liquid stocks are above their
 * 50-day average (the gate the 10-year backtest used). The Nifty 50 against its 200-day average is no longer part of the check: it was
 * neutral with the 8% stop and cut profit from 412L to 146L with the 12% stop that is now the main plan, so the live strategy check runs
 * without it. It is still read for display. One place, so the dashboard, the checklist and the emails always agree.
 */
export const SETUP_BREADTH_MIN = 35;

export interface SetupStatus {
  /** Real buys are allowed today. */
  allowed: boolean;
  breadthOk: boolean | null;
  niftyOk: boolean | null;
  /** The reason in plain words, for a banner or an email line. */
  reason: string;
}

/** The size note for the trade-plan card: the setup check decides between a normal size and paper trading. */
export function setupSize(breadth50: number | null, nifty?: { above: boolean; percent: number } | null): { key: "full" | "paper"; label: string; detail: string } {
  const gate = setupStatus(breadth50, nifty);
  return gate.allowed
    ? { key: "full", label: "Normal size", detail: `The setup check is passed (${gate.reason}). The tested rules risk about 1-2% of the account on a trade; never more than 2%.` }
    : { key: "paper", label: "Paper trade only", detail: `The setup check is not passed (${gate.reason}). In the 10-year test the rules stayed out of exactly these markets, so paper trade, or risk no more than 0.25%.` };
}

/** `nifty` is accepted so callers need not change; it is reported in `niftyOk` for display but never decides `allowed`. */
export function setupStatus(breadth50: number | null, nifty?: { above: boolean; percent: number } | null): SetupStatus {
  const breadthOk = breadth50 == null ? null : breadth50 >= SETUP_BREADTH_MIN;
  const niftyOk = nifty == null ? null : nifty.above;
  return {
    allowed: breadthOk === true,
    breadthOk,
    niftyOk,
    reason: breadth50 != null ? `${Math.round(breadth50)}% of stocks are above their 50-day average (the setup needs ${SETUP_BREADTH_MIN}%)` : "the market check is unavailable",
  };
}
