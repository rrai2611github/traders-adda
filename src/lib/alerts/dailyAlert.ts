import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getActiveSession, istDateKey } from "@/lib/market/marketHours";
import { getScannerResults } from "@/lib/screen/scannerResults";
import { scannerBacktestStat } from "@/lib/screen/scannerBacktest";
import { buildAlertTable, buildScannerAlert, type AlertTable, type BacktestLine } from "./scannerAlert";
import { sendTelegram, telegramConfig } from "./telegram";

const STATE_FILE = join(process.cwd(), ".cache", "telegram-alert.json");
const CHECK_EVERY_MS = 5 * 60_000;

export interface AlertState {
  lastSentDateKey: string | null;
  lastSentAt: number | null;
  lastError: string | null;
}

function readState(): AlertState {
  try {
    return { lastSentDateKey: null, lastSentAt: null, lastError: null, ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch {
    return { lastSentDateKey: null, lastSentAt: null, lastError: null };
  }
}

function writeState(state: AlertState) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Buy-ready rules with the exits the alert tells people to use (half at T1,
 * SL to cost, rest at T2), not the high-win-rate quick exit, whose 80%
 * winners come with no average gain and would mislead. This is the blended
 * figure across every scanner ("ANY"); it hides that some scanners have a
 * real edge and others do not — see `scannerBacktestStat` for the per-scanner
 * breakdown used in the app's own tables.
 */
export function backtestLine(): BacktestLine | null {
  const s = scannerBacktestStat("ANY");
  if (!s) return null;
  return {
    from: s.from,
    to: s.to,
    trades: s.trades,
    winRate: s.winRate,
    avgR: s.avgR,
    costPercent: s.costPercent,
    recent: s.recent,
  };
}

export function alertStatus() {
  return {
    configured: telegramConfig() != null,
    autoSend: process.env.TELEGRAM_AUTO_SEND === "1",
    ...readState(),
  };
}

export type PreviewResult = { ok: true; text: string; table: AlertTable; dateKey: string } | { ok: false; reason: string };

export function previewAlert(): PreviewResult {
  const state = getScannerResults();
  if (state.status === "warming") return { ok: false, reason: "The NSE universe is still loading." };
  if (state.status === "failed") return { ok: false, reason: "Market data is unavailable." };
  const p = state.payload;
  const bt = backtestLine();
  return { ok: true, text: buildScannerAlert(p, bt), table: buildAlertTable(p, bt), dateKey: p.candleTimestamp ? istDateKey(p.candleTimestamp) : p.sessionDateKey };
}

export async function sendAlertNow(): Promise<{ parts: number; dateKey: string }> {
  const preview = previewAlert();
  if (!preview.ok) throw new Error(preview.reason);
  const state = readState();
  try {
    const parts = await sendTelegram(preview.text);
    writeState({ lastSentDateKey: preview.dateKey, lastSentAt: Date.now(), lastError: null });
    return { parts, dateKey: preview.dateKey };
  } catch (error) {
    writeState({ ...state, lastError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** Sends once per trading day, after that day's candle has closed and is in the snapshot. */
async function autoSendTick() {
  if (process.env.TELEGRAM_AUTO_SEND !== "1" || !telegramConfig()) return;
  const session = getActiveSession();
  if (session.progress !== 1 || session.isLive) return;
  if (readState().lastSentDateKey === session.dateKey) return;
  const preview = previewAlert();
  if (!preview.ok || preview.dateKey !== session.dateKey) return;
  try {
    await sendAlertNow();
  } catch (error) {
    console.error("[telegram] daily alert failed:", error instanceof Error ? error.message : error);
  }
}

export function startAlertScheduler() {
  const g = globalThis as typeof globalThis & { __telegramAlertTimer?: ReturnType<typeof setInterval> };
  if (g.__telegramAlertTimer) return;
  g.__telegramAlertTimer = setInterval(() => void autoSendTick(), CHECK_EVERY_MS);
  g.__telegramAlertTimer.unref?.();
}
