import { getActiveSession, SESSION_MINUTES } from "../marketHours";
import { getInstrument, UNIVERSE, type SeedInstrument } from "../universe";
import type { Candle, PricePoint, Quote } from "../types";
import type { MarketDataProvider, QuoteErrorListener, QuoteListener, Unsubscribe } from "./types";

const TICK_INTERVAL_MS = 1000;
const BARS = SESSION_MINUTES + 1; // one point per minute, inclusive of 09:15
const TRADING_DAYS = 252;

/** Deterministic 32-bit hash so a symbol+day always yields the same session. */
function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  const input = parts.join("|");
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), Number.EPSILON);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** U-shaped intraday volume distribution: heavy at the open and the close. */
function volumeFraction(progress: number): number {
  const f = (x: number) => x + (1.6 / 6) * (2 * x - 1) ** 3;
  const lo = f(0);
  return (f(Math.min(1, Math.max(0, progress))) - lo) / (f(1) - lo);
}

interface SessionPath {
  previousClose: number;
  open: number;
  prices: Float64Array;
  runningHigh: Float64Array;
  runningLow: Float64Array;
  dayVolume: number;
}

const pathCache = new Map<string, SessionPath>();

function buildSessionPath(inst: SeedInstrument, dateKey: string): SessionPath {
  const rand = mulberry32(hashSeed(inst.symbol, dateKey));

  // Drift the anchor slightly per day so successive sessions are not identical.
  const previousClose = inst.seedPrice * (1 + (rand() - 0.5) * 0.06);
  const open = previousClose * (1 + gaussian(rand) * 0.004);

  const sigmaPerBar = inst.volatility / Math.sqrt(TRADING_DAYS * SESSION_MINUTES);
  // A persistent intraday tilt is what makes some names trend and others chop.
  const sessionDrift = gaussian(rand) * (inst.volatility / Math.sqrt(TRADING_DAYS)) * 0.6;
  const driftPerBar = sessionDrift / SESSION_MINUTES;

  const prices = new Float64Array(BARS);
  const runningHigh = new Float64Array(BARS);
  const runningLow = new Float64Array(BARS);

  let price = open;
  let high = open;
  let low = open;

  for (let i = 0; i < BARS; i += 1) {
    if (i > 0) {
      const shock = sigmaPerBar * gaussian(rand);
      price *= Math.exp(driftPerBar - 0.5 * sigmaPerBar ** 2 + shock);
    }
    high = Math.max(high, price);
    low = Math.min(low, price);
    prices[i] = price;
    runningHigh[i] = high;
    runningLow[i] = low;
  }

  return {
    previousClose,
    open,
    prices,
    runningHigh,
    runningLow,
    dayVolume: inst.avgVolume * (0.6 + rand() * 0.9),
  };
}

