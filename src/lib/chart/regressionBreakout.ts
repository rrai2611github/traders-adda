import type { Candle } from "../market/types.ts";

/**
 * Adaptive Regression Breakout Map, ported from GainzAlgo's open-source Pine
 * script (TradingView, defaults). A linear-regression channel of ±2 standard
 * deviations; a "squeeze" is bandwidth in the lowest 20% of its 100-bar range.
 * A close crossing out of the channel right after a squeeze opens a trade with
 * the stop at the opposite band and targets at 1/2/3× the bandwidth. TP1 moves
 * the stop to entry, TP2 moves it to TP1, TP3 closes.
 *
 * The trade map below repeats the script bar by bar, quirks included: a trade
 * is managed on its own signal bar, TP3 is checked before the stop on the same
 * bar, and the indicator's "win rate" counts a TP1-then-breakeven exit as a win.
 * `scripts/backtest-arbm.mjs` found no edge on NSE stocks (−0.09R a trade).
 */
export interface ArbmOptions {
  length: number;
  devMult: number;
  sqzLen: number;
  sqzPct: number;
  tp: readonly [number, number, number];
  pivotLen: number;
}

export const ARBM_DEFAULTS: ArbmOptions = { length: 50, devMult: 2, sqzLen: 100, sqzPct: 20, tp: [1, 2, 3], pivotLen: 10 };

export interface ArbmBands {
  upper: (number | null)[];
  lower: (number | null)[];
  width: (number | null)[];
  /** Bandwidth position inside its lookback range, 0 = narrowest. */
  widthPct: (number | null)[];
  squeeze: boolean[];
}

/** Pine ta.linreg(close, n, 0) ± devMult × ta.stdev(close, n) (population), from index `from` on. */
export function regressionBands(closes: readonly number[], o: ArbmOptions = ARBM_DEFAULTS, from = 0): ArbmBands {
  const n = o.length;
  const N = closes.length;
  const upper: (number | null)[] = new Array(N).fill(null);
  const lower: (number | null)[] = new Array(N).fill(null);
  const width: (number | null)[] = new Array(N).fill(null);
  const widthPct: (number | null)[] = new Array(N).fill(null);
  const squeeze: boolean[] = new Array(N).fill(false);
  const sx = (n * (n - 1)) / 2;
  const sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  const start = Math.max(n - 1, from - o.sqzLen + 1);
  for (let i = start; i < N; i++) {
    let sy = 0;
    let sxy = 0;
    let syy = 0;
    for (let k = 0; k < n; k++) {
      const y = closes[i - n + 1 + k];
      sy += y;
      sxy += k * y;
      syy += y * y;
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const reg = (sy - slope * sx) / n + slope * (n - 1);
    const mean = sy / n;
    const sd = Math.sqrt(Math.max(0, syy / n - mean * mean));
    upper[i] = reg + o.devMult * sd;
    lower[i] = reg - o.devMult * sd;
    width[i] = upper[i]! - lower[i]!;
  }
  for (let i = Math.max(n - 1 + o.sqzLen - 1, from); i < N; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = i - o.sqzLen + 1; k <= i; k++) {
      lo = Math.min(lo, width[k]!);
      hi = Math.max(hi, width[k]!);
    }
    widthPct[i] = ((width[i]! - lo) / Math.max(hi - lo, 1e-6)) * 100;
    squeeze[i] = widthPct[i]! <= o.sqzPct;
  }
  return { upper, lower, width, widthPct, squeeze };
}

export type ArbmDirection = 1 | -1;
export type ArbmEventKind = "tp1" | "tp2" | "tp3" | "stop";
export type ArbmOutcome = "tp3" | "stop" | "breakeven" | "trail" | "open";

