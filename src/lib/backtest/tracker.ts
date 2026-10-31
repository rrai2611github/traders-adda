import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { istDateKey } from "../market/marketHours.ts";
import { historyLastDay, refreshState, type RefreshState } from "./historyRefresh.ts";
import { startBacktest, type JobState } from "./jobs.ts";
import type { BacktestSettings } from "./types.ts";

/**
 * The live strategy check: the same rules as the backtest preset "Blue sky + Multi-year breakouts", followed from a start date
 * with real, finished daily prices. Every refresh replays the rules from the start date to the latest session, so the open
 * positions, stops, closed trades and account value always come from the same engine that produced the ten-year numbers.
 */
const FILE = join(process.cwd(), ".cache", "strategy-tracker.json");

export interface TrackerConfig {
  /** First day the rules may act on, YYYY-MM-DD: signals from this day's close onward. */
  startDate: string;
  startedAt: number;
  capital: number;
  /** Also require the Nifty 50 to close above its 200-day average before buying. */
  niftyGate: boolean;
  /** Stop below the buy price: 8 (the tested default) or 12 (smaller positions, shallower drops). */
  stopPercent: 8 | 12;
}

export const LIVE_RULES = {
  name: "Blue sky + Multi-year breakouts",
  lines: [
    "Buy a breakout on the Blue sky or Multi-year breakouts screen at the next open (strongest RS first, at most 3 a day, 10 positions).",
    "Only while at least 35% of stocks are above their 50-day average.",
    "Stop 12% below the buy price (8% is the tighter option), with a smaller position so 2% of the account is at risk. Exit when the stock closes under its 50-day average, or hits the stop.",
    "Risk 2% of the account on each trade (a position never exceeds 20% of the account); 0.25% cost on each side. A buy is skipped if the cash left covers less than half the size the rules want.",
  ],
} as const;

export function trackerSettings(config: TrackerConfig): BacktestSettings {
  return {
    strategy: { kind: "screen", screen: "Blue sky" },
    alsoScreens: ["Multi-year breakouts"],
    from: config.startDate,
    to: "2099-12-31",
    entry: "next-open",
    stop: { kind: "percent", percent: config.stopPercent },
    exit: { kind: "ma", type: "sma", period: 50, when: "close" },
    maxHoldDays: 0,
    costPercent: 0.25,
    capital: config.capital,
    maxPositions: 10,
    sizing: { kind: "risk", riskPercent: 2 },
    positionCapPercent: 20,
    turnoverLimitPercent: 10,
    breadthMin: 35,
    floor: "trading",
    maxNewPerDay: 3,
    ...(config.niftyGate ? { niftyAbove: 200 } : {}),
  };
}

export function readTracker(): TrackerConfig | null {
  try {
    const c = JSON.parse(readFileSync(FILE, "utf8")) as Partial<TrackerConfig>;
    if (typeof c.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.startDate)) return null;
    return { startDate: c.startDate, startedAt: Number(c.startedAt) || 0, capital: Number(c.capital) > 0 ? Number(c.capital) : 1_000_000, niftyGate: c.niftyGate === true, stopPercent: c.stopPercent === 12 ? 12 : 8 };
  } catch {
    return null;
  }
}

/** Starts following the rules from today's close (or from `startDate`). Replaces any earlier check. */
export function startTracker(options: { capital?: number; niftyGate?: boolean; stopPercent?: number; startDate?: string; now?: number } = {}): TrackerConfig {
  const now = options.now ?? Date.now();
  const config: TrackerConfig = {
    startDate: options.startDate && /^\d{4}-\d{2}-\d{2}$/.test(options.startDate) ? options.startDate : istDateKey(now),
    startedAt: now,
    capital: options.capital && options.capital >= 10_000 && options.capital <= 1e9 ? Math.round(options.capital) : 1_000_000,
    niftyGate: options.niftyGate === true,
    stopPercent: options.stopPercent === 12 ? 12 : 8,
  };
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(config));
  return config;
}

export function stopTracker(): void {
  if (existsSync(FILE)) unlinkSync(FILE);
}

export interface TrackerState {
  config: TrackerConfig | null;
  history: RefreshState & { lastCandleDay: string | null };
  /** "waiting" until the price files hold a session on or after the start date. */
  job: JobState | { status: "waiting"; message: string } | { status: "none" };
}

/** The tracker's configuration and its current result (starting the computation if it is not running). */
export function trackerState(): TrackerState {
  const config = readTracker();
  const history = { ...refreshState(), lastCandleDay: historyLastDay() };
  if (!config) return { config, history, job: { status: "none" } };
  if (!history.lastCandleDay || history.lastCandleDay < config.startDate) {
    return { config, history, job: { status: "waiting", message: `Following from ${config.startDate}. The first finished session arrives after the close (about 4:30 pm IST); nothing has happened yet.` } };
  }
  return { config, history, job: startBacktest(trackerSettings(config)) };
}
