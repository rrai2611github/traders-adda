/**
 * The all-stocks screener: filtering, sorting, export and saved scans over the rows the universe scan already
 * measures. Pure functions, so the page stays thin and the rules are testable.
 *
 * Not included on purpose: delivery %. No feed in this app carries it (it needs NSE's bhavcopy), and an empty
 * column would only look like data.
 */

export type ScreenerStage = "forming" | "breakout" | "climbing" | "played-out";

/** The part of a scan row the screener reads. */
export interface ScreenerRow {
  symbol: string;
  name: string;
  sector?: string;
  liquid?: boolean;
  price: number;
  changePercent: number;
  rs: number | null;
  vs50: number | null;
  vs200: number | null;
  /** Percent below the 52-week high. */
  fromHigh: number | null;
  turnoverCr: number | null;
  mcap: number | null;
  stage: ScreenerStage | null;
  baseWk: number | null;
  baseDepth: number | null;
}

export interface ScreenerFilter {
  search: string;
  sector: string | null;
  stage: ScreenerStage | null;
  minRs: number | null;
  maxFromHigh: number | null;
  minTurnoverCr: number | null;
  minMcapCr: number | null;
  liquidOnly: boolean;
}

export const DEFAULT_SCREENER_FILTER: ScreenerFilter = {
  search: "", sector: null, stage: null, minRs: null, maxFromHigh: null, minTurnoverCr: null, minMcapCr: null, liquidOnly: true,
};

export const SCREENER_PRESETS: { label: string; filter: Partial<ScreenerFilter> }[] = [
  { label: "RS leaders near the high", filter: { minRs: 80, maxFromHigh: 10 } },
  { label: "Liquid leaders: ₹25 Cr/day, RS 70+", filter: { minRs: 70, minTurnoverCr: 25 } },
  { label: "Forming bases, RS 60+", filter: { stage: "forming", minRs: 60 } },
  { label: "Fresh breakouts", filter: { stage: "breakout" } },
];

export function matchesScreener(row: ScreenerRow, f: ScreenerFilter): boolean {
  if (f.liquidOnly && row.liquid === false) return false;
  const search = f.search.trim().toLowerCase();
  if (search && !row.symbol.toLowerCase().includes(search) && !row.name.toLowerCase().includes(search)) return false;
  if (f.sector && row.sector !== f.sector) return false;
  if (f.stage && row.stage !== f.stage) return false;
  if (f.minRs != null && (row.rs == null || row.rs < f.minRs)) return false;
  if (f.maxFromHigh != null && (row.fromHigh == null || Math.abs(row.fromHigh) > f.maxFromHigh)) return false;
  if (f.minTurnoverCr != null && (row.turnoverCr == null || row.turnoverCr < f.minTurnoverCr)) return false;
  if (f.minMcapCr != null && (row.mcap == null || row.mcap < f.minMcapCr)) return false;
  return true;
}

export type ScreenerSortKey = "symbol" | "price" | "changePercent" | "rs" | "vs50" | "fromHigh" | "turnoverCr" | "mcap" | "baseWk";
export interface ScreenerSort { key: ScreenerSortKey; dir: "asc" | "desc" }

/** Sorts a copy. Blanks always sink to the bottom, whichever way the column is sorted. */
export function sortScreenerRows<T extends ScreenerRow>(rows: ReadonlyArray<T>, sort: ScreenerSort): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "symbol") return a.symbol.localeCompare(b.symbol) * sign;
    const x = a[sort.key];
    const y = b[sort.key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * sign;
  });
}

const CSV_COLUMNS: { header: string; value: (row: ScreenerRow) => string | number | null }[] = [
  { header: "Symbol", value: (r) => r.symbol },
  { header: "Name", value: (r) => r.name },
  { header: "Sector", value: (r) => r.sector ?? null },
  { header: "Price", value: (r) => r.price },
  { header: "Day %", value: (r) => r.changePercent },
  { header: "RS", value: (r) => r.rs },
  { header: "Vs 50-DMA %", value: (r) => r.vs50 },
  { header: "Vs 200-DMA %", value: (r) => r.vs200 },
  { header: "From 52W high %", value: (r) => r.fromHigh },
  { header: "Turnover Cr/day", value: (r) => r.turnoverCr },
  { header: "Market cap Cr", value: (r) => r.mcap },
  { header: "Stage", value: (r) => r.stage },
  { header: "Base weeks", value: (r) => r.baseWk },
  { header: "Base depth %", value: (r) => r.baseDepth },
];

