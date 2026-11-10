import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { historyLastDay } from "../backtest/historyRefresh.ts";
import { FyersApiError, FyersAuthError, fyersConnected, fyersOrderBook, fyersPlaceOrder, type FyersOrderBookRow } from "../fyers/fyersClient.ts";
import { getMarketStatus } from "../market/marketHours.ts";
import { readAccount } from "../positions/account.ts";
import { readSavedPlan } from "../positions/planServer.ts";
import { brokerOrderState, buyPayload, planFingerprint, sendBlocks, type BrokerOrderState, type FyersOrderPayload } from "./fyersOrders.ts";

/**
 * Sends the approved "Tomorrow's plan" buys to Fyers. Safe by default:
 *  - Nothing real goes out unless FYERS_ORDERS_ENABLED=1 is set in .env.local; otherwise "Approve" is a dry run that only writes the log.
 *  - The kill switch is a file: while .cache/orders-off exists, nothing goes out.
 *  - Approve must carry the fingerprint of exactly the orders shown, and a set of orders can be sent only once.
 *  - No retries and no automatic sending: every send is one click by the owner.
 */
const DIR = join(process.cwd(), ".cache");
const SENT_FILE = join(DIR, "orders-sent.json");
const LOG_FILE = join(DIR, "order-log.jsonl");
const KILL_FILE = join(DIR, "orders-off");

export type OrderMode = "dry-run" | "live";
export const ordersMode = (): OrderMode => (process.env.FYERS_ORDERS_ENABLED === "1" ? "live" : "dry-run");
const killed = () => existsSync(KILL_FILE);

interface SentRecord { fingerprint: string; sentAt: number; results: OrderResult[] }
export interface OrderResult {
  symbol: string;
  status: "placed" | "rejected" | "unknown" | "dry-run" | "skipped";
  detail: string;
  orderId?: string;
  brokerState?: BrokerOrderState;
  filledQty?: number;
  remainingQuantity?: number;
  tradedPrice?: number;
  brokerMessage?: string;
}

function readSent(): SentRecord | null {
  try { return JSON.parse(readFileSync(SENT_FILE, "utf8")) as SentRecord; } catch { return null; }
}

function log(entry: Record<string, unknown>) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

export function ordersView(now = Date.now()) {
  const plan = readSavedPlan();
  const account = readAccount();
  const dataDay = historyLastDay();
  const status = getMarketStatus(now);
  const afterMarket = !status.isLive;
  const orders = (plan?.orders ?? []).map((order) => ({ order, payload: buyPayload(order, plan!.lastDay, afterMarket) }));
  const fingerprint = plan ? planFingerprint(plan.lastDay, plan.orders) : null;
  const blocks = sendBlocks({ orders: plan?.orders ?? [], accountSize: account, planDay: plan?.lastDay ?? null, dataDay, killed: killed() });
  const sent = readSent();
  const mode = ordersMode();
  const fyers = fyersConnected();
  const liveBlocks = mode === "live" && !fyers.connected ? ["Connect Fyers for today first (the login is daily)."] : [];
  return {
    mode,
    planDay: plan?.lastDay ?? null,
    orders,
    skipped: plan?.skipped ?? [],
    fingerprint,
    afterMarket,
    blocks: [...blocks, ...liveBlocks],
    alreadySent: sent != null && sent.fingerprint === fingerprint && (sent.results ?? []).some((r) => r.status !== "dry-run"),
    sentResults: sent && sent.fingerprint === fingerprint ? sent.results : null,
    fyers: { configured: fyers.configured, connected: fyers.connected },
  };
}

function validNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function withBrokerStatus(result: OrderResult, order: FyersOrderBookRow | undefined): OrderResult {
  if (!order) return { ...result, brokerState: "unknown", brokerMessage: "Not found in today's Fyers order book. Check the broker before taking any action." };
  const brokerState = brokerOrderState(order.status, order.filledQty, order.remainingQuantity);
  return {
    ...result,
    brokerState,
    filledQty: validNumber(order.filledQty),
    remainingQuantity: validNumber(order.remainingQuantity),
    tradedPrice: validNumber(order.tradedPrice),
    brokerMessage: typeof order.message === "string" && order.message ? order.message : undefined,
  };
}

/** Adds broker-confirmed status only for submitted live orders; a missing or failed sync is surfaced rather than guessed. */
export async function ordersViewWithBrokerStatus(now = Date.now()) {
  const view = ordersView(now);
  const sent = readSent();
  const results = sent && sent.fingerprint === view.fingerprint ? sent.results : null;
  if (view.mode !== "live" || !results?.some((result) => result.orderId)) return view;

  try {
    const orderBook = await fyersOrderBook();
    const byId = new Map(orderBook.filter((order) => typeof order.id === "string").map((order) => [order.id as string, order]));
    return {
      ...view,
      sentResults: results.map((result) => withBrokerStatus(result, result.orderId ? byId.get(result.orderId) : undefined)),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[orders] broker status refresh failed:", detail);
    return { ...view, orderStatusError: `Could not refresh broker status: ${detail}` };
  }
}

export async function sendOrders(fingerprint: unknown, now = Date.now()): Promise<{ ok: true; mode: OrderMode; results: OrderResult[] } | { ok: false; status: number; error: string }> {
  const view = ordersView(now);
  if (typeof fingerprint !== "string" || fingerprint !== view.fingerprint) return { ok: false, status: 409, error: "The orders changed since you looked. Refresh the page and check them again." };
  if (view.blocks.length) return { ok: false, status: 409, error: view.blocks[0] };
  if (view.alreadySent) return { ok: false, status: 409, error: "These orders were already sent. Check your broker's order list." };

  const mode = view.mode;
  const results: OrderResult[] = [];
  let stopped = false;
  for (const { order, payload } of view.orders) {
    if (stopped) { results.push({ symbol: order.symbol, status: "skipped", detail: "Not sent: an earlier order failed." }); continue; }
    if (mode === "dry-run") {
      results.push({ symbol: order.symbol, status: "dry-run", detail: "Dry run: nothing was sent to the broker." });
      log({ mode, symbol: order.symbol, payload });
      continue;
    }
    try {
      const placed = await fyersPlaceOrder(payload as unknown as Record<string, unknown>);
      results.push({ symbol: order.symbol, status: "placed", detail: placed.message || "Placed.", orderId: placed.id });
      log({ mode, symbol: order.symbol, payload, status: "placed", orderId: placed.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A rejection from Fyers is final. Anything else (timeout, network) may still have placed the order, so never resend it.
      const rejected = error instanceof FyersApiError || error instanceof FyersAuthError;
      results.push({ symbol: order.symbol, status: rejected ? "rejected" : "unknown", detail: rejected ? message : `${message} Check your broker's order list before doing anything else.` });
      log({ mode, symbol: order.symbol, payload, status: rejected ? "rejected" : "unknown", error: message });
      stopped = true;
    }
  }
  if (mode === "live") {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(SENT_FILE, JSON.stringify({ fingerprint: view.fingerprint, sentAt: now, results } satisfies SentRecord));
  }
  return { ok: true, mode, results };
}

export type { FyersOrderPayload };
