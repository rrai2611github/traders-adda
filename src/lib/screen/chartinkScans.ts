import type { Candle } from "@/lib/market/types";
import type { BuyCheckKey, BuyReadiness, ScannerPlan } from "./buyReady.ts";
import type { PaBrief, PriceActionRating } from "./priceActionRating.ts";
import type { HighBreakoutSection } from "./highBreakout.ts";
import type { DataHealth } from "../market/historyQuality.ts";
import { getActiveSession, istDateKey, type ActiveSession } from "../market/marketHours.ts";
import { ema, rsi } from "./oscillators.ts";
import { ARBM_DEFAULTS, arbmLongSignal } from "../chart/regressionBreakout.ts";

/**
 * Chartink screeners from @JayneshKasliwal's list, translated condition by
 * condition from each scan's published clause. "latest" is the last completed
 * daily candle, "1 day ago" the one before it.
 */
export type ScannerKey =
  | "swing" | "range" | "nr7" | "fall4" | "up3" | "ema21" | "inside" | "rsidiv"
  | "high52" | "pullback20" | "leader" | "ath" | "pocket" | "arbm";
export type ScannerMode = "completed" | "live";

export type ScannerValue = number | boolean | null;

export interface ScannerHit {
  symbol: string;
  candleTimestamp: number;
  close: number;
  changePercent: number;
  volume: number;
  /** Scanner-specific measures, keyed as in SCANNERS[key].columns. */
  values: Record<string, ScannerValue>;
}

export interface ScannerRow extends ScannerHit {
  name: string;
  sector?: string;
  /** Live price where the feed has one, otherwise the last close. */
  price: number;
  livePercent: number | null;
  rs: number | null;
  turnoverCr: number | null;
  passesFloor: boolean;
  /** 3-day average oscillator score out of 15. */
  score: number | null;
  /** Price Action Rating on the scanned candles; absent from older cached payloads. */
  paRating?: PriceActionRating | null;
  readiness: BuyReadiness;
}

export interface ScannerPayload extends DataHealth {
  mode: ScannerMode;
  /** True when today's incomplete quote-built candle participates in the scan. */
  provisional: boolean;
  updatedAt: number;
  sessionDateKey: string;
  candleTimestamp: number | null;
  scanned: number;
  breadth: { percent: number | null; above: number; covered: number };
  results: Record<ScannerKey, ScannerRow[]>;
  /** Best RPCI-approximation and Oscillator buy-watch set-ups, for the daily alert. */
  extras?: { rpci: ExtraSection; oscillator: ExtraSection };
  /** 52-week-high breakout screen (pre-open email); absent from older caches. */
  highBreakouts?: HighBreakoutSection;
}

export interface ExtraPick {
  symbol: string;
  name: string;
  close: number;
  changePercent: number | null;
  rs: number | null;
  score: number | null;
  /** Price Action rating, display only. Missing in caches built before it was added. */
  pa?: PaBrief | null;
  /** Short set-up description, e.g. "Testing pivot · range contracted to 0.52×". */
  note: string;
  plan: ScannerPlan;
  /** Buy-ready checks this pick fails, breadth excluded; empty means it passes them all. */
  failed: BuyCheckKey[];
}

export interface ExtraSection {
  /** Every stock the screen found today. */
  total: number;
  /** Best first; a few only. */
  top: ExtraPick[];
}

export interface ScannerDef {
  key: ScannerKey;
  title: string;
  menuLabel: string;
  icon: string;
  blurb: string;
  /** Null for the Scanner Pro-style scans, which are our own formulas with no Chartink page. */
  chartinkSlug: string | null;
  /** The published Chartink clause verbatim, or our own formula when there is no Chartink source. */
  clause: string;
  /** Plain-language version of the clause. */
  rules: string[];
  /** Caveats where we cannot run the clause exactly as Chartink does. */
  notes: string[];
}

const IST = 5.5 * 3600e3;
const DAY = 86400e3;

/** Thresholds of the Scanner Pro-style scans (high52, pullback20, leader, ath, pocket). */
export const MVP_SCAN_RULES = {
  high52Sessions: 252,
  high52VolumeRatio: 1.5,
  pullbackTouchPercent: 1.5,
  pullbackLiftPercent: 3,
  leaderMinRs: 90,
  athMinSessions: 500,
  athRsi: [60, 75] as const,
  pocketLookback: 10,
  pocketMaxAboveSma10: 5,
} as const;