/** A spreadsheet opens a cell starting with = + - @ as a formula, so text like that is quoted with a leading apostrophe. */
function csvCell(value: string | number | null): string {
  if (value == null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toScreenerCsv(rows: ReadonlyArray<ScreenerRow>): string {
  const lines = [CSV_COLUMNS.map((c) => c.header).join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(c.value(row))).join(","));
  return lines.join("\n");
}

/** A TradingView watchlist import: comma-separated exchange-prefixed symbols. */
export function toTradingViewList(rows: ReadonlyArray<Pick<ScreenerRow, "symbol">>): string {
  return rows.map((row) => `NSE:${row.symbol}`).join(",");
}

export interface SavedScan { name: string; filter: ScreenerFilter }

export const MAX_SAVED_SCANS = 20;

export type SavedScansValidation =
  | { ok: true; scans: SavedScan[] }
  | { ok: false; error: string };

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const STAGES: ReadonlyArray<ScreenerStage> = ["forming", "breakout", "climbing", "played-out"];
const isStage = (value: unknown): value is ScreenerStage => typeof value === "string" && STAGES.some((stage) => stage === value);

export function validateSavedScans(value: unknown): SavedScansValidation {
  if (!Array.isArray(value)) return { ok: false, error: "Saved scans must be a list." };
  if (value.length > MAX_SAVED_SCANS) return { ok: false, error: `Save at most ${MAX_SAVED_SCANS} scans.` };

  const scans: SavedScan[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "A saved scan is malformed." };
    const saved = item as Record<string, unknown>;
    if (typeof saved.name !== "string" || !saved.name.trim() || saved.name.trim().length > 60) {
      return { ok: false, error: "Each scan needs a name of 1 to 60 characters." };
    }
    const name = saved.name.trim();
    const key = name.toLowerCase();
    if (names.has(key)) return { ok: false, error: "Saved scan names must be unique." };
    names.add(key);
    if (!saved.filter || typeof saved.filter !== "object" || Array.isArray(saved.filter)) {
      return { ok: false, error: `The filters for "${name}" are malformed.` };
    }
    const filter = saved.filter as Record<string, unknown>;
    const search = filter.search ?? "";
    const sector = filter.sector ?? null;
    const stage = filter.stage ?? null;
    const liquidOnly = filter.liquidOnly ?? true;
    if (typeof search !== "string" || search.trim().length > 100) return { ok: false, error: `Search text for "${name}" must be at most 100 characters.` };
    if (sector !== null && (typeof sector !== "string" || sector.length > 100)) return { ok: false, error: `Sector for "${name}" is invalid.` };
    if (stage !== null && !isStage(stage)) return { ok: false, error: `Stage for "${name}" is invalid.` };
    if (typeof liquidOnly !== "boolean") return { ok: false, error: `The liquid-stock setting for "${name}" is invalid.` };

    type NumericFilterKey = "minRs" | "maxFromHigh" | "minTurnoverCr" | "minMcapCr";
    const bounds: ReadonlyArray<readonly [NumericFilterKey, number, number]> = [
      ["minRs", 1, 99],
      ["maxFromHigh", 0, 1000],
      ["minTurnoverCr", 0, 1_000_000_000],
      ["minMcapCr", 0, 1_000_000_000_000],
    ];
    const numeric: Record<NumericFilterKey, number | null> = { minRs: null, maxFromHigh: null, minTurnoverCr: null, minMcapCr: null };
    for (const [field, min, max] of bounds) {
      const current = filter[field] ?? null;
      if (current === null) {
        numeric[field] = null;
      } else if (typeof current !== "number" || !Number.isFinite(current) || current < min || current > max) {
        return { ok: false, error: `The ${field} filter for "${name}" is out of range.` };
      } else {
        numeric[field] = current;
      }
    }
    scans.push({
      name,
      filter: {
        search: search.trim(),
        sector: typeof sector === "string" ? sector.trim() || null : null,
        stage: stage === null ? null : isStage(stage) ? stage : null,
        minRs: numeric.minRs,
        maxFromHigh: numeric.maxFromHigh,
        minTurnoverCr: numeric.minTurnoverCr,
        minMcapCr: numeric.minMcapCr,
        liquidOnly,
      },
    });
  }
  return { ok: true, scans };
}

/** Reads saved scans from storage text, dropping anything malformed instead of throwing. */
export function parseSavedScans(raw: string | null): SavedScan[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: SavedScan[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { name, filter } = item as { name?: unknown; filter?: Record<string, unknown> };
    if (typeof name !== "string" || !name.trim() || !filter || typeof filter !== "object") continue;
    out.push({
      name: name.trim().slice(0, 60),
      filter: {
        search: typeof filter.search === "string" ? filter.search : "",
        sector: typeof filter.sector === "string" ? filter.sector : null,
        stage: isStage(filter.stage) ? filter.stage : null,
        minRs: num(filter.minRs),
        maxFromHigh: num(filter.maxFromHigh),
        minTurnoverCr: num(filter.minTurnoverCr),
        minMcapCr: num(filter.minMcapCr),
        liquidOnly: filter.liquidOnly !== false,
      },
    });
  }
  return out.slice(0, MAX_SAVED_SCANS);
}

/** Saving under an existing name replaces it; the newest scan goes first. */
export function upsertSavedScan(list: ReadonlyArray<SavedScan>, scan: SavedScan): SavedScan[] {
  const name = scan.name.trim().slice(0, 60);
  if (!name) return [...list];
  return [{ name, filter: scan.filter }, ...list.filter((s) => s.name.toLowerCase() !== name.toLowerCase())].slice(0, MAX_SAVED_SCANS);
}

export const removeSavedScan = (list: ReadonlyArray<SavedScan>, name: string): SavedScan[] => list.filter((s) => s.name !== name);
