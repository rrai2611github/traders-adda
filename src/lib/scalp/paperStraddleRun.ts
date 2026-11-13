import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FyersApiError, fyersConnected, fyersHistory, fyersOptionChain } from "@/lib/fyers/fyersClient";
import { DEFAULT_COSTS } from "./backtest";
import { isTradingDay } from "@/lib/market/marketHours";
import { PAPER_PLAN, chainDate, paperDayIntegrity, priceDay, recordingExpiry, recordingFrom, replayLeg, replaySymbols, summarizePaper, type PaperDay, type PaperLeg, type PaperSummary } from "./paperStraddle";
import { bsPrice, ivRatioByDay, overnightShare, realisedVolByDay, tradingYears, weekdaysBetween } from "./premium";
import { SCALP_INDEXES, istDayKey, istMinute, parseCandles, parseChain, type Bar, type ScalpIndex } from "./scalpLogic";

const STORE_FILE = join(process.cwd(), ".cache", "paper-straddle.json");
const DAY_MS = 86_400_000;
const INDEXES: ScalpIndex[] = ["NIFTY", "BANKNIFTY"];
const STRIKE_STEP: Record<ScalpIndex, number> = { NIFTY: 50, BANKNIFTY: 100 };
const VIX_SYMBOL = "NSE:INDIAVIX-INDEX";
interface Store {
  days: PaperDay[];
  lastRunAt: number | null;
  lastError: string | null;
}

function readStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(STORE_FILE, "utf8")) as Partial<Store>;
    if (!parsed || !Array.isArray(parsed.days) || parsed.days.some((d) =>
      !d || !INDEXES.includes(d.index) || typeof d.day !== "string" || typeof d.expiry !== "string" ||
      !["open", "closed"].includes(d.status) || !Array.isArray(d.legs) || d.legs.length !== 2)) {
      throw new Error("Saved paper straddle record is invalid. Back up .cache/paper-straddle.json before continuing.");
    }
    return { days: parsed.days ?? [], lastRunAt: parsed.lastRunAt ?? null, lastError: parsed.lastError ?? null };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { days: [], lastRunAt: null, lastError: null };
    }
    throw error;
  }
}