export const SCANNERS: Record<ScannerKey, ScannerDef> = {
  swing: {
    key: "swing",
    title: "Swing Trading SPECIAL (Fundamental + Technical)",
    menuLabel: "Swing Trading SPECIAL",
    icon: "★",
    blurb: "Growing EPS, quality returns, near the 52-week high and above the 50 EMA.",
    chartinkSlug: "swing-trading-sceener-by-techno-charts",
    clause:
      "quarterly eps >= 1 quarter ago eps and 1 quarter ago eps >= 2 quarter ago eps and 2 quarter ago eps >= 3 quarter ago eps and market cap > 2000 and latest close >= latest max( 252 , latest high ) * .80 and latest close > latest ema( latest close , 50 ) and latest volume > 100000 and yearly ROCE % > 20 and yearly RONW % >= 20",
    rules: [
      "Close within 20% of the 252-session high",
      "Close above the 50-day EMA",
      "Volume above 1,00,000 shares",
      "Market cap above ₹2,000 cr (checked only where we have it)",
      "EPS rising 3 quarters in a row, ROCE > 20%, ROE ≥ 20% — not checked",
    ],
    notes: [
      "We have no quarterly EPS, ROE or ROCE data, so only the technical conditions run here. Verify the fundamentals on Screener.in before acting.",
      "Chartink's description says \"within 15% of the 52-week high\" but its clause uses 80% of the high (within 20%); we follow the clause.",
    ],
  },
  range: {
    key: "range",
    title: "Range Breakout with Volume",
    menuLabel: "Range Breakout",
    icon: "⇪",
    blurb: "Widest range of 5 days, green candle, above the week's and month's open.",
    chartinkSlug: "range-break-out-with-volume-1000117",
    clause:
      "abs( latest high - latest low ) > abs( N day ago high - N day ago low ) for N = 1..4 and latest close > latest open and latest close > weekly open and latest close > monthly open and latest volume * latest close >= 10000000 and latest low > 1 day ago close - abs( 1 day ago close / 222 )",
    rules: [
      "Today's high–low range is bigger than each of the previous 4 days",
      "Green candle: close above open",
      "Close above this week's open and this month's open",
      "Traded value (volume × close) at least ₹1 cr",
      "Low no more than 0.45% below yesterday's close (no gap-down or deep dip)",
    ],
    notes: [],
  },
  nr7: {
    key: "nr7",
    title: "NR7 · Narrow Range 7",
    menuLabel: "NR7 Narrow Range",
    icon: "⇔",
    blurb: "Yesterday was the narrowest day of 7, inside a rising trend.",
    chartinkSlug: "copy-narrow-range-7-nr7-2415",
    clause:
      "1 day ago high - 1 day ago low < N days ago high - N days ago low for N = 2..7 and latest sma( close,10 ) > latest sma( close,50 ) and latest sma( close,50 ) > latest sma( close,200 ) and latest volume > 50000",
    rules: [
      "Yesterday's range is smaller than each of the 6 days before it (NR7 day)",
      "Trend stack: 10-day SMA > 50-day SMA > 200-day SMA",
      "Volume above 50,000 shares",
      "Trade idea: buy above the NR7 day's high, stop below its low",
    ],
    notes: ["Chartink runs this on a stock segment we cannot see; we run it on the whole NSE list."],
  },
  fall4: {
    key: "fall4",
    title: "4 Days Fall then Reversal Candle",
    menuLabel: "4-Day Fall & Reversal",
    icon: "↺",
    blurb: "Four lower highs and lower lows, then a higher high — above the 200 EMA.",
    chartinkSlug: "4-days-fall-then-reversal-candle",
    clause:
      "latest high > 1 day ago high and latest close > 1 day ago low and (N day ago high < N+1 days ago high and N day ago low < N+1 days ago low for N = 1..4) and latest close > latest ema( latest close , 200 )",
    rules: [
      "4 straight sessions of lower highs and lower lows",
      "Today makes a higher high than yesterday",
      "Close above yesterday's low",
      "Close above the 200-day EMA (a dip in a long-term uptrend)",
    ],
    notes: ["Chartink runs this on a stock segment we cannot see; we run it on the whole NSE list."],
  },
  up3: {
    key: "up3",
    title: "Closing 3% Up for 3 Days",
    menuLabel: "Up 3% × 3 Days",
    icon: "⇈",
    blurb: "Three sessions in a row, each closing at least 3% higher.",
    chartinkSlug: "copy-closing-3-up-since-3-days-1111112040",
    clause: "latest min( 3 , ( latest close - 1 day ago close ) / latest close ) >= 0.03 and latest volume > 10000",
    rules: [
      "Each of the last 3 sessions rose at least 3% (Chartink divides by that day's close)",
      "Volume above 10,000 shares",
    ],
    notes: ["Strong momentum, but often extended — check the distance from the 21 EMA before buying."],
  },
  ema21: {
    key: "ema21",
    title: "Close above 21 EMA (fresh cross)",
    menuLabel: "Close above 21 EMA",
    icon: "⤴",
    blurb: "Closed above the 21-day EMA today after closing at or below it yesterday.",
    chartinkSlug: "close-above-21ema-2",
    clause: "latest close > latest ema( latest close , 21 ) and 1 day ago close <= 1 day ago ema( latest close , 21 )",
    rules: ["Today's close above the 21-day EMA", "Yesterday's close at or below its 21-day EMA"],
    notes: ["Chartink runs this on a stock segment we cannot see; we run it on the whole NSE list."],
  },
  inside: {
    key: "inside",
    title: "Inside Bar (Chartink definition)",
    menuLabel: "Inside Bar",
    icon: "▣",
    blurb: "Opened above yesterday's open and closed below yesterday's close.",
    chartinkSlug: "inside-bar-606464",
    clause: "latest open > 1 day ago open and latest close < 1 day ago close",
    rules: ["Today's open above yesterday's open", "Today's close below yesterday's close"],
    notes: [
      "This is the scan's own definition, not the textbook inside bar (high below yesterday's high and low above yesterday's low). The \"True inside bar\" column shows which hits are textbook ones.",
      "Chartink runs this on a stock segment we cannot see; we run it on the whole NSE list.",
    ],
  },
  rsidiv: {
    key: "rsidiv",
    title: "RSI Divergence (RSI up, highs down)",
    menuLabel: "RSI Divergence",
    icon: "≠",
    blurb: "RSI rising for 2 sessions while each day's high is lower.",
    chartinkSlug: "bullish-rsi-divergence-110",
    clause:
      "latest rsi( 14 ) > 1 day ago rsi( 14 ) and 1 day ago rsi( 14 ) > 2 days ago rsi( 14 ) and latest high < 1 day ago high and 1 day ago high < 2 days ago high",
    rules: ["RSI(14) higher than yesterday, and yesterday higher than the day before", "Today's high below yesterday's, and yesterday's below the day before"],
    notes: [
      "The tweet calls it \"Bearish RSI Divergence\" and the Chartink page says \"most bullish\"; the clause itself is RSI rising while highs fall, which traders usually read as bullish (momentum improving before price).",
    ],
  },
  high52: {
    key: "high52",
    title: "Fresh 52-Week High on Volume",
    menuLabel: "Fresh 52W High",
    icon: "▲",
    blurb: "Closed above the prior 52-week high on at least 1.5× average volume.",
    chartinkSlug: null,
    clause:
      `latest close > max( ${MVP_SCAN_RULES.high52Sessions} , 1 day ago high ) and latest volume > ${MVP_SCAN_RULES.high52VolumeRatio} * 1 day ago sma( volume , 50 )`,
    rules: [
      "Close above the highest high of the previous 252 sessions (a closing breakout, not an intraday poke)",
      `Volume at least ${MVP_SCAN_RULES.high52VolumeRatio}× the 50-day average`,
    ],
    notes: ["Scanner Pro-style scan (\"Fresh 52W High\"); the formula is ours and runs on completed daily candles."],
  },
  pullback20: {
    key: "pullback20",
    title: "Trend Pullback to a Rising 20 EMA",
    menuLabel: "Trend Pullback",
    icon: "↘",
    blurb: "A stage-2 stock dipped to its rising 20 EMA and held it.",
    chartinkSlug: null,
    clause:
      `latest close > sma( close , 50 ) > sma( close , 200 ) and sma( close , 200 ) > 20 days ago sma( close , 200 ) and ema( close , 20 ) > 5 days ago ema( close , 20 ) and latest low <= ema( close , 20 ) * ${1 + MVP_SCAN_RULES.pullbackTouchPercent / 100} and latest close >= ema( close , 20 ) and max( 10 , 1 day ago close ) >= 1 day ago ema( close , 20 ) * ${1 + MVP_SCAN_RULES.pullbackLiftPercent / 100}`,
    rules: [
      "Stage-2 uptrend: close above the 50-day SMA, 50-day above the 200-day, 200-day rising over 20 sessions",
      "20 EMA rising over the last 5 sessions",
      `Today's low came within ${MVP_SCAN_RULES.pullbackTouchPercent}% of the 20 EMA and the close held above it`,
      `It was at least ${MVP_SCAN_RULES.pullbackLiftPercent}% above the 20 EMA in the prior 10 sessions (a real pullback, not a flat drift)`,
    ],
    notes: ["Scanner Pro-style scan (\"Trend Pullback\"); the formula is ours. Trade idea: buy above today's high, stop below today's low."],
  },
  leader: {
    key: "leader",
    title: "Relative Leader (RS line at a 52-week high)",
    menuLabel: "Relative Leader",
    icon: "♛",
    blurb: "Price relative to the Nifty 50 at a new 52-week high, with an RS rating in the top 10%.",
    chartinkSlug: null,
    clause:
      `latest close / nifty close > max( ${MVP_SCAN_RULES.high52Sessions} , 1 day ago close / nifty close ) and rs rating >= ${MVP_SCAN_RULES.leaderMinRs} and latest close > sma( close , 50 )`,
    rules: [
      "RS line (close ÷ Nifty 50 close) above its highest level of the previous 252 sessions",
      `RS rating ${MVP_SCAN_RULES.leaderMinRs} or higher (top 10% of the market)`,
      "Close above the 50-day SMA",
    ],
    notes: [
      "Scanner Pro-style scan (\"Relative Leader\"). Scanner Pro also requires a top-3 rank in the sector; most NSE stocks have no sector in our data, so an RS rating of 90+ stands in for it.",
      "Needs the Nifty 50 history; the scan is empty while that feed is unavailable.",
    ],
  },
  ath: {
    key: "ath",
    title: "All-Time High (3-year data window)",
    menuLabel: "All-Time High",
    icon: "⛰",
    blurb: "Closed at the highest price in all the history we hold, with RSI 60–75 (strong, not overheated).",
    chartinkSlug: null,
    clause:
      `latest close > max( all , 1 day ago high ) and rsi( 14 ) between ${MVP_SCAN_RULES.athRsi[0]} and ${MVP_SCAN_RULES.athRsi[1]} and history >= ${MVP_SCAN_RULES.athMinSessions} sessions`,
    rules: [
      "Close above every earlier high in the stock's history (up to 3 years)",
      `RSI(14) between ${MVP_SCAN_RULES.athRsi[0]} and ${MVP_SCAN_RULES.athRsi[1]}`,
      `At least ${MVP_SCAN_RULES.athMinSessions} sessions of history, so a recent listing cannot qualify`,
    ],
    notes: [
      "Our daily history goes back about 3 years, so this is the highest price in 3 years. A stock that peaked before that would also show here; check a long-term chart before calling it a true all-time high.",
    ],
  },
  pocket: {
    key: "pocket",
    title: "Pocket Pivot",
    menuLabel: "Pocket Pivot",
    icon: "◆",
    blurb: "An up day whose volume beats every down day of the last 10 sessions, close to the 10-day average.",
    chartinkSlug: null,
    clause:
      `latest close > 1 day ago close and latest volume > max volume of down days in last ${MVP_SCAN_RULES.pocketLookback} sessions and latest close >= sma( close , 10 ) and latest close <= sma( close , 10 ) * ${1 + MVP_SCAN_RULES.pocketMaxAboveSma10 / 100} and sma( close , 50 ) > sma( close , 200 ) and latest close > sma( close , 50 )`,
    rules: [
      "Up day: close above yesterday's close",
      `Volume above the biggest down-day volume of the previous ${MVP_SCAN_RULES.pocketLookback} sessions`,
      `Close at or above the 10-day SMA and no more than ${MVP_SCAN_RULES.pocketMaxAboveSma10}% above it (an early entry, not a chase)`,
      "Uptrend: close above the 50-day SMA and the 50-day above the 200-day",
    ],
    notes: ["Scanner Pro-style scan (\"Pocket Pivot\", from the Pro Strategies set), after Kacher and Morales; the formula is ours."],
  },
  arbm: {
    key: "arbm",
    title: "Regression Breakout (GainzAlgo ARBM)",
    menuLabel: "Regression Breakout",
    icon: "⇡",
    blurb: "Closed above a 50-day regression channel right after the channel was at its narrowest.",
    chartinkSlug: null,
    clause:
      `latest close > linreg( close , ${ARBM_DEFAULTS.length} ) + ${ARBM_DEFAULTS.devMult} * stdev( close , ${ARBM_DEFAULTS.length} ) and 1 day ago close <= 1 day ago upper band and 1 day ago bandwidth in the lowest ${ARBM_DEFAULTS.sqzPct}% of its ${ARBM_DEFAULTS.sqzLen}-session range`,
    rules: [
      `Channel: ${ARBM_DEFAULTS.length}-session linear regression of the close ± ${ARBM_DEFAULTS.devMult} standard deviations`,
      `Squeeze: yesterday the channel width was in the narrowest ${ARBM_DEFAULTS.sqzPct}% of its last ${ARBM_DEFAULTS.sqzLen} sessions`,
      "Today's close crossed above the upper band (yesterday's close was at or below it)",
      `Indicator's own map: stop at yesterday's lower band, TP1/TP2/TP3 at ${ARBM_DEFAULTS.tp.join("/")}× yesterday's channel width; TP1 moves the stop to entry, TP2 moves it to TP1`,
    ],
    notes: [
      "Port of GainzAlgo's open-source \"Adaptive Regression Breakout Map\" (TradingView), long side only; short signals show on the chart overlay.",
      "Our walk-forward test (2022–2026, 0.25% costs) lost −0.09R a trade as published and −0.05R with breadth ≥ 50%. The indicator's stop is often 15%+ away, so the Buy-ready plan uses our own swing stop instead.",
    ],
  },
};

