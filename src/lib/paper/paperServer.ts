import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { notifyOwner, ownerAlertAddress } from "@/lib/alerts/personal";
import { getDataSource, getQuotes } from "@/lib/market/engine";
import { getMarketStatus, isTradingDay } from "@/lib/market/marketHours";
import type { Quote } from "@/lib/market/types";
import { quoteEntryIssue } from "@/lib/market/quoteQuality";
import { computePositionSize } from "@/lib/screen/positionSize";
import {
  advancePaperOrder, cancelPaperOrder, closePaperOrderNow, createPaperOrder, isDemoPaperOrder, isPaperOrder,
  istDayKey, MAX_PAPER_QUOTE_AGE_MS, tradingSessionsBetween, upgradePaperOrder, type PaperFill, type PaperOrder,
} from "@/lib/screen/paperTrading";
import type { TodaysPick } from "@/lib/screen/todaysPicks";
import { DEFAULT_PAPER_SETTINGS, committedCash, paperRisk, paperStats, paperTotals, type PaperSettings } from "./paperRules";

/**
 * Server-side paper trading. The portfolio lives in .cache/paper-portfolio.json and a background loop
 * advances every pending or open order against live quotes, so entries, stops and targets are handled
 * whether or not a browser is open. Fills, stops and an end-of-day summary are emailed to PERSONAL_ALERT_EMAIL.
 * Simulation only: no broker order is ever placed.
 */

const ADMIN_FILE = join(process.cwd(), ".cache", "paper-portfolio.json");
const DEFAULT_CAPITAL = 500_000;
const TICK_LIVE_MS = 5_000;
const TICK_IDLE_MS = 60_000;
const SUMMARY_AFTER_MINUTES = 15 * 60 + 40; // 15:40 IST, after the close

interface PortfolioFile {
  initialCapital: number;
  orders: PaperOrder[];
  settings: PaperSettings;
  /** IST day of the last end-of-day summary, so it is sent once. */
  lastSummaryDay: string | null;
}

export interface EngineStatus {
  running: boolean;
  lastTickAt: number | null;
  /** Why fills are paused right now, or null when the engine is advancing orders. */
  pausedReason: string | null;
  source: string;
  /** Age of the freshest quote used in the last tick. */
  quoteAgeMs: number | null;
  /** Owner email alerts are configured (PERSONAL_ALERT_EMAIL and SMTP). */
  alerts: boolean;
  lastError: string | null;
}

interface PaperStore {
  cache: PortfolioFile | null;
  lock: Promise<unknown>;
  timer: ReturnType<typeof setTimeout> | null;
  status: EngineStatus;
  isAdmin: boolean;
}

const stores = ((globalThis as { __paperServers?: Map<string, PaperStore> }).__paperServers ??= new Map());

const empty = (): PortfolioFile => ({ initialCapital: DEFAULT_CAPITAL, orders: [], settings: { ...DEFAULT_PAPER_SETTINGS }, lastSummaryDay: null });

function storeFor(scope: string, isAdmin: boolean): PaperStore {
  let store = stores.get(scope);
  if (!store) {
    store = {
      cache: null,
      lock: Promise.resolve(),
      timer: null,
      status: { running: false, lastTickAt: null, pausedReason: null, source: "", quoteAgeMs: null, alerts: false, lastError: null },
      isAdmin,
    };
    stores.set(scope, store);
  } else {
    store.isAdmin = isAdmin;
  }
  return store;
}

function portfolioPath(scope: string): string {
  if (scope === "admin") return ADMIN_FILE;
  const key = createHash("sha256").update(scope).digest("hex");
  return join(process.cwd(), ".cache", "accounts", key, "paper-portfolio.json");
}

function parseOrders(value: unknown): PaperOrder[] {
  if (!Array.isArray(value)) throw new Error("Saved paper portfolio has no order list.");
  const orders = value.map(upgradePaperOrder);
  if (!orders.every(isPaperOrder)) throw new Error("Saved paper portfolio contains an invalid order.");
  return orders as PaperOrder[];
}

function load(scope: string, isAdmin: boolean): PortfolioFile {
  const store = storeFor(scope, isAdmin);
  if (store.cache) return store.cache;
  let file: PortfolioFile;
  try {
    const raw = JSON.parse(readFileSync(portfolioPath(scope), "utf8")) as Partial<PortfolioFile>;
    const capital = raw.initialCapital;
    if (typeof capital !== "number" || !Number.isFinite(capital) || capital <= 0) throw new Error("Saved paper portfolio has an invalid starting capital.");
    file = {
      initialCapital: capital,
      orders: parseOrders(raw.orders ?? []),
      settings: { ...DEFAULT_PAPER_SETTINGS, ...(raw.settings ?? {}) },
      lastSummaryDay: raw.lastSummaryDay ?? null,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") file = empty();
    else throw error; // never overwrite a file that exists but cannot be read
  }
  store.cache = file;
  return file;
}

function save(scope: string, file: PortfolioFile, isAdmin: boolean) {
  const store = storeFor(scope, isAdmin);
  const path = portfolioPath(scope);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2));
  renameSync(tmp, path);
  store.cache = file;
}

