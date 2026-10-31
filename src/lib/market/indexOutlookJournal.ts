import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { IndexContext } from "./indexContext";
import type { IndexAnalysis, StructuralLevel } from "./indexAnalysis";
import type { Candle } from "./types";
import { isTradingDay, istDateKey } from "./marketHours.ts";

export const INDEX_OUTLOOK_JOURNAL_PATH = ".cache/index-outlook-journal.json";
/** About four exchange years: keep whole dates, never partial index coverage. */
export const INDEX_OUTLOOK_RETENTION_DAYS = 1000;
const OFFSET = 19_800_000;
const DAY = 86_400_000;
const MAX_CONTEXT_AGE = 5 * 60_000;
type TradingCalendar = (epoch: number) => boolean;
export type JournalResult<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: string };

export interface IndexOutlookLevels {
  nearbySupport: StructuralLevel | null;
  nearbyResistance: StructuralLevel | null;
  /** Nearest first, retaining labels even when prices coincide. */
  rankedSupports: StructuralLevel[];
  rankedResistances: StructuralLevel[];
}

export interface IndexOutlookLevelOutcome {
  level: StructuralLevel;
  /** True only if this price lies inside the observed daily low…high. */
  touched: boolean;
  /** Strictly exceeded on the relevant side; gaps can break without touching. */
  broken: boolean;
  /** Resistance: close >= level. Support: close >= level. Equality is held. */
  closeStatus: "held" | "failed";
}

/** Caller must attest to a completed DAILY bar, not a quote/intraday candle. */
export interface IndexOutlookDailyBar extends Candle {
  interval: "1d";
  completed: boolean;
  provisional?: boolean;
  source: string;
}

export interface IndexOutlookEvaluation {
  evaluatedAt: number;
  source: string;
  bar: Candle;
  resistance: IndexOutlookLevelOutcome | null;
  support: IndexOutlookLevelOutcome | null;
  rankedResistances: IndexOutlookLevelOutcome[];
  rankedSupports: IndexOutlookLevelOutcome[];
  path: "ambiguous-intraday-sequence-unknown" | "daily-observation-only";
  unavailable: string[];
}

export interface IndexOutlookRecord {
  symbol: string;
  tradingDate: string;
  phase: "PREOPEN";
  createdAt: number;
  /** Actual completed candle timestamp, NOT today's active session. */
  signalSession: number;
  source: string;
  analysis: IndexAnalysis;
  levels: IndexOutlookLevels;
  evaluation: IndexOutlookEvaluation | null;
}

export interface IndexOutlookJournal {
  version: 1;
  records: IndexOutlookRecord[];
}

export interface IndexOutlookJournalSummary {
  records: number;
  tradingDays: number;
  evaluated: number;
  pending: number;
  ambiguous: number;
  missingSupport: number;
  missingResistance: number;
}

export interface IndexOutlookJournalOptions {
  now?: number;
  filePath?: string;
  isTradingDay?: TradingCalendar;
}

export interface IndexOutlookJournalInputs extends IndexOutlookJournalOptions {
  bars?: Readonly<Record<string, IndexOutlookDailyBar>>;
  /** Raw candles must come from getDailyCandles, with completed context attesting source/mode. */
  histories?: ReadonlyMap<string, readonly (Candle | IndexOutlookDailyBar)[]>
    | Readonly<Record<string, readonly (Candle | IndexOutlookDailyBar)[]>>;
}

export interface IndexOutlookJournalUpdate {
  journal: IndexOutlookJournal;
  captured: number;
  evaluated: number;
  unavailable: { symbol: string; tradingDate: string; reason: string }[];
}

const unavailable = (reason: string): JournalResult<never> => ({ status: "unavailable", reason });
const realSource = (source: string) =>
  typeof source === "string" && !!source.trim() && !/mock|demo|simulat|synthetic/i.test(source);
