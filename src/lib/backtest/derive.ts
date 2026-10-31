import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rsAmong } from "../screen/rsScale.ts";
import type { History } from "./history.ts";

/**
 * Cross-sectional facts no single stock can give: the RS rank of every stock on every day, its median traded value, and
 * how many liquid stocks sat above their 50 and 200-day averages. Built once from the history and saved, so a backtest
 * starts from it instead of re-ranking ten years of the whole market.
 */
export interface Derived {
  /** Median daily traded value over the last 50 sessions, in rupees crore, per candle. */
  turn: Map<string, Float32Array>;
  /** RS rating 1 to 99 per candle among the liquid stocks that day; 0 where there is too little history. */
  rs: Map<string, Uint8Array>;
  /** Percent of liquid stocks at or above their 50-day average, per calendar day; NaN with too few stocks. */
  breadth50: Float32Array;
  breadth200: Float32Array;
}

/** The trading liquidity floor the RS scale and the breadth are measured on. Same as the live app. */
export const RANKING_FLOOR_CR = 5;
const MIN_BREADTH_STOCKS = 100;
const WINDOWS: Array<[number, number]> = [[63, 0.4], [126, 0.2], [189, 0.2], [252, 0.2]];

/** Weighted price performance at candle `at`, like the live RS input; null with under 15 candles. */
export function performance(close: Float32Array, at: number): number | null {
  if (at < 14) return null;
  const last = close[at];
  let score = 0;
  let weight = 0;
  for (const [sessions, w] of WINDOWS) {
    if (at < sessions) continue;
    const past = close[at - sessions];
    if (!(past > 0)) continue;
    score += (last / past - 1) * w;
    weight += w;
  }
  if (!weight) return close[0] > 0 ? (last / close[0] - 1) * 100 : null;
  return (score / weight) * 100;
}

function medianTurnover(close: Float32Array, volume: Float32Array): Float32Array {
  const n = close.length;
  const out = new Float32Array(n);
  const window = new Float64Array(50);
  for (let i = 0; i < n; i += 1) {
    const from = Math.max(0, i - 49);
    const count = i - from + 1;
    for (let k = 0; k < count; k += 1) window[k] = (close[from + k] * volume[from + k]) / 1e7;
    const view = window.subarray(0, count).sort();
    out[i] = count % 2 ? view[count >> 1] : (view[count / 2 - 1] + view[count / 2]) / 2;
  }
  return out;
}

