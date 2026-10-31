/**
 * Index setups compared in the scalping backtest. Each detector sees one
 * session (previous day + today's 1-minute index bars, today's futures) and
 * returns the bars whose close triggers a trade. Rules and numbers were fixed
 * before the first run and are not tuned to the results.
 */
import type { DayContext } from "./backtest.ts";
import { SCALP_INDEXES, ema, istDayKey, istMinute, orbSignals, previousSession, vwap, type Bar, type ScalpIndex, type Side } from "./scalpLogic.ts";

export type SetupKey = "ORB" | "VWAP_PULLBACK" | "PDH_PDL" | "TREND_5M";

export interface SetupSignal {
  t: number;
  side: Side;
}

interface Gate {
  firstMin: number;
  lastMin: number;
  maxPerDay: number;
  cooldownMin: number;
}

const at = (h: number, m: number) => h * 60 + m;

/** Applies the entry window, daily cap and cooldown to raw candidates (time order). */
function gate(candidates: SetupSignal[], g: Gate): SetupSignal[] {
  const out: SetupSignal[] = [];
  let last = -Infinity;
  for (const c of candidates) {
    const minute = istMinute(c.t);
    if (minute < g.firstMin || minute >= g.lastMin) continue;
    if (c.t - last < g.cooldownMin * 60_000) continue;
    out.push(c);
    last = c.t;
    if (out.length >= g.maxPerDay) break;
  }
  return out;
}

function today(ctx: DayContext): { bars: Bar[]; offset: number } {
  if (!ctx.spot.length) return { bars: [], offset: 0 };
  const day = istDayKey(ctx.spot[ctx.spot.length - 1].t);
  const offset = ctx.spot.findIndex((b) => istDayKey(b.t) === day);
  return { bars: ctx.spot.slice(offset), offset };
}

/** Futures bar and session VWAP at or just before `t`. */
function futuresAt(fut: Bar[]): (t: number) => { bar: Bar; vwap: number } | null {
  const v = vwap(fut);
  return (t) => {
    let lo = 0, hi = fut.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fut[mid].t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const value = found >= 0 ? v[found] : null;
    return found >= 0 && value != null ? { bar: fut[found], vwap: value } : null;
  };
}

/**
 * VWAP pullback: futures have held one side of their VWAP for most of the last
 * 20 minutes and the 21-EMA slopes that way; a futures bar dips back to VWAP
 * (within 0.03%) but closes on the trend side, and the spot bar closes in the
 * trend direction.
 */
export function vwapPullbackSignals(ctx: DayContext): SetupSignal[] {
  const { bars, offset } = today(ctx);
  if (!bars.length || !ctx.fut.length) return [];
  const slow = ema(ctx.spot, 21);
  const futAt = futuresAt(ctx.fut);
  const candidates: SetupSignal[] = [];
  for (let j = 20; j < bars.length; j++) {
    const bar = bars[j];
    const f = futAt(bar.t);
    const e = slow[offset + j];
    const ePrev = slow[offset + j - 10];
    if (!f || e == null || ePrev == null) continue;
    let above = 0, below = 0;
    for (let k = j - 20; k < j; k++) {
      const p = futAt(bars[k].t);
      if (!p) continue;
      if (p.bar.close > p.vwap) above++;
      else if (p.bar.close < p.vwap) below++;
    }
    const band = f.vwap * 0.0003;
    if (above >= 18 && e > ePrev && f.bar.low <= f.vwap + band && f.bar.close > f.vwap && bar.close > bar.open) {
      candidates.push({ t: bar.t, side: "CE" });
    } else if (below >= 18 && e < ePrev && f.bar.high >= f.vwap - band && f.bar.close < f.vwap && bar.close < bar.open) {
      candidates.push({ t: bar.t, side: "PE" });
    }
  }
  return gate(candidates, { firstMin: at(9, 45), lastMin: at(14, 30), maxPerDay: 3, cooldownMin: 20 });
}

/**
 * Previous-day high/low break: a 1-minute close crosses yesterday's high (low)
 * with futures on the same side of VWAP. At most one trade per side a day.
 */
export function pdhPdlSignals(ctx: DayContext): SetupSignal[] {
  const { bars } = today(ctx);
  const prev = previousSession(ctx.spot);
  if (!bars.length || !prev) return [];
  const futAt = futuresAt(ctx.fut);
  const candidates: SetupSignal[] = [];
  const taken = new Set<Side>();
  for (let j = 1; j < bars.length; j++) {
    const bar = bars[j];
    const before = bars[j - 1].close;
    const side: Side | null = bar.close > prev.high && before <= prev.high ? "CE"
      : bar.close < prev.low && before >= prev.low ? "PE" : null;
    if (!side || taken.has(side)) continue;
    const f = futAt(bar.t);
    if (!f || (side === "CE" ? f.bar.close <= f.vwap : f.bar.close >= f.vwap)) continue;
    const minute = istMinute(bar.t);
    if (minute < at(9, 30) || minute >= at(14, 30)) continue;
    taken.add(side);
    candidates.push({ t: bar.t, side });
  }
  return gate(candidates, { firstMin: at(9, 30), lastMin: at(14, 30), maxPerDay: 2, cooldownMin: 30 });
}

