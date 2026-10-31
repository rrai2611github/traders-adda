/**
 * Pure index-scalping logic for the Index Scalp Desk: 1-minute indicators, the
 * opening-range breakout (ORB) watch signal and option-chain helpers. No I/O,
 * so it is unit-tested and can be reused by a backtest.
 *
 * The signals are NOT validated yet. They are drawn as "setup" markers only
 * until a 1-minute backtest (after costs) shows an edge.
 */

export interface Bar {
  /** Bar open time, epoch ms. */
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ScalpIndex = "NIFTY" | "BANKNIFTY";
export type Side = "CE" | "PE";

export const SCALP_INDEXES: Record<ScalpIndex, {
  name: string;
  underlying: string;
  futPrefix: string;
  /** Default stop in index points for the plan shown with each setup. */
  stopPoints: number;
}> = {
  NIFTY: { name: "Nifty 50", underlying: "NSE:NIFTY50-INDEX", futPrefix: "NIFTY", stopPoints: 20 },
  BANKNIFTY: { name: "Bank Nifty", underlying: "NSE:NIFTYBANK-INDEX", futPrefix: "BANKNIFTY", stopPoints: 50 },
};

export const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** 09:15 IST as minutes after IST midnight. */
export const SESSION_OPEN_MIN = 9 * 60 + 15;

export const istDayKey = (t: number) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
export const istMinute = (t: number) => Math.floor(((t + IST_OFFSET_MS) % DAY_MS) / MINUTE_MS);
/** Epoch ms of 09:15 IST on the IST day containing `t`. */
export const sessionOpenAt = (t: number) =>
  Math.floor((t + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS + SESSION_OPEN_MIN * MINUTE_MS;

/** Bars of the latest IST trading day present in `bars`. */
export function latestSession(bars: Bar[]): Bar[] {
  if (!bars.length) return [];
  const day = istDayKey(bars[bars.length - 1].t);
  return bars.filter((bar) => istDayKey(bar.t) === day);
}

/** High, low and close of the IST day before the latest session. */
export function previousSession(bars: Bar[]): { high: number; low: number; close: number } | null {
  const today = latestSession(bars);
  if (!today.length) return null;
  const prev = latestSession(bars.filter((bar) => bar.t < today[0].t));
  if (!prev.length) return null;
  return {
    high: Math.max(...prev.map((b) => b.high)),
    low: Math.min(...prev.map((b) => b.low)),
    close: prev[prev.length - 1].close,
  };
}

/** Exponential moving average of closes; null until `period` bars exist. */
export function ema(bars: Bar[], period: number): Array<number | null> {
  const k = 2 / (period + 1);
  let value: number | null = null;
  let sum = 0;
  return bars.map((bar, i) => {
    if (i < period - 1) {
      sum += bar.close;
      return null;
    }
    value = value == null ? (sum + bar.close) / period : bar.close * k + value * (1 - k);
    return value;
  });
}

/**
 * Session VWAP (typical price × volume), reset each IST day. Null while the day
 * has no volume yet — index spot has no volume, so use futures or options.
 */
export function vwap(bars: Bar[]): Array<number | null> {
  let day = "";
  let pv = 0;
  let vol = 0;
  return bars.map((bar) => {
    const key = istDayKey(bar.t);
    if (key !== day) {
      day = key;
      pv = 0;
      vol = 0;
    }
    const v = Number.isFinite(bar.volume) && bar.volume > 0 ? bar.volume : 0;
    pv += ((bar.high + bar.low + bar.close) / 3) * v;
    vol += v;
    return vol > 0 ? pv / vol : null;
  });
}

export interface OpeningRange {
  high: number;
  low: number;
  /** Epoch ms when the range is complete (09:15 + minutes). */
  endsAt: number;
  complete: boolean;
}

/** High/low of the first `minutes` of the latest session. */
export function openingRange(bars: Bar[], minutes = 15, now = Date.now()): OpeningRange | null {
  const today = latestSession(bars);
  if (!today.length) return null;
  const endsAt = sessionOpenAt(today[0].t) + minutes * MINUTE_MS;
  const inRange = today.filter((bar) => bar.t < endsAt);
  if (!inRange.length) return null;
  return {
    high: Math.max(...inRange.map((b) => b.high)),
    low: Math.min(...inRange.map((b) => b.low)),
    endsAt,
    complete: today[today.length - 1].t >= endsAt || now >= endsAt,
  };
}

/** Value of an aligned series at time `t` (that bar, or the last bar before it). */
function valueAt(bars: Bar[], series: Array<number | null>, t: number): number | null {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? series[found] : null;
}

export interface ScalpSignal {
  t: number;
  side: Side;
  setup: "ORB";
  /** Spot close of the signal bar. */
  entry: number;
  stop: number;
  target: number;
  /** Exit if neither stop nor target is hit within this many minutes. */
  timeStopMin: number;
  /** Checks that passed (or were unavailable), for the setup list. */
  reasons: string[];
}

export interface SignalOptions {
  stopPoints: number;
  rewardRisk?: number;
  orbMinutes?: number;
  timeStopMin?: number;
  maxPerDay?: number;
  cooldownMin?: number;
  /** No new setups at or after this IST minute (default 15:00). */
  lastEntryMin?: number;
}

/**
 * Opening-range breakout setups on the latest session: the spot 1-min close
 * crosses the 15-min range, EMA 9 vs 21 agrees, futures are on the same side of
 * their VWAP and the option leg is above its own VWAP. Missing futures/option
 * data skips that check and says so in `reasons`.
 */
export function orbSignals(
  input: { spot: Bar[]; fut?: Bar[]; ce?: Bar[]; pe?: Bar[] },
  options: SignalOptions,
): ScalpSignal[] {
  const {
    stopPoints, rewardRisk = 1.5, orbMinutes = 15, timeStopMin = 10,
    maxPerDay = 3, cooldownMin = 15, lastEntryMin = 15 * 60,
  } = options;
  const spot = input.spot;
  const today = latestSession(spot);
  if (!today.length) return [];
  const orb = openingRange(spot, orbMinutes, today[today.length - 1].t);
  if (!orb) return [];
  const fast = ema(spot, 9);
  const slow = ema(spot, 21);
  const index = new Map(spot.map((bar, i) => [bar.t, i]));
  const fut = input.fut ?? [];
  const futVwap = vwap(fut);
  const futClose = fut.map((b) => b.close);
  const legs: Record<Side, Bar[]> = { CE: input.ce ?? [], PE: input.pe ?? [] };

  const signals: ScalpSignal[] = [];
  let lastAt = -Infinity;
  for (let j = 1; j < today.length && signals.length < maxPerDay; j++) {
    const bar = today[j];
    const prev = today[j - 1];
    if (bar.t < orb.endsAt || istMinute(bar.t) >= lastEntryMin) continue;
    if (bar.t - lastAt < cooldownMin * MINUTE_MS) continue;
    const side: Side | null = bar.close > orb.high && prev.close <= orb.high ? "CE"
      : bar.close < orb.low && prev.close >= orb.low ? "PE" : null;
    if (!side) continue;
    const i = index.get(bar.t)!;
    const f = fast[i];
    const s = slow[i];
    if (f == null || s == null || (side === "CE" ? f <= s : f >= s)) continue;
    const up = side === "CE";
    const reasons = [`1-min close ${up ? "above" : "below"} 15-min range`, `EMA 9 ${up ? ">" : "<"} EMA 21`];

    const fClose = fut.length ? valueAt(fut, futClose, bar.t) : null;
    const fVwap = fut.length ? valueAt(fut, futVwap, bar.t) : null;
    if (fClose == null || fVwap == null) reasons.push("futures VWAP n/a");
    else if (up ? fClose <= fVwap : fClose >= fVwap) continue;
    else reasons.push(`Futures ${up ? "above" : "below"} VWAP`);

    const leg = legs[side];
    const lClose = leg.length ? valueAt(leg, leg.map((b) => b.close), bar.t) : null;
    const lVwap = leg.length ? valueAt(leg, vwap(leg), bar.t) : null;
    if (lClose == null || lVwap == null) reasons.push(`${side} VWAP n/a`);
    else if (lClose <= lVwap) continue;
    else reasons.push(`${side} premium above its VWAP`);

    const dir = up ? 1 : -1;
    signals.push({
      t: bar.t, side, setup: "ORB", entry: bar.close,
      stop: bar.close - dir * stopPoints,
      target: bar.close + dir * stopPoints * rewardRisk,
      timeStopMin, reasons,
    });
    lastAt = bar.t;
  }
  return signals;
}

/* ---------- option chain helpers ---------- */

export interface ChainLeg {
  symbol: string;
  strike: number;
  type: Side;
  ltp: number;
  oi: number;
  oiChange: number;
  volume: number;
}

export interface ChainSummary {
  spot: number | null;
  strikes: number[];
  atm: number | null;
  legs: ChainLeg[];
  callOi: number;
  putOi: number;
  pcr: number | null;
  /** Strike with the most call OI (often read as resistance) and put OI (support). */
  maxCallOiStrike: number | null;
  maxPutOiStrike: number | null;
  expiries: { date: string; expiry: number; flag: string }[];
  vix: number | null;
}

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Parses the Fyers `options-chain-v3` `data` object. */
export function parseChain(data: unknown): ChainSummary {
  const d = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d.optionsChain) ? (d.optionsChain as Record<string, unknown>[]) : [];
  const spotRow = rows.find((r) => r.option_type !== "CE" && r.option_type !== "PE");
  const legs: ChainLeg[] = rows
    .filter((r) => r.option_type === "CE" || r.option_type === "PE")
    .map((r) => ({
      symbol: String(r.symbol ?? ""),
      strike: num(r.strike_price),
      type: r.option_type as Side,
      ltp: num(r.ltp),
      oi: num(r.oi),
      oiChange: num(r.oich),
      volume: num(r.volume),
    }))
    .filter((leg) => leg.symbol && leg.strike > 0);
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const spot = spotRow ? num(spotRow.ltp) || null : null;
  const atm = spot != null && strikes.length
    ? strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0])
    : null;
  const callOi = num(d.callOi) || legs.filter((l) => l.type === "CE").reduce((a, l) => a + l.oi, 0);
  const putOi = num(d.putOi) || legs.filter((l) => l.type === "PE").reduce((a, l) => a + l.oi, 0);
  const maxBy = (type: Side) => {
    const side = legs.filter((l) => l.type === type);
    return side.length ? side.reduce((a, b) => (b.oi > a.oi ? b : a)).strike : null;
  };
  const expiries = Array.isArray(d.expiryData)
    ? (d.expiryData as Record<string, unknown>[]).map((e) => ({ date: String(e.date ?? ""), expiry: num(e.expiry), flag: String(e.expiry_flag ?? "") }))
    : [];
  const vixData = d.indiavixData as Record<string, unknown> | undefined;
  return {
    spot, strikes, atm, legs, callOi, putOi,
    pcr: callOi > 0 ? putOi / callOi : null,
    maxCallOiStrike: maxBy("CE"),
    maxPutOiStrike: maxBy("PE"),
    expiries,
    vix: vixData?.ltp != null ? num(vixData.ltp) : null,
  };
}

