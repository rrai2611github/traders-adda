import { isTradingDay, istDateKey } from "./marketHours.ts";

/**
 * Is the saved daily price data up to date? Exit signals, the live strategy check and the health monitor all read it, so a failed
 * nightly refresh must not go unnoticed. The holiday calendar only knows fixed national holidays, so a missing candle is only called
 * stale when the refresh itself did not run for that day: a refresh that ran and found nothing new means the market was closed.
 */
const DAY = 86_400_000;
const IST_MS = 19_800_000;
const MINUTES = (now: number) => { const d = new Date(now + IST_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/** The latest trading day whose daily candle should be on file at `now`: today only once `readyAtMinutes` (IST) has passed. */
export function expectedLastSession(now: number, readyAtMinutes = 19 * 60): string {
  let t = MINUTES(now) >= readyAtMinutes ? now : now - DAY;
  for (let i = 0; i < 10 && !isTradingDay(t); i += 1) t -= DAY;
  return istDateKey(t);
}

/** How many trading sessions after `lastDay` should already be on file (0 = up to date). */
export function sessionsBehind(lastDay: string | null, expected: string): number {
  if (!lastDay) return 99;
  let n = 0;
  for (let t = Date.parse(`${lastDay}T12:00:00+05:30`) + DAY; istDateKey(t) <= expected && n < 60; t += DAY) if (isTradingDay(t)) n += 1;
  return n;
}

export interface Freshness {
  state: "ok" | "stale";
  behind: number;
  expected: string;
  lastCandleDay: string | null;
  message: string;
}

/**
 * `lastCandleDay`: the latest candle in the price files. `refreshedDay`: the IST day the nightly refresh last completed (null if never).
 */
export function dataFreshness(input: { lastCandleDay: string | null; refreshedDay: string | null; now: number }): Freshness {
  const expected = expectedLastSession(input.now);
  const behind = sessionsBehind(input.lastCandleDay, expected);
  const refreshCovered = input.refreshedDay != null && input.refreshedDay >= expected;
  if (behind === 0 || (refreshCovered && input.lastCandleDay != null)) {
    return { state: "ok", behind: 0, expected, lastCandleDay: input.lastCandleDay, message: "Price data is up to date." };
  }
  const how = input.lastCandleDay ? `${behind} session${behind === 1 ? "" : "s"} old (latest ${input.lastCandleDay})` : "missing";
  return {
    state: "stale",
    behind,
    expected,
    lastCandleDay: input.lastCandleDay,
    message: `Price data is ${how}. Exit signals and the live strategy check may be out of date. The app refreshes after 4:30 pm IST and catches up when it is running; if this stays, run npm run refresh-data.`,
  };
}

/**
 * Should the app refresh the price files now, outside the usual after-the-close run? Only when finished sessions are missing and no
 * refresh has run since they finished (otherwise the gap is a market holiday), at most once an hour.
 */
export function needsCatchUp(input: { lastCandleDay: string | null; refreshedDay: string | null; lastRunAt: number | null; now: number }): boolean {
  if (input.lastCandleDay == null) return false;
  // A session counts as finished (and fetchable) from 16:45 IST.
  const expected = expectedLastSession(input.now, 16 * 60 + 45);
  if (sessionsBehind(input.lastCandleDay, expected) === 0) return false;
  if (input.refreshedDay != null && input.refreshedDay >= expected) return false;
  return input.lastRunAt == null || input.now - input.lastRunAt >= 3_600_000;
}
