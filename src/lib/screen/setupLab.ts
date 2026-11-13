import type { Candle } from "@/lib/market/types";
import { measureStage2Base } from "./stage2Bases.ts";
import { stage2Flags } from "./sectorStage2.ts";

/**
 * Setup Lab: pick conditions, see what happened next to every past stock-day that met them, against all stock-days.
 *
 * Every condition is recomputed for each past session from the candles up to that close, so nothing looks ahead. A
 * stock-day is judged by its return over the next 5, 20 or 60 sessions measured from that day's close, minus the
 * median return of all stocks over the same days ("excess"), so a rising market does not flatter every setup. A win is
 * an excess return above zero.
 *
 * Limits the page repeats: today's listed stocks only (survivorship), about four years (mostly one regime), signals on
 * consecutive days of one stock overlap and are not independent, and entry is at the signal close, not the next open.
 */
export const LAB_HORIZONS = [5, 20, 60] as const;
export type LabHorizon = (typeof LAB_HORIZONS)[number];

export const LAB_RULES = {
  /** First session judged: enough history for the 200-day average, its slope, and the 252-session base window. */
  warmup: 260,
  rsSessions: 63,
  volumeSessions: 50,
  minSectorNames: 3,
  regimeSmoothing: 5,
  /** Minimum observations before a statistic is shown rather than withheld. */
  minObservations: 30,
  /** Fine histogram for quantiles: 0.25% bins from -100% to +200%. */
  binWidth: 0.25,
  binMin: -100,
  binMax: 200,
} as const;

export type FeatureKey = "stage2" | "trend" | "fromHigh" | "rs" | "volume" | "base" | "sectorStage2" | "regime";

export interface LabFeature { key: FeatureKey; label: string; hint: string; group: "Trend" | "Strength" | "Setup" | "Context"; levels: string[] }

export const LAB_FEATURES: LabFeature[] = [
  { key: "stage2", group: "Trend", label: "Stage 2 uptrend", hint: "Close over the 50-day, the 50 over the 200, the 200 rising.", levels: ["Not Stage 2", "Stage 2"] },
  { key: "trend", group: "Trend", label: "Trend structure", hint: "Where the close sits against the 50 and 200-day averages.", levels: ["Below 200-day, 50 under it", "Below 200-day", "Above 200-day", "Above 50 and 200, 50 over 200"] },
  { key: "fromHigh", group: "Trend", label: "Distance below 52-week high", hint: "Against the highest high of the last 252 sessions.", levels: ["At the high (under 2%)", "2–10% below", "10–25% below", "25–50% below", "50%+ below"] },
  { key: "rs", group: "Strength", label: "63-day return rank", hint: "Rank of the 63-session return among all stocks that day.", levels: ["Bottom 20%", "20–40%", "40–60%", "60–80%", "Top 20%"] },
  { key: "volume", group: "Strength", label: "Volume vs 50-day average", hint: "That day's volume over the prior 50-session average.", levels: ["Dry (under 0.8×)", "Normal (0.8–1.5×)", "Surge (1.5–3×)", "Spike (3×+)"] },
  { key: "base", group: "Setup", label: "Stage 2 base", hint: "The Stage 2 Bases scan, run on that day.", levels: ["No base", "Forming, over 5% under its high", "Forming, within 5% of its high", "Breakout (20+ session base)"] },
  { key: "sectorStage2", group: "Context", label: "Sector Stage 2 share", hint: "Share of the stock's sector in Stage 2 that day.", levels: ["Red (under 20%)", "Amber (20–40%)", "Green (40%+)", "Unknown"] },
  { key: "regime", group: "Context", label: "Market regime", hint: "Share of stocks above their 200-day average, 5-day smoothed.", levels: ["Bear (under half above 200-day)", "Bull (half or more above)"] },
];

const FEATURE_KEYS = LAB_FEATURES.map((f) => f.key);
const UNKNOWN = 7;

export interface LabStock { symbol: string; sector: string | null; candles: ReadonlyArray<Candle> }

export interface LabTable {
  n: number;
  symbols: string[];
  stock: Uint16Array;
  slot: Uint16Array;
  month: Uint8Array;
  months: string[];
  levels: Record<FeatureKey, Uint8Array>;
  /** Excess return in percent per horizon; NaN where the horizon is not yet reachable. */
  excess: Record<LabHorizon, Float32Array>;
  close: Float32Array;
  /** 63-day return rank, 1-99, 0 when unknown. */
  rank: Uint8Array;
  lastSlot: number;
  lastDay: number;
}