const positive = (value: number) => Number.isFinite(value) && value > 0;
const minute = (now: number) => ((now + OFFSET) % DAY + DAY) % DAY / 60_000;
const dateEpoch = (date: string, minutes = 0) => Date.parse(`${date}T00:00:00+05:30`) + minutes * 60_000;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(dateEpoch(date)) && istDateKey(dateEpoch(date)) === date;
const validLevel = (level: StructuralLevel) =>
  !!level && typeof level.label === "string" && positive(level.price);
const validCandle = (bar: Candle) => Number.isFinite(bar.t)
  && [bar.open, bar.high, bar.low, bar.close].every(positive)
  && bar.low <= Math.min(bar.open, bar.close)
  && bar.high >= Math.max(bar.open, bar.close) && bar.high >= bar.low
  && Number.isFinite(bar.volume) && bar.volume >= 0;

function priorTradingDate(now: number, calendar: TradingCalendar): string | null {
  const midnight = dateEpoch(istDateKey(now));
  // A bounded calendar lookup fails explicitly rather than guessing a session.
  for (let offset = 1; offset <= 370; offset++) {
    const candidate = midnight - offset * DAY;
    if (calendar(candidate)) return istDateKey(candidate);
  }
  return null;
}

/** Scheduler guard: actual pre-open capture or trading-day post-close evaluation. */
export function shouldUpdateIndexOutlookJournal(
  now: number,
  calendar: TradingCalendar = isTradingDay,
): boolean {
  return Number.isFinite(now) && calendar(now)
    && ((minute(now) >= 525 && minute(now) < 555) || minute(now) >= 930);
}

/** Pure with explicit now/calendar. Window is [08:45, 09:15), IST. No backfills. */
export function createIndexOutlookRecord(
  context: IndexContext | null,
  symbol: string,
  now: number,
  calendar: TradingCalendar = isTradingDay,
): JournalResult<IndexOutlookRecord> {
  if (!Number.isFinite(now) || !calendar(now) || minute(now) < 525 || minute(now) >= 555)
    return unavailable("Outside the actual trading-day 08:45–09:15 IST capture window.");
  if (!context) return unavailable("Index context missing.");
  if (context.mode !== "completed") return unavailable("Completed-mode context required.");
  if (!realSource(context.source)) return unavailable("Nonmock market source required.");
  if (!Number.isFinite(context.generatedAt) || context.generatedAt > now
    || now - context.generatedAt > MAX_CONTEXT_AGE)
    return unavailable("Context generation timestamp is stale or invalid.");
  const analysis = context.analysis[symbol];
  if (!analysis) return unavailable("Index analysis missing.");
  if (context.historyCoverage?.[symbol]?.stale)
    return unavailable("Index history coverage is explicitly stale.");
  const previous = priorTradingDate(now, calendar);
  if (!Number.isFinite(analysis.asOf) || analysis.asOf > now || !previous
    || istDateKey(analysis.asOf) !== previous || !calendar(analysis.asOf))
    return unavailable("Analysis is not from the latest completed trading session.");
  if (analysis.provisional !== false) return unavailable("Provisional analysis cannot be captured.");
  if (!positive(analysis.close) || !Array.isArray(analysis.structuralLevels)
    || !analysis.structuralLevels.every(validLevel)
    || (analysis.nearbySupport !== null && !validLevel(analysis.nearbySupport))
    || (analysis.nearbyResistance !== null && !validLevel(analysis.nearbyResistance))
    || (analysis.nearbySupport && analysis.nearbySupport.price >= analysis.close)
    || (analysis.nearbyResistance && analysis.nearbyResistance.price <= analysis.close)
    || typeof analysis.summary !== "string"
    || !analysis.scenarios || !["bullish", "bearish", "range"].every(
      (key) => typeof analysis.scenarios[key as keyof IndexAnalysis["scenarios"]] === "string"))
    return unavailable("Analysis or levels are invalid.");
  const frozen = structuredClone(analysis);
  return { status: "available", value: {
    symbol, tradingDate: istDateKey(now), phase: "PREOPEN", createdAt: now,
    signalSession: frozen.asOf, source: context.source, analysis: frozen,
    levels: {
      nearbySupport: frozen.nearbySupport,
      nearbyResistance: frozen.nearbyResistance,
      rankedSupports: frozen.structuralLevels.filter((level) => level.price < frozen.close)
        .sort((a, b) => b.price - a.price),
      rankedResistances: frozen.structuralLevels.filter((level) => level.price > frozen.close)
        .sort((a, b) => a.price - b.price),
    },
    evaluation: null,
  } };
}