export interface ArbmTrade {
  dir: ArbmDirection;
  signalIndex: number;
  signalT: number;
  entry: number;
  initialStop: number;
  targets: [number, number, number];
  /** Stop level on each bar from the signal bar to the exit (or last) bar. */
  stopPath: number[];
  events: { index: number; kind: ArbmEventKind; price: number }[];
  exitIndex: number | null;
  exitPrice: number | null;
  outcome: ArbmOutcome;
  /** Gross % return, exit vs entry (marked to the last close while open). */
  returnPct: number;
  /** Result in R: return over the initial entry-to-stop distance. */
  r: number;
  /** How the indicator's dashboard scores it: TP3, or stopped after TP1. */
  indicatorWin: boolean;
}

export interface ArbmTrendline {
  from: { index: number; price: number };
  to: { index: number; price: number };
  /** Line value extended to the last bar. */
  last: number;
}

export interface ArbmStats {
  /** As the indicator's "Map Performance" table counts them. */
  indicator: { trades: number; winRate: number; sharpe: number };
  /** Closed trades only, gross of costs. */
  real: { trades: number; winRate: number; avgReturnPct: number; avgR: number };
}

export interface ArbmMap {
  bands: ArbmBands;
  trades: ArbmTrade[];
  open: ArbmTrade | null;
  trendHigh: ArbmTrendline | null;
  trendLow: ArbmTrendline | null;
  stats: ArbmStats;
}

/** Pine ta.pivothigh/pivotlow: the centre bar beats `len` bars on each side. */
function pivots(values: readonly number[], len: number, high: boolean): { index: number; price: number }[] {
  const out: { index: number; price: number }[] = [];
  for (let i = len; i + len < values.length; i++) {
    const v = values[i];
    let ok = true;
    for (let k = i - len; k <= i + len && ok; k++) {
      if (k === i) continue;
      const w = values[k];
      // Ties count for the earlier bar, as in Pine.
      ok = high ? (k < i ? w < v : w <= v) : (k < i ? w > v : w >= v);
    }
    if (ok) out.push({ index: i, price: v });
  }
  return out;
}