const IST_MS = 5.5 * 3600e3;
const dayOf = (t: number) => Math.floor((t + IST_MS) / 86_400_000);
const monthOf = (t: number) => new Date(t + IST_MS).toISOString().slice(0, 7);

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function buildLabTable(stocks: ReadonlyArray<LabStock>, onProgress?: (done: number, total: number) => void): Promise<LabTable> {
  const R = LAB_RULES;
  // Sessions every stock shares: a day with a handful of stocks is a partial feed, not a session.
  const perDay = new Map<number, number>();
  for (const s of stocks) for (const c of s.candles) perDay.set(dayOf(c.t), (perDay.get(dayOf(c.t)) ?? 0) + 1);
  const peak = Math.max(0, ...perDay.values());
  const days = [...perDay].filter(([, n]) => n >= peak * 0.5).map(([d]) => d).sort((a, b) => a - b);
  const slotOf = new Map(days.map((d, i) => [d, i]));

  let capacity = 0;
  for (const s of stocks) capacity += Math.max(0, s.candles.length - R.warmup);
  const table: LabTable = {
    n: 0, symbols: stocks.map((s) => s.symbol),
    stock: new Uint16Array(capacity), slot: new Uint16Array(capacity), month: new Uint8Array(capacity), months: [],
    levels: Object.fromEntries(FEATURE_KEYS.map((k) => [k, new Uint8Array(capacity).fill(UNKNOWN)])) as Record<FeatureKey, Uint8Array>,
    excess: { 5: new Float32Array(capacity).fill(NaN), 20: new Float32Array(capacity).fill(NaN), 60: new Float32Array(capacity).fill(NaN) },
    close: new Float32Array(capacity), rank: new Uint8Array(capacity),
    lastSlot: days.length - 1, lastDay: days.at(-1) ?? 0,
  };
  const rawFwd = { 5: new Float32Array(capacity).fill(NaN), 20: new Float32Array(capacity).fill(NaN), 60: new Float32Array(capacity).fill(NaN) };
  const ret63 = new Float32Array(capacity).fill(NaN);
  const monthIndex = new Map<string, number>();
  const sectorIdx = new Map<string, number>();
  const sectorOfStock = new Uint8Array(stocks.length).fill(255);

  let n = 0;
  for (let si = 0; si < stocks.length; si++) {
    const { candles: c, sector } = stocks[si];
    if (sector) sectorOfStock[si] = sectorIdx.get(sector) ?? sectorIdx.set(sector, sectorIdx.size).get(sector)!;
    if (c.length > R.warmup) {
      const closes = c.map((k) => k.close);
      const flags = stage2Flags(closes);
      const pc = new Float64Array(c.length + 1), pv = new Float64Array(c.length + 1);
      for (let i = 0; i < c.length; i++) { pc[i + 1] = pc[i] + c[i].close; pv[i + 1] = pv[i] + c[i].volume; }
      const deque: number[] = [];
      let head = 0;
      for (let i = 0; i < c.length; i++) {
        while (deque.length > head && c[deque[deque.length - 1]].high <= c[i].high) deque.pop();
        deque.push(i);
        while (deque[head] <= i - 252) head++;
        if (i < R.warmup) continue;
        const slot = slotOf.get(dayOf(c[i].t));
        const flag = flags[i];
        if (slot == null || flag == null) continue;

        const s50 = (pc[i + 1] - pc[i - 49]) / 50;
        const s200 = (pc[i + 1] - pc[i - 199]) / 200;
        const close = c[i].close;
        const high = c[deque[head]].high;
        const fromHigh = (1 - close / high) * 100;
        const avgVol = (pv[i] - pv[i - R.volumeSessions]) / R.volumeSessions;
        const vol = avgVol > 0 ? c[i].volume / avgVol : null;
        const base = measureStage2Base(c.slice(i - 259, i + 1));

        table.stock[n] = si;
        table.slot[n] = slot;
        const m = monthOf(c[i].t);
        table.month[n] = monthIndex.get(m) ?? monthIndex.set(m, monthIndex.size).get(m)!;
        table.close[n] = close;
        table.levels.stage2[n] = flag ? 1 : 0;
        table.levels.trend[n] = close < s200 ? (s50 < s200 ? 0 : 1) : close > s50 && s50 > s200 ? 3 : 2;
        table.levels.fromHigh[n] = fromHigh < 2 ? 0 : fromHigh < 10 ? 1 : fromHigh < 25 ? 2 : fromHigh < 50 ? 3 : 4;
        if (vol != null) table.levels.volume[n] = vol < 0.8 ? 0 : vol < 1.5 ? 1 : vol < 3 ? 2 : 3;
        table.levels.base[n] = !base ? 0 : base.kind === "breakout" ? 3 : base.toHighPercent > 5 ? 1 : 2;
        if (c[i - R.rsSessions].close > 0) ret63[n] = (close / c[i - R.rsSessions].close - 1) * 100;
        for (const h of LAB_HORIZONS) if (i + h < c.length) rawFwd[h][n] = (c[i + h].close / close - 1) * 100;
        n++;
      }
    }
    if (si % 20 === 19) { onProgress?.(si + 1, stocks.length); await tick(); }
  }
  table.n = n;
  table.months = [...monthIndex.keys()];

  // Group observations by session for the cross-sectional pieces.
  const bySlot: number[][] = days.map(() => []);
  for (let i = 0; i < n; i++) bySlot[table.slot[i]].push(i);
  const above200 = new Float64Array(days.length).fill(NaN);
  for (let s = 0; s < days.length; s++) {
    const obs = bySlot[s];
    if (!obs.length) continue;
    for (const h of LAB_HORIZONS) {
      const values: number[] = [];
      for (const i of obs) if (!Number.isNaN(rawFwd[h][i])) values.push(rawFwd[h][i]);
      if (!values.length) continue;
      const mid = median(values);
      for (const i of obs) if (!Number.isNaN(rawFwd[h][i])) table.excess[h][i] = rawFwd[h][i] - mid;
    }
    const ranked = obs.filter((i) => !Number.isNaN(ret63[i])).sort((a, b) => ret63[a] - ret63[b]);
    ranked.forEach((i, r) => {
      const pct = ranked.length === 1 ? 0.5 : r / (ranked.length - 1);
      table.rank[i] = Math.max(1, Math.min(99, Math.round(1 + pct * 98)));
      table.levels.rs[i] = Math.min(4, Math.floor(pct * 5));
    });
    let up = 0;
    for (const i of obs) if (table.levels.trend[i] >= 2) up++;
    above200[s] = (up / obs.length) * 100;
    const sectors = new Map<number, [number, number]>();
    for (const i of obs) {
      const sec = sectorOfStock[table.stock[i]];
      if (sec === 255) continue;
      const t = sectors.get(sec) ?? sectors.set(sec, [0, 0]).get(sec)!;
      t[1]++; if (table.levels.stage2[i]) t[0]++;
    }
    for (const i of obs) {
      const sec = sectorOfStock[table.stock[i]];
      const t = sec === 255 ? undefined : sectors.get(sec);
      table.levels.sectorStage2[i] = !t || t[1] < R.minSectorNames ? 3 : ((t[0] / t[1]) * 100 < 20 ? 0 : (t[0] / t[1]) * 100 < 40 ? 1 : 2);
    }
  }
  // Regime: share above the 200-day, smoothed over the last few sessions that had stocks.
  const history: number[] = [];
  for (let s = 0; s < days.length; s++) {
    if (Number.isNaN(above200[s])) continue;
    history.push(above200[s]);
    const window = history.slice(-R.regimeSmoothing);
    const level = window.reduce((a, b) => a + b, 0) / window.length >= 50 ? 1 : 0;
    for (const i of bySlot[s]) table.levels.regime[i] = level;
  }
  onProgress?.(stocks.length, stocks.length);
  return table;
}