/** Describes observed level behaviour only; daily OHLC cannot establish event order. */
export function evaluateIndexOutlookRecord(
  record: IndexOutlookRecord,
  bar: IndexOutlookDailyBar | null | undefined,
  now: number,
  calendar: TradingCalendar = isTradingDay,
): JournalResult<IndexOutlookEvaluation> {
  if (!validDate(record.tradingDate) || !Number.isFinite(now)
    || !calendar(dateEpoch(record.tradingDate))
    || now < dateEpoch(record.tradingDate, 930))
    return unavailable("Target trading session has not completed.");
  if (!bar) return unavailable("Target-date completed daily bar missing.");
  if (bar.interval !== "1d" || bar.completed !== true || bar.provisional === true)
    return unavailable("Partial or non-daily bar cannot evaluate an outlook.");
  if (!realSource(bar.source)) return unavailable("Nonmock evaluation source required.");
  if (!validCandle(bar) || bar.t > now || istDateKey(bar.t) !== record.tradingDate)
    return unavailable("Invalid or wrong-date evaluation bar.");
  const observe = (level: StructuralLevel, side: "support" | "resistance"): IndexOutlookLevelOutcome => ({
    level: structuredClone(level),
    touched: bar.low <= level.price && bar.high >= level.price,
    broken: side === "resistance" ? bar.high > level.price : bar.low < level.price,
    closeStatus: bar.close >= level.price ? "held" : "failed",
  });
  const resistance = record.levels.nearbyResistance
    ? observe(record.levels.nearbyResistance, "resistance") : null;
  const support = record.levels.nearbySupport ? observe(record.levels.nearbySupport, "support") : null;
  return { status: "available", value: {
    evaluatedAt: now, source: bar.source,
    bar: { t: bar.t, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
    resistance, support,
    rankedResistances: record.levels.rankedResistances.map((level) => observe(level, "resistance")),
    rankedSupports: record.levels.rankedSupports.map((level) => observe(level, "support")),
    path: resistance?.broken && support?.broken
      ? "ambiguous-intraday-sequence-unknown" : "daily-observation-only",
    unavailable: [
      ...(!support ? ["Nearest support unavailable."] : []),
      ...(!resistance ? ["Nearest resistance unavailable."] : []),
    ],
  } };
}

export function summarizeIndexOutlookJournal(records: readonly IndexOutlookRecord[]): IndexOutlookJournalSummary {
  const evaluated = records.filter((record) => record.evaluation !== null).length;
  return {
    records: records.length, tradingDays: new Set(records.map((record) => record.tradingDate)).size,
    evaluated, pending: records.length - evaluated,
    ambiguous: records.filter((record) =>
      record.evaluation?.path === "ambiguous-intraday-sequence-unknown").length,
    missingSupport: records.filter((record) => !record.levels.nearbySupport).length,
    missingResistance: records.filter((record) => !record.levels.nearbyResistance).length,
  };
}

const queues = new Map<string, Promise<unknown>>();
/** Serializes read/modify/rename within this Node process; not a multi-process lock. */
function serialized<T>(file: string, action: () => Promise<T>): Promise<T> {
  const prior = queues.get(file) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(action);
  queues.set(file, next);
  void next.finally(() => { if (queues.get(file) === next) queues.delete(file); }).catch(() => undefined);
  return next;
}

function missing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function load(file: string): Promise<JournalResult<IndexOutlookJournal>> {
  let text: string;
  try { text = await readFile(file, "utf8"); }
  catch (error) {
    if (missing(error)) return unavailable("Journal file missing; no outlooks captured yet.");
    throw new Error(`Index outlook journal read failed: ${file}`, { cause: error });
  }
  try {
    const data = JSON.parse(text) as IndexOutlookJournal;
    if (data.version !== 1 || !Array.isArray(data.records)) throw new Error("Unsupported journal schema.");
    const keys = new Set<string>();
    for (const record of data.records) {
      if (!record || typeof record.symbol !== "string" || !record.symbol || !validDate(record.tradingDate)
        || record.phase !== "PREOPEN" || !Number.isFinite(record.createdAt)
        || istDateKey(record.createdAt) !== record.tradingDate
        || minute(record.createdAt) < 525 || minute(record.createdAt) >= 555
        || !Number.isFinite(record.signalSession) || record.signalSession >= record.createdAt
        || !realSource(record.source) || !record.analysis
        || record.analysis.asOf !== record.signalSession || record.analysis.provisional !== false
        || !positive(record.analysis.close) || !record.levels
        || !Array.isArray(record.levels.rankedSupports) || !Array.isArray(record.levels.rankedResistances)
        || !record.levels.rankedSupports.every(validLevel) || !record.levels.rankedResistances.every(validLevel)
        || (record.levels.nearbySupport !== null && !validLevel(record.levels.nearbySupport))
        || (record.levels.nearbyResistance !== null && !validLevel(record.levels.nearbyResistance))
        || (record.evaluation !== null && (!record.evaluation || !validCandle(record.evaluation.bar)
          || istDateKey(record.evaluation.bar.t) !== record.tradingDate
          || !Number.isFinite(record.evaluation.evaluatedAt)
          || record.evaluation.evaluatedAt < dateEpoch(record.tradingDate, 930))))
        throw new Error("Invalid journal record.");
      const key = `${record.tradingDate}:${record.symbol}`;
      if (keys.has(key)) throw new Error("Duplicate journal record.");
      keys.add(key);
    }
    return { status: "available", value: data };
  } catch (error) {
    throw new Error(`Index outlook journal parse/validation failed: ${file}`, { cause: error });
  }
}

async function save(file: string, journal: IndexOutlookJournal): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temporary, JSON.stringify(journal, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    throw new Error(`Index outlook journal write failed: ${file}`, { cause: error });
  } finally {
    try { await unlink(temporary); }
    catch (error) {
      if (!missing(error)) throw new Error(`Index outlook journal cleanup failed: ${temporary}`, { cause: error });
    }
  }
}

