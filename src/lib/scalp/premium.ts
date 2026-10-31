/**
 * Modelled option selling: a short ATM straddle priced minute by minute with
 * Black-Scholes from the index level and India VIX (Fyers has no expired option
 * history). Results are estimates; the report says so.
 */
import type { BacktestTrade, CostModel } from "./backtest.ts";
import { istDayKey, istMinute, type Bar, type ScalpIndex, type Side } from "./scalpLogic.ts";

const MIN_T = 5 / (375 * 252);
export const RISK_FREE = 0.065;

function normCdf(x: number): number {
  // Abramowitz–Stegun 7.1.26, error < 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** European option price; `t` in years, `vol` as a fraction (0.14 = 14%). */
export function bsPrice(side: Side, spot: number, strike: number, t: number, vol: number, r = RISK_FREE): number {
  const years = Math.max(t, MIN_T);
  const sd = vol * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (r + vol * vol / 2) * years) / sd;
  const d2 = d1 - sd;
  const df = Math.exp(-r * years);
  return side === "CE"
    ? spot * normCdf(d1) - strike * df * normCdf(d2)
    : strike * df * normCdf(-d2) - spot * normCdf(-d1);
}

/* ---------- expiry calendar ---------- */

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

function nextWeekday(day: string, dow: number): string {
  return addDays(day, (dow - weekday(day) + 7) % 7);
}

function lastWeekdayOfMonth(year: number, month: number, dow: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return addDays(last, -((weekday(last) - dow + 7) % 7));
}

/**
 * Scheduled expiry of the nearest contract on or after `day`, before holiday
 * shifts. Nifty: weekly Thursday, Tuesday from 1 Sep 2025. Bank Nifty: weekly
 * Wednesday until 13 Nov 2024, then monthly (last Thursday; last Tuesday from Sep 2025).
 */
export function scheduledExpiry(index: ScalpIndex, day: string): string {
  const tuesdayEra = day >= "2025-09-01";
  if (index === "NIFTY") return nextWeekday(day, tuesdayEra ? 2 : 4);
  if (day <= "2024-11-13") return nextWeekday(day, 3);
  const [y, m] = day.split("-").map(Number);
  const dow = tuesdayEra ? 2 : 4;
  const thisMonth = lastWeekdayOfMonth(y, m - 1, dow);
  if (day <= thisMonth) return thisMonth;
  const next = new Date(Date.UTC(y, m, 1));
  const nextDow = next.toISOString().slice(0, 10) >= "2025-09-01" ? 2 : 4;
  return lastWeekdayOfMonth(next.getUTCFullYear(), next.getUTCMonth(), nextDow);
}

/** Holiday-adjusted expiry: the last trading session on or before the scheduled date. */
export function actualExpiry(index: ScalpIndex, day: string, sessions: string[]): string {
  const scheduled = scheduledExpiry(index, day);
  if (!sessions.length || scheduled > sessions[sessions.length - 1]) return scheduled;
  let lo = 0, hi = sessions.length - 1, found = day;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sessions[mid] <= scheduled) { found = sessions[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found < day ? day : found;
}

const SESSION_MINUTES = 375;
const TRADING_DAYS_YEAR = 252;

/**
 * Share of a day's index variance that happens overnight (close → next open),
 * from daily bars; clamped to 5–50%. The rest is spread evenly over the session.
 */
export function overnightShare(daily: Bar[]): number {
  let gap = 0, total = 0;
  for (let i = 1; i < daily.length; i++) {
    gap += Math.log(daily[i].open / daily[i - 1].close) ** 2;
    total += Math.log(daily[i].close / daily[i - 1].close) ** 2;
  }
  return total > 0 ? Math.min(0.5, Math.max(0.05, gap / total)) : 0.25;
}

/** Weekdays after `from` up to and including `to` (holidays beyond the data are unknown). */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (weekday(d) % 6 !== 0) n++;
  return n;
}

/**
 * Time to expiry in trading years: whole sessions left (each with its overnight)
 * plus the rest of today's session, which carries (1 − overnight share) of a day.
 * Options lose most of their value during market hours, not evenly over the clock.
 */
