/**
 * The "daily trend, hourly entry" index framework as a live checklist.
 * Daily regime: price vs 50 and 200 DMA, RSI, MACD, India VIX and Bank Nifty. Hourly setup: 20 EMA, VWAP, RSI, volume,
 * higher highs and lows, breadth and a close beyond the previous hour. All six daily and all hourly conditions must hold.
 * It describes conditions and proposes a trade; it is not a recommendation, and the framework is unproven (see the backtest notes).
 */

export interface Check {
  label: string;
  value: string;
  /** True or false when measured; null when the input is unavailable (shown as "n/a", never counted as a pass). */
  pass: boolean | null;
}

export interface Bar {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const sma = (v: number[], n: number): number | null => (v.length < n ? null : v.slice(-n).reduce((a, b) => a + b, 0) / n);

function emaSeries(v: number[], n: number): number[] {
  const k = 2 / (n + 1);
  let e = v[0];
  return v.map((x, i) => (e = i ? x * k + e * (1 - k) : v[0]));
}

function rsiLast(v: number[], n = 14): number | null {
  if (v.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function atrLast(bars: Bar[], n = 14): number | null {
  if (bars.length <= n) return null;
  let a = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n;
  }
  return a;
}

const fmt = (v: number, d = 0) => v.toLocaleString("en-IN", { maximumFractionDigits: d });

export interface DailyRegime {
  state: "bull" | "bear" | "none";
  bull: Check[];
  bear: Check[];
  bullCount: number;
  bearCount: number;
}

/** Daily trend filter from the last completed daily bars of the index, Bank Nifty and India VIX. */
export function dailyRegime(index: ReadonlyArray<{ close: number }>, bank: ReadonlyArray<{ close: number }>, vix: ReadonlyArray<{ close: number }>): DailyRegime | null {
  const c = index.map((k) => k.close);
  const s50 = sma(c, 50), s200 = sma(c, 200), rsi = rsiLast(c);
  if (c.length < 200 || s50 == null || s200 == null || rsi == null) return null;
  const price = c[c.length - 1];
  const macd = emaSeries(c, 12)[c.length - 1] - emaSeries(c, 26)[c.length - 1];
  const bc = bank.map((k) => k.close);
  const bank50 = sma(bc, 50);
  const bankAbove = bank50 == null ? null : bc[bc.length - 1] > bank50;
  const v = vix.map((k) => k.close);
  const vixNow = v.at(-1), vixThen = v.length > 5 ? v[v.length - 6] : undefined;
  const vixChange = vixNow != null && vixThen != null ? (vixNow / vixThen - 1) * 100 : null;
  const bull: Check[] = [
    { label: "Price above 50 DMA", value: `${fmt(price)} vs ${fmt(s50)}`, pass: price > s50 },
    { label: "50 DMA above 200 DMA", value: `${fmt(s50)} vs ${fmt(s200)}`, pass: s50 > s200 },
    { label: "RSI(14) above 55", value: rsi.toFixed(1), pass: rsi > 55 },
    { label: "MACD above zero", value: fmt(macd), pass: macd > 0 },
    { label: "India VIX stable or falling (5 days)", value: vixChange == null ? "n/a" : `${vixChange >= 0 ? "+" : "−"}${Math.abs(vixChange).toFixed(1)}%`, pass: vixChange == null ? null : vixChange <= 3 },
    { label: "Bank Nifty above its 50 DMA", value: bankAbove == null ? "n/a" : bankAbove ? "above" : "below", pass: bankAbove },
  ];
  const bear: Check[] = [
    { label: "Price below 50 DMA", value: `${fmt(price)} vs ${fmt(s50)}`, pass: price < s50 },
    { label: "50 DMA below 200 DMA", value: `${fmt(s50)} vs ${fmt(s200)}`, pass: s50 < s200 },
    { label: "RSI(14) below 45", value: rsi.toFixed(1), pass: rsi < 45 },
    { label: "MACD below zero", value: fmt(macd), pass: macd < 0 },
    { label: "India VIX rising (5 days)", value: vixChange == null ? "n/a" : `${vixChange >= 0 ? "+" : "−"}${Math.abs(vixChange).toFixed(1)}%`, pass: vixChange == null ? null : vixChange > 3 },
    { label: "Bank Nifty below its 50 DMA", value: bankAbove == null ? "n/a" : bankAbove ? "above" : "below", pass: bankAbove == null ? null : !bankAbove },
  ];
  const count = (checks: Check[]) => checks.filter((x) => x.pass === true).length;
  const bullCount = count(bull), bearCount = count(bear);
  return { state: bullCount === 6 ? "bull" : bearCount === 6 ? "bear" : "none", bull, bear, bullCount, bearCount };
}

export interface HourlySetup {
  dir: 1 | -1;
  checks: Check[];
  /** Measured conditions that failed. */
  failed: number;
  /** Conditions that could not be measured. */
  unmeasured: number;
  allPass: boolean;
  /** The last completed hourly bar already closed beyond the previous hour's extreme (the framework's entry trigger). */
  breakoutConfirmed: boolean;
  proposal: { entryType: "market" | "trigger"; entry: number; stop: number; target: number; riskPoints: number } | null;
}

/**
 * `bars` are completed hourly bars, oldest first (at least 30). `vwap` is the session VWAP at the last bar's close
 * and `breadthPercent` the share of liquid stocks above their 50 DMA; either may be null when unavailable.
 */
export function hourlySetup(input: { bars: ReadonlyArray<Bar>; vwap: number | null; breadthPercent: number | null; dir: 1 | -1 }): HourlySetup | null {
  const { bars, dir, vwap, breadthPercent } = input;
  if (bars.length < 30) return null;
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1], prev = bars[bars.length - 2], prev2 = bars[bars.length - 3];
  const ema20 = emaSeries(closes, 20)[closes.length - 1];
  const rsi = rsiLast(closes);
  const atr = atrLast(bars as Bar[]);
  const avgVol = bars.slice(-21, -1).reduce((a, b) => a + b.volume, 0) / 20;
  const long = dir === 1;
  const hhhl = long ? last.high > prev.high && last.low > prev.low && prev.high > prev2.high : last.high < prev.high && last.low < prev.low && prev.low < prev2.low;
  const checks: Check[] = [
    { label: long ? "Price above 20 EMA" : "Price below 20 EMA", value: `${fmt(last.close)} vs ${fmt(ema20)}`, pass: long ? last.close > ema20 : last.close < ema20 },
    { label: long ? "Price above VWAP" : "Price below VWAP", value: vwap == null ? "n/a" : `${fmt(last.close)} vs ${fmt(vwap)}`, pass: vwap == null ? null : long ? last.close > vwap : last.close < vwap },
    { label: long ? "RSI(14) above 60" : "RSI(14) below 40", value: rsi == null ? "n/a" : rsi.toFixed(1), pass: rsi == null ? null : long ? rsi > 60 : rsi < 40 },
    { label: long ? "Volume above 20-hour average" : "Volume expanding on the decline", value: `${fmt(last.volume)} vs ${fmt(avgVol)}`, pass: long ? last.volume > avgVol : last.volume > avgVol && last.close < prev.close },
    { label: long ? "Higher highs and higher lows" : "Lower highs and lower lows", value: hhhl ? "yes" : "no", pass: hhhl },
    { label: long ? "Market breadth positive (≥ 50% above 50 DMA)" : "Market breadth negative (< 50% above 50 DMA)", value: breadthPercent == null ? "n/a" : `${breadthPercent.toFixed(0)}%`, pass: breadthPercent == null ? null : long ? breadthPercent >= 50 : breadthPercent < 50 },
  ];
  const failed = checks.filter((x) => x.pass === false).length;
  const unmeasured = checks.filter((x) => x.pass === null).length;
  const breakoutConfirmed = long ? last.close > prev.high : last.close < prev.low;
  let proposal: HourlySetup["proposal"] = null;
  if (atr != null && failed === 0) {
    const entry = breakoutConfirmed ? last.close : long ? last.high : last.low;
    const recent = bars.slice(-6);
    const swing = long ? Math.min(...recent.map((b) => b.low)) : Math.max(...recent.map((b) => b.high));
    const riskPoints = Math.max(Math.abs(entry - swing), 1.5 * atr);
    proposal = { entryType: breakoutConfirmed ? "market" : "trigger", entry, stop: entry - dir * riskPoints, target: entry + dir * 2 * riskPoints, riskPoints };
  }
  return { dir, checks, failed, unmeasured, allPass: failed === 0 && unmeasured === 0, breakoutConfirmed, proposal };
}

export type AutoDecision = { action: "place" } | { action: "skip"; message: string };

/**
 * Whether auto-paper mode may place an order for one index on this hourly bar. Everything must hold: no open or pending
 * order on the index, no trading limit hit, the daily regime aligned, every hourly condition measured and passing,
 * and at least one lot that fits the 1% risk and the free margin.
 */
export function autoDecision(input: {
  hasActiveOrder: boolean;
  limitReason: string | null;
  setup: Pick<HourlySetup, "allPass"> | null;
  hasProposal: boolean;
  lots: number;
  verdict: string;
}): AutoDecision {
  if (input.hasActiveOrder) return { action: "skip", message: "An order for this index is already open or pending." };
  if (input.limitReason) return { action: "skip", message: input.limitReason };
  if (!input.setup?.allPass || !input.hasProposal) return { action: "skip", message: input.verdict };
  if (input.lots < 1) return { action: "skip", message: "All conditions pass, but not even one lot fits the 1% risk and the free margin." };
  return { action: "place" };
}