export async function readIndexOutlookJournal(filePath = INDEX_OUTLOOK_JOURNAL_PATH) {
  const file = resolve(/* turbopackIgnore: true */ filePath);
  return serialized(file, () => load(file));
}

export async function listIndexOutlookJournal(
  options: { filePath?: string; symbol?: string; tradingDate?: string } = {},
): Promise<JournalResult<IndexOutlookRecord[]>> {
  const result = await readIndexOutlookJournal(options.filePath);
  if (result.status === "unavailable") return result;
  return { status: "available", value: result.value.records.filter((record) =>
    (!options.symbol || record.symbol === options.symbol)
    && (!options.tradingDate || record.tradingDate === options.tradingDate))
    .sort((a, b) => b.tradingDate.localeCompare(a.tradingDate) || a.symbol.localeCompare(b.symbol)) };
}

export async function getIndexOutlookJournalSummary(filePath = INDEX_OUTLOOK_JOURNAL_PATH) {
  const result = await readIndexOutlookJournal(filePath);
  return result.status === "unavailable" ? result
    : { status: "available" as const, value: summarizeIndexOutlookJournal(result.value.records) };
}

/**
 * Use on actual pre-open context refreshes, then with attested completed bars after close.
 * `now` is injectable for tests only: production must omit it (never replay old contexts).
 * Histories only evaluate already-captured dates, never manufacture historical outlooks.
 * Raw Candle[] histories are accepted only alongside a completed, nonmock context
 * as provenance for provider DAILY histories. Explicit bar metadata takes precedence;
 * partial/provisional/non-daily markers are never overwritten. Without context,
 * provide IndexOutlookDailyBar metadata. Scheduler callers should use
 * shouldUpdateIndexOutlookJournal to avoid filesystem work outside update windows.
 * File errors reject; ENOENT alone is a normal empty journal. Requires persistent local
 * disk and a single writer process; multiple instances need an external shared store.
 */
