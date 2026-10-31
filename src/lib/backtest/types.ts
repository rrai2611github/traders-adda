import type { ScreenName } from "../screen/criteria.ts";

/** Which stocks become candidates each day. */
export type StrategySettings =
  | {
      /** Strong stocks in a stacked uptrend near their high (the Weekly Top 5 rule), judged every day. */
      kind: "leaders";
      rsMin: number;
      /** How far below the 52-week high a stock may be, in percent. */
      nearHighPercent: number;
      /** Also require a close above the prior 20-day high on 1.5x average volume. */
      breakout: boolean;
      /** Skip a stock more than this far above its 50-day average (one that has already run). */
      maxAboveSma50Percent?: number;
      /** Require the last 10 sessions' volume to be under the 50-day average (a base drying up before a move). */
      volumeDryUp?: boolean;
    }
  | {
      /** A breakout that passes one of the house screens on its own breakout day. */
      kind: "screen";
      screen: ScreenName;
    };

/** How the real world can be worse than the test: every fill is slightly worse, and a share of stop-outs lose far more than planned. */
export interface StressSettings {
  /** Percent worse than the test price on every entry and every exit. */
  slippagePercent: number;
  /** Share (0 to 1) of stop-outs that gap through the stop. */
  gapShare: number;
  /** Those stop-outs sell this percent under the buy price, if that is worse than the stop. */
  gapLossPercent: number;
  /** Makes the choice of which stops gap repeatable. */
  seed: number;
}

export type StopSettings =
  | { kind: "percent"; percent: number }
  | { kind: "atr"; multiple: number };

export type ExitSettings =
  | { kind: "stop" }
  | { kind: "target"; r: number }
  | { kind: "ma"; type: "sma" | "ema"; period: number; when: "next-open" | "close" };

export interface BacktestSettings {
  strategy: StrategySettings;
  /** First and last day a trade may be entered, YYYY-MM-DD. */
  from: string;
  to: string;
  /** "next-open" buys the open after the signal close; "at-pivot" (screens only) buys at the lid as it breaks out. */
  entry: "next-open" | "at-pivot";
  stop: StopSettings;
  exit: ExitSettings;
  /** Sessions after which a trade is closed at the close; 0 means no limit. */
  maxHoldDays: number;
  /** Percent of the traded value, charged on entry and again on exit. */
  costPercent: number;
  capital: number;
  maxPositions: number;
  sizing: { kind: "risk"; riskPercent: number } | { kind: "equal" };
  /** Largest share of the account one position may hold, in percent. */
  positionCapPercent: number;
  /** Largest share of a stock's median daily traded value one position may be; 0 turns the limit off. */
  turnoverLimitPercent: number;
  /** New entries only while this percent of liquid stocks are above their 50-day average; 0 turns the gate off. */
  breadthMin: number;
  /** "trading" is the live trading floor (Rs 5 Cr a day), "screen" the wider floor the screens use (Rs 1 Cr). */
  floor: "trading" | "screen";
  /** Most new entries on one day, best RS first. */
  maxNewPerDay: number;
  /** Screens only: also trade breakouts from these screens (same account, best RS first). */
  alsoScreens?: ScreenName[];
  /** Once a position closes `afterPercent` above its buy price, buy `fraction` of the original size more at the next open. */
  addOn?: { afterPercent: number; fraction: number };
  /** Skip a breakout unless the next session also closes above the breakout day's close; then buy the open after that. */
  confirm?: boolean;
  /** After a close this far above the buy price, move the stop up to the buy price. */
  breakEvenAfterPercent?: number;
  /** Sell at the close once `days` sessions have passed if the stock is not at least `minGainPercent` above the buy price. */
  timeStop?: { days: number; minGainPercent: number };
  /** Only buy while the Nifty 50 closes above its N-day average; 0 or missing turns it off. */
  niftyAbove?: number;
  /** While the account is `percent` below its peak, new positions are sized at `factor` of normal (0 pauses buying). */
  drawdownBrake?: { percent: number; factor: number };
  /** Screens only: skip a breakout whose volume that day is under this many times its 50-day average volume. */
  minVolumeRatio?: number;
  /** Screens only: skip a breakout that closes more than this percent above its 50-day average (an extended stock). */
  maxAbove50Percent?: number;
  /** At most this many open positions in one sector (stocks with no known sector are not limited); 0 or missing means no limit. */
  maxPerSector?: number;
  /** Reality check only: worse fills and some stop-outs that gap far through the stop. Missing means the ordinary test. */
  stress?: StressSettings;
  /** Screens only: skip breakouts whose RS rank on the breakout day is below this. 0 or missing keeps the screen's own band. */
  minRs?: number;
  /** Trade only this stock (a single-stock backtest); leave out for the whole market. */
  symbol?: string;
}