/**
 * The leg to chart: ATM shifted by `offset` strikes out of the money for that
 * side (+1 = one strike OTM, −1 = one strike ITM).
 */
export function pickLeg(chain: ChainSummary, side: Side, offset = 0): ChainLeg | null {
  if (chain.atm == null) return null;
  const i = chain.strikes.indexOf(chain.atm);
  const shift = side === "CE" ? offset : -offset;
  const strike = chain.strikes[Math.min(chain.strikes.length - 1, Math.max(0, i + shift))];
  return chain.legs.find((l) => l.strike === strike && l.type === side) ?? null;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Current-month futures symbol, e.g. NSE:NIFTY26OCTFUT. Index futures expire with
 * the monthly options, so the first monthly ("M") expiry not yet passed gives the month.
 */
export function futuresSymbol(futPrefix: string, expiries: ChainSummary["expiries"], now = Date.now()): string | null {
  const monthly = expiries
    .filter((e) => e.flag === "M" && e.expiry > 0)
    .sort((a, b) => a.expiry - b.expiry)
    .find((e) => istDayKey(e.expiry * 1000) >= istDayKey(now));
  if (!monthly) return null;
  const [year, month] = istDayKey(monthly.expiry * 1000).split("-");
  return `NSE:${futPrefix}${year.slice(2)}${MONTHS[Number(month) - 1]}FUT`;
}

/** Parses Fyers `/data/history` candles `[epochSec, o, h, l, c, v]`. */
export function parseCandles(candles: unknown): Bar[] {
  if (!Array.isArray(candles)) return [];
  return candles
    .filter((c): c is unknown[] => Array.isArray(c) && c.length >= 5)
    .map((c) => ({ t: num(c[0]) * 1000, open: num(c[1]), high: num(c[2]), low: num(c[3]), close: num(c[4]), volume: num(c[5]) }))
    .filter((b) => b.t > 0 && b.high >= b.low && b.close > 0)
    .sort((a, b) => a.t - b.t);
}