/** 1-minute bars rolled into 5-minute bars aligned to 09:15 IST, each stamped with its last 1-minute bar time. */
export function fiveMinute(bars: Bar[]): Array<Bar & { lastT: number; complete: boolean }> {
  const out: Array<Bar & { lastT: number; complete: boolean }> = [];
  for (const b of bars) {
    const minute = istMinute(b.t);
    const bucket = b.t - ((minute - at(9, 15)) % 5) * 60_000;
    const last = out[out.length - 1];
    if (last && last.t === bucket) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
      last.lastT = b.t;
      last.complete = b.t === bucket + 4 * 60_000;
    } else {
      out.push({ ...b, t: bucket, lastT: b.t, complete: b.t === bucket + 4 * 60_000 });
    }
  }
  return out;
}

/**
 * 5-minute trend: on a completed 5-minute bar, EMA 9 crosses EMA 21, the close
 * is beyond EMA 9 and futures are on the same side of VWAP.
 */
export function trend5mSignals(ctx: DayContext): SetupSignal[] {
  const { bars } = today(ctx);
  if (!bars.length) return [];
  const day = istDayKey(bars[0].t);
  const five = fiveMinute(ctx.spot).filter((b) => b.complete);
  const fast = ema(five, 9);
  const slow = ema(five, 21);
  const futAt = futuresAt(ctx.fut);
  const candidates: SetupSignal[] = [];
  for (let i = 1; i < five.length; i++) {
    const b = five[i];
    if (istDayKey(b.t) !== day) continue;
    const [f0, s0, f1, s1] = [fast[i - 1], slow[i - 1], fast[i], slow[i]];
    if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
    const side: Side | null = f0 <= s0 && f1 > s1 && b.close > f1 ? "CE" : f0 >= s0 && f1 < s1 && b.close < f1 ? "PE" : null;
    if (!side) continue;
    const f = futAt(b.lastT);
    if (!f || (side === "CE" ? f.bar.close <= f.vwap : f.bar.close >= f.vwap)) continue;
    candidates.push({ t: b.lastT, side });
  }
  return gate(candidates, { firstMin: at(9, 45), lastMin: at(14, 30), maxPerDay: 3, cooldownMin: 30 });
}

export interface SetupDef {
  key: SetupKey;
  name: string;
  rule: string;
  /** Stop as a multiple of the index's base stop (Nifty 20, Bank Nifty 50 points). */
  stopMult: number;
  rewardRisk: number;
  timeStopMin: number;
  detect: (ctx: DayContext, index: ScalpIndex) => SetupSignal[];
}

export const SETUPS: SetupDef[] = [
  {
    key: "ORB",
    name: "Opening-range breakout (current desk rule)",
    rule: "1-min close breaks the 09:15–09:30 range, EMA 9/21 agree, futures on the same side of VWAP. Up to 3 a day, none after 15:00.",
    stopMult: 1, rewardRisk: 1.5, timeStopMin: 10,
    detect: (ctx, index) => orbSignals({ spot: ctx.spot, fut: ctx.fut }, { stopPoints: SCALP_INDEXES[index].stopPoints }),
  },
  {
    key: "VWAP_PULLBACK",
    name: "VWAP pullback",
    rule: "Futures held one side of VWAP for 18 of the last 20 minutes and EMA 21 slopes that way; a futures bar dips back to VWAP but closes on the trend side, and the spot bar closes in the trend direction. 09:45–14:30, up to 3 a day.",
    stopMult: 1, rewardRisk: 1.5, timeStopMin: 20,
    detect: (ctx) => vwapPullbackSignals(ctx),
  },
  {
    key: "PDH_PDL",
    name: "Previous-day high/low break",
    rule: "1-min close crosses yesterday's high (or low) with futures on the same side of VWAP. 09:30–14:30, one per side a day.",
    stopMult: 1, rewardRisk: 2, timeStopMin: 30,
    detect: (ctx) => pdhPdlSignals(ctx),
  },
  {
    key: "TREND_5M",
    name: "5-minute EMA trend",
    rule: "Completed 5-min bar where EMA 9 crosses EMA 21, close beyond EMA 9, futures on the same side of VWAP. 09:45–14:30, up to 3 a day.",
    stopMult: 1.5, rewardRisk: 2, timeStopMin: 45,
    detect: (ctx) => trend5mSignals(ctx),
  },
];
