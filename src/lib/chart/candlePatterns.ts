import type { Candle } from "../market/types.ts";

/**
 * Classic candlestick patterns (names follow Scanner Pro's list; the rules are
 * textbook definitions with our thresholds). Reversal patterns need a prior
 * move of at least one ATR over the previous five bars, and every pattern bar
 * must span at least 0.3 ATR so micro-candles are ignored.
 */
export type CandlePatternKey =
  | "hammer" | "hangingMan" | "shootingStar" | "dragonflyDoji" | "gravestoneDoji"
  | "bullEngulfing" | "bearEngulfing" | "piercing" | "darkCloud"
  | "morningStar" | "eveningStar" | "threeWhiteSoldiers" | "threeBlackCrows"
  | "bullMarubozu" | "bearMarubozu";

export type PatternBias = "bullish" | "bearish";

export const CANDLE_PATTERNS: Record<CandlePatternKey, { label: string; short: string; bias: PatternBias; desc: string }> = {
  hammer: { label: "Hammer", short: "Ham", bias: "bullish", desc: "Long lower wick after a decline: sellers pushed down, buyers closed it near the high" },
  hangingMan: { label: "Hanging Man", short: "HM", bias: "bearish", desc: "Hammer shape after a rally: first sign that selling is being absorbed less easily" },
  shootingStar: { label: "Shooting Star", short: "SS", bias: "bearish", desc: "Long upper wick after a rally: buyers pushed up, sellers closed it near the low" },
  dragonflyDoji: { label: "Dragonfly Doji", short: "DD", bias: "bullish", desc: "Open ≈ close at the high after a decline, long lower wick" },
  gravestoneDoji: { label: "Gravestone Doji", short: "GD", bias: "bearish", desc: "Open ≈ close at the low after a rally, long upper wick" },
  bullEngulfing: { label: "Bullish Engulfing", short: "BE", bias: "bullish", desc: "Green body fully covers the prior red body after a decline" },
  bearEngulfing: { label: "Bearish Engulfing", short: "BE", bias: "bearish", desc: "Red body fully covers the prior green body after a rally" },
  piercing: { label: "Piercing Line", short: "PL", bias: "bullish", desc: "After a red bar, opens below its close and closes above its midpoint" },
  darkCloud: { label: "Dark Cloud Cover", short: "DC", bias: "bearish", desc: "After a green bar, opens above its close and closes below its midpoint" },
  morningStar: { label: "Morning Star", short: "MS", bias: "bullish", desc: "Large red bar, small-bodied bar, then green bar closing above the first bar's midpoint" },
  eveningStar: { label: "Evening Star", short: "ES", bias: "bearish", desc: "Large green bar, small-bodied bar, then red bar closing below the first bar's midpoint" },
  threeWhiteSoldiers: { label: "3 White Soldiers", short: "3W", bias: "bullish", desc: "Three strong green bars, each closing higher and opening inside the prior body" },
  threeBlackCrows: { label: "3 Black Crows", short: "3B", bias: "bearish", desc: "Three strong red bars, each closing lower and opening inside the prior body" },
  bullMarubozu: { label: "Bullish Marubozu", short: "M", bias: "bullish", desc: "Wide green bar with almost no wicks: buyers in control all session" },
  bearMarubozu: { label: "Bearish Marubozu", short: "M", bias: "bearish", desc: "Wide red bar with almost no wicks: sellers in control all session" },
};

export interface CandlePatternHit {
  index: number;
  t: number;
  key: CandlePatternKey;
  label: string;
  bias: PatternBias;
}

const RULES = { trendBars: 5, trendAtr: 1, minRangeAtr: 0.3, atrPeriod: 14 } as const;