function sessionPath(inst: SeedInstrument, dateKey: string): SessionPath {
  const key = `${inst.symbol}:${dateKey}`;
  let path = pathCache.get(key);
  if (!path) {
    path = buildSessionPath(inst, dateKey);
    if (pathCache.size > UNIVERSE.length * 3) pathCache.clear();
    pathCache.set(key, path);
  }
  return path;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function quoteAt(inst: SeedInstrument, now: number): Quote {
  const session = getActiveSession(now);
  const path = sessionPath(inst, session.dateKey);

  const exact = session.progress * (BARS - 1);
  const idx = Math.min(BARS - 1, Math.floor(exact));
  const next = Math.min(BARS - 1, idx + 1);
  const frac = exact - idx;

  // Interpolating between minute bars turns the 1-minute path into a smooth
  // sub-second tick stream without breaking determinism.
  let ltp = path.prices[idx] + (path.prices[next] - path.prices[idx]) * frac;

  if (session.isLive) {
    const wiggle = mulberry32(hashSeed(inst.symbol, session.dateKey, Math.floor(now / TICK_INTERVAL_MS)))();
    ltp *= 1 + (wiggle - 0.5) * 0.0006;
  }

  const high = Math.max(path.runningHigh[idx], ltp);
  const low = Math.min(path.runningLow[idx], ltp);
  const previousClose = path.previousClose;
  const change = ltp - previousClose;

  return {
    symbol: inst.symbol,
    name: inst.name,
    kind: inst.kind,
    sector: inst.sector,
    ltp: round(ltp),
    previousClose: round(previousClose),
    change: round(change),
    changePercent: round((change / previousClose) * 100),
    open: round(path.open),
    high: round(high),
    low: round(low),
    volume: Math.round(path.dayVolume * volumeFraction(session.progress)),
    timestamp: now,
  };
}

/**
 * Simulated market feed used for development.
 *
 * It is deterministic per symbol per trading day, so a server restart or a page
 * reload reproduces the same session instead of jumping to new prices.
 */
class MockProvider implements MarketDataProvider {
  readonly id = "mock";
  readonly label = "Simulated feed (development)";
  readonly isRealtime = false;

  private listeners = new Set<{ symbols: Set<string>; listener: QuoteListener }>();
  private timer: NodeJS.Timeout | null = null;
  private lastSent = new Map<string, number>();

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const now = Date.now();
    return symbols
      .map((s) => getInstrument(s))
      .filter((i): i is SeedInstrument => Boolean(i))
      .map((i) => quoteAt(i, now));
  }

  /**
   * Emits only on price change. Callers that need an immediate baseline should
   * pair this with `getQuotes`, which is what the SSE route does via its
   * snapshot frame.
   */
  subscribe(
    symbols: string[],
    listener: QuoteListener,
    _onError: QuoteErrorListener,
  ): Unsubscribe {
    void _onError;
    const entry = {
      symbols: new Set(symbols.map((s) => s.toUpperCase())),
      listener,
    };
    this.listeners.add(entry);
    this.ensureTimer();

    return () => {
      this.listeners.delete(entry);
      if (this.listeners.size === 0) this.stopTimer();
    };
  }

  async getIntradaySeries(symbol: string, maxPoints = 60): Promise<PricePoint[]> {
    const inst = getInstrument(symbol);
    if (!inst) return [];

    const now = Date.now();
    const session = getActiveSession(now);
    const path = sessionPath(inst, session.dateKey);
    const lastIdx = Math.min(BARS - 1, Math.round(session.progress * (BARS - 1)));
    const step = Math.max(1, Math.ceil((lastIdx + 1) / maxPoints));

    const points: PricePoint[] = [];
    for (let i = 0; i <= lastIdx; i += step) {
      points.push({ t: i, p: round(path.prices[i]) });
    }
    if (points.at(-1)?.t !== lastIdx) {
      points.push({ t: lastIdx, p: round(path.prices[lastIdx]) });
    }
    return points;
  }

  async getDailyCandles(symbol: string, maxCandles = 80): Promise<Candle[]> {
    const inst = getInstrument(symbol);
    if (!inst) return [];

    const count = Math.max(1, maxCandles);
    const candles: Candle[] = [];
    let previousClose = inst.seedPrice * 0.82;

    for (let i = 0; i < count; i += 1) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - (count - i));
      const rand = mulberry32(hashSeed(inst.symbol, date.toISOString().slice(0, 10)));
      const drift = 0.0015 + gaussian(rand) * (inst.volatility / Math.sqrt(TRADING_DAYS));
      const open = previousClose * (1 + gaussian(rand) * 0.006);
      const close = open * Math.exp(drift);
      const spread = Math.max(Math.abs(close - open), previousClose * 0.012);
      const high = Math.max(open, close) + spread * (0.35 + rand() * 0.9);
      const low = Math.min(open, close) - spread * (0.35 + rand() * 0.9);

      candles.push({
        t: date.getTime(),
        open: round(open),
        high: round(high),
        low: round(low),
        close: round(close),
        volume: Math.round(inst.avgVolume * (0.35 + rand() * 1.6)),
      });
      previousClose = close;
    }

    return candles;
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.emit(), TICK_INTERVAL_MS);
    // Never hold the Node event loop open just for the simulator.
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.lastSent.clear();
  }

  private emit(): void {
    if (this.listeners.size === 0) return;

    const now = Date.now();
    const wanted = new Set<string>();
    for (const entry of this.listeners) {
      for (const symbol of entry.symbols) wanted.add(symbol);
    }

    const changed = new Map<string, Quote>();
    for (const symbol of wanted) {
      const inst = getInstrument(symbol);
      if (!inst) continue;
      const quote = quoteAt(inst, now);
      if (this.lastSent.get(symbol) === quote.ltp) continue;
      this.lastSent.set(symbol, quote.ltp);
      changed.set(symbol, quote);
    }
    if (changed.size === 0) return;

    for (const entry of this.listeners) {
      const batch: Quote[] = [];
      for (const symbol of entry.symbols) {
        const quote = changed.get(symbol);
        if (quote) batch.push(quote);
      }
      if (batch.length) entry.listener(batch);
    }
  }
}

export const mockProvider = new MockProvider();

/** Every symbol the simulator can serve — used by the movers endpoint. */
export const MOCK_SYMBOLS = UNIVERSE.map((i) => i.symbol);
