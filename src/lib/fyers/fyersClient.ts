import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertDataAvailable, currentUsage, dataBackoff, FYERS_DATA_MIN_GAP_MS, FYERS_DATA_PER_MINUTE, FyersReadCache, type FyersDataUsage } from "./dataPolicy.ts";

/**
 * Minimal Fyers API v3 client: market data, plus one guarded call to place an order (fyersPlaceOrder).
 * Credentials come from .env.local; the daily access token is kept in
 * .cache/fyers-token.json and is treated as expired on the next IST day.
 */

const API = "https://api-t1.fyers.in";
const TOKEN_FILE = join(process.cwd(), ".cache", "fyers-token.json");
const USAGE_FILE = join(process.cwd(), ".cache", "fyers-data-usage.json");
// Fyers' edge rejects some default library user agents with a bare 403.
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TradersAdda/1.0";
const AUTH_ERROR_CODES = new Set([-8, -15, -16, -17]);

export interface FyersConfig {
  appId: string;
  secretId: string;
  redirectUri: string;
}

export function fyersConfig(): FyersConfig | null {
  const appId = process.env.FYERS_APP_ID?.trim();
  const secretId = process.env.FYERS_SECRET_ID?.trim();
  const redirectUri = process.env.FYERS_REDIRECT_URI?.trim() || "http://127.0.0.1:3107/api/fyers/callback";
  return appId && secretId ? { appId, secretId, redirectUri } : null;
}

export class FyersAuthError extends Error {
  constructor(message = "Fyers login required. Click Connect Fyers to log in for today.") {
    super(message);
    this.name = "FyersAuthError";
  }
}

export class FyersApiError extends Error {
  readonly status: number;
  readonly code?: number;
  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "FyersApiError";
    this.status = status;
    this.code = code;
  }
}

interface StoredToken {
  accessToken: string;
  issuedAt: number;
}

const istDay = (t: number) => new Date(t + 19_800_000).toISOString().slice(0, 10);

function readToken(now = Date.now()): StoredToken | null {
  try {
    const token = JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as StoredToken;
    // Fyers tokens are daily; one issued on a previous IST day is no longer valid.
    return token.accessToken && istDay(token.issuedAt) === istDay(now) ? token : null;
  } catch {
    return null;
  }
}

export function clearFyersToken() {
  rmSync(TOKEN_FILE, { force: true });
}

export function fyersConnected(): { configured: boolean; connected: boolean; issuedAt: number | null } {
  const token = readToken();
  return { configured: fyersConfig() != null, connected: token != null, issuedAt: token?.issuedAt ?? null };
}

/* ---------- OAuth ---------- */

export const FYERS_STATE_COOKIE = "fyers_oauth_state";
export const newFyersState = () => randomBytes(12).toString("hex");

