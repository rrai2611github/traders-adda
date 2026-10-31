/**
 * Upcoming results dates from NSE's board-meeting calendar (the same list NSE publishes at nseindia.com/companies-listing/
 * corporate-filings-board-meetings). A company missing from it has not announced a date yet, which is not the same as no results.
 */
export interface BoardMeetingRow {
  bm_symbol?: string;
  bm_date?: string;
  bm_purpose?: string;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "22-Oct-2026" to "2026-10-22"; null when it is not that shape. */
export function nseDateToIso(value: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  return month ? `${m[3]}-${month}-${m[1].padStart(2, "0")}` : null;
}

/** The soonest results date on or after `todayIso` for each symbol. */
export function resultsDates(rows: ReadonlyArray<BoardMeetingRow>, todayIso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.bm_symbol || !row.bm_date || !/result/i.test(row.bm_purpose ?? "")) continue;
    const iso = nseDateToIso(row.bm_date);
    if (!iso || iso < todayIso) continue;
    if (!out[row.bm_symbol] || iso < out[row.bm_symbol]) out[row.bm_symbol] = iso;
  }
  return out;
}

/** Whole days from `todayIso` to `dateIso` (0 is today). */
export function daysUntil(dateIso: string, todayIso: string): number {
  return Math.round((Date.parse(`${dateIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000);
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL_MS = 6 * 3_600_000;
const WINDOW_DAYS = 45;
let cache: { at: number; dates: Record<string, string> } | null = null;
let inflight: Promise<Record<string, string>> | null = null;

const nseDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;

/** Results dates for the next 45 days, cached for six hours; an older copy is kept if NSE cannot be reached. */
export async function getResultsDates(todayIso: string): Promise<{ updatedAt: number; dates: Record<string, string> } | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return { updatedAt: cache.at, dates: cache.dates };
  inflight ??= (async () => {
    const from = new Date(`${todayIso}T00:00:00Z`);
    const to = new Date(from.getTime() + WINDOW_DAYS * 86_400_000);
    const url = `https://www.nseindia.com/api/corporate-board-meetings?index=equities&from_date=${nseDate(from)}&to_date=${nseDate(to)}`;
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", referer: "https://www.nseindia.com/" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`NSE board meetings HTTP ${response.status}`);
    const rows = (await response.json()) as BoardMeetingRow[];
    if (!Array.isArray(rows)) throw new Error("NSE board meetings: unexpected response");
    return resultsDates(rows, todayIso);
  })();
  try {
    const dates = await inflight;
    cache = { at: Date.now(), dates };
  } catch (error) {
    console.error("[results-dates] Failed:", error);
  } finally {
    inflight = null;
  }
  return cache ? { updatedAt: cache.at, dates: cache.dates } : null;
}