export async function updateIndexOutlookJournal(
  context: IndexContext | null,
  inputs: IndexOutlookJournalInputs = {},
): Promise<IndexOutlookJournalUpdate> {
  const file = resolve(/* turbopackIgnore: true */ inputs.filePath ?? INDEX_OUTLOOK_JOURNAL_PATH);
  // Snapshot caller-owned inputs before waiting for an earlier write.
  const snapshot = structuredClone(context);
  const bars = structuredClone(inputs.bars);
  const histories = structuredClone(inputs.histories);
  return serialized(file, async () => {
    const now = inputs.now ?? Date.now();
    const calendar = inputs.isTradingDay ?? isTradingDay;
    const result = await load(file);
    const journal = result.status === "available" ? result.value : { version: 1 as const, records: [] };
    const update: IndexOutlookJournalUpdate = { journal, captured: 0, evaluated: 0, unavailable: [] };
    if (!snapshot || !Object.keys(snapshot.analysis).length) update.unavailable.push({
      symbol: "*", tradingDate: istDateKey(now), reason: "Index context/analysis missing; no outlook captured.",
    });
    for (const symbol of Object.keys(snapshot?.analysis ?? {})) {
      if (journal.records.some((record) => record.symbol === symbol && record.tradingDate === istDateKey(now))) continue;
      const created = process.env.MARKET_FORCE_LIVE === "1"
        ? unavailable("Simulated market session cannot capture a real outlook.")
        : createIndexOutlookRecord(snapshot, symbol, now, calendar);
      if (created.status === "available") {
        journal.records.push(created.value);
        update.captured++;
      } else update.unavailable.push({ symbol, tradingDate: istDateKey(now), reason: created.reason });
    }
    for (const record of journal.records) {
      if (record.evaluation) continue;
      const history: readonly (Candle | IndexOutlookDailyBar)[] | undefined = histories instanceof Map ? histories.get(record.symbol)
        : (histories as Readonly<Record<string, readonly (Candle | IndexOutlookDailyBar)[]>> | undefined)?.[record.symbol];
      const dailyHistory = (history ?? []).map((bar): IndexOutlookDailyBar => {
        const explicit = bar as Partial<IndexOutlookDailyBar>;
        return {
          ...bar,
          interval: explicit.interval ?? "1d",
          completed: explicit.completed ?? (snapshot?.mode === "completed" && realSource(snapshot.source)),
          source: explicit.source ?? (snapshot?.mode === "completed" ? snapshot.source : ""),
        };
      });
      const candidates = [bars?.[record.symbol], ...dailyHistory].filter(
        (bar): bar is IndexOutlookDailyBar => !!bar && Number.isFinite(bar.t)
          && istDateKey(bar.t) === record.tradingDate);
      let evaluation: JournalResult<IndexOutlookEvaluation> = evaluateIndexOutlookRecord(record, null, now, calendar);
      for (const candidate of candidates) {
        evaluation = evaluateIndexOutlookRecord(record, candidate, now, calendar);
        if (evaluation.status === "available") break;
      }
      if (evaluation.status === "available") {
        record.evaluation = evaluation.value;
        update.evaluated++;
      } else update.unavailable.push({
        symbol: record.symbol, tradingDate: record.tradingDate, reason: evaluation.reason,
      });
    }
    if (update.captured || update.evaluated) {
      const dates = [...new Set(journal.records.map((record) => record.tradingDate))].sort().reverse();
      const retained = new Set(dates.slice(0, INDEX_OUTLOOK_RETENTION_DAYS));
      journal.records = journal.records.filter((record) => retained.has(record.tradingDate));
      await save(file, journal);
    }
    return update;
  });
}