export function tradingYears(t: number, day: string, expiry: string, sessionsAfter: number, overnight: number): number {
  const minutesLeft = Math.max(0, 15 * 60 + 30 - istMinute(t));
  const today = (1 - overnight) * Math.min(1, minutesLeft / SESSION_MINUTES);
  return day >= expiry ? today / TRADING_DAYS_YEAR : (sessionsAfter + today) / TRADING_DAYS_YEAR;
}

/* ---------- implied volatility ---------- */

/** 20-day close-to-close volatility (annualised) known before each day, keyed by IST day. */
export function realisedVolByDay(daily: Bar[], window = 20): Map<string, number> {
  const out = new Map<string, number>();
  const rets: number[] = [];
  for (let i = 1; i < daily.length; i++) {
    if (rets.length >= window) {
      const recent = rets.slice(-window);
      const mean = recent.reduce((a, b) => a + b, 0) / window;
      const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1);
      out.set(istDayKey(daily[i].t), Math.sqrt(variance * 252));
    }
    rets.push(Math.log(daily[i].close / daily[i - 1].close));
  }
  return out;
}

/**
 * Multiplier from India VIX (a Nifty measure) to the index's own IV. 1 for Nifty;
 * for Bank Nifty, the ratio of the two indexes' recent realised volatility, clamped to 0.8–2.
 */
export function ivRatioByDay(index: ScalpIndex, own: Map<string, number>, nifty: Map<string, number>): (day: string) => number {
  return (day) => {
    if (index === "NIFTY") return 1;
    const a = own.get(day), b = nifty.get(day);
    return a && b ? Math.min(2, Math.max(0.8, a / b)) : 1.25;
  };
}

/* ---------- short straddle ---------- */

export interface StraddlePlan {
  /** IST minute of entry (the bar opening at this minute). */
  entryMin: number;
  /** Exit a leg when its premium rises this fraction above the sale price (0.25 = 25%). Infinity = no stop. */
  legStopPct: number;
  /** IST minute for the closing exit. */
  exitMin: number;
  /** Which days to trade relative to expiry. */
  days: "all" | "expiry" | "nonExpiry";
  /** Multiplier on IV at entry only, to stress-test the model (0.9 = sold 10% cheaper). */
  entryIvScale: number;
  /** Trade only when entry IV ÷ the index's 20-day realised volatility is at least this (needs `realisedVol`). */
  minIvOverRv?: number;
}

export const DEFAULT_STRADDLE: StraddlePlan = { entryMin: 9 * 60 + 20, legStopPct: 0.25, exitMin: 15 * 60 + 15, days: "all", entryIvScale: 1 };

/** True when a volatility filter is set and the day fails it (or has no realised-vol reading). */
function filteredOut(minIvOverRv: number | undefined, iv: number, day: string, realisedVol?: (day: string) => number | undefined): boolean {
  if (minIvOverRv == null) return false;
  const rv = realisedVol?.(day);
  return !rv || iv / rv < minIvOverRv;
}

export interface StraddleInput {
  index: ScalpIndex;
  strikeStep: number;
  spot: Bar[];
  vix: Bar[];
  /** IV multiplier for a day (see `ivRatioByDay`). */
  ivRatio: (day: string) => number;
  /** Overnight share of daily variance (see `overnightShare`). */
  overnight: number;
  /** The index's annualised 20-day realised volatility known before each day (see `realisedVolByDay`). */
  realisedVol?: (day: string) => number | undefined;
}

/** Costs of one short leg: sold at `sold`, bought back at `bought` (premium per unit). */
export function shortLegCost(c: CostModel, sold: number, bought: number): number {
  const sell = sold * c.lotSize, buy = bought * c.lotSize;
  const brokerage = 2 * c.brokeragePerOrder;
  const exchange = (sell + buy) * c.exchangePct;
  const sebi = ((sell + buy) * c.sebiPerCrore) / 1e7;
  const gst = (brokerage + exchange + sebi) * c.gstPct;
  return brokerage + exchange + sebi + gst + sell * c.sttSellPct + buy * c.stampBuyPct + 2 * c.slippagePerSide * c.lotSize;
}