function movingAverage(close: Float32Array, period: number): Float32Array {
  const n = close.length;
  const out = new Float32Array(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += close[i];
    if (i >= period) sum -= close[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function derive(history: History, log: (message: string) => void = () => {}): Derived {
  const symbols = [...history.series.keys()];
  const list = symbols.map((s) => history.series.get(s)!);
  const turn = new Map<string, Float32Array>();
  const rs = new Map<string, Uint8Array>();
  const sma50 = list.map((s) => movingAverage(s.close, 50));
  const sma200 = list.map((s) => movingAverage(s.close, 200));
  list.forEach((s) => {
    turn.set(s.symbol, medianTurnover(s.close, s.volume));
    rs.set(s.symbol, new Uint8Array(s.n));
  });
  log(`turnover and averages done for ${list.length} stocks`);

  const days = history.calendar;
  const breadth50 = new Float32Array(days.length).fill(NaN);
  const breadth200 = new Float32Array(days.length).fill(NaN);
  const ptr = new Int32Array(list.length);
  const turnArrays = list.map((s) => turn.get(s.symbol)!);
  const rsArrays = list.map((s) => rs.get(s.symbol)!);
  const scoreAt = new Float64Array(list.length);
  const idxAt = new Int32Array(list.length);

  for (let p = 0; p < days.length; p += 1) {
    const day = days[p];
    const ranking: number[] = [];
    let present = 0;
    let liquid50 = 0, above50 = 0, liquid200 = 0, above200 = 0;
    for (let k = 0; k < list.length; k += 1) {
      const s = list[k];
      const i = ptr[k];
      if (i >= s.n || s.day[i] !== day) { idxAt[k] = -1; continue; }
      ptr[k] += 1;
      idxAt[k] = i;
      const score = performance(s.close, i);
      scoreAt[k] = score ?? NaN;
      present += 1;
      if (turnArrays[k][i] >= RANKING_FLOOR_CR) {
        if (score != null) ranking.push(score);
        const m50 = sma50[k][i];
        if (!Number.isNaN(m50)) { liquid50 += 1; if (s.close[i] >= m50) above50 += 1; }
        const m200 = sma200[k][i];
        if (!Number.isNaN(m200)) { liquid200 += 1; if (s.close[i] >= m200) above200 += 1; }
      }
    }
    if (liquid50 >= MIN_BREADTH_STOCKS) breadth50[p] = (above50 / liquid50) * 100;
    if (liquid200 >= MIN_BREADTH_STOCKS) breadth200[p] = (above200 / liquid200) * 100;
    if (!present || ranking.length < 2) continue;
    ranking.sort((a, b) => a - b);
    for (let k = 0; k < list.length; k += 1) {
      const i = idxAt[k];
      if (i < 0 || Number.isNaN(scoreAt[k])) continue;
      rsArrays[k][i] = rsAmong(ranking, scoreAt[k]);
    }
  }
  log("RS ranks and breadth done");
  return { turn, rs, breadth50, breadth200 };
}

/* ---------- saved copy ---------- */

interface Index {
  fingerprint: string;
  symbols: Array<{ symbol: string; n: number; turn: number; rs: number }>;
  breadth50: number;
  breadth200: number;
  days: number;
}

const fingerprint = (history: History) => `${history.series.size}:${history.candleCount}:${history.calendar[history.calendar.length - 1]}`;
const pad4 = (n: number) => (n + 3) & ~3;

export function saveDerived(dir: string, history: History, derived: Derived): void {
  const symbols = [...history.series.keys()];
  const index: Index = { fingerprint: fingerprint(history), symbols: [], breadth50: 0, breadth200: 0, days: history.calendar.length };
  let size = 0;
  for (const symbol of symbols) {
    const n = history.series.get(symbol)!.n;
    index.symbols.push({ symbol, n, turn: size, rs: size + 4 * n });
    size += 4 * n + pad4(n);
  }
  index.breadth50 = size; size += 4 * history.calendar.length;
  index.breadth200 = size; size += 4 * history.calendar.length;
  const buffer = Buffer.alloc(size);
  for (const entry of index.symbols) {
    Buffer.from(derived.turn.get(entry.symbol)!.buffer).copy(buffer, entry.turn);
    Buffer.from(derived.rs.get(entry.symbol)!.buffer).copy(buffer, entry.rs);
  }
  Buffer.from(derived.breadth50.buffer).copy(buffer, index.breadth50);
  Buffer.from(derived.breadth200.buffer).copy(buffer, index.breadth200);
  writeFileSync(join(dir, "_derived.bin"), buffer);
  writeFileSync(join(dir, "_derived.json"), JSON.stringify(index));
}

export function loadDerived(dir: string, history: History): Derived | null {
  const binPath = join(dir, "_derived.bin");
  const indexPath = join(dir, "_derived.json");
  if (!existsSync(binPath) || !existsSync(indexPath)) return null;
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as Index;
  if (index.fingerprint !== fingerprint(history)) return null;
  const raw = readFileSync(binPath);
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const turn = new Map<string, Float32Array>();
  const rs = new Map<string, Uint8Array>();
  for (const entry of index.symbols) {
    turn.set(entry.symbol, new Float32Array(buffer, entry.turn, entry.n));
    rs.set(entry.symbol, new Uint8Array(buffer, entry.rs, entry.n));
  }
  return {
    turn,
    rs,
    breadth50: new Float32Array(buffer, index.breadth50, index.days),
    breadth200: new Float32Array(buffer, index.breadth200, index.days),
  };
}

export function ensureDerived(dir: string, history: History, log: (message: string) => void = () => {}): Derived {
  const saved = loadDerived(dir, history);
  if (saved) return saved;
  log("building RS ranks and breadth (about a minute, once per history refresh)");
  const built = derive(history, log);
  saveDerived(dir, history, built);
  return built;
}