export function fyersLoginUrl(state: string): string {
  const config = fyersConfig();
  if (!config) throw new FyersAuthError("Fyers is not configured. Add FYERS_APP_ID and FYERS_SECRET_ID to .env.local.");
  const url = new URL(`${API}/api/v3/generate-authcode`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeFyersAuthCode(code: string): Promise<void> {
  const config = fyersConfig();
  if (!config) throw new FyersAuthError("Fyers is not configured.");
  const appIdHash = createHash("sha256").update(`${config.appId}:${config.secretId}`).digest("hex");
  const response = await fetch(`${API}/api/v3/validate-authcode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ grant_type: "authorization_code", appIdHash, code }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as { s?: string; access_token?: string; message?: string };
  if (!response.ok || body.s !== "ok" || !body.access_token) {
    throw new FyersAuthError(`Fyers login failed: ${body.message || `HTTP ${response.status}`}`);
  }
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify({ accessToken: body.access_token, issuedAt: Date.now() } satisfies StoredToken));
}

/* ---------- throttled data requests ---------- */

// Leave headroom under the Standard plan's five/second and fifty/minute limits.
const MIN_GAP_MS = FYERS_DATA_MIN_GAP_MS;
const PER_MINUTE = FYERS_DATA_PER_MINUTE;
// Shared across route bundles in the same server process.
const pacer = ((globalThis as { __fyersPacer?: { sent: number[]; chain: Promise<unknown> } }).__fyersPacer ??= {
  sent: [],
  chain: Promise.resolve(),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dataState = ((globalThis as { __fyersData?: { loaded: boolean; usage: FyersDataUsage | null; cache: FyersReadCache } }).__fyersData ??=
  { loaded: false, usage: null, cache: new FyersReadCache() });

export function fyersDataUsage(now = Date.now()): FyersDataUsage {
  if (!dataState.loaded) {
    try {
      const saved = JSON.parse(readFileSync(USAGE_FILE, "utf8")) as FyersDataUsage;
      if (!saved || typeof saved.day !== "string" || !Number.isInteger(saved.requests) || saved.requests < 0 ||
        !Number.isFinite(saved.blockedUntil) || !(saved.reason === null || typeof saved.reason === "string") ||
        !saved.endpoints || typeof saved.endpoints !== "object" ||
        !Object.values(saved.endpoints).every((n) => Number.isInteger(n) && n >= 0)) {
        throw new Error("Saved Fyers data usage is invalid; inspect .cache/fyers-data-usage.json.");
      }
      dataState.usage = saved;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    dataState.loaded = true;
  }
  dataState.usage = currentUsage(dataState.usage, now);
  return { ...dataState.usage, endpoints: { ...dataState.usage.endpoints } };
}

function saveUsage(usage: FyersDataUsage) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  const tmp = `${USAGE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(usage));
  renameSync(tmp, USAGE_FILE);
  dataState.usage = usage;
}

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const { sent } = pacer;
  const run = pacer.chain.then(async () => {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] > 60_000) sent.shift();
      const last = sent[sent.length - 1] ?? 0;
      if (sent.length < PER_MINUTE && now - last >= MIN_GAP_MS) break;
      await sleep(sent.length >= PER_MINUTE ? 60_000 - (now - sent[0]) + 10 : MIN_GAP_MS - (now - last));
    }
    sent.push(Date.now());
    try {
      return await task();
    } finally {
      sent[sent.length - 1] = Date.now();
    }
  });
  pacer.chain = run.catch(() => undefined);
  return run;
}

async function dataGet(path: string, params: Record<string, string | number>, ttl = 15_000): Promise<Record<string, unknown>> {
  const config = fyersConfig();
  if (!config) throw new FyersAuthError("Fyers is not configured. Add FYERS_APP_ID and FYERS_SECRET_ID to .env.local.");
  const token = readToken();
  if (!token) throw new FyersAuthError();
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const key = `${token.issuedAt}:${url}`;
  return dataState.cache.get(key, ttl, Date.now(), () => throttled(async () => {
    // Re-check after queueing: a preceding request may have exhausted the quota.
    const usage = fyersDataUsage();
    assertDataAvailable(usage, Date.now());
    if (readToken()?.issuedAt !== token.issuedAt) throw new FyersAuthError("Fyers session changed while data requests were queued. Retry after connecting.");
    saveUsage({ ...usage, requests: usage.requests + 1, endpoints: { ...usage.endpoints, [path]: (usage.endpoints[path] ?? 0) + 1 } });
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `${config.appId}:${token.accessToken}`, "User-Agent": USER_AGENT },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      saveUsage({ ...fyersDataUsage(), ...dataBackoff(Date.now(), 0, message) });
      console.error("[fyers] data transport failed; backing off:", message);
      throw error;
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof body.code === "number" ? body.code : undefined;
    if (response.status === 401 || (code != null && AUTH_ERROR_CODES.has(code))) {
      clearFyersToken();
      throw new FyersAuthError("Fyers session expired. Click Connect Fyers to log in again.");
    }
    if (!response.ok || body.s !== "ok") {
      const message = String(body.message || `Fyers HTTP ${response.status}`);
      const backoff = dataBackoff(Date.now(), response.status, message);
      if (backoff) {
        saveUsage({ ...fyersDataUsage(), ...backoff });
        console.error("[fyers] data requests paused:", message);
      }
      throw new FyersApiError(message, response.status, code);
    }
    return { ...body, fetchedAt: Date.now() };
  }));
}