/** Serialises every read-modify-write so the loop and an API call cannot overwrite each other. */
function exclusive<T>(scope: string, task: () => Promise<T> | T, isAdmin: boolean): Promise<T> {
  const store = storeFor(scope, isAdmin);
  const run = store.lock.then(task, task);
  store.lock = run.catch(() => undefined);
  return run;
}

/* ---------- snapshot for the UI ---------- */

export function paperSnapshot(now = Date.now(), scope = "admin", isAdmin = scope === "admin") {
  const store = storeFor(scope, isAdmin);
  const file = load(scope, isAdmin);
  return {
    initialCapital: file.initialCapital,
    orders: file.orders,
    settings: file.settings,
    risk: paperRisk(file.orders, file.initialCapital, file.settings, now),
    totals: paperTotals(file.orders, file.settings),
    stats: paperStats(file.orders, file.settings),
    engine: { ...store.status, alerts: isAdmin && ownerAlertAddress() != null },
    serverTime: now,
  };
}
export type PaperSnapshot = ReturnType<typeof paperSnapshot>;

/* ---------- notifications ---------- */

const money = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pnl = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;

function describeFill(order: PaperOrder, fill: PaperFill): string {
  const q = `${fill.quantity} × ${order.symbol} @ ${money(fill.price)}`;
  if (fill.side === "buy") return `🟢 [PAPER] BUY ${q}\nStop ${money(order.activeStop)} · T1 ${money(order.plan.target1)} · T2 ${money(order.plan.target2)}`;
  const gain = order.entryFillPrice != null ? (fill.price - order.entryFillPrice) * fill.quantity : 0;
  const icon = fill.label === "Stop" ? "🛑" : fill.label === "T1" || fill.label === "T2" ? "🎯" : "⚪";
  return `${icon} [PAPER] ${fill.label.toUpperCase()} — sold ${q}\nP&L on this exit ${pnl(gain)}${fill.label === "T1" ? " · stop moved to cost" : ""}`;
}

async function notify(lines: string[], isAdmin: boolean) {
  if (!isAdmin || !lines.length || process.env.PAPER_ALERTS === "0") return;
  const first = lines[0].replace(/^\S+\s*\[PAPER\]\s*/, "");
  await notifyOwner(`[PAPER] ${lines.length === 1 ? first.split("\n")[0] : `${lines.length} updates`}`, lines);
}

function changesBetween(before: PaperOrder, after: PaperOrder): string[] {
  const out = after.fills.slice(before.fills.length).map((fill) => describeFill(after, fill));
  if (before.status !== after.status && (after.status === "cancelled" || after.status === "expired")) {
    out.push(`⚪ [PAPER] ${after.symbol} order ${after.status}: ${after.reason}`);
  }
  return out;
}

/* ---------- the loop ---------- */

async function tickOnce(scope: string, now: number, isAdmin: boolean): Promise<void> {
  const store = storeFor(scope, isAdmin);
  const file = load(scope, isAdmin);
  const active = file.orders.filter((order) => !isDemoPaperOrder(order) && (order.status === "pending" || order.status === "open"));
  const status = getMarketStatus(now);
  const source = getDataSource();
  store.status = { ...store.status, running: true, lastTickAt: now, source: source.label, alerts: isAdmin && ownerAlertAddress() != null };
  if (!active.length) { store.status.pausedReason = null; await maybeSummary(now, file, isAdmin); return; }
  if (!status.isLive || status.label.includes("simulated") || !source.isRealtime) {
    store.status.pausedReason = !status.isLive ? "Market closed" : !source.isRealtime ? "No real-time quote feed" : "Simulated session";
    await maybeSummary(now, file, isAdmin);
    return;
  }
  const quotes = new Map<string, Quote>((await getQuotes([...new Set(active.map((order) => order.symbol))])).map((quote) => [quote.symbol, quote]));
  const risk = paperRisk(file.orders, file.initialCapital, file.settings, now);
  store.status.pausedReason = risk.entryBlocked ? risk.reasons.find((r) => r.includes("loss limit")) ?? "Loss limit reached" : null;
  const blocked = active.filter((o) => o.status === "pending").map((o) => {
    const q = quotes.get(o.symbol);
    return q ? quoteEntryIssue(q, now, MAX_PAPER_QUOTE_AGE_MS) : "Missing quote: new paper entries blocked.";
  }).find((issue) => issue != null);
  if (blocked) store.status.pausedReason = blocked;
  store.status.quoteAgeMs = quotes.size ? Math.max(0, now - Math.max(...[...quotes.values()].map((quote) => quote.timestamp))) : null;

  const alerts: string[] = [];
  let changed = false;
  const orders = file.orders.map((order) => {
    if (isDemoPaperOrder(order) || (order.status !== "pending" && order.status !== "open")) return order;
    const quote = quotes.get(order.symbol);
    if (!quote) return order;
    // A loss limit stops new entries; positions already open keep their stops and targets.
    if (order.status === "pending" && risk.entryBlocked) return order;
    const next = advancePaperOrder(order, quote, status, now);
    if (next !== order) {
      changed = true;
      alerts.push(...changesBetween(order, next));
    }
    return next;
  });
  if (changed) save(scope, { ...file, orders }, isAdmin);
  await notify(alerts, isAdmin);
  await maybeSummary(now, store.cache ?? file, isAdmin);
}