export type LabFilters = Partial<Record<FeatureKey, number[]>>;

export interface LabStats {
  /** Observations with a measured outcome. */
  n: number;
  /** Share with a return above the median stock's, 0-100. */
  winRate: number | null;
  mean: number | null;
  median: number | null;
  /** The 10th percentile: how bad the bad outcomes were. */
  p10: number | null;
}

interface Tally {
  n: number;
  wins: number;
  sum: number;
  fine: Uint32Array;
  monthN: number[];
  monthWins: number[];
  matched: number;
}

const FINE_BINS = Math.round((LAB_RULES.binMax - LAB_RULES.binMin) / LAB_RULES.binWidth);
const fineBin = (v: number) => Math.max(0, Math.min(FINE_BINS - 1, Math.floor((v - LAB_RULES.binMin) / LAB_RULES.binWidth)));
const binValue = (b: number) => LAB_RULES.binMin + (b + 0.5) * LAB_RULES.binWidth;

function masksOf(filters: LabFilters): [FeatureKey, number][] {
  const out: [FeatureKey, number][] = [];
  for (const key of FEATURE_KEYS) {
    const levels = filters[key];
    if (!levels || !levels.length) continue;
    out.push([key, levels.reduce((m, l) => m | (1 << l), 0)]);
  }
  return out;
}

