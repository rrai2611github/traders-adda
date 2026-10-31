import type { Derived } from "./derive.ts";
import type { History, Series } from "./history.ts";
import { atrAt, movingAverage, type Candidate } from "./signals.ts";
import { dayToIso } from "./history.ts";
import type { BacktestSettings, OpenPosition, Trade } from "./types.ts";

export interface SimulationOutput {
  trades: Trade[];
  /** Account value at each calendar position from `fromPos` to `toPos` (index 0 is `fromPos`). */
  account: Float64Array;
  /** Money sitting in open positions at each close (account value minus cash), same indexing as `account`. */
  deployed: Float64Array;
  /** Positions still held on the last day, before they are closed for the result. */
  openAtEnd: OpenPosition[];
  /** Account value on the last day with open positions at their last close, before selling costs. */
  markedValue: number;
  /** Sessions in range with at least one open position. */
  investedSessions: number;
  warnings: string[];
}

interface Position {
  s: Series;
  symbol: string;
  entryIdx: number;
  entryPos: number;
  entryPrice: number;
  stop: number;
  target: number | null;
  riskPerShare: number;
  qty: number;
  rs: number;
  /** Index of the most recent candle handled for this position. */
  cursor: number;
  /** A close under the trailing average was seen; leave at the next open. */
  leaveAtOpen: boolean;
  /** Rupees paid for all shares held (before costs), and the size first bought. */
  spent: number;
  initialQty: number;
  added: boolean;
  addPending: boolean;
}

const MAX_RISK_FRACTION = 0.25;
const CHASE_LIMIT = 1.05;
/** A buy is skipped when the cash left allows less than this share of the size the rules want: a sliver of a position is not a trade. */
const MIN_FILL_FRACTION = 0.5;

const averageCache = new WeakMap<Series, Map<string, Float32Array>>();
function trailAverage(s: Series, type: "sma" | "ema", period: number): Float32Array {
  let byKey = averageCache.get(s);
  if (!byKey) { byKey = new Map(); averageCache.set(s, byKey); }
  const key = `${type}${period}`;
  let values = byKey.get(key);
  if (!values) {
    if (type === "sma") values = movingAverage(s.close, period);
    else {
      values = new Float32Array(s.n);
      const k = 2 / (period + 1);
      let e = s.close[0];
      for (let i = 0; i < s.n; i += 1) { e = i ? s.close[i] * k + e * (1 - k) : s.close[0]; values[i] = i >= period - 1 ? e : NaN; }
    }
    byKey.set(key, values);
  }
  return values;
}

/** A small repeatable random-number generator (mulberry32): the same seed always picks the same stops. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1 where the Nifty 50 closed above its N-day average, by calendar position; null when the filter is off. */
export function niftyFilter(history: History, days: number): Uint8Array | null {
  if (!days) return null;
  const calendar = history.calendar;
  const ok = new Uint8Array(calendar.length).fill(1);
  const nifty = history.series.get("NIFTY50");
  if (!nifty) return ok;
  const avg = movingAverage(nifty.close, days);
  let j = 0;
  for (let k = 0; k < calendar.length; k += 1) {
    while (j < nifty.n - 1 && nifty.day[j + 1] <= calendar[k]) j += 1;
    ok[k] = nifty.day[j] <= calendar[k] && !Number.isNaN(avg[j]) && nifty.close[j] > avg[j] ? 1 : 0;
  }
  return ok;
}

/**
 * Walks the calendar one session at a time with one account: exits first (stops, targets, trailing average, time), then new
 * entries from the previous session's candidates, best RS first, within the position cap, cash, risk size and liquidity.
 * Nothing uses a price from after the moment it would have been known.
 */