/** One summary after the close on a trading day, with the day's result, costs and what is still open. */
async function maybeSummary(now: number, file: PortfolioFile, isAdmin: boolean) {
  if (!isAdmin) return;
  const day = istDayKey(now);
  const status = getMarketStatus(now);
  const minutes = new Date(now + 19_800_000).getUTCHours() * 60 + new Date(now + 19_800_000).getUTCMinutes();
  if (file.lastSummaryDay === day || !isTradingDay(now) || status.isLive || minutes < SUMMARY_AFTER_MINUTES) return;
  const real = file.orders.filter((order) => !isDemoPaperOrder(order));
  if (!real.length) return;
  const risk = paperRisk(file.orders, file.initialCapital, file.settings, now);
  const totals = paperTotals(file.orders, file.settings);
  const open = real.filter((order) => order.status === "open");
  const pending = real.filter((order) => order.status === "pending");
  const text = [
    `📒 [PAPER] Day summary · ${day}`,
    `Day P&L ${pnl(risk.dayPnl)} · Week ${pnl(risk.weekPnl)}`,
    `Total gross ${pnl(totals.gross)} · costs ${money(totals.charges + totals.slippage)} · net ${pnl(totals.net)}`,
    `Holding ${open.length}${open.length ? `: ${open.map((order) => `${order.symbol} ${order.remainingQuantity}`).join(", ")}` : ""} · pending ${pending.length}`,
    ...(risk.reasons.length ? [`⚠ ${risk.reasons.join(" ")}`] : []),
  ].join("\n");
  await notify([text], true);
  save("admin", { ...file, lastSummaryDay: day }, true);
}

export function startPaperEngine(scope = "admin", isAdmin = scope === "admin") {
  const store = storeFor(scope, isAdmin);
  if (store.timer) return;
  const loop = async () => {
    let next = TICK_IDLE_MS;
    try {
      await exclusive(scope, () => tickOnce(scope, Date.now(), isAdmin), isAdmin);
      next = getMarketStatus().isLive ? TICK_LIVE_MS : TICK_IDLE_MS;
      store.status.lastError = null;
    } catch (error) {
      store.status.lastError = error instanceof Error ? error.message : String(error);
      console.error("[paper] engine tick failed:", store.status.lastError);
    }
    store.timer = setTimeout(loop, next);
  };
  store.status.running = true;
  store.timer = setTimeout(loop, 3_000);
}

/* ---------- actions ---------- */

const fail = (message: string): never => { throw new Error(message); };

export function approvePick(pick: TodaysPick, signalDate: string, scope = "admin", isAdmin = scope === "admin") {
  return exclusive(scope, () => {
    const file = load(scope, isAdmin);
    const now = Date.now();
    const today = istDayKey(now);
    const elapsed = tradingSessionsBetween(signalDate, today);
    if (elapsed < 0 || elapsed > 3) fail("This completed setup is too old for the three-session entry window.");
    if (pick.status !== "buy-ready") fail("Only confirmed Buy ready setups can be paper-approved.");
    const real = file.orders.filter((order) => !isDemoPaperOrder(order));
    if (real.some((order) => order.symbol === pick.symbol && (order.status === "pending" || order.status === "open"))) fail(`${pick.symbol} already has an outstanding paper order.`);
    if (!(pick.plan.entry > pick.plan.stop) || !(pick.plan.buyZoneHigh >= pick.plan.entry)) fail("The setup has an invalid entry or stop.");
    const risk = paperRisk(file.orders, file.initialCapital, file.settings, now);
    if (risk.approvalBlocked) fail(risk.reasons.join(" "));
    const realized = real.reduce((sum, order) => sum + order.realizedPnl, 0);
    const committed = real.reduce((sum, order) => sum + committedCash(order), 0);
    const available = file.initialCapital + realized - committed;
    const size = computePositionSize({ accountSize: file.initialCapital, entry: pick.plan.buyZoneHigh, stop: pick.plan.stop });
    const quantity = Math.min(size.quantity, Math.floor(available / pick.plan.buyZoneHigh));
    if (quantity < 2) fail("Insufficient paper cash or risk budget for the minimum two shares needed to book half at T1.");
    const order = createPaperOrder(pick, signalDate, quantity, now);
    save(scope, { ...file, orders: [order, ...file.orders] }, isAdmin);
    return paperSnapshot(now, scope, isAdmin);
  }, isAdmin);
}

