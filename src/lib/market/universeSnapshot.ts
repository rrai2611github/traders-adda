import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProvider } from "./providers";
import { EQUITIES } from "./universe";
import { getActiveSession } from "./marketHours";
import { medianTurnoverCr, mergeQuoteIntoCandles } from "./candleMerge";
import { marketProviderErrorMessage } from "./apiErrors";
import {
  checkDailyHistory,
  emptyDataQuality,
  fallbackContinuityIssue,
  previousSessionConsensus,
  type RefreshFailure,
  type SnapshotDataQuality,
} from "./historyQuality";
import type { Candle, Quote } from "./types";

/** Deep enough for the 200-day line, 52-week range and listing-age checks. */
export const HISTORY_SESSIONS = 750;
const HISTORY_TTL_MS = 12 * 60 * 60_000;
const REFRESH_WHILE_OPEN_MS = 60_000;
const REFRESH_WHILE_CLOSED_MS = 15 * 60_000;
const RETRY_AFTER_FAILURE_MS = 30_000;
const HISTORY_CONCURRENCY = 12;
const QUOTE_CHUNK = 100;
const CACHE_DIR = join(process.cwd(), ".cache", "daily-candles");

/**
 * One complete pass over the equity universe. Every scan payload is computed
 * from exactly one of these, so cross-sectional RS ranks are never built from
 * a half-loaded universe.
 */
export interface UniverseSnapshot {
  id: number;
  providerId: string;
  startedAt: number;
  completedAt: number;
  sessionDateKey: string;
  total: number;
  quotes: Map<string, Quote>;
  /** Daily history with the latest quote folded in as the current session. */
  histories: Map<string, Candle[]>;
  /** 50-session median traded value, used to keep illiquid names out of movers. */
  turnoverCr: Map<string, number>;
  /** Symbols with no quote or no history in this pass; excluded, never back-filled. */
  unavailable: string[];
  /** Nifty 50 daily history (quote merged), the benchmark for RS-line scans; null when unavailable. */
  benchmark: Candle[] | null;
  /** History validation results; excluded symbols are absent from `histories`. */
  dataQuality: SnapshotDataQuality;
}

export type { RefreshFailure };

export const BENCHMARK_SYMBOL = "NIFTY50";

export interface SweepProgress {
  phase: "history" | "quotes";
  done: number;
  total: number;
  /** When the current sweep started, for an elapsed-rate ETA on the loading message. */
  startedAt: number;
}

export type SnapshotState =
  | { status: "ready"; snapshot: UniverseSnapshot; refreshing: boolean; refreshFailure: RefreshFailure | null }
  | { status: "warming"; progress: SweepProgress }
  | { status: "failed"; error: unknown };

interface HistoryEntry {
  candles: Candle[];
  fetchedAt: number;
}

interface ProviderState {
  history: Map<string, HistoryEntry>;
  latest: UniverseSnapshot | null;
  running: Promise<void> | null;
  progress: SweepProgress;
  lastFailure: { at: number; error: unknown } | null;
  nextId: number;
}

const globalRef = globalThis as typeof globalThis & {
  __universeSnapshot?: Map<string, ProviderState>;
};

function stateFor(providerId: string): ProviderState {
  globalRef.__universeSnapshot ??= new Map();
  let state = globalRef.__universeSnapshot.get(providerId);
  if (!state) {
    state = {
      history: new Map(),
      latest: null,
      running: null,
      progress: { phase: "history", done: 0, total: EQUITIES.length, startedAt: Date.now() },
      lastFailure: null,
      nextId: 1,
    };
    globalRef.__universeSnapshot.set(providerId, state);
  }
  return state;
}

async function pool<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await run(item);
      }
    }),
  );
}

// Disk cache keeps restarts from re-downloading years of history per symbol.
// The simulated feed is deterministic and cheap, so it is never cached.
function cachePath(providerId: string, symbol: string): string {
  return join(CACHE_DIR, providerId, `${encodeURIComponent(symbol)}.json`);
}

async function readCachedHistory(providerId: string, symbol: string): Promise<HistoryEntry | null> {
  if (providerId === "mock") return null;
  try {
    const raw = JSON.parse(await readFile(cachePath(providerId, symbol), "utf8")) as {
      fetchedAt: number;
      c: Array<[number, number, number, number, number, number]>;
    };
    return {
      fetchedAt: raw.fetchedAt,
      candles: raw.c.map(([t, open, high, low, close, volume]) => ({ t, open, high, low, close, volume })),
    };
  } catch {
    return null;
  }
}