export const SCANNER_KEYS = Object.keys(SCANNERS) as ScannerKey[];

/** Trade Trigger navigation, grouped by category the way Scanner Pro groups its scans. */
export const SCANNER_NAV_GROUPS: {
  label: string;
  description: string;
  keys: ScannerKey[];
}[] = [
  {
    label: "MVP picks",
    description: "Leadership, fresh highs and trend pullbacks",
    keys: ["high52", "pullback20", "leader"],
  },
  {
    label: "Breakout",
    description: "Range, contraction and all-time-high breakouts",
    keys: ["range", "nr7", "ath"],
  },
  {
    label: "Pro strategies",
    description: "Named institutional playbooks",
    keys: ["pocket"],
  },
  {
    label: "Reversal",
    description: "Confirmed pullback reversals",
    keys: ["fall4"],
  },
  {
    label: "Experimental",
    description: "Requires price confirmation",
    keys: ["rsidiv", "arbm"],
  },
];

export const VISIBLE_SCANNER_KEYS = SCANNER_NAV_GROUPS.flatMap((group) => group.keys);
/**
 * Curated for Today's Picks / the daily alert. Chosen by each scanner's own
 * disclosed backtest (`scannerBacktest.json`, ready/targets/all), not by feel:
 * range (avgR -0.18) and nr7 (-0.06) were dropped for leader (+0.42, 55.6% win)
 * and ath (+0.13, 45.2% win) — every source here has a positive average R.
 */
