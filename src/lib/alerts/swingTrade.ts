/**
 * Trade-type wording shared by the customer emails. Every stock they carry is
 * a daily-candle swing setup, backtested with a 3-session entry window and a
 * 30-session time exit, never an intraday or long-term call.
 */
export const SWING_LABEL = "Swing trade";
export const SWING_HOLDING = "Hold a few days to a few weeks (max 30 sessions). Not intraday, not long-term.";

export const SWING_RULES: string[] = [
  "Enter only above the trigger, within 3 trading days. Skip if it opens above the skip price or hits the stop first.",
  "Size so the stop loss costs at most 1% of capital: quantity = (1% of capital) ÷ (entry − stop).",
  "At T1 book half and move the stop to cost. At T2 book the rest.",
  "Exit on a close below the stop, or after 30 trading days if neither target is hit.",
];

/** The shared alert footer line these rules replace. */
export const isPlanFooterLine = (line: string) => /^Buy only above the trigger/i.test(line);
