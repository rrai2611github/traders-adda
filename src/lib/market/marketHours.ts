import type { Exchange, MarketStatus, MarketPhase } from "./types";

/**
 * IST is a fixed UTC+05:30 offset with no daylight saving, so wall-clock maths
 * can be done by shifting the epoch and reading UTC fields.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const PRE_OPEN_START_MIN = 9 * 60; // 09:00
const SESSION_START_MIN = 9 * 60 + 15; // 09:15
const SESSION_END_MIN = 15 * 60 + 30; // 15:30

/**
 * Exchange holidays, keyed `YYYY-MM-DD` in IST.
 *
 * Only fixed-date national holidays are hard-coded because festival dates move
 * every year. Supply the full exchange circular list via the
 * `MARKET_HOLIDAYS` env var (comma-separated `YYYY-MM-DD`) and refresh it
 * annually — an out-of-date list only affects the displayed session label.
 */
const FIXED_HOLIDAYS_MMDD = new Set([
  "01-26", // Republic Day
  "08-15", // Independence Day
  "10-02", // Gandhi Jayanti
  "12-25", // Christmas
]);

function configuredHolidays(): Set<string> {
  const raw = process.env.MARKET_HOLIDAYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  );
}

interface IstParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minutesOfDay: number;
  secondsOfDay: number;
  dateKey: string;
  mmdd: string;
  clock: string;
}

