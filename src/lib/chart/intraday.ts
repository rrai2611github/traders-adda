/** Intraday chart timeframes served from Fyers (minutes per bar). */
export type IntradayTimeframe = "1" | "5" | "15" | "60";

export const INTRADAY_TIMEFRAMES: Record<IntradayTimeframe, {
  label: string;
  short: string;
  /** Calendar days of history to load (Fyers allows up to 100 per request). */
  days: number;
  /** Bars shown on first open: about one session for 1m, a few for higher frames. */
  visibleBars: number;
}> = {
  "1": { label: "1 minute", short: "1m", days: 5, visibleBars: 375 },
  "5": { label: "5 minutes", short: "5m", days: 30, visibleBars: 225 },
  "15": { label: "15 minutes", short: "15m", days: 60, visibleBars: 250 },
  "60": { label: "1 hour", short: "1h", days: 100, visibleBars: 210 },
};

export const isIntradayTimeframe = (value: unknown): value is IntradayTimeframe =>
  typeof value === "string" && Object.hasOwn(INTRADAY_TIMEFRAMES, value);