export function simulate(
  history: History,
  derived: Derived,
  settings: BacktestSettings,
  candidates: ReadonlyArray<Candidate>,
  fromPos: number,
  toPos: number,
  /** The sector of a stock, or null when unknown; only used with `settings.maxPerSector`. */
  sectorOf: (symbol: string) => string | null = () => null,
): SimulationOutput {
  const warnings: string[] = [];
  const byPos = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const list = byPos.get(c.pos);
    if (list) list.push(c); else byPos.set(c.pos, [c]);
  }
  const calendar = history.calendar;
  const trades: Trade[] = [];
  const open: Position[] = [];
  const account = new Float64Array(toPos - fromPos + 1);
  const deployed = new Float64Array(toPos - fromPos + 1);
  let cash = settings.capital;
  let investedSessions = 0;
  const cost = settings.costPercent / 100;
  const stress = settings.stress;
  const slip = stress ? stress.slippagePercent / 100 : 0;
  const draw = stress ? seededRandom(stress.seed) : null;
  const niftyOk = niftyFilter(history, settings.niftyAbove ?? 0);
  let peakValue = settings.capital;

  const close = (p: Position, pos: number, exitIdx: number, rawPrice: number, reason: Trade["exitReason"]) => {
    let price = rawPrice;
    if (stress && draw) {
      // A stop that gaps: the sale happens far under the stop, never better than the ordinary fill.
      if (reason === "stop" && draw() < stress.gapShare) price = Math.min(price, p.entryPrice * (1 - stress.gapLossPercent / 100));
      price *= 1 - slip;
    }
    const gross = p.qty * price - p.spent;
    const costs = cost * (p.spent + p.qty * price);
    const pnl = gross - costs;
    cash += p.qty * price - cost * p.qty * price;
    trades.push({
      symbol: p.symbol,
      entryDay: dayToIso(p.s.day[p.entryIdx]),
      entryPrice: p.entryPrice,
      exitDay: dayToIso(calendar[pos]),
      exitPrice: price,
      quantity: p.qty,
      pnl,
      r: pnl / (p.initialQty * p.riskPerShare),
      pnlPercent: (pnl / p.spent) * 100,
      holdDays: exitIdx - p.entryIdx,
      exitReason: reason,
      rs: p.rs || null,
    });
  };

  /** Today's candle index for a stock, advancing its cursor; -1 when it did not trade. */
  const todayIndex = (s: Series, from: number, day: number) => {
    let j = from;
    while (j < s.n && s.day[j] < day) j += 1;
    return j < s.n && s.day[j] === day ? j : -1;
  };

  for (let pos = fromPos; pos <= toPos; pos += 1) {
    const day = calendar[pos];

    // 1. Entries decided at the previous close (or at the lid today), filled before today's exits are judged.
    const signalPos = settings.entry === "at-pivot" ? pos : pos - 1;
    const todays = byPos.get(signalPos);
    if (todays && open.length < settings.maxPositions) {
      let equity = cash;
      for (const p of open) equity += p.qty * p.s.close[Math.max(p.cursor, p.entryIdx)];
      const gateOk = (settings.breadthMin <= 0 || (derived.breadth50[signalPos] >= settings.breadthMin)) && (!niftyOk || niftyOk[signalPos] === 1);
      const brake = settings.drawdownBrake && equity < peakValue * (1 - settings.drawdownBrake.percent / 100) ? settings.drawdownBrake.factor : 1;
      if (gateOk) {
        const ranked = [...todays].sort((a, b) => b.rs - a.rs || a.symbol.localeCompare(b.symbol));
        let added = 0;
        for (const c of ranked) {
          if (added >= settings.maxNewPerDay || open.length >= settings.maxPositions) break;
          if (open.some((p) => p.symbol === c.symbol)) continue;
          if (settings.maxPerSector) {
            const sector = sectorOf(c.symbol);
            if (sector != null && open.filter((p) => sectorOf(p.symbol) === sector).length >= settings.maxPerSector) continue;
          }
          const s = history.series.get(c.symbol)!;
          const fillIdx = settings.entry === "at-pivot" ? c.i : c.i + 1;
          if (fillIdx >= s.n || s.day[fillIdx] !== day) continue;
          let fill: number;
          if (settings.entry === "at-pivot") fill = Math.max(s.open[fillIdx], c.pivot ?? s.open[fillIdx]);
          else {
            fill = s.open[fillIdx];
            if (fill > s.close[c.i] * CHASE_LIMIT) continue;
          }
          if (slip) fill *= 1 + slip;
          const atr = settings.stop.kind === "atr" ? atrAt(s, c.i) : NaN;
          const stop = settings.stop.kind === "atr" ? fill - settings.stop.multiple * atr : fill * (1 - settings.stop.percent / 100);
          const risk = fill - stop;
          if (!(risk > 0) || risk / fill > MAX_RISK_FRACTION) continue;
          let qty = settings.sizing.kind === "risk"
            ? Math.floor((equity * settings.sizing.riskPercent) / 100 / risk)
            : Math.floor(equity / settings.maxPositions / fill);
          qty = Math.min(qty, Math.floor((equity * settings.positionCapPercent) / 100 / fill));
          if (settings.turnoverLimitPercent > 0) {
            const medianRupees = derived.turn.get(c.symbol)![c.i] * 1e7;
            qty = Math.min(qty, Math.floor((medianRupees * settings.turnoverLimitPercent) / 100 / fill));
          }
          const wanted = Math.floor(qty * brake);
          qty = Math.min(wanted, Math.floor(cash / (fill * (1 + cost))));
          if (qty < 1 || qty < wanted * MIN_FILL_FRACTION) continue;
          cash -= qty * fill * (1 + cost);
          open.push({
            s, symbol: c.symbol, entryIdx: fillIdx, entryPos: pos, entryPrice: fill, stop,
            target: settings.exit.kind === "target" ? fill + settings.exit.r * risk : null,
            riskPerShare: risk, qty, rs: c.rs, cursor: fillIdx, leaveAtOpen: false,
            spent: qty * fill, initialQty: qty, added: false, addPending: false,
          });
          added += 1;
        }
      }
    }

    // 1b. Winners that earned an add-on yesterday get their extra shares at today's open.
    if (settings.addOn) {
      let equity = cash;
      for (const p of open) equity += p.qty * p.s.close[Math.max(p.cursor, p.entryIdx)];
      for (const p of open) {
        if (!p.addPending) continue;
        const j = todayIndex(p.s, p.cursor, day);
        if (j < 0) continue;
        const fill = p.s.open[j];
        const room = Math.floor((equity * settings.positionCapPercent) / 100 / fill) - p.qty;
        const addQty = Math.min(Math.floor(p.initialQty * settings.addOn.fraction), room, Math.floor(cash / (fill * (1 + cost))));
        p.addPending = false;
        p.added = true;
        if (addQty < 1) continue;
        cash -= addQty * fill * (1 + cost);
        p.spent += addQty * fill;
        p.qty += addQty;
      }
    }

    // 2. Exits for every open position on today's candle.
    for (let k = open.length - 1; k >= 0; k -= 1) {
      const p = open[k];
      const j = p.entryPos === pos ? p.entryIdx : todayIndex(p.s, p.cursor, day);
      if (j < 0) continue; // did not trade today
      p.cursor = j;
      const s = p.s;
      const openPx = s.open[j];
      let exit: { price: number; reason: Trade["exitReason"] } | null = null;
      if (p.leaveAtOpen && j > p.entryIdx) exit = { price: openPx, reason: "trail" };
      else if (j > p.entryIdx && openPx <= p.stop) exit = { price: openPx, reason: "stop" };
      else if (s.low[j] <= p.stop) exit = { price: p.stop, reason: "stop" };
      else if (p.target != null && s.high[j] >= p.target) exit = { price: Math.max(openPx, p.target), reason: "target" };
      if (!exit && settings.exit.kind === "ma") {
        const average = trailAverage(s, settings.exit.type, settings.exit.period)[j];
        if (!Number.isNaN(average) && s.close[j] < average) {
          if (settings.exit.when === "close") exit = { price: s.close[j], reason: "trail" };
          else p.leaveAtOpen = true;
        }
      }
      if (!exit && settings.maxHoldDays > 0 && j - p.entryIdx >= settings.maxHoldDays) exit = { price: s.close[j], reason: "time" };
      if (!exit && settings.timeStop && j - p.entryIdx >= settings.timeStop.days && s.close[j] < p.entryPrice * (1 + settings.timeStop.minGainPercent / 100)) exit = { price: s.close[j], reason: "time" };
      if (exit) { close(p, pos, j, exit.price, exit.reason); open.splice(k, 1); }
      // A close well above the buy price locks the stop in at the buy price from the next session.
      else {
        if (settings.breakEvenAfterPercent && s.close[j] >= p.entryPrice * (1 + settings.breakEvenAfterPercent / 100)) p.stop = Math.max(p.stop, p.entryPrice);
        if (settings.addOn && !p.added && !p.addPending && s.close[j] >= p.entryPrice * (1 + settings.addOn.afterPercent / 100)) p.addPending = true;
      }
    }

    // 3. Mark to market at today's close.
    let value = cash;
    for (const p of open) {
      const j = p.s.day[p.cursor] === day ? p.cursor : todayIndex(p.s, p.cursor, day);
      value += p.qty * p.s.close[j >= 0 ? j : p.cursor];
    }
    account[pos - fromPos] = value;
    peakValue = Math.max(peakValue, value);
    deployed[pos - fromPos] = value - cash;
    if (open.length) investedSessions += 1;
  }

  const openAtEnd: OpenPosition[] = open.map((p) => {
    const j = Math.min(p.s.n - 1, Math.max(p.cursor, p.entryIdx));
    const exit = settings.exit;
    return {
      symbol: p.symbol, entryDay: dayToIso(p.s.day[p.entryIdx]), entryPrice: p.entryPrice, quantity: p.qty, spent: p.spent,
      last: p.s.close[j], lastDay: dayToIso(p.s.day[j]), stop: p.stop,
      exitLevel: exit.kind === "ma" ? (() => { const v = trailAverage(p.s, exit.type, exit.period)[j]; return Number.isNaN(v) ? null : v; })() : null,
      added: p.added, addPending: p.addPending,
      addAt: settings.addOn && !p.added ? p.entryPrice * (1 + settings.addOn.afterPercent / 100) : null,
      rs: p.rs || null,
    };
  });
  const markedValue = account[account.length - 1];

  // Anything still open is closed at the last close, so the result is realised, not a paper gain.
  for (const p of open.splice(0)) {
    const j = Math.min(p.s.n - 1, Math.max(p.cursor, p.entryIdx));
    close(p, toPos, j, p.s.close[j], "end");
  }
  // Closing costs on those last exits belong in the final account value too.
  account[account.length - 1] = cash;
  if (!trades.length) warnings.push("No trade was taken: nothing qualified in this period with these rules.");
  return { trades, account, deployed, openAtEnd, markedValue, investedSessions, warnings };
}