async function writeCachedHistory(providerId: string, symbol: string, entry: HistoryEntry): Promise<void> {
  if (providerId === "mock") return;
  try {
    await mkdir(join(CACHE_DIR, providerId), { recursive: true });
    const c = entry.candles.map((k) => [k.t, k.open, k.high, k.low, k.close, k.volume]);
    await writeFile(cachePath(providerId, symbol), JSON.stringify({ fetchedAt: entry.fetchedAt, c }));
  } catch {
    // A cache write failure only costs a re-download on the next restart.
  }
}

interface LoadedHistory {
  candles: Candle[];
  /** Expired cached history reused because the refresh failed. */
  fallback: boolean;
}

async function loadHistory(state: ProviderState, providerId: string, symbol: string): Promise<LoadedHistory> {
  const now = Date.now();
  let entry = state.history.get(symbol) ?? null;
  if (!entry) {
    entry = await readCachedHistory(providerId, symbol);
    if (entry) state.history.set(symbol, entry);
  }
  if (entry && now - entry.fetchedAt < HISTORY_TTL_MS) return { candles: entry.candles, fallback: false };

  try {
    const candles = await getProvider().getDailyCandles(symbol, HISTORY_SESSIONS);
    const fresh = { candles, fetchedAt: now };
    state.history.set(symbol, fresh);
    void writeCachedHistory(providerId, symbol, fresh);
    return { candles, fallback: false };
  } catch (error) {
    // An expired history is correct up to its last session; the sweep checks
    // that merging the current quote cannot hide a missing session.
    if (entry) return { candles: entry.candles, fallback: true };
    throw error;
  }
}

async function sweep(state: ProviderState): Promise<void> {
  const provider = getProvider();
  const symbols = EQUITIES.map((e) => e.symbol);
  const startedAt = Date.now();
  const histories = new Map<string, Candle[]>();
  const fallbacks = new Set<string>();
  const quotes = new Map<string, Quote>();
  const unavailable = new Set<string>();
  const dataQuality = emptyDataQuality();
  let firstError: unknown = null;

  state.progress = { phase: "history", done: 0, total: symbols.length, startedAt };
  await pool(symbols, HISTORY_CONCURRENCY, async (symbol) => {
    try {
      const loaded = await loadHistory(state, provider.historyCacheId ?? provider.id, symbol);
      const checked = checkDailyHistory(loaded.candles, Date.now());
      if (!checked.ok) {
        dataQuality.excluded.push({ symbol, reason: checked.reason });
      } else {
        if (checked.truncation) dataQuality.truncated.push({ symbol, ...checked.truncation });
        histories.set(symbol, checked.candles);
        if (loaded.fallback) fallbacks.add(symbol);
      }
    } catch (error) {
      firstError ??= error;
      unavailable.add(symbol);
    }
    state.progress.done += 1;
  });
  dataQuality.historyFallback = [...fallbacks].sort();
  const expectedPrevious = previousSessionConsensus(
    [...histories].filter(([symbol]) => !fallbacks.has(symbol)).map(([, candles]) => candles),
  );

  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) chunks.push(symbols.slice(i, i + QUOTE_CHUNK));
  state.progress = { phase: "quotes", done: 0, total: symbols.length, startedAt };
  await pool(chunks, 2, async (chunk) => {
    try {
      for (const quote of await provider.getQuotes(chunk)) quotes.set(quote.symbol, quote);
    } catch (error) {
      firstError ??= error;
    }
    state.progress.done += chunk.length;
  });

  const merged = new Map<string, Candle[]>();
  const turnoverCr = new Map<string, number>();
  for (const symbol of symbols) {
    const candles = histories.get(symbol);
    const quote = quotes.get(symbol);
    if (!candles) {
      if (!dataQuality.excluded.some((item) => item.symbol === symbol)) unavailable.add(symbol);
      continue;
    }
    if (!quote) {
      unavailable.add(symbol);
      continue;
    }
    const gap = fallbacks.has(symbol) ? fallbackContinuityIssue(candles, quote.timestamp, expectedPrevious) : null;
    if (gap) {
      dataQuality.excluded.push({ symbol, reason: gap });
      continue;
    }
    const withQuote = mergeQuoteIntoCandles(candles, quote);
    merged.set(symbol, withQuote);
    const turnover = medianTurnoverCr(withQuote);
    if (turnover != null) turnoverCr.set(symbol, turnover);
  }

  if (merged.size === 0) {
    throw firstError ?? new Error("The market data provider returned no usable equities.");
  }

  // The benchmark is optional: a failure only empties the RS-line scan.
  let benchmark: Candle[] | null = null;
  try {
    const loaded = await loadHistory(state, provider.id, BENCHMARK_SYMBOL);
    const checked = checkDailyHistory(loaded.candles, Date.now());
    if (!checked.ok) throw new Error(checked.reason);
    if (checked.truncation) dataQuality.truncated.push({ symbol: BENCHMARK_SYMBOL, ...checked.truncation });
    const [quote] = await provider.getQuotes([BENCHMARK_SYMBOL]).catch(() => [] as Quote[]);
    const gap = quote && loaded.fallback ? fallbackContinuityIssue(checked.candles, quote.timestamp, expectedPrevious) : null;
    if (gap) throw new Error(gap);
    benchmark = quote ? mergeQuoteIntoCandles(checked.candles, quote) : checked.candles;
  } catch (error) {
    dataQuality.excluded.push({ symbol: BENCHMARK_SYMBOL, reason: marketProviderErrorMessage(error) });
    benchmark = null;
  }
  dataQuality.truncated.sort((a, b) => a.symbol.localeCompare(b.symbol));
  dataQuality.excluded.sort((a, b) => a.symbol.localeCompare(b.symbol));

  state.latest = {
    id: state.nextId,
    providerId: provider.id,
    startedAt,
    completedAt: Date.now(),
    sessionDateKey: getActiveSession().dateKey,
    total: symbols.length,
    quotes,
    histories: merged,
    turnoverCr,
    unavailable: [...unavailable].sort(),
    benchmark,
    dataQuality,
  };
  state.nextId += 1;
}