export function cancelOrder(id: string, scope = "admin", isAdmin = scope === "admin") {
  return exclusive(scope, () => {
    const file = load(scope, isAdmin);
    const order = file.orders.find((item) => item.id === id) ?? fail("Paper order not found.");
    const cancelled = cancelPaperOrder(order, Date.now());
    save(scope, { ...file, orders: file.orders.map((item) => (item.id === id && item.status === "pending" ? cancelled : item)) }, isAdmin);
    return paperSnapshot(Date.now(), scope, isAdmin);
  }, isAdmin);
}

export function closeOrder(id: string, exitPrice: number, scope = "admin", isAdmin = scope === "admin") {
  return exclusive(scope, async () => {
    const file = load(scope, isAdmin);
    const order = file.orders.find((item) => item.id === id) ?? fail("Paper order not found.");
    const price = Number.isFinite(exitPrice) && exitPrice > 0 ? exitPrice : (await getQuotes([order.symbol]))[0]?.ltp ?? fail("No price available to close at.");
    const closed = closePaperOrderNow(order, price, Date.now());
    save(scope, { ...file, orders: file.orders.map((item) => (item.id === id ? closed : item)) }, isAdmin);
    return paperSnapshot(Date.now(), scope, isAdmin);
  }, isAdmin);
}

export function setCapital(value: number, scope = "admin", isAdmin = scope === "admin") {
  return exclusive(scope, () => {
    const file = load(scope, isAdmin);
    if (!Number.isFinite(value) || value <= 0 || file.orders.some((order) => !isDemoPaperOrder(order))) fail("Set a positive starting capital before approving the first paper order.");
    save(scope, { ...file, initialCapital: value }, isAdmin);
    return paperSnapshot(Date.now(), scope, isAdmin);
  }, isAdmin);
}

export function updateSettings(patch: Partial<PaperSettings>, scope = "admin", isAdmin = scope === "admin") {
  return exclusive(scope, () => {
    const file = load(scope, isAdmin);
    const next = { ...file.settings };
    for (const key of Object.keys(DEFAULT_PAPER_SETTINGS) as Array<keyof PaperSettings>) {
      const v = patch[key];
      if (v === undefined) continue;
      if (!Number.isFinite(v) || v < 0 || (key === "maxOpenPositions" && (!Number.isInteger(v) || v < 1))) fail(`Invalid ${key}.`);
      next[key] = v;
    }
    save(scope, { ...file, settings: next }, isAdmin);
    return paperSnapshot(Date.now(), scope, isAdmin);
  }, isAdmin);
}

export function removeDemoOrders(scope = "admin", isAdmin = scope === "admin") {
  return exclusive(scope, () => {
    const file = load(scope, isAdmin);
    save(scope, { ...file, orders: file.orders.filter((order) => !isDemoPaperOrder(order)) }, isAdmin);
    return paperSnapshot(Date.now(), scope, isAdmin);
  }, isAdmin);
}

/** One-time move of a browser-held portfolio to the server. Refused once the server holds real orders. */
export function importLegacy(portfolio: { initialCapital: number; orders: unknown[] }, scope = "admin", isAdmin = scope === "admin") {
  return exclusive(scope, () => {
    const file = load(scope, isAdmin);
    if (file.orders.some((order) => !isDemoPaperOrder(order))) fail("The server already holds paper orders; nothing was imported.");
    const orders = parseOrders(portfolio.orders);
    if (!Number.isFinite(portfolio.initialCapital) || portfolio.initialCapital <= 0) fail("Invalid starting capital in the imported portfolio.");
    save(scope, { ...file, initialCapital: portfolio.initialCapital, orders }, isAdmin);
    return paperSnapshot(Date.now(), scope, isAdmin);
  }, isAdmin);
}
