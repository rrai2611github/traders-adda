import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner, ownerAlertAddress } from "@/lib/alerts/personal";
import { FyersApiError, fyersConnected, fyersHistory, fyersQuotes } from "@/lib/fyers/fyersClient";
import { getDailyCandles } from "@/lib/market/engine";
import { getMarketStatus, isTradingDay } from "@/lib/market/marketHours";
import { tradeTime } from "@/lib/market/providers/fyersQuotes";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { FUTURES_COSTS } from "@/lib/scalp/backtest";
import { SCALP_INDEXES, parseCandles, type ScalpIndex } from "@/lib/scalp/scalpLogic";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { scanUniverse } from "@/lib/screen/scan";
import { autoDecision, dailyRegime, hourlySetup } from "./indexFramework";
import {
  DEFAULT_INDEX_SETTINGS, advanceIndexOrder, cancelIndexOrder, closeIndexOrderNow, createIndexOrder, indexOrderCosts, indexRisk, indexStats, isActive,
  istDay, marginForLots, pnlAt, sizeLots, type IndexKey, type IndexOrder, type IndexQuote, type IndexSettings, type SquareOff,
} from "./indexPaper";

/**
 * Server side of the Index Paper Desk: Nifty and Bank Nifty near-month futures, paper only.
 * Orders live in .cache/paper-index.json and a loop advances them on live Fyers futures quotes whether or not a
 * page is open. Needs today's Fyers login: futures prices are not available from Yahoo.
 */

const FILE = join(process.cwd(), ".cache", "paper-index.json");
const DEFAULT_CAPITAL = 1_000_000;
const INDEXES: IndexKey[] = ["NIFTY", "BANKNIFTY"];
const TICK_LIVE_MS = 4_000;
const TICK_IDLE_MS = 60_000;
const SAVE_EVERY_MS = 30_000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const CONTRACT_TTL_MS = 30 * 60_000;
const HOUR = 3_600_000;

export interface AutoLogEntry {
  at: number;
  index: IndexKey;
  result: "placed" | "skipped";
  message: string;
}

/** Auto-paper mode: when the framework passes on a new completed hourly bar, the desk places the paper order itself. */
export interface AutoMode {
  enabled: boolean;
  indexes: IndexKey[];
  /** The hourly slot last evaluated per index (day:slot), so each completed hour is judged once. */
  lastKey: Partial<Record<IndexKey, string>>;
  log: AutoLogEntry[];
}

interface IndexFile {
  capital: number;
  orders: IndexOrder[];
  settings: IndexSettings;
  lastSummaryDay: string | null;
  lastSavedAt: number;
  auto: AutoMode;
}

const AUTO_LAST_ENTRY_MINUTE = 14 * 60 + 30;
const AUTO_LOG_LIMIT = 30;
const defaultAuto = (): AutoMode => ({ enabled: false, indexes: ["NIFTY"], lastKey: {}, log: [] });

interface EngineState {
  running: boolean;
  lastTickAt: number | null;
  pausedReason: string | null;
  quoteAgeMs: number | null;
  lastError: string | null;
}

interface Store {
  cache: IndexFile | null;
  lock: Promise<unknown>;
  timer: ReturnType<typeof setTimeout> | null;
  engine: EngineState;
  contracts: Map<string, { contract: string; at: number }>;
  quotes: Partial<Record<IndexKey, IndexQuote & { volume: number }>>;
}

const store: Store = ((globalThis as { __indexPaper?: Store }).__indexPaper ??= {
  cache: null, lock: Promise.resolve(), timer: null,
  engine: { running: false, lastTickAt: null, pausedReason: null, quoteAgeMs: null, lastError: null },
  contracts: new Map(), quotes: {},
});

const fresh = (): IndexFile => ({ capital: DEFAULT_CAPITAL, orders: [], settings: { ...DEFAULT_INDEX_SETTINGS }, lastSummaryDay: null, lastSavedAt: 0, auto: defaultAuto() });