export interface Trade {
  symbol: string;
  entryDay: string;
  entryPrice: number;
  exitDay: string;
  exitPrice: number;
  quantity: number;
  /** Profit after costs, rupees. */
  pnl: number;
  /** Profit after costs over the amount risked to the initial stop. */
  r: number;
  pnlPercent: number;
  holdDays: number;
  exitReason: "stop" | "target" | "trail" | "time" | "end";
  rs: number | null;
}

/** What the trades alone say; enough to compare two halves of a period. */
export interface TradeStats {
  trades: number;
  winRate: number | null;
  avgR: number | null;
  /** Average winner over average loser, both in rupees. */
  payoff: number | null;
  profitFactor: number | null;
  avgHoldDays: number | null;
  /** Worst run of consecutive losing trades. */
  worstLosingStreak: number;
}

export interface BacktestStats extends TradeStats {
  totalReturnPercent: number;
  cagrPercent: number | null;
  maxDrawdownPercent: number;
  /** Share of sessions with at least one open position. */
  exposurePercent: number;
  tradesPerYear: number | null;
  /** Final account value minus the starting capital, rupees. */
  totalProfit: number;
  /** Rupees held in open positions: average over the whole period, and the most at any one close. */
  avgDeployed: number;
  peakDeployed: number;
  /** Total rupees spent buying shares over the period. */
  totalBought: number;
}

/** A position still held on the last day of the period, marked at the last close. */
export interface OpenPosition {
  symbol: string;
  entryDay: string;
  entryPrice: number;
  quantity: number;
  /** Rupees paid for the shares held, before costs. */
  spent: number;
  last: number;
  lastDay: string;
  /** The stop in force now (the first stop, or the buy price once break-even applies). */
  stop: number;
  /** Today's trailing-average exit level when the exit is a trailing average; a close under it ends the trade. */
  exitLevel: number | null;
  /** The add-to-winners purchase was made, or is waiting for the next open. */
  added: boolean;
  addPending: boolean;
  /** Price at which an add-to-winners purchase triggers, when that rule is on and has not happened. */
  addAt: number | null;
  rs: number | null;
}

/** A buy the rules would make at the next open, from the last day's signals. */
export interface PendingSignal {
  symbol: string;
  rs: number;
  /** The signal day's close; the real buy is the next open, so the figures below are approximate. */
  close: number;
  stop: number;
  quantity: number;
  amount: number;
}

export interface BacktestResult {
  settings: BacktestSettings;
  data: { symbols: number; firstDay: string; lastDay: string; sessions: number };
  stats: BacktestStats;
  /** Same figures for the two halves of the trades (by entry date), to show whether the result holds. */
  halves: { split: string; first: TradeStats; second: TradeStats } | null;
  years: Array<{
    year: number;
    trades: number;
    winRate: number | null;
    avgR: number | null;
    /** Account value at the start and end of the year, and the profit between them (after costs, open positions marked to market). */
    startValue: number;
    endValue: number;
    pnl: number;
    returnPercent: number;
    /** Rupees held in open positions: average over the year's sessions, and the most at any one close. */
    avgDeployed: number;
    peakDeployed: number;
    /** Rupees spent buying shares for trades entered in the year. */
    bought: number;
  }>;
  equity: { days: string[]; account: number[]; benchmark: number[]; drawdown: number[] };
  /** The latest trades, newest last, capped. */
  trades: Trade[];
  /** Positions still held on the last day (they are also listed in `trades` as closed at the last close, reason "end"). */
  openPositions: OpenPosition[];
  /** Account value on the last day with open positions at their last close, before any selling costs. */
  markedValue: number;
  /** What the rules would buy at the next open, and whether the market gates allow it. */
  pending: {
    signals: PendingSignal[];
    breadth50: number | null;
    breadthOk: boolean;
    niftyOk: boolean | null;
    slotsFree: number;
    /** Every breakout-day signal on the last day that the market gates allow, best RS first, whatever the paper account holds (quantity and amount are 0). */
    candidates?: PendingSignal[];
  };
  tradeCount: number;
  warnings: string[];
  elapsedMs: number;
}

export const DEFAULT_SETTINGS: BacktestSettings = {
  strategy: { kind: "leaders", rsMin: 80, nearHighPercent: 25, breakout: false },
  from: "2018-01-01",
  to: "2026-10-16",
  entry: "next-open",
  stop: { kind: "atr", multiple: 2 },
  exit: { kind: "target", r: 3 },
  maxHoldDays: 40,
  costPercent: 0.25,
  capital: 1_000_000,
  maxPositions: 10,
  sizing: { kind: "risk", riskPercent: 1 },
  positionCapPercent: 20,
  turnoverLimitPercent: 10,
  breadthMin: 60,
  floor: "trading",
  maxNewPerDay: 3,
};