function writeStore(store: Store) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  const tmp = `${STORE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 1));
  renameSync(tmp, STORE_FILE);
}

const nowSec = () => Math.floor(Date.now() / 1000);

async function minuteBars(symbol: string, fromMs: number): Promise<Bar[]> {
  return parseCandles(await fyersHistory(symbol, "1", fromMs / 1000, nowSec()));
}

async function dailyBars(symbol: string): Promise<Bar[]> {
  return parseCandles(await fyersHistory(symbol, "D", (Date.now() - 360 * DAY_MS) / 1000, nowSec()));
}

/**
 * Records every session of the current expiry cycle that is not already
 * closed in the store: the ATM strike from the 09:20 index open, the real legs
 * from the live contracts' 1-minute candles, and the model's price for comparison.
 */
async function refreshIndex(index: ScalpIndex, store: Store, context: { vix: Bar[]; niftyDaily: Bar[] }): Promise<string | null> {
  const config = SCALP_INDEXES[index];
  const today = istDayKey(Date.now());
  const chain = parseChain(await fyersOptionChain(config.underlying, 40));
  const nearest = chain.expiries.map((e) => chainDate(e.date)).filter((d) => d >= today).sort()[0];
  if (!nearest) throw new Error(`${config.name}: no live expiry in the option chain.`);
  const from = recordingFrom(store.days, index, Date.now());
  const spot = await minuteBars(config.underlying, from);
  const daily = index === "NIFTY" ? context.niftyDaily : await dailyBars(config.underlying);
  const sessions = [...new Set(spot.map((b) => istDayKey(b.t)))].sort();
  const ratio = ivRatioByDay(index, realisedVolByDay(daily), realisedVolByDay(context.niftyDaily));
  const overnight = overnightShare(daily);
  const vixAt = new Map(context.vix.map((b) => [b.t, b]));
  const optionBars = new Map<string, Bar[]>();
  const costs = DEFAULT_COSTS[index];

  for (const day of sessions) {
    const existing = store.days.find((d) => d.index === index && d.day === day);
    if (existing?.status === "closed") continue;
    // Only days whose nearest contract is still live can be replayed with real prices.
    const expected = recordingExpiry(index, day, sessions);
    if ((existing?.expiry ?? expected) < today) continue;
    const entryBar = spot.find((b) => istDayKey(b.t) === day && istMinute(b.t) >= PAPER_PLAN.entryMin);
    if (!entryBar) continue;
    const strike = existing?.strike ?? Math.round(entryBar.open / STRIKE_STEP[index]) * STRIKE_STEP[index];
    const symbols = replaySymbols(existing, nearest, expected, strike, chain.legs);
    if (symbols.length !== 2 || symbols.some((s) => !s)) continue;
    const expiry = existing?.expiry ?? nearest;
    const vix = vixAt.get(entryBar.t) ?? null;
    const at = sessions.indexOf(day);
    const sessionsAfter = expiry <= sessions[sessions.length - 1]
      ? sessions.filter((d) => d > day && d <= expiry).length
      : sessions.length - 1 - at + weekdaysBetween(sessions[sessions.length - 1], expiry);
    const years = tradingYears(entryBar.t, day, expiry, sessionsAfter, overnight);
    const legs: PaperLeg[] = [];
    for (const side of ["CE", "PE"] as const) {
      const symbol = symbols[side === "CE" ? 0 : 1];
      if (!symbol) break;
      const original = existing?.legs.find((l) => l.side === side);
      if (original && original.status !== "open") {
        legs.push(original);
        continue;
      }
      let bars = optionBars.get(symbol);
      if (!bars) {
        bars = await minuteBars(symbol, from);
        optionBars.set(symbol, bars);
      }
      const replay = replayLeg(bars, day);
      if (!replay) break;
      if (original && (original.soldAt !== replay.soldAt || original.sold !== replay.sold)) {
        throw new Error(`${config.name} ${day}: recovered candles disagree with the recorded entry. Original record preserved.`);
      }
      const modelSold = existing ? existing.legs.find((l) => l.side === side)?.modelSold ?? null :
        vix ? bsPrice(side, entryBar.open, strike, years, (vix.open / 100) * ratio(day)) : null;
      legs.push({ side, symbol, modelSold, ...replay });
    }
    if (legs.length !== 2) continue;
    const record: PaperDay = {
      index, day, expiry, strike, spotAtEntry: existing?.spotAtEntry ?? entryBar.open, vixAtEntry: existing?.vixAtEntry ?? vix?.open ?? null,
      status: legs.every((l) => l.status !== "open") ? "closed" : "open",
      legs, ...priceDay(legs, costs), updatedAt: Date.now(),
    };
    store.days = [...store.days.filter((d) => !(d.index === index && d.day === day)), record];
  }
  return isTradingDay(Date.now()) && istMinute(Date.now()) > PAPER_PLAN.entryMin &&
    !store.days.some((d) => d.index === index && d.day === today)
    ? `${config.name}: current session not recorded. Check expiry, ATM contracts and 09:20 candles.` : null;
}

const g = globalThis as typeof globalThis & {
  __paperStraddle?: { running: Promise<void> | null; lastAt: number };
  __paperStraddleTimer?: ReturnType<typeof setInterval>;
};
const state = (g.__paperStraddle ??= { running: null, lastAt: 0 });

/** Refreshes both indexes at most once a minute; concurrent callers share one run. */
export function refreshPaperStraddle(force = false): Promise<void> {
  if (state.running) return state.running;
  if (!force && Date.now() - state.lastAt < 60_000) return Promise.resolve();
  state.running = (async () => {
    const store = readStore();
    try {
      const from = Math.min(...INDEXES.map((index) => recordingFrom(store.days, index, Date.now())));
      const context = { vix: await minuteBars(VIX_SYMBOL, from), niftyDaily: await dailyBars(SCALP_INDEXES.NIFTY.underlying) };
      const errors: string[] = [];
      for (const index of INDEXES) {
        try {
          const issue = await refreshIndex(index, store, context);
          if (issue) errors.push(issue);
        } catch (error) {
          if (!(error instanceof FyersApiError) && !(error instanceof Error && /no live expiry/.test(error.message))) throw error;
          errors.push(error.message);
        }
      }
      store.lastError = errors.length ? errors.join(" ") : null;
    } catch (error) {
      store.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      store.lastRunAt = Date.now();
      state.lastAt = Date.now();
      store.days.sort((a, b) => b.day.localeCompare(a.day) || a.index.localeCompare(b.index));
      writeStore(store);
    }
  })().finally(() => { state.running = null; });
  return state.running;
}

export interface PaperStraddleReport {
  days: PaperDay[];
  summary: Record<ScalpIndex, PaperSummary>;
  lastRunAt: number | null;
  lastError: string | null;
  plan: typeof PAPER_PLAN;
  lotSize: Record<ScalpIndex, number>;
  integrity?: Array<{ index: ScalpIndex; day: string; state: "incomplete" | "expired-incomplete" }>;
  asOfDay: string;
}

export function paperStraddleReport(): PaperStraddleReport {
  const store = readStore();
  const today = istDayKey(Date.now());
  return {
    days: store.days,
    asOfDay: today,
    summary: {
      NIFTY: summarizePaper(store.days.filter((d) => d.index === "NIFTY")),
      BANKNIFTY: summarizePaper(store.days.filter((d) => d.index === "BANKNIFTY")),
    },
    lastRunAt: store.lastRunAt,
    lastError: store.lastError,
    plan: PAPER_PLAN,
    lotSize: { NIFTY: DEFAULT_COSTS.NIFTY.lotSize, BANKNIFTY: DEFAULT_COSTS.BANKNIFTY.lotSize },
    integrity: store.days.flatMap((d) => {
      const state = paperDayIntegrity(d, today);
      return state === "incomplete" || state === "expired-incomplete" ? [{ index: d.index, day: d.day, state }] : [];
    }),
  };
}

/**
 * Weekdays from 09:21 IST: follow today's straddle live every 5 minutes while the market
 * is open, then keep retrying (every 10 minutes, until 23:00) until both indexes are closed.
 */
async function tick() {
  const now = Date.now();
  const minute = istMinute(now);
  if (!isTradingDay(now) || minute < PAPER_PLAN.entryMin + 1 || minute > 23 * 60) return;
  const status = fyersConnected();
  if (!status.configured || !status.connected) return;
  const today = istDayKey(now);
  const store = readStore();
  const done = INDEXES.every((index) => store.days.some((d) => d.index === index && d.day === today && d.status === "closed"));
  if (done) return;
  const marketOpen = minute <= 15 * 60 + 30;
  if (!marketOpen && store.lastRunAt && now - store.lastRunAt < 10 * 60_000) return;
  try {
    await refreshPaperStraddle(true);
  } catch (error) {
    console.error("[paper-straddle] refresh failed:", error instanceof Error ? error.message : error);
  }
}

export function startPaperStraddleScheduler() {
  if (g.__paperStraddleTimer) return;
  void tick().catch((error) => console.error("[paper-straddle] scheduler failed:", error));
  g.__paperStraddleTimer = setInterval(() => {
    void tick().catch((error) => console.error("[paper-straddle] scheduler failed:", error));
  }, 5 * 60_000);
  g.__paperStraddleTimer.unref?.();
}