function istParts(epochMs: number): IstParts {
  const shifted = new Date(epochMs + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  const seconds = shifted.getUTCSeconds();
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    year,
    month,
    day,
    weekday: shifted.getUTCDay(),
    minutesOfDay: hours * 60 + minutes,
    secondsOfDay: hours * 3600 + minutes * 60 + seconds,
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
    mmdd: `${pad(month)}-${pad(day)}`,
    clock: `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  };
}

/**
 * Development escape hatch: `MARKET_FORCE_LIVE=1` simulates an open session at
 * any hour so the streaming path can be exercised outside market hours. The UI
 * labels the session as simulated so it can never be mistaken for a real one.
 */
function isForcedLive(): boolean {
  return process.env.MARKET_FORCE_LIVE === "1";
}

/** Epoch ms for a given IST calendar day at `minutesOfDay` past midnight. */
function istEpochFor(parts: IstParts, minutesOfDay: number, dayOffset = 0): number {
  const midnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset);
  return midnightUtc + minutesOfDay * 60_000 - IST_OFFSET_MS;
}

function isNonTradingDay(parts: IstParts, holidays: Set<string>): boolean {
  if (parts.weekday === 0 || parts.weekday === 6) return true;
  return holidays.has(parts.dateKey) || FIXED_HOLIDAYS_MMDD.has(parts.mmdd);
}

/** Epoch ms of the next 09:15 IST that falls on a trading day. */
function nextSessionOpen(parts: IstParts, holidays: Set<string>): number {
  for (let offset = 0; offset <= 10; offset += 1) {
    const probeEpoch = istEpochFor(parts, SESSION_START_MIN, offset);
    const probe = istParts(probeEpoch);
    if (isNonTradingDay(probe, holidays)) continue;
    if (probeEpoch > istEpochFor(parts, parts.minutesOfDay)) return probeEpoch;
  }
  return istEpochFor(parts, SESSION_START_MIN, 1);
}

export function getMarketStatus(
  now: number = Date.now(),
  exchange: Exchange = "NSE",
): MarketStatus {
  const holidays = configuredHolidays();
  const parts = istParts(now);

  if (isForcedLive()) {
    return {
      phase: "OPEN",
      isLive: true,
      label: "Market open (simulated session)",
      exchange,
      serverTimeIst: parts.clock,
      nextTransition: null,
      nextTransitionLabel: null,
    };
  }

  let phase: MarketPhase;
  let label: string;
  let nextTransition: number | null;
  let nextTransitionLabel: string | null;

  if (parts.weekday === 0 || parts.weekday === 6) {
    phase = "WEEKEND";
    label = "Weekend — market closed";
    nextTransition = nextSessionOpen(parts, holidays);
    nextTransitionLabel = "Opens";
  } else if (isNonTradingDay(parts, holidays)) {
    phase = "HOLIDAY";
    label = "Trading holiday";
    nextTransition = nextSessionOpen(parts, holidays);
    nextTransitionLabel = "Opens";
  } else if (parts.minutesOfDay >= PRE_OPEN_START_MIN && parts.minutesOfDay < SESSION_START_MIN) {
    phase = "PRE_OPEN";
    label = "Pre-open session";
    nextTransition = istEpochFor(parts, SESSION_START_MIN);
    nextTransitionLabel = "Opens";
  } else if (parts.minutesOfDay >= SESSION_START_MIN && parts.minutesOfDay < SESSION_END_MIN) {
    phase = "OPEN";
    label = "Market open";
    nextTransition = istEpochFor(parts, SESSION_END_MIN);
    nextTransitionLabel = "Closes";
  } else {
    phase = "CLOSED";
    label = parts.minutesOfDay >= SESSION_END_MIN ? "Market closed" : "Pre-market";
    nextTransition = nextSessionOpen(parts, holidays);
    nextTransitionLabel = "Opens";
  }

  return {
    phase,
    isLive: phase === "OPEN",
    label,
    exchange,
    serverTimeIst: parts.clock,
    nextTransition,
    nextTransitionLabel,
  };
}

export const SESSION_MINUTES = SESSION_END_MIN - SESSION_START_MIN;

/**
 * Whether the IST calendar day is a trading day (not a weekend or a holiday).
 *
 * This is a calendar fact, so unlike `getMarketStatus` it deliberately ignores
 * `MARKET_FORCE_LIVE`: a simulated session must not make Sunday a trading day,
 * and must not stop time-of-day schedules such as the pre-open email from
 * recognising a real trading day.
 */
export function isTradingDay(now: number = Date.now()): boolean {
  return !isNonTradingDay(istParts(now), configuredHolidays());
}

export interface ActiveSession {
  /** Trading day the displayed prices belong to (`YYYY-MM-DD`, IST). */
  dateKey: string;
  /** Fraction of that session elapsed, in `[0, 1]`. */
  progress: number;
  isLive: boolean;
}

/**
 * Resolves which trading session the UI should display.
 *
 * Outside market hours this rolls back to the most recent completed session so
 * the dashboard shows that day's close instead of an empty state.
 */
export function getActiveSession(now: number = Date.now()): ActiveSession {
  const holidays = configuredHolidays();
  const parts = istParts(now);

  if (isForcedLive()) {
    // Advance at real-time speed and wrap, so a forced session never freezes.
    const sessionSeconds = SESSION_MINUTES * 60;
    return {
      dateKey: parts.dateKey,
      progress: (parts.secondsOfDay % sessionSeconds) / sessionSeconds,
      isLive: true,
    };
  }

  const tradingToday = !isNonTradingDay(parts, holidays);
  if (tradingToday && parts.minutesOfDay >= SESSION_START_MIN) {
    const elapsed = parts.minutesOfDay - SESSION_START_MIN;
    return {
      dateKey: parts.dateKey,
      progress: Math.min(1, elapsed / SESSION_MINUTES),
      isLive: parts.minutesOfDay < SESSION_END_MIN,
    };
  }

  for (let offset = 1; offset <= 10; offset += 1) {
    const probe = istParts(istEpochFor(parts, SESSION_START_MIN, -offset));
    if (!isNonTradingDay(probe, holidays)) {
      return { dateKey: probe.dateKey, progress: 1, isLive: false };
    }
  }

  return { dateKey: parts.dateKey, progress: 1, isLive: false };
}

/** IST calendar day key (`YYYY-MM-DD`) for the given instant. */
export function istDateKey(now: number = Date.now()): string {
  return istParts(now).dateKey;
}