/** 1-minute (or other resolution) candles between two epoch-second times. */
export async function fyersHistory(symbol: string, resolution: string, fromSec: number, toSec: number) {
  const body = await dataGet("/data/history", {
    symbol, resolution, date_format: 0, range_from: Math.floor(fromSec), range_to: Math.floor(toSec), cont_flag: 1,
  }, resolution === "D" ? 5 * 60_000 : 30_000);
  return body.candles;
}

/** Live quotes for up to 50 Fyers symbols per call (e.g. NSE:SBIN-EQ, NSE:NIFTY50-INDEX). Rows carry their own s: ok | error. */
export async function fyersQuotes(symbols: string[]) {
  const body = await dataGet("/data/quotes", { symbols: [...new Set(symbols)].sort().join(",") });
  return Array.isArray(body.d) ? body.d.map((row: unknown) =>
    row && typeof row === "object" ? { ...row, fetchedAt: body.fetchedAt } : row) : [];
}

export async function fyersOptionChain(underlying: string, strikecount: number) {
  const body = await dataGet("/data/options-chain-v3", { symbol: underlying, strikecount }, 60_000);
  return body.data;
}

export interface FyersOrderBookRow {
  id?: unknown;
  symbol?: unknown;
  status?: unknown;
  filledQty?: unknown;
  remainingQuantity?: unknown;
  tradedPrice?: unknown;
  message?: unknown;
}

/** Reads today's broker order book so an explicitly submitted order can be tracked without guessing from the submit response. */
export async function fyersOrderBook(): Promise<FyersOrderBookRow[]> {
  const config = fyersConfig();
  if (!config) throw new FyersAuthError("Fyers is not configured. Add FYERS_APP_ID and FYERS_SECRET_ID to .env.local.");
  const token = readToken();
  if (!token) throw new FyersAuthError();
  return throttled(async () => {
    const response = await fetch(`${API}/api/v3/orders`, {
      headers: { Authorization: `${config.appId}:${token.accessToken}`, "User-Agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof body.code === "number" ? body.code : undefined;
    if (response.status === 401 || (code != null && AUTH_ERROR_CODES.has(code))) {
      clearFyersToken();
      throw new FyersAuthError("Fyers session expired. Click Connect Fyers to log in again.");
    }
    if (!response.ok || body.s !== "ok") {
      throw new FyersApiError(String(body.message || `Fyers HTTP ${response.status}`), response.status, code);
    }
    if (!Array.isArray(body.orderBook)) throw new FyersApiError("Fyers returned an invalid order book.", response.status, code);
    return body.orderBook as FyersOrderBookRow[];
  });
}

/**
 * Places ONE order. Only src/lib/orders/orderServer.ts calls this, and only after its guards. Never retried: a timeout may still have
 * placed the order, so the caller reports "check your broker" instead of sending again.
 */
export async function fyersPlaceOrder(payload: Record<string, unknown>): Promise<{ id: string; message: string }> {
  const config = fyersConfig();
  if (!config) throw new FyersAuthError("Fyers is not configured. Add FYERS_APP_ID and FYERS_SECRET_ID to .env.local.");
  const token = readToken();
  if (!token) throw new FyersAuthError();
  return throttled(async () => {
    const response = await fetch(`${API}/api/v3/orders/sync`, {
      method: "POST",
      headers: { Authorization: `${config.appId}:${token.accessToken}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof body.code === "number" ? body.code : undefined;
    if (response.status === 401 || (code != null && AUTH_ERROR_CODES.has(code))) {
      clearFyersToken();
      throw new FyersAuthError("Fyers session expired. Click Connect Fyers to log in again.");
    }
    if (!response.ok || body.s !== "ok") throw new FyersApiError(String(body.message || `Fyers HTTP ${response.status}`), response.status, code);
    return { id: String(body.id ?? ""), message: String(body.message ?? "") };
  });
}