function tally(table: LabTable, masks: [FeatureKey, number][], horizon: LabHorizon): Tally {
  const t: Tally = { n: 0, wins: 0, sum: 0, fine: new Uint32Array(FINE_BINS), monthN: new Array(table.months.length).fill(0), monthWins: new Array(table.months.length).fill(0), matched: 0 };
  const cols = masks.map(([key, mask]) => [table.levels[key], mask] as const);
  const ex = table.excess[horizon];
  outer: for (let i = 0; i < table.n; i++) {
    for (const [col, mask] of cols) if (!((mask >> col[i]) & 1)) continue outer;
    t.matched++;
    const v = ex[i];
    if (Number.isNaN(v)) continue;
    t.n++; t.sum += v; t.fine[fineBin(v)]++;
    const m = table.month[i];
    t.monthN[m]++;
    if (v > 0) { t.wins++; t.monthWins[m]++; }
  }
  return t;
}

function quantile(fine: Uint32Array, total: number, q: number): number | null {
  if (!total) return null;
  const target = q * total;
  let seen = 0;
  for (let b = 0; b < fine.length; b++) { seen += fine[b]; if (seen >= target) return binValue(b); }
  return binValue(fine.length - 1);
}

const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

function statsOf(t: Tally): LabStats {
  if (t.n < LAB_RULES.minObservations) return { n: t.n, winRate: null, mean: null, median: null, p10: null };
  return { n: t.n, winRate: round((t.wins / t.n) * 100, 1), mean: round(t.sum / t.n), median: round(quantile(t.fine, t.n, 0.5)), p10: round(quantile(t.fine, t.n, 0.1)) };
}

/** Coarse return buckets, as a share of each group's own observations. */
export const HISTOGRAM_EDGES = [-25, -15, -10, -5, -2.5, 0, 2.5, 5, 10, 15, 25] as const;
export const histogramLabels = (): string[] => ["≤ −25", "−25…−15", "−15…−10", "−10…−5", "−5…−2.5", "−2.5…0", "0…2.5", "2.5…5", "5…10", "10…15", "15…25", "25+"];

function coarse(fine: Uint32Array, total: number): number[] {
  const out = new Array(HISTOGRAM_EDGES.length + 1).fill(0);
  for (let b = 0; b < fine.length; b++) {
    if (!fine[b]) continue;
    const v = binValue(b);
    let k = 0;
    while (k < HISTOGRAM_EDGES.length && v >= HISTOGRAM_EDGES[k]) k++;
    out[k] += fine[b];
  }
  return out.map((c) => (total ? round((c / total) * 100, 1)! : 0));
}

export interface LabMonth { month: string; n: number; winRate: number | null; baseline: number | null; delta: number | null }
export interface LabDrop { key: FeatureKey; label: string; winRate: number | null; delta: number | null; n: number }
export interface LabRegimeSplit { label: string; combo: LabStats; universe: LabStats }
export interface LabMatch { symbol: string; close: number; rank: number }

export interface LabResult {
  horizon: LabHorizon;
  matched: number;
  combo: LabStats;
  universe: LabStats;
  histogram: { labels: string[]; combo: number[]; universe: number[] };
  months: LabMonth[];
  /** Win rate with each active filter removed, to show which one earns its place. */
  dropOne: LabDrop[];
  regimes: LabRegimeSplit[];
  matchingNow: { total: number; rows: LabMatch[] };
  observations: number;
  sessions: number;
  through: number;
}