function load(): IndexFile {
  if (store.cache) return store.cache;
  let file: IndexFile;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<IndexFile>;
    if (typeof raw.capital !== "number" || !(raw.capital > 0) || !Array.isArray(raw.orders)) throw new Error("Saved index paper portfolio is invalid. Back up .cache/paper-index.json before continuing.");
    file = { capital: raw.capital, orders: raw.orders, settings: { ...DEFAULT_INDEX_SETTINGS, ...(raw.settings ?? {}) }, lastSummaryDay: raw.lastSummaryDay ?? null, lastSavedAt: raw.lastSavedAt ?? 0, auto: { ...defaultAuto(), ...(raw.auto ?? {}) } };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") file = fresh();
    else throw error;
  }
  store.cache = file;
  return file;
}

function save(file: IndexFile, now = Date.now()) {
  const next = { ...file, lastSavedAt: now };
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 1));
  renameSync(tmp, FILE);
  store.cache = next;
}

function exclusive<T>(task: () => Promise<T> | T): Promise<T> {
  const run = store.lock.then(task, task);
  store.lock = run.catch(() => undefined);
  return run;
}

const fail = (message: string): never => { throw new Error(message); };
const lotSize = (index: IndexKey) => FUTURES_COSTS[index as ScalpIndex].lotSize;

/* ---------- futures quotes ---------- */

const candidates = (index: IndexKey, now: number): string[] => {
  const ist = new Date(now + 19_800_000);
  const month = ist.getUTCMonth(), year = ist.getUTCFullYear();
  const prefix = SCALP_INDEXES[index as ScalpIndex].futPrefix;
  return [0, 1].map((ahead) => `NSE:${prefix}${String((year + Math.floor((month + ahead) / 12)) % 100).padStart(2, "0")}${MONTHS[(month + ahead) % 12]}FUT`);
};

interface Row { n?: string; s?: string; v?: Record<string, unknown> }
const rowQuote = (row: Row | undefined, now: number): (IndexQuote & { volume: number }) | null => {
  const price = Number(row?.v?.lp);
  if (row?.s !== "ok" || !(price > 0)) return null;
  return { price, timestamp: tradeTime(Number(row.v?.tt) || null, now), contract: row.n ?? "", volume: Number(row.v?.volume) || 0 };
};

/** Near-month futures quote. The front contract is the month with the larger volume, re-checked every 30 minutes. */
async function futuresQuote(index: IndexKey, now = Date.now()): Promise<IndexQuote & { volume: number }> {
  if (!fyersConnected().connected) throw new Error("Fyers is not connected today; futures prices need the Fyers login.");
  const known = store.contracts.get(index);
  if (known && now - known.at < CONTRACT_TTL_MS) {
    const rows = (await fyersQuotes([known.contract])) as Row[];
    const quote = rowQuote(rows[0], now);
    if (quote) return quote;
  }
  const names = candidates(index, now);
  const rows = (await fyersQuotes(names).catch((error) => { if (error instanceof FyersApiError && error.code === -300) return []; throw error; })) as Row[];
  const quotes = rows.map((row) => rowQuote(row, now)).filter((q): q is IndexQuote & { volume: number } => q != null).sort((a, b) => b.volume - a.volume);
  const best = quotes[0] ?? fail(`No futures quote for ${index} (${names.join(", ")}).`);
  store.contracts.set(index, { contract: best.contract, at: now });
  return best;
}

/* ---------- snapshot ---------- */

function view(order: IndexOrder) {
  const model = FUTURES_COSTS[order.index as ScalpIndex];
  const price = order.status === "closed" ? order.exitPrice : order.lastPrice;
  const gross = order.entryPrice != null && price != null ? pnlAt(order, price) : 0;
  const costs = indexOrderCosts(order, model);
  return { ...order, grossPnl: gross, costs, netPnl: gross - costs };
}

export function indexSnapshot(now = Date.now()) {
  const file = load();
  const risk = indexRisk(file.orders, file.capital, file.settings, now);
  const costs = (o: IndexOrder) => indexOrderCosts(o, FUTURES_COSTS[o.index as ScalpIndex]);
  return {
    capital: file.capital,
    settings: file.settings,
    auto: file.auto,
    orders: file.orders.map(view),
    risk,
    freeMargin: file.capital - risk.marginUsed,
    stats: indexStats(file.orders, costs),
    quotes: store.quotes,
    lotSizes: { NIFTY: lotSize("NIFTY"), BANKNIFTY: lotSize("BANKNIFTY") },
    engine: { ...store.engine, fyers: fyersConnected().connected, alerts: ownerAlertAddress() != null },
    serverTime: now,
  };
}
export type IndexPaperSnapshot = ReturnType<typeof indexSnapshot>;