/**
 * Each day: sell the ATM call and put at the entry bar's open, stop each leg
 * independently (checked against the bar's worst index level and VIX high),
 * buy back the rest at the exit bar's open. Each leg is one trade
 * (`side` = the leg; `points` = premium kept per unit).
 */
export function backtestStraddle(input: StraddleInput, plan: StraddlePlan, costs: CostModel): BacktestTrade[] {
  const sessions = new Map<string, Bar[]>();
  for (const bar of input.spot) {
    const m = istMinute(bar.t);
    if (m < 9 * 60 + 15 || m > 15 * 60 + 29) continue;
    const day = istDayKey(bar.t);
    const list = sessions.get(day);
    if (list) list.push(bar); else sessions.set(day, [bar]);
  }
  const vixAt = new Map(input.vix.map((b) => [b.t, b]));
  const days = [...sessions.keys()];
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const trades: BacktestTrade[] = [];
  let lastVix: Bar | undefined;
  for (const day of days) {
    const bars = sessions.get(day) as Bar[];
    const expiry = actualExpiry(input.index, day, days);
    const isExpiry = expiry === day;
    if ((plan.days === "expiry" && !isExpiry) || (plan.days === "nonExpiry" && isExpiry)) continue;
    const e = bars.findIndex((b) => istMinute(b.t) >= plan.entryMin);
    const x = bars.findIndex((b) => istMinute(b.t) >= plan.exitMin);
    if (e < 0 || x <= e) continue;
    const ratio = input.ivRatio(day);
    const vol = (bar: Bar, pick: "open" | "high") => {
      const v = vixAt.get(bar.t) ?? lastVix;
      if (vixAt.has(bar.t)) lastVix = v;
      return v ? (v[pick] / 100) * ratio : null;
    };
    const here = dayIndex.get(day) as number;
    const there = dayIndex.get(expiry);
    const sessionsAfter = there != null ? there - here : days.length - 1 - here + weekdaysBetween(days[days.length - 1], expiry);
    const years = (t: number) => tradingYears(t, day, expiry, sessionsAfter, input.overnight);
    const entryBar = bars[e];
    const entryVol = vol(entryBar, "open");
    if (entryVol == null || filteredOut(plan.minIvOverRv, entryVol, day, input.realisedVol)) continue;
    const strike = Math.round(entryBar.open / input.strikeStep) * input.strikeStep;
    for (const side of ["CE", "PE"] as const) {
      const sold = bsPrice(side, entryBar.open, strike, years(entryBar.t), entryVol * plan.entryIvScale);
      const stop = sold * (1 + plan.legStopPct);
      let exit: { i: number; price: number; reason: BacktestTrade["reason"] } | null = null;
      for (let i = e; i < x && !exit; i++) {
        const bar = bars[i];
        const volHigh = vol(bar, "high");
        if (volHigh == null) continue;
        const worstSpot = side === "CE" ? bar.high : bar.low;
        const worst = bsPrice(side, worstSpot, strike, years(bar.t), volHigh);
        if (worst >= stop) {
          const atOpen = i > e ? bsPrice(side, bar.open, strike, years(bar.t), vol(bar, "open") ?? volHigh) : sold;
          exit = { i, price: Math.max(stop, atOpen), reason: "stop" };
        }
      }
      const exitBar = exit ? bars[exit.i] : bars[x];
      const bought = exit ? exit.price : bsPrice(side, exitBar.open, strike, years(exitBar.t), vol(exitBar, "open") ?? entryVol);
      const points = sold - bought;
      const grossRs = points * costs.lotSize;
      trades.push({
        day, side, signalAt: entryBar.t, entryAt: entryBar.t, entry: sold, exitAt: exitBar.t, exit: bought,
        reason: exit ? "stop" : "eod", points, grossRs, netRs: grossRs - shortLegCost(costs, sold, bought),
      });
    }
  }
  return trades;
}

/* ---------- iron condor / iron fly (defined risk) ---------- */