export const ALERT_SCANNER_KEYS: ScannerKey[] = ["leader", "fall4", "ath"];

const range = (c: Candle) => c.high - c.low;
const sma = (closes: number[], end: number, n: number) => {
  if (end + 1 < n) return null;
  let s = 0;
  for (let k = end - n + 1; k <= end; k++) s += closes[k];
  return s / n;
};
const pct = (a: number, b: number) => (b ? (a / b - 1) * 100 : null);
const round = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const istParts = (t: number) => {
  const d = new Date(t + IST);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), dayNo: Math.floor((t + IST) / DAY), dow: (d.getUTCDay() + 6) % 7 };
};

/** Benchmark (Nifty 50) closes keyed by IST day number, for the Relative Leader RS line. */
export type BenchmarkCloses = ReadonlyMap<number, number>;

export function benchmarkCloses(candles: ReadonlyArray<Candle> | null | undefined): BenchmarkCloses | null {
  if (!candles?.length) return null;
  const map = new Map<number, number>();
  for (const k of candles) if (k.close > 0) map.set(istParts(k.t).dayNo, k.close);
  return map;
}

export interface ScannerMeta {
  marketCapCr?: number | null;
  /** RS rating (1–99) on the scanned candle; Relative Leader needs it. */
  rs?: number | null;
  benchmark?: BenchmarkCloses | null;
}

