import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { needsCatchUp } from "../market/freshness.ts";
import { getActiveSession, isTradingDay, istDateKey } from "../market/marketHours.ts";

/**
 * Keeps the ten-year price files current: after the close, `scripts/fetch-history.mjs --recent` adds the day's candle for every
 * stock. The live strategy check reads these files, so it moves forward one finished session at a time.
 */
const DIR = join(process.cwd(), ".cache");
const STATE_FILE = join(DIR, "history-refresh.json");
const NIFTY_FILE = join(DIR, "history10y", "NIFTY50.json");
/** After this IST time on a trading day the day's candle is final on Yahoo. */
const READY_MINUTES = 16 * 60 + 30;

export interface RefreshState {
  /** IST day of the last successful refresh. */
  lastDay: string | null;
  lastRunAt: number | null;
  status: "idle" | "running" | "failed";
  message: string;
}

const store = ((globalThis as { __historyRefresh?: { running: boolean; timer: ReturnType<typeof setInterval> | null; message: string } }).__historyRefresh ??= { running: false, timer: null, message: "" });

function readSaved(): { lastDay: string | null; lastRunAt: number | null; failed: string | null } {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { lastDay: s.lastDay ?? null, lastRunAt: s.lastRunAt ?? null, failed: s.failed ?? null };
  } catch {
    return { lastDay: null, lastRunAt: null, failed: null };
  }
}

function save(state: { lastDay: string | null; lastRunAt: number | null; failed: string | null }) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

export function refreshState(): RefreshState {
  const s = readSaved();
  return { lastDay: s.lastDay, lastRunAt: s.lastRunAt, status: store.running ? "running" : s.failed ? "failed" : "idle", message: store.running ? store.message : s.failed ?? "" };
}

/** The last trading day held in the saved Nifty file, YYYY-MM-DD (IST); null if the file is missing. */
export function historyLastDay(): string | null {
  try {
    const rows = JSON.parse(readFileSync(NIFTY_FILE, "utf8")).c as number[][];
    const t = rows[rows.length - 1]?.[0];
    return t ? new Date(t + 19_800_000).toISOString().slice(0, 10) : null;
  } catch {
    return null;
  }
}

/** Changes whenever the price files are refreshed, so saved backtest results never outlive the data they were built on. */
export function historyStamp(): number {
  try { return Math.floor(statSync(NIFTY_FILE).mtimeMs); } catch { return 0; }
}

/** Downloads the last month for every stock and merges it in. Resolves when the child process ends; never throws. */
export function refreshHistory(): Promise<RefreshState> {
  if (store.running) return Promise.resolve(refreshState());
  const script = join(process.cwd(), "scripts", "fetch-history.mjs");
  if (!existsSync(script)) return Promise.resolve({ lastDay: null, lastRunAt: null, status: "failed", message: "The history script is missing." });
  store.running = true;
  store.message = "starting";
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--use-system-ca", "--no-warnings", script, "--recent"], { cwd: process.cwd(), windowsHide: true });
    let tail = "";
    child.stdout.on("data", (chunk: Buffer) => { const lines = chunk.toString().split(/\r?\n/).filter(Boolean); if (lines.length) store.message = lines[lines.length - 1]; });
    child.stderr.on("data", (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-400); });
    child.on("close", (code) => {
      store.running = false;
      const now = Date.now();
      if (code === 0) save({ lastDay: istDateKey(now), lastRunAt: now, failed: null });
      else save({ ...readSaved(), lastRunAt: now, failed: tail.trim() || `The download stopped (exit ${code}).` });
      resolve(refreshState());
    });
  });
}

/** True once today's candle should be final and has not been downloaded yet. */
export function refreshDue(now = Date.now()): boolean {
  if (!isTradingDay(now)) return false;
  const shifted = new Date(now + 19_800_000);
  if (shifted.getUTCHours() * 60 + shifted.getUTCMinutes() < READY_MINUTES) return false;
  if (getActiveSession(now).progress < 1) return false;
  return readSaved().lastDay !== istDateKey(now);
}

/**
 * True when finished sessions are missing from the price files outside the usual after-the-close run, for example after the computer was
 * off through an evening. The download only ever saves finished candles, so it is safe at any hour. At most once an hour.
 */
export function catchUpDue(now = Date.now()): boolean {
  const saved = readSaved();
  return needsCatchUp({ lastCandleDay: historyLastDay(), refreshedDay: saved.lastDay, lastRunAt: saved.lastRunAt, now });
}

/** Checks every ten minutes; `onDone` runs after each successful refresh (the live strategy check recomputes there). */
export function startHistoryRefreshScheduler(onDone: () => void, isWanted: () => boolean) {
  if (store.timer) return;
  const tick = () => {
    if (store.running || !isWanted() || !(refreshDue() || catchUpDue())) return;
    void refreshHistory().then((s) => { if (s.status === "idle") onDone(); });
  };
  store.timer = setInterval(tick, 600_000);
  store.timer.unref?.();
  setTimeout(tick, 20_000).unref?.();
}