export interface CondorPlan {
  entryMin: number;
  exitMin: number;
  /** Short strikes this fraction away from the entry index level (0 = ATM, an iron fly). */
  shortPct: number;
  /** Bought wings this fraction beyond the short strikes. */
  wingPct: number;
  /** Close the whole position when its loss reaches this multiple of the credit. Infinity = no stop. */
  stopX: number;
  /** "day": buy back at `exitMin` the same day; "expiry": hold to `exitMin` on expiry day. */
  hold: "day" | "expiry";
  days: "all" | "expiry" | "nonExpiry";
  /** Model stress at entry only: shorts sold at IV × this, wings bought at IV ÷ this. */
  entryIvScale: number;
  /** Trade only when entry IV ÷ 20-day realised volatility is at least this. */
  minIvOverRv?: number;
}

export const DEFAULT_CONDOR: CondorPlan = {
  entryMin: 9 * 60 + 20, exitMin: 15 * 60 + 15, shortPct: 0.005, wingPct: 0.005, stopX: 1, hold: "day", days: "all", entryIvScale: 1,
};

export interface CondorStrikes { shortCall: number; longCall: number; shortPut: number; longPut: number }

/** Strikes rounded to the strike step; shorts never inside ATM, wings at least one step beyond the shorts. */
export function condorStrikes(spot: number, step: number, shortPct: number, wingPct: number): CondorStrikes {
  const round = (x: number) => Math.round(x / step) * step;
  const atm = round(spot);
  const shortCall = Math.max(atm, round(spot * (1 + shortPct)));
  const shortPut = Math.min(atm, round(spot * (1 - shortPct)));
  return {
    shortCall,
    shortPut,
    longCall: Math.max(shortCall + step, round(spot * (1 + shortPct + wingPct))),
    longPut: Math.min(shortPut - step, round(spot * (1 - shortPct - wingPct))),
  };
}

interface Legs { sc: number; lc: number; sp: number; lp: number }
const callSpread = (l: Legs) => l.sc - l.lc;
const putSpread = (l: Legs) => l.sp - l.lp;
const netValue = (l: Legs) => callSpread(l) + putSpread(l);
const scaleLegs = (l: Legs, k: number): Legs => ({ sc: l.sc * k, lc: l.lc * k, sp: l.sp * k, lp: l.lp * k });

/**
 * Sell an OTM call and put and buy further-OTM wings (iron condor; iron fly when
 * the shorts are ATM). One stop on the whole position, checked against the bar's
 * high and low with the VIX high. Each position gives two trades: the call
 * spread (`side` CE) and the put spread (PE), both entered on the entry day.
 */