/** Wilder-free simple ATR series (mean true range over `period` bars). */
function atrSeries(c: ReadonlyArray<Candle>, period: number): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  let sum = 0;
  const tr = (i: number) => i === 0
    ? c[0].high - c[0].low
    : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
  for (let i = 0; i < c.length; i += 1) {
    sum += tr(i);
    if (i >= period) sum -= tr(i - period);
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Patterns completing on each bar from `from` onward (default: every bar). */
export function detectCandlePatterns(candles: ReadonlyArray<Candle>, from = 0): CandlePatternHit[] {
  const c = candles;
  const atr = atrSeries(c, RULES.atrPeriod);
  const out: CandlePatternHit[] = [];
  const body = (k: Candle) => Math.abs(k.close - k.open);
  const range = (k: Candle) => k.high - k.low;
  const upper = (k: Candle) => k.high - Math.max(k.open, k.close);
  const lower = (k: Candle) => Math.min(k.open, k.close) - k.low;
  const green = (k: Candle) => k.close > k.open;
  const red = (k: Candle) => k.close < k.open;
  const mid = (k: Candle) => (k.open + k.close) / 2;

  for (let i = Math.max(from, RULES.atrPeriod + RULES.trendBars + 2); i < c.length; i += 1) {
    const a = atr[i - 1];
    if (a == null || a <= 0) continue;
    const L = c[i];
    const P = c[i - 1];
    const Q = c[i - 2];
    // Trend into the pattern, measured up to the bar before the pattern starts.
    const trendInto = (start: number) => {
      const ref = c[start - 1 - RULES.trendBars];
      const end = c[start - 1];
      if (!ref) return 0;
      const move = end.close - ref.close;
      return move <= -RULES.trendAtr * a ? -1 : move >= RULES.trendAtr * a ? 1 : 0;
    };
    const hit = (key: CandlePatternKey) => {
      const def = CANDLE_PATTERNS[key];
      out.push({ index: i, t: L.t, key, label: def.label, bias: def.bias });
    };
    const bigEnough = (k: Candle) => range(k) >= RULES.minRangeAtr * a;
    if (!bigEnough(L)) continue;

    const t1 = trendInto(i);
    const r = range(L);
    const b = body(L);

    // Single-bar shapes.
    const hammerShape = b > 0.05 * r && lower(L) >= 2 * b && upper(L) <= 0.15 * r;
    const starShape = b > 0.05 * r && upper(L) >= 2 * b && lower(L) <= 0.15 * r;
    const doji = b <= 0.05 * r;
    if (hammerShape && t1 < 0) hit("hammer");
    else if (hammerShape && t1 > 0) hit("hangingMan");
    else if (starShape && t1 > 0) hit("shootingStar");
    else if (doji && t1 < 0 && upper(L) <= 0.1 * r && lower(L) >= 0.6 * r) hit("dragonflyDoji");
    else if (doji && t1 > 0 && lower(L) <= 0.1 * r && upper(L) >= 0.6 * r) hit("gravestoneDoji");

    if (b >= 0.9 * r && r >= a) hit(green(L) ? "bullMarubozu" : "bearMarubozu");

    // Two-bar patterns.
    const t2 = trendInto(i - 1);
    if (bigEnough(P)) {
      if (t2 < 0 && red(P) && green(L) && L.open <= P.close && L.close >= P.open && b > body(P)) hit("bullEngulfing");
      else if (t2 > 0 && green(P) && red(L) && L.open >= P.close && L.close <= P.open && b > body(P)) hit("bearEngulfing");
      else if (t2 < 0 && red(P) && body(P) >= 0.6 * range(P) && green(L) && L.open < P.close && L.close > mid(P) && L.close < P.open) hit("piercing");
      else if (t2 > 0 && green(P) && body(P) >= 0.6 * range(P) && red(L) && L.open > P.close && L.close < mid(P) && L.close > P.open) hit("darkCloud");
    }

    // Three-bar patterns.
    const t3 = trendInto(i - 2);
    const strong = (k: Candle) => body(k) >= 0.6 * range(k) && body(k) >= 0.5 * a;
    const small = (k: Candle) => body(k) <= 0.3 * range(k) || body(k) <= 0.25 * a;
    if (t3 < 0 && red(Q) && strong(Q) && small(P) && green(L) && L.close > mid(Q)) hit("morningStar");
    if (t3 > 0 && green(Q) && strong(Q) && small(P) && red(L) && L.close < mid(Q)) hit("eveningStar");
    const soldiers = [Q, P, L].every((k) => green(k) && strong(k)) &&
      P.close > Q.close && L.close > P.close && P.open >= Q.open && P.open <= Q.close && L.open >= P.open && L.open <= P.close;
    const crows = [Q, P, L].every((k) => red(k) && strong(k)) &&
      P.close < Q.close && L.close < P.close && P.open <= Q.open && P.open >= Q.close && L.open <= P.open && L.open >= P.close;
    if (soldiers && t3 <= 0) hit("threeWhiteSoldiers");
    if (crows && t3 >= 0) hit("threeBlackCrows");
  }
  return out;
}