const universeCache = new WeakMap<LabTable, Map<LabHorizon, Tally>>();
function universeTally(table: LabTable, horizon: LabHorizon): Tally {
  const perTable = universeCache.get(table) ?? universeCache.set(table, new Map()).get(table)!;
  return perTable.get(horizon) ?? perTable.set(horizon, tally(table, [], horizon)).get(horizon)!;
}

export function runLabQuery(table: LabTable, filters: LabFilters, horizon: LabHorizon, nowLimit = 40): LabResult {
  const masks = masksOf(filters);
  const combo = tally(table, masks, horizon);
  const base = universeTally(table, horizon);

  const months: LabMonth[] = table.months.map((month, m) => {
    const winRate = combo.monthN[m] >= 10 ? round((combo.monthWins[m] / combo.monthN[m]) * 100, 1) : null;
    const baseline = base.monthN[m] >= 10 ? round((base.monthWins[m] / base.monthN[m]) * 100, 1) : null;
    return { month, n: combo.monthN[m], winRate, baseline, delta: winRate != null && baseline != null ? round(winRate - baseline, 1) : null };
  }).sort((a, b) => a.month.localeCompare(b.month));

  const dropOne: LabDrop[] = masks.map(([key]) => {
    const without = tally(table, masks.filter(([k]) => k !== key), horizon);
    const win = without.n >= LAB_RULES.minObservations ? round((without.wins / without.n) * 100, 1) : null;
    const withWin = combo.n >= LAB_RULES.minObservations ? (combo.wins / combo.n) * 100 : null;
    return { key, label: LAB_FEATURES.find((f) => f.key === key)!.label, winRate: win, delta: win != null && withWin != null ? round(withWin - win, 1) : null, n: without.n };
  });

  const regimeMasks = masks.filter(([k]) => k !== "regime");
  const regimes: LabRegimeSplit[] = LAB_FEATURES.find((f) => f.key === "regime")!.levels.map((label, level) => {
    const m: [FeatureKey, number][] = [...regimeMasks, ["regime", 1 << level]];
    return { label, combo: statsOf(tally(table, m, horizon)), universe: statsOf(tally(table, [["regime", 1 << level]], horizon)) };
  });

  const rows: LabMatch[] = [];
  let total = 0;
  const cols = masks.map(([key, mask]) => [table.levels[key], mask] as const);
  // Observations are stored stock by stock, so the latest session's are found by scanning for its slot.
  const lastObs: number[] = [];
  outer: for (let i = 0; i < table.n; i++) {
    if (table.slot[i] !== table.lastSlot) continue;
    for (const [col, mask] of cols) if (!((mask >> col[i]) & 1)) continue outer;
    lastObs.push(i);
  }
  total = lastObs.length;
  lastObs.sort((a, b) => table.rank[b] - table.rank[a]);
  for (const i of lastObs.slice(0, nowLimit)) rows.push({ symbol: table.symbols[table.stock[i]], close: Math.round(table.close[i] * 100) / 100, rank: table.rank[i] });

  return {
    horizon,
    matched: combo.matched,
    combo: statsOf(combo),
    universe: statsOf(base),
    histogram: { labels: histogramLabels(), combo: coarse(combo.fine, combo.n), universe: coarse(base.fine, base.n) },
    months,
    dropOne,
    regimes,
    matchingNow: { total, rows },
    observations: table.n,
    sessions: table.lastSlot + 1,
    through: table.lastDay,
  };
}

/** Plain-English sentence for the result card. */
export function labSentence(result: LabResult): string {
  const { combo, universe, horizon } = result;
  if (combo.winRate == null) return `Only ${combo.n.toLocaleString("en-IN")} past stock-days met every condition with a ${horizon}-session outcome. That is too few to read, so no statistic is shown.`;
  const diff = universe.winRate == null ? null : combo.winRate - universe.winRate;
  const rel = diff == null ? "" : ` (${Math.abs(diff).toFixed(1)} points ${diff >= 0 ? "above" : "below"} all stocks' ${universe.winRate!.toFixed(1)}%)`;
  return `${combo.n.toLocaleString("en-IN")} past stock-days met these conditions. ${combo.winRate.toFixed(1)}% went on to beat the median stock over ${horizon} sessions${rel}, with a median excess return of ${combo.median! > 0 ? "+" : ""}${combo.median!.toFixed(1)}% and a worst-10% outcome of ${combo.p10!.toFixed(1)}%.`;
}