/* ---------- loop ---------- */

const money = (v: number) => `₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
const signedMoney = (v: number) => `${v >= 0 ? "+" : "−"}${money(v)}`;

function describe(before: IndexOrder, after: IndexOrder): string[] {
  const label = `${after.side.toUpperCase()} ${after.lots} × ${after.index}`;
  if (before.status === "pending" && after.status === "open") return [`🟢 [INDEX PAPER] ${label} filled at ${after.entryPrice} (${after.contract}). Stop ${after.stop}${after.target ? ` · target ${after.target}` : ""}.`];
  if (before.status === "open" && after.status === "closed" && after.exitPrice != null) {
    return [`${after.exitReason === "stop" ? "🛑" : after.exitReason === "target" ? "🎯" : "⚪"} [INDEX PAPER] ${label} closed (${after.exitReason}) at ${after.exitPrice}. Gross ${signedMoney(pnlAt(after, after.exitPrice))}.`];
  }
  if (after.status === "expired") return [`⚪ [INDEX PAPER] ${label} order expired without triggering.`];
  return [];
}

async function tickOnce(now: number) {
  const file = load();
  const status = getMarketStatus(now);
  store.engine = { ...store.engine, running: true, lastTickAt: now };
  const active = file.orders.filter(isActive);
  if (!active.length) { store.engine.pausedReason = null; await autoEntries(now); await maybeSummary(now, load()); return; }
  if (!status.isLive) { store.engine.pausedReason = "Market closed"; await maybeSummary(now, file); return; }
  if (!fyersConnected().connected) { store.engine.pausedReason = "Fyers not connected: futures prices need today's login"; return; }

  const needed = [...new Set(active.map((order) => order.index))];
  const quotes = new Map<IndexKey, IndexQuote & { volume: number }>();
  for (const index of needed) {
    try {
      const quote = await futuresQuote(index, now);
      quotes.set(index, quote);
      store.quotes[index] = quote;
    } catch (error) {
      store.engine.lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (quotes.size) store.engine.quoteAgeMs = Math.max(0, now - Math.max(...[...quotes.values()].map((q) => q.timestamp)));
  const risk = indexRisk(file.orders, file.capital, file.settings, now);
  store.engine.pausedReason = risk.entryBlocked ? (risk.reasons[0] ?? "Trading limit reached") : null;

  const alerts: string[] = [];
  let transitioned = false;
  const orders = file.orders.map((order) => {
    const quote = quotes.get(order.index);
    if (!isActive(order) || !quote) return order;
    const next = advanceIndexOrder(order, quote, { now, isLive: true, entryBlocked: risk.entryBlocked });
    if (next.status !== order.status) { transitioned = true; alerts.push(...describe(order, next)); }
    return next;
  });
  const updated = { ...file, orders };
  if (transitioned || now - file.lastSavedAt >= SAVE_EVERY_MS) save(updated, now);
  else store.cache = updated;
  if (alerts.length && process.env.PAPER_ALERTS !== "0") await notifyOwner(`[INDEX PAPER] ${alerts.length === 1 ? alerts[0].replace(/^\S+\s*\[INDEX PAPER\]\s*/, "").slice(0, 70) : `${alerts.length} updates`}`, alerts);
  await autoEntries(now);
  await maybeSummary(now, store.cache ?? updated);
}

async function maybeSummary(now: number, file: IndexFile) {
  const day = istDay(now);
  const minutes = Math.floor(((now + 19_800_000) % 86_400_000) / 60_000);
  if (file.lastSummaryDay === day || !isTradingDay(now) || getMarketStatus(now).isLive || minutes < 15 * 60 + 40 || !file.orders.length) return;
  const risk = indexRisk(file.orders, file.capital, file.settings, now);
  const stats = indexStats(file.orders, (o) => indexOrderCosts(o, FUTURES_COSTS[o.index as ScalpIndex]));
  const open = file.orders.filter((o) => o.status === "open");
  if (process.env.PAPER_ALERTS !== "0") {
    await notifyOwner(`[INDEX PAPER] Day summary ${day}`, [
      `📒 Index paper · ${day}\nToday ${signedMoney(risk.dayPnl)} · week ${signedMoney(risk.weekPnl)} (before costs)\nTrades today ${risk.tradesToday}, losers ${risk.lossesToday}\nAll closed trades: ${stats.closed}, net ${signedMoney(stats.net)}${stats.winRate != null ? `, win rate ${stats.winRate.toFixed(0)}%` : ""}\nOpen positions: ${open.length ? open.map((o) => `${o.side} ${o.lots} × ${o.index}`).join(", ") : "none"}`,
    ]);
  }
  save({ ...file, lastSummaryDay: day }, now);
}

export function startIndexPaperEngine() {
  if (store.timer) return;
  const loop = async () => {
    let next = TICK_IDLE_MS;
    try {
      await exclusive(() => tickOnce(Date.now()));
      next = getMarketStatus().isLive ? TICK_LIVE_MS : TICK_IDLE_MS;
      store.engine.lastError = null;
    } catch (error) {
      store.engine.lastError = error instanceof Error ? error.message : String(error);
      console.error("[index-paper] tick failed:", store.engine.lastError);
    }
    store.timer = setTimeout(loop, next);
  };
  store.engine.running = true;
  store.timer = setTimeout(loop, 4_000);
}

/* ---------- actions ---------- */

export interface PlaceInput {
  index: IndexKey;
  side: "long" | "short";
  lots: number;
  /** Null for a market order. */
  trigger: number | null;
  stop: number;
  target: number | null;
  squareOff: SquareOff;
  source?: "manual" | "framework";
}

/** Validates and saves a new order. Callers hold the lock (the loop and the API each take it once). */
async function placeUnlocked(input: PlaceInput, now: number): Promise<IndexOrder> {
  {
    if (!INDEXES.includes(input.index)) fail("Unknown index.");
    const file = load();
    const risk = indexRisk(file.orders, file.capital, file.settings, now);
    if (risk.entryBlocked) fail(`New orders are blocked: ${risk.reasons.join(" ")}`);
    const quote = await futuresQuote(input.index, now);
    const size = lotSize(input.index);
    const order = createIndexOrder({
      id: `${input.index}-${now}`, index: input.index, side: input.side, lots: Number(input.lots), lotSize: size,
      trigger: input.trigger, referencePrice: quote.price, stop: Number(input.stop), target: input.target, squareOff: input.squareOff, source: input.source, now,
    });
    const basis = input.trigger ?? quote.price;
    const riskAmount = Math.abs(basis - order.stop) * size * order.lots;
    const riskLimit = (file.capital * file.settings.riskPercent) / 100;
    if (riskAmount > riskLimit * 1.0001) fail(`This order risks ₹${Math.round(riskAmount).toLocaleString("en-IN")} to the stop, above the ${file.settings.riskPercent}% limit of ₹${Math.round(riskLimit).toLocaleString("en-IN")}. Reduce the lots or tighten the stop.`);
    const margin = marginForLots(basis, size, order.lots, file.settings.marginPercent);
    const free = file.capital - risk.marginUsed;
    if (margin > free) fail(`Needs about ₹${Math.round(margin).toLocaleString("en-IN")} margin; ₹${Math.round(free).toLocaleString("en-IN")} is free.`);
    save({ ...file, orders: [order, ...file.orders] }, now);
    return order;
  }
}

export function placeOrder(input: PlaceInput) {
  return exclusive(async () => {
    const now = Date.now();
    await placeUnlocked(input, now);
    return indexSnapshot(now);
  });
}

export function updateAuto(patch: { enabled?: boolean; indexes?: IndexKey[] }) {
  return exclusive(() => {
    const file = load();
    const indexes = patch.indexes ? patch.indexes.filter((i): i is IndexKey => INDEXES.includes(i)) : file.auto.indexes;
    if (patch.indexes && !indexes.length) fail("Pick at least one index for auto-paper mode.");
    save({ ...file, auto: { ...file.auto, enabled: patch.enabled ?? file.auto.enabled, indexes } });
    return indexSnapshot();
  });
}

/**
 * Once per completed hourly bar (10:16, 11:16 ... until 14:30) the framework is read for each selected index.
 * It places a paper order only when the daily regime is aligned, every hourly condition passes (none unmeasured),
 * lots fit the 1% risk and margin, no limit is hit, and that index has no order open or pending.
 */
async function autoEntries(now: number): Promise<void> {
  let file = load();
  if (!file.auto.enabled || !getMarketStatus(now).isLive || !fyersConnected().connected) return;
  const minute = Math.floor(((now + 19_800_000) % 86_400_000) / 60_000);
  const slot = Math.floor((minute - 556) / 60); // slot 1 starts 10:16, when the 09:15 hourly bar has completed
  if (slot < 1 || minute > AUTO_LAST_ENTRY_MINUTE) return;
  const key = `${istDay(now)}:${slot}`;
  const alerts: string[] = [];
  for (const index of file.auto.indexes) {
    if (file.auto.lastKey[index] === key) continue;
    let entry: AutoLogEntry;
    try {
      const active = file.orders.some((o) => o.index === index && isActive(o));
      const signal = await frameworkSignal(index);
      const risk = indexRisk(file.orders, file.capital, file.settings, now);
      const setup = signal.setup;
      const decision = autoDecision({
        hasActiveOrder: active, limitReason: risk.entryBlocked ? (risk.reasons[0] ?? "A trading limit is reached.") : null,
        setup, hasProposal: signal.proposal != null, lots: signal.sizing?.lots ?? 0, verdict: signal.verdict,
      });
      if (decision.action === "skip") entry = { at: now, index, result: "skipped", message: decision.message };
      else {
        const p = signal.proposal!;
        const order = await placeUnlocked({
          index, side: setup!.dir === 1 ? "long" : "short", lots: signal.sizing!.lots, trigger: p.entryType === "trigger" ? p.entry : null,
          stop: Math.round(p.stop * 100) / 100, target: Math.round(p.target * 100) / 100, squareOff: "intraday", source: "framework",
        }, now);
        file = load();
        entry = { at: now, index, result: "placed", message: `${order.side} ${order.lots} lot${order.lots === 1 ? "" : "s"}, ${p.entryType === "market" ? "market" : `${order.side === "long" ? "above" : "below"} ${p.entry.toFixed(2)}`}, stop ${p.stop.toFixed(2)}, target ${p.target.toFixed(2)}.` };
        alerts.push(`🤖 [INDEX PAPER AUTO] ${NAMES[index]}: ${entry.message}`);
      }
    } catch (error) {
      entry = { at: now, index, result: "skipped", message: `Could not evaluate: ${error instanceof Error ? error.message : String(error)}` };
    }
    file = load();
    save({ ...file, auto: { ...file.auto, lastKey: { ...file.auto.lastKey, [index]: key }, log: [entry, ...file.auto.log].slice(0, AUTO_LOG_LIMIT) } }, now);
    file = load();
  }
  if (alerts.length && process.env.PAPER_ALERTS !== "0") await notifyOwner("[INDEX PAPER] Auto order placed", alerts);
}

const NAMES: Record<IndexKey, string> = { NIFTY: "Nifty", BANKNIFTY: "Bank Nifty" };

export function cancelOrder(id: string) {
  return exclusive(() => {
    const file = load();
    const order = file.orders.find((o) => o.id === id) ?? fail("Order not found.");
    const cancelled = cancelIndexOrder(order, Date.now());
    save({ ...file, orders: file.orders.map((o) => (o.id === id ? cancelled : o)) });
    return indexSnapshot();
  });
}

export function closeOrder(id: string) {
  return exclusive(async () => {
    const file = load();
    const order = file.orders.find((o) => o.id === id) ?? fail("Order not found.");
    const quote = await futuresQuote(order.index);
    const closed = closeIndexOrderNow(order, quote.price, Date.now());
    save({ ...file, orders: file.orders.map((o) => (o.id === id ? closed : o)) });
    return indexSnapshot();
  });
}

export function setCapital(value: number) {
  return exclusive(() => {
    const file = load();
    if (!Number.isFinite(value) || value <= 0 || file.orders.length) fail("Set a positive starting capital before the first index paper order.");
    save({ ...file, capital: value });
    return indexSnapshot();
  });
}

export function updateSettings(patch: Partial<IndexSettings>) {
  return exclusive(() => {
    const file = load();
    const next = { ...file.settings };
    for (const key of Object.keys(DEFAULT_INDEX_SETTINGS) as Array<keyof IndexSettings>) {
      const v = patch[key];
      if (v === undefined) continue;
      if (!Number.isFinite(v) || v <= 0) fail(`Invalid ${key}.`);
      next[key] = v;
    }
    save({ ...file, settings: next });
    return indexSnapshot();
  });
}

/* ---------- framework signal ---------- */

function breadthPercent(): number | null {
  const state = getUniverseSnapshot();
  if (state.status !== "ready") return null;
  try {
    return movingAverageBreadth(scanUniverse(state.snapshot).metrics.filter((m) => m.passesFloor), "vs50").percent;
  } catch {
    return null;
  }
}

const sessionStart = (t: number) => Date.parse(`${istDay(t)}T00:00:00+05:30`);

export async function frameworkSignal(index: IndexKey) {
  if (!INDEXES.includes(index)) fail("Unknown index.");
  const now = Date.now();
  const live = getMarketStatus(now).isLive;
  const spot = index === "NIFTY" ? "NIFTY50" : "BANKNIFTY";
  const [idx, bank, vix] = await Promise.all([getDailyCandles(spot, 260), getDailyCandles("BANKNIFTY", 80), getDailyCandles("INDIAVIX", 30)]);
  // While the market is live today's daily bar is still forming; the regime uses completed days only.
  const today = istDay(now);
  const done = <T extends { t: number }>(list: T[]) => (live ? list.filter((k) => istDay(k.t) < today) : list);
  const regime = dailyRegime(done(idx), done(bank), done(vix));

  const quote = await futuresQuote(index, now);
  const from = Math.floor(now / 1000) - 12 * 86_400;
  const hourly = parseCandles(await fyersHistory(quote.contract, "60", from, Math.floor(now / 1000)));
  const bars = hourly.filter((b) => !live || b.t + HOUR <= now);
  const last = bars[bars.length - 1];
  let vwap: number | null = null;
  if (last) {
    const fiveMin = parseCandles(await fyersHistory(quote.contract, "5", Math.floor(sessionStart(last.t) / 1000), Math.floor(now / 1000)));
    const upto = fiveMin.filter((b) => b.t + 5 * 60_000 <= last.t + HOUR && b.volume > 0);
    const volume = upto.reduce((sum, b) => sum + b.volume, 0);
    if (volume > 0) vwap = upto.reduce((sum, b) => sum + ((b.high + b.low + b.close) / 3) * b.volume, 0) / volume;
  }
  const breadth = breadthPercent();
  const side = regime?.state === "bull" ? 1 : regime?.state === "bear" ? -1 : null;
  const setup = side ? hourlySetup({ bars, vwap, breadthPercent: breadth, dir: side }) : null;

  const file = load();
  const risk = indexRisk(file.orders, file.capital, file.settings, now);
  const proposal = setup?.proposal ?? null;
  const sizing = proposal
    ? sizeLots({ capital: file.capital, riskPercent: file.settings.riskPercent, entry: proposal.entry, stop: proposal.stop, lotSize: lotSize(index), freeMargin: file.capital - risk.marginUsed, marginPercent: file.settings.marginPercent })
    : null;
  return {
    index, asOf: now, live, contract: quote.contract, futuresPrice: quote.price, lastBarAt: last?.t ?? null,
    regime, setup, proposal, sizing, breadthPercent: breadth, vwap,
    verdict: !regime ? "Not enough daily history for the regime check."
      : regime.state === "none" ? `No trade: the daily regime is not aligned (${regime.bullCount} of 6 bullish checks, ${regime.bearCount} of 6 bearish).`
        : !setup ? "Not enough hourly bars yet."
          : setup.allPass ? `All conditions pass for a ${side === 1 ? "long" : "short"}.`
            : setup.failed ? `${setup.failed} hourly condition${setup.failed === 1 ? "" : "s"} failing: wait.`
              : `${setup.unmeasured} condition${setup.unmeasured === 1 ? "" : "s"} could not be measured; the rest pass.`,
    entryBlocked: risk.entryBlocked,
    riskReasons: risk.reasons,
  };
}
