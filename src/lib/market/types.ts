export type Exchange = "NSE" | "BSE";

export type InstrumentKind = "EQUITY" | "INDEX";

export interface Instrument {
  symbol: string;
  name: string;
  exchange: Exchange;
  kind: InstrumentKind;
  sector?: string;
  /** Free-float market cap in INR crore. Undefined for indices. */
  marketCapCr?: number;
  /** NSE series: EQ is regular, BE is trade-for-trade (delivery only, usually a 5% price band). */
  series?: "EQ" | "BE";
}

/**
 * A normalised snapshot of an instrument. Every provider adapter must map its
 * native payload into this shape so the rest of the app stays provider-agnostic.
 */
export interface Quote {
  symbol: string;
  name: string;
  kind: InstrumentKind;
  sector?: string;
  /** Last traded price. */
  ltp: number;
  /** Previous session close, the baseline for change calculations. */
  previousClose: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  /** Cumulative traded volume for the session. */
  volume: number;
  /** Epoch milliseconds of the last update. */
  timestamp: number;
}

export type MarketPhase =
  | "PRE_OPEN"
  | "OPEN"
  | "CLOSED"
  | "HOLIDAY"
  | "WEEKEND";

export interface MarketStatus {
  phase: MarketPhase;
  /** True only when continuous trading is live and prices should stream. */
  isLive: boolean;
  label: string;
  exchange: Exchange;
  /** IST wall-clock time of the evaluation, `YYYY-MM-DD HH:mm:ss`. */
  serverTimeIst: string;
  /** Epoch ms of the next phase transition, or null when unknown. */
  nextTransition: number | null;
  nextTransitionLabel: string | null;
}

/** Rolling intraday point used to render sparklines. */
export interface PricePoint {
  t: number;
  p: number;
}

/** Daily OHLCV candle used by the pattern setup charts. */
export interface Candle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ConnectionState = "connecting" | "live" | "polling" | "offline";