/** Every scanner the stock passes on its last completed candle. */
export function runScanners(
  symbol: string,
  candles: Candle[],
  meta: ScannerMeta = {},
  session: Pick<ActiveSession, "dateKey" | "progress"> = getActiveSession(),
): Partial<Record<ScannerKey, ScannerHit>> {
  const c = candles.filter((k) => {
    const day = istDateKey(k.t);
    return day < session.dateKey || (day === session.dateKey && session.progress === 1);
  });
  const out: Partial<Record<ScannerKey, ScannerHit>> = {};
  const i = c.length - 1;
  if (i < 8) return out;
  const L = c[i];
  const P = c[i - 1];
  const closes = c.map((k) => k.close);
  const hit = (key: ScannerKey, values: Record<string, ScannerValue>) => {
    out[key] = {
      symbol,
      candleTimestamp: L.t,
      close: L.close,
      changePercent: round(pct(L.close, P.close)) ?? 0,
      volume: L.volume,
      values,
    };
  };

  // Swing Trading SPECIAL: technical half only.
  if (c.length >= 50) {
    const e50 = ema(closes, 50)[i];
    const high252 = Math.max(...c.slice(-252).map((k) => k.high));
    const mcap = meta.marketCapCr ?? null;
    if (e50 != null && L.close >= high252 * 0.8 && L.close > e50 && L.volume > 100000 && (mcap == null || mcap > 2000)) {
      hit("swing", {
        fromHigh: round(pct(L.close, high252)),
        vsEma50: round(pct(L.close, e50)),
        marketCapCr: mcap,
        fundamentalsChecked: false,
      });
    }
  }

  // Range breakout with volume.
  {
    const r = range(L);
    const priorRanges = [1, 2, 3, 4].map((n) => range(c[i - n]));
    const now = istParts(L.t);
    let w = i;
    while (w > 0 && istParts(c[w - 1].t).dayNo >= now.dayNo - now.dow) w--;
    let m = i;
    while (m > 0) {
      const p = istParts(c[m - 1].t);
      if (p.y !== now.y || p.m !== now.m) break;
      m--;
    }
    const weeklyOpen = c[w].open;
    const monthlyOpen = c[m].open;
    const valueCr = (L.volume * L.close) / 1e7;
    if (priorRanges.every((x) => r > x) && L.close > L.open && L.close > weeklyOpen && L.close > monthlyOpen &&
        L.volume * L.close >= 10_000_000 && L.low > P.close - Math.abs(P.close / 222)) {
      const avgPrior = priorRanges.reduce((a, b) => a + b, 0) / 4;
      hit("range", {
        rangePercent: round((r / P.close) * 100),
        rangeVsPrior: round(avgPrior ? r / avgPrior : null),
        vsWeeklyOpen: round(pct(L.close, weeklyOpen)),
        vsMonthlyOpen: round(pct(L.close, monthlyOpen)),
        tradedCr: round(valueCr),
        closeInRange: round(r ? ((L.close - L.low) / r) * 100 : null, 0),
      });
    }
  }

  // NR7 on the previous session.
  if (c.length >= 200) {
    const nr = range(P);
    const s10 = sma(closes, i, 10);
    const s50 = sma(closes, i, 50);
    const s200 = sma(closes, i, 200);
    if ([2, 3, 4, 5, 6, 7].every((n) => nr < range(c[i - n])) && s10 != null && s50 != null && s200 != null &&
        s10 > s50 && s50 > s200 && L.volume > 50000) {
      const avg7 = [1, 2, 3, 4, 5, 6, 7].reduce((a, n) => a + range(c[i - n]), 0) / 7;
      hit("nr7", {
        nr7Date: P.t,
        nr7High: round(P.high),
        nr7Low: round(P.low),
        nr7RangePercent: round((nr / P.close) * 100),
        nr7VsAvg: round(avg7 ? nr / avg7 : null),
        brokeHigh: L.close > P.high,
        brokeLow: L.close < P.low,
        vsSma50: round(pct(L.close, s50)),
      });
    }
  }

  // 4 days fall then reversal.
  if (c.length >= 200 && i >= 5) {
    const e200 = ema(closes, 200)[i];
    const falling = [1, 2, 3, 4].every((n) => c[i - n].high < c[i - n - 1].high && c[i - n].low < c[i - n - 1].low);
    if (falling && L.high > P.high && L.close > P.low && e200 != null && L.close > e200) {
      hit("fall4", {
        fallPercent: round(pct(P.low, c[i - 5].high)),
        reversalHigh: round(L.high),
        pullbackLow: round(P.low),
        vsEma200: round(pct(L.close, e200)),
      });
    }
  }

  // Up at least 3% on each of the last 3 sessions.
  {
    const gains = [0, 1, 2].map((n) => (c[i - n].close - c[i - n - 1].close) / c[i - n].close);
    if (gains.every((g) => g >= 0.03) && L.volume > 10000) {
      const e21 = ema(closes, 21)[i];
      hit("up3", {
        day1: round(pct(c[i - 2].close, c[i - 3].close)),
        day2: round(pct(c[i - 1].close, c[i - 2].close)),
        day3: round(pct(L.close, P.close)),
        gain3d: round(pct(L.close, c[i - 3].close)),
        vsEma21: e21 == null ? null : round(pct(L.close, e21)),
      });
    }
  }

  // Fresh close above the 21 EMA.
  if (c.length >= 22) {
    const e = ema(closes, 21);
    if (e[i] != null && e[i - 1] != null && L.close > e[i]! && P.close <= e[i - 1]!) {
      hit("ema21", {
        ema21: round(e[i]),
        vsEma21: round(pct(L.close, e[i]!)),
        emaRising: e[i]! > e[i - 1]!,
        vsSma200: round(pct(L.close, sma(closes, i, 200) ?? NaN)),
      });
    }
  }

  // Chartink's inside bar.
  if (L.open > P.open && L.close < P.close) {
    hit("inside", {
      trueInside: L.high < P.high && L.low > P.low,
      motherHigh: round(P.high),
      motherLow: round(P.low),
      rangeVsMother: round(range(P) ? range(L) / range(P) : null),
    });
  }

  // RSI rising while highs fall.
  if (c.length >= 30) {
    const r = rsi(closes, 14);
    if (r[i] != null && r[i - 1] != null && r[i - 2] != null && r[i]! > r[i - 1]! && r[i - 1]! > r[i - 2]! &&
        L.high < P.high && P.high < c[i - 2].high) {
      hit("rsidiv", {
        rsi: round(r[i], 1),
        rsiChange2d: round(r[i]! - r[i - 2]!, 1),
        highChange2d: round(pct(L.high, c[i - 2].high)),
      });
    }
  }

  const M = MVP_SCAN_RULES;
  const closeInRange = range(L) ? round(((L.close - L.low) / range(L)) * 100, 0) : null;
  const avgVolume50 = i >= 50 ? c.slice(i - 50, i).reduce((a, k) => a + k.volume, 0) / 50 : null;
  const s50 = sma(closes, i, 50);
  const s200 = sma(closes, i, 200);

  // Fresh 52-week closing high on volume.
  if (i >= M.high52Sessions && avgVolume50) {
    let priorHigh = -Infinity;
    for (let k = i - M.high52Sessions; k < i; k++) priorHigh = Math.max(priorHigh, c[k].high);
    const volumeRatio = L.volume / avgVolume50;
    if (L.close > priorHigh && volumeRatio >= M.high52VolumeRatio) {
      hit("high52", {
        priorHigh: round(priorHigh),
        vsPriorHigh: round(pct(L.close, priorHigh)),
        volumeRatio: round(volumeRatio),
        closeInRange,
        vsSma50: round(pct(L.close, s50 ?? NaN)),
      });
    }
  }

  // Pullback to a rising 20 EMA inside a stage-2 uptrend.
  if (s50 != null && s200 != null && i >= 220) {
    const e20 = ema(closes, 20);
    const s200Before = sma(closes, i - 20, 200);
    const now = e20[i];
    const before = e20[i - 5];
    let lifted = false;
    for (let k = i - 10; k < i; k++) {
      if (e20[k] != null && c[k].close >= e20[k]! * (1 + M.pullbackLiftPercent / 100)) lifted = true;
    }
    if (now != null && before != null && s200Before != null && L.close > s50 && s50 > s200 && s200 > s200Before &&
        now > before && L.low <= now * (1 + M.pullbackTouchPercent / 100) && L.close >= now && lifted) {
      const high10 = Math.max(...c.slice(i - 10, i).map((k) => k.high));
      hit("pullback20", {
        ema20: round(now),
        vsEma20: round(pct(L.close, now)),
        offRecentHigh: round(pct(L.close, high10)),
        dayHigh: round(L.high),
        dayLow: round(L.low),
        closeInRange,
      });
    }
  }

  // RS line (close ÷ Nifty 50) at a 52-week high, RS rating in the top 10%.
  if (meta.benchmark && meta.rs != null && meta.rs >= M.leaderMinRs && s50 != null && L.close > s50 && i >= M.high52Sessions) {
    const bench = meta.benchmark;
    const ratioAt = (k: number) => {
      const b = bench.get(istParts(c[k].t).dayNo);
      return b ? c[k].close / b : null;
    };
    const today = ratioAt(i);
    let priorMax = -Infinity;
    let known = 0;
    for (let k = i - M.high52Sessions; k < i; k++) {
      const r = ratioAt(k);
      if (r == null) continue;
      known++;
      priorMax = Math.max(priorMax, r);
    }
    if (today != null && known >= 200 && today > priorMax) {
      const high252 = Math.max(...c.slice(i - M.high52Sessions, i + 1).map((k) => k.high));
      hit("leader", {
        rsLineVsHigh: round(pct(today, priorMax)),
        rsRating: meta.rs,
        vsSma50: round(pct(L.close, s50)),
        fromHigh: round(pct(L.close, high252)),
      });
    }
  }

  // Highest close of all the history we hold, RSI strong but not overheated.
  if (c.length >= M.athMinSessions) {
    let priorHigh = -Infinity;
    for (let k = 0; k < i; k++) priorHigh = Math.max(priorHigh, c[k].high);
    if (L.close > priorHigh) {
      const r = rsi(closes, 14)[i];
      if (r != null && r >= M.athRsi[0] && r <= M.athRsi[1]) {
        hit("ath", {
          priorHigh: round(priorHigh),
          vsPriorHigh: round(pct(L.close, priorHigh)),
          rsi: round(r, 1),
          historyYears: round(c.length / 250, 1),
          closeInRange,
        });
      }
    }
  }

  // Pocket pivot: up-day volume beats every down day of the last 10 sessions.
  if (s50 != null && s200 != null && i > M.pocketLookback) {
    const s10 = sma(closes, i, 10)!;
    let maxDown = 0;
    for (let k = i - M.pocketLookback; k < i; k++) if (c[k].close < c[k - 1].close) maxDown = Math.max(maxDown, c[k].volume);
    if (maxDown > 0 && L.close > P.close && L.volume > maxDown && L.close >= s10 &&
        L.close <= s10 * (1 + M.pocketMaxAboveSma10 / 100) && L.close > s50 && s50 > s200) {
      hit("pocket", {
        volumeVsDown: round(L.volume / maxDown),
        vsSma10: round(pct(L.close, s10)),
        vsSma50: round(pct(L.close, s50)),
        closeInRange,
      });
    }
  }

  // GainzAlgo ARBM: close breaks above the regression channel right after a squeeze.
  {
    const a = arbmLongSignal(c);
    if (a) {
      hit("arbm", {
        upperBand: round(a.upper),
        bandStop: round(a.stop),
        bandStopPercent: round(a.stopPercent),
        tp1: round(a.targets[0]),
        tp2: round(a.targets[1]),
        tp3: round(a.targets[2]),
        squeezeRank: round(a.squeezeWidthPct, 0),
        closeInRange,
      });
    }
  }

  return out;
}