/** A failed refresh newer than the snapshot being served; the snapshot is then last-known data. */
function refreshFailure(state: ProviderState): RefreshFailure | null {
  const failure = state.lastFailure;
  if (!failure || !state.latest || failure.at < state.latest.completedAt) return null;
  return { at: failure.at, message: marketProviderErrorMessage(failure.error) };
}

function isStale(snapshot: UniverseSnapshot, now: number): boolean {
  const session = getActiveSession(now);
  if (snapshot.sessionDateKey !== session.dateKey) return true;
  const maxAge = session.isLive ? REFRESH_WHILE_OPEN_MS : REFRESH_WHILE_CLOSED_MS;
  return now - snapshot.completedAt > maxAge;
}

/**
 * Returns the latest complete universe snapshot, starting a background
 * refresh when it is due. Callers never wait for a sweep: until the first one
 * finishes they get progress to report instead.
 */
export function getUniverseSnapshot(): SnapshotState {
  const providerId = getProvider().id;
  const state = stateFor(providerId);
  const now = Date.now();
  const due = !state.latest || isStale(state.latest, now);
  const backingOff = state.lastFailure != null && now - state.lastFailure.at < RETRY_AFTER_FAILURE_MS;

  if (due && !state.running && !backingOff) {
    state.running = sweep(state)
      .then(() => {
        state.lastFailure = null;
      })
      .catch((error: unknown) => {
        state.lastFailure = { at: Date.now(), error };
      })
      .finally(() => {
        state.running = null;
      });
  }

  if (state.latest) {
    return {
      status: "ready",
      snapshot: state.latest,
      refreshing: state.running != null,
      refreshFailure: refreshFailure(state),
    };
  }
  if (!state.running && state.lastFailure) return { status: "failed", error: state.lastFailure.error };
  return { status: "warming", progress: { ...state.progress } };
}

/**
 * Starts a due sweep and waits for it to finish. Scheduled work uses this so
 * it never acts on the stale snapshot that intentionally keeps the UI fast.
 */
export async function getFreshUniverseSnapshot(): Promise<SnapshotState> {
  const providerId = getProvider().id;
  const state = stateFor(providerId);
  getUniverseSnapshot();
  if (state.running) await state.running;
  if (state.latest && !isStale(state.latest, Date.now())) {
    return { status: "ready", snapshot: state.latest, refreshing: false, refreshFailure: null };
  }
  if (state.lastFailure) return { status: "failed", error: state.lastFailure.error };
  return { status: "warming", progress: { ...state.progress } };
}