export function backtestCondor(input: StraddleInput, plan: CondorPlan, costs: CostModel): BacktestTrade[] {
  const sessions = new Map<string, Bar[]>();
  for (const bar of input.spot) {
    const m = istMinute(bar.t);
    if (m < 9 * 60 + 15 || m > 15 * 60 + 29) continue;
    const day = istDayKey(bar.t);
    const list = sessions.get(day);
    if (list) list.push(bar); else sessions.set(day, [bar]);
  }
  const vixAt = new Map(input.vix.map((b) => [b.t, b]));
  const days = [...sessions.keys()];
  const trades: BacktestTrade[] = [];
  let lastVix: Bar | undefined;
  const volOf = (bar: Bar, pick: "open" | "high", ratio: number) => {
    const v = vixAt.get(bar.t) ?? lastVix;
    if (vixAt.has(bar.t)) lastVix = v;
    return v ? (v[pick] / 100) * ratio : null;
  };

  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    const expiry = actualExpiry(input.index, day, days);
    const isExpiry = expiry === day;
    if ((plan.days === "expiry" && !isExpiry) || (plan.days === "nonExpiry" && isExpiry)) continue;
    const expiryIdx = days.indexOf(expiry, d);
    const lastIdx = plan.hold === "day" ? d : expiryIdx;
    if (lastIdx < 0) break;
    const bars = sessions.get(day) as Bar[];
    const e = bars.findIndex((b) => istMinute(b.t) >= plan.entryMin);
    const lastBars = sessions.get(days[lastIdx]) as Bar[];
    const x = lastBars.findIndex((b) => istMinute(b.t) >= plan.exitMin);
    if (e < 0 || x < 0 || (lastIdx === d && x <= e)) continue;
    const ratio = input.ivRatio(day);
    const entryBar = bars[e];
    const entryVol = volOf(entryBar, "open", ratio);
    if (entryVol == null || filteredOut(plan.minIvOverRv, entryVol, day, input.realisedVol)) continue;

    const sessionsAfter = (k: number) => expiryIdx >= 0
      ? expiryIdx - k
      : days.length - 1 - k + weekdaysBetween(days[days.length - 1], expiry);
    const strikes = condorStrikes(entryBar.open, input.strikeStep, plan.shortPct, plan.wingPct);
    const legsAt = (spot: number, t: number, k: number, vol: number, shortScale = 1, longScale = 1): Legs => {
      const years = tradingYears(t, days[k], expiry, sessionsAfter(k), input.overnight);
      return {
        sc: bsPrice("CE", spot, strikes.shortCall, years, vol * shortScale),
        lc: bsPrice("CE", spot, strikes.longCall, years, vol * longScale),
        sp: bsPrice("PE", spot, strikes.shortPut, years, vol * shortScale),
        lp: bsPrice("PE", spot, strikes.longPut, years, vol * longScale),
      };
    };
    const opened = legsAt(entryBar.open, entryBar.t, d, entryVol, plan.entryIvScale, 1 / plan.entryIvScale);
    const credit = netValue(opened);
    if (credit <= 0) continue;
    const stopLevel = credit * (1 + plan.stopX);

    let closed: { legs: Legs; at: number; reason: BacktestTrade["reason"] } | null = null;
    let lastRatio = ratio;
    for (let k = d; k <= lastIdx && !closed; k++) {
      const list = sessions.get(days[k]) as Bar[];
      const r = k === d ? ratio : input.ivRatio(days[k]);
      lastRatio = r;
      const from = k === d ? e : 0;
      const to = k === lastIdx ? x : list.length;
      for (let i = from; i < to && !closed; i++) {
        const bar = list[i];
        const volHigh = volOf(bar, "high", r);
        if (volHigh == null) continue;
        const up = legsAt(bar.high, bar.t, k, volHigh);
        const down = legsAt(bar.low, bar.t, k, volHigh);
        const worst = netValue(up) >= netValue(down) ? up : down;
        if (netValue(worst) < stopLevel) continue;
        const first = k === d && i === e;
        const atOpen = first ? opened : legsAt(bar.open, bar.t, k, volOf(bar, "open", r) ?? volHigh);
        const legs = netValue(atOpen) >= stopLevel ? atOpen : scaleLegs(worst, stopLevel / netValue(worst));
        closed = { legs, at: bar.t, reason: "stop" };
      }
    }
    if (!closed) {
      const bar = lastBars[x];
      const legs = legsAt(bar.open, bar.t, lastIdx, volOf(bar, "open", lastRatio) ?? entryVol);
      closed = { legs, at: bar.t, reason: "eod" };
    }

    const leg = (sold: number, bought: number) => shortLegCost(costs, sold, bought);
    const spreads = [
      { side: "CE" as const, entry: callSpread(opened), exit: callSpread(closed.legs), cost: leg(opened.sc, closed.legs.sc) + leg(closed.legs.lc, opened.lc) },
      { side: "PE" as const, entry: putSpread(opened), exit: putSpread(closed.legs), cost: leg(opened.sp, closed.legs.sp) + leg(closed.legs.lp, opened.lp) },
    ];
    for (const s of spreads) {
      const points = s.entry - s.exit;
      const grossRs = points * costs.lotSize;
      trades.push({
        day, side: s.side, signalAt: entryBar.t, entryAt: entryBar.t, entry: s.entry, exitAt: closed.at, exit: s.exit,
        reason: closed.reason, points, grossRs, netRs: grossRs - s.cost,
      });
    }
    if (plan.hold === "expiry") d = lastIdx;
  }
  return trades;
}

/** Net rupees per entry day (a straddle's or condor's legs combined): winning days and the worst day. */
export function dayStats(trades: BacktestTrade[]): { days: number; winDays: number; worstDay: number; bestDay: number } {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.netRs);
  const nets = [...byDay.values()];
  return {
    days: nets.length,
    winDays: nets.filter((n) => n > 0).length,
    worstDay: nets.length ? Math.min(...nets) : 0,
    bestDay: nets.length ? Math.max(...nets) : 0,
  };
}