function trendline(points: { index: number; price: number }[], lastIndex: number): ArbmTrendline | null {
  if (points.length < 2) return null;
  const from = points[points.length - 2];
  const to = points[points.length - 1];
  const slope = (to.price - from.price) / (to.index - from.index);
  return { from, to, last: to.price + slope * (lastIndex - to.index) };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function regressionBreakoutMap(candles: readonly Candle[], o: ArbmOptions = ARBM_DEFAULTS): ArbmMap {
  const closes = candles.map((c) => c.close);
  const bands = regressionBands(closes, o);
  const { upper, lower, width, squeeze } = bands;
  const trades: ArbmTrade[] = [];
  let t: ArbmTrade | null = null;
  let tp1Hit = false;
  let tp2Hit = false;

  const close = (trade: ArbmTrade, index: number, price: number, outcome: ArbmOutcome, win: boolean) => {
    trade.exitIndex = index;
    trade.exitPrice = price;
    trade.outcome = outcome;
    trade.indicatorWin = win;
    trade.events.push({ index, kind: outcome === "tp3" ? "tp3" : "stop", price });
  };

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i];
    if (!t && upper[i] != null && upper[i - 1] != null && squeeze[i - 1]) {
      const bull = bar.close > upper[i]! && closes[i - 1] <= upper[i - 1]!;
      const bear = bar.close < lower[i]! && closes[i - 1] >= lower[i - 1]!;
      if (bull || bear) {
        const dir: ArbmDirection = bull ? 1 : -1;
        const w = width[i - 1]!;
        const stop = bull ? lower[i - 1]! : upper[i - 1]!;
        t = {
          dir,
          signalIndex: i,
          signalT: bar.t,
          entry: bar.close,
          initialStop: stop,
          targets: [bar.close + dir * o.tp[0] * w, bar.close + dir * o.tp[1] * w, bar.close + dir * o.tp[2] * w],
          stopPath: [],
          events: [],
          exitIndex: null,
          exitPrice: null,
          outcome: "open",
          returnPct: 0,
          r: 0,
          indicatorWin: false,
        };
        tp1Hit = false;
        tp2Hit = false;
        trades.push(t);
      }
    }
    if (!t) continue;
    const long = t.dir === 1;
    let sl = t.stopPath.length ? t.stopPath[t.stopPath.length - 1] : t.initialStop;
    const reached = (level: number) => (long ? bar.high >= level : bar.low <= level);
    const hitSl = long ? bar.low <= sl : bar.high >= sl;
    if (reached(t.targets[0]) && !tp1Hit) {
      tp1Hit = true;
      sl = t.entry;
      t.events.push({ index: i, kind: "tp1", price: t.targets[0] });
    }
    if (reached(t.targets[1]) && !tp2Hit) {
      tp2Hit = true;
      sl = t.targets[0];
      t.events.push({ index: i, kind: "tp2", price: t.targets[1] });
    }
    t.stopPath.push(sl);
    if (reached(t.targets[2])) {
      close(t, i, t.targets[2], "tp3", true);
      t = null;
    } else if (hitSl) {
      close(t, i, sl, tp2Hit ? "trail" : tp1Hit ? "breakeven" : "stop", tp1Hit);
      t = null;
    }
  }

  const lastClose = closes[closes.length - 1];
  for (const trade of trades) {
    const px = trade.exitPrice ?? lastClose;
    trade.returnPct = ((px - trade.entry) / trade.entry) * trade.dir * 100;
    const riskPct = (Math.abs(trade.entry - trade.initialStop) / trade.entry) * 100;
    trade.r = riskPct > 0 ? trade.returnPct / riskPct : 0;
  }

  const closed = trades.filter((x) => x.outcome !== "open");
  const returns = closed.map((x) => x.returnPct);
  const avg = mean(returns);
  const sd = returns.length > 1 ? Math.sqrt(mean(returns.map((x) => (x - avg) ** 2))) : 0;
  const lastIndex = candles.length - 1;
  return {
    bands,
    trades,
    open: t,
    trendHigh: trendline(pivots(candles.map((c) => c.high), o.pivotLen, true), lastIndex),
    trendLow: trendline(pivots(candles.map((c) => c.low), o.pivotLen, false), lastIndex),
    stats: {
      indicator: {
        trades: closed.length,
        winRate: closed.length ? (closed.filter((x) => x.indicatorWin).length / closed.length) * 100 : 0,
        sharpe: sd > 0 ? avg / sd : 0,
      },
      real: {
        trades: closed.length,
        winRate: closed.length ? (closed.filter((x) => x.returnPct > 0).length / closed.length) * 100 : 0,
        avgReturnPct: avg,
        avgR: mean(closed.map((x) => x.r)),
      },
    },
  };
}

/** Long signal on the last candle only, for the scanner (cheap: bands for the last squeeze window). */
export function arbmLongSignal(candles: readonly Candle[], o: ArbmOptions = ARBM_DEFAULTS) {
  const i = candles.length - 1;
  if (i < o.length + o.sqzLen) return null;
  const closes = candles.map((c) => c.close);
  const b = regressionBands(closes, o, i - 1);
  const up = b.upper[i];
  const upPrev = b.upper[i - 1];
  if (up == null || upPrev == null || !b.squeeze[i - 1]) return null;
  if (!(closes[i] > up && closes[i - 1] <= upPrev)) return null;
  const w = b.width[i - 1]!;
  const stop = b.lower[i - 1]!;
  const entry = closes[i];
  return {
    upper: up,
    stop,
    stopPercent: ((entry - stop) / entry) * 100,
    targets: [entry + o.tp[0] * w, entry + o.tp[1] * w, entry + o.tp[2] * w] as [number, number, number],
    squeezeWidthPct: b.widthPct[i - 1]!,
  };
}
