import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ten years of daily candles for every stock, held as typed arrays so the whole market fits in memory (about 150 MB):
 * `scripts/fetch-history.mjs` writes `.cache/history10y/<SYMBOL>.json`, this reads it.
 */
export interface Series {
  symbol: string;
  n: number;
  /** IST day number (days since 1970-01-01) of each candle, strictly increasing. */
  day: Int32Array;
  open: Float32Array;
  high: Float32Array;
  low: Float32Array;
  close: Float32Array;
  volume: Float32Array;
}

export interface History {
  series: Map<string, Series>;
  /** Every IST day any stock traded, ascending. */
  calendar: Int32Array;
  /** Calendar position of each day number. */
  position: Map<number, number>;
  /** Total candles across all stocks; changes whenever the files change. */
  candleCount: number;
}

const IST_MS = 19_800_000;
const DAY_MS = 86_400_000;

export const istDay = (timestamp: number) => Math.floor((timestamp + IST_MS) / DAY_MS);
export const dayToIso = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const isoToDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

type Row = [number, number, number, number, number, number];

/** Builds a series from raw rows, dropping any candle that does not move time forward. */
export function toSeries(symbol: string, rows: ReadonlyArray<Row>, minCandles = 30): Series | null {
  const day = new Int32Array(rows.length);
  const open = new Float32Array(rows.length);
  const high = new Float32Array(rows.length);
  const low = new Float32Array(rows.length);
  const close = new Float32Array(rows.length);
  const volume = new Float32Array(rows.length);
  let n = 0;
  for (const [t, o, h, l, c, v] of rows) {
    const d = istDay(t);
    if (n > 0 && d <= day[n - 1]) continue;
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    day[n] = d; open[n] = o; high[n] = h; low[n] = l; close[n] = c; volume[n] = v;
    n += 1;
  }
  if (n < minCandles) return null;
  return { symbol, n, day: day.slice(0, n), open: open.slice(0, n), high: high.slice(0, n), low: low.slice(0, n), close: close.slice(0, n), volume: volume.slice(0, n) };
}

export function loadHistory(dir: string): History {
  const series = new Map<string, Series>();
  let candleCount = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const symbol = decodeURIComponent(file.slice(0, -5));
    let rows: Row[];
    try {
      rows = (JSON.parse(readFileSync(join(dir, file), "utf8")) as { c: Row[] }).c;
    } catch {
      continue;
    }
    const s = toSeries(symbol, rows);
    if (!s) continue;
    series.set(symbol, s);
    candleCount += s.n;
  }
  const days = new Set<number>();
  for (const s of series.values()) for (let i = 0; i < s.n; i += 1) days.add(s.day[i]);
  // A day only one or two stocks traded (a stray bar) is not a session.
  const seen = new Map<number, number>();
  for (const s of series.values()) for (let i = 0; i < s.n; i += 1) seen.set(s.day[i], (seen.get(s.day[i]) ?? 0) + 1);
  const calendar = Int32Array.from([...days].filter((d) => (seen.get(d) ?? 0) >= 20).sort((a, b) => a - b));
  const position = new Map<number, number>();
  calendar.forEach((d, i) => position.set(d, i));
  return { series, calendar, position, candleCount };
}
