import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTradingDay, getMarketStatus, getActiveSession } from "@/lib/market/marketHours";
import { getWeeklyTop5 } from "@/lib/screen/weeklyTop5Results";
import { notifyOwner, ownerAlertAddress } from "./personal";
import { decideTop5Alert, EMPTY_TOP5_STATE, top5AlertMessage, type Top5AlertState } from "./top5AlertRules";

/**
 * Emails the owner (PERSONAL_ALERT_EMAIL) when the Weekly Top 5's market tier changes, or, after the close, when the
 * list itself changed. Checked every 15 minutes on trading days. Never sent to the customer list.
 */
const FILE = join(process.cwd(), ".cache", "top5-alert.json");
const CHECK_MS = 15 * 60_000;
const store = ((globalThis as { __top5Alert?: { timer: ReturnType<typeof setInterval> | null; running: boolean } }).__top5Alert ??= { timer: null, running: false });

function readState(): Top5AlertState {
  try {
    return { ...EMPTY_TOP5_STATE, ...(JSON.parse(readFileSync(FILE, "utf8")) as Partial<Top5AlertState>) };
  } catch {
    return { ...EMPTY_TOP5_STATE };
  }
}

function writeState(state: Top5AlertState) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
}

async function check(now = Date.now()) {
  if (store.running || !ownerAlertAddress() || !isTradingDay(now)) return;
  const shifted = new Date(now + 19_800_000);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  // 09:30 to 16:30 IST: the open, the session and the first look after the close.
  if (minutes < 9 * 60 + 30 || minutes > 16 * 60 + 30) return;
  store.running = true;
  try {
    const live = getMarketStatus(now).isLive;
    const result = getWeeklyTop5(live ? "live" : "completed");
    if (result.status !== "ready") return;
    const { payload } = result;
    const reading = {
      tier: payload.size.key,
      symbols: payload.picks.map((p) => p.symbol),
      afterClose: !live && getActiveSession(now).progress === 1,
      day: shifted.toISOString().slice(0, 10),
    };
    const prev = readState();
    const { state, alerts } = decideTop5Alert(prev, reading);
    for (const alert of alerts) {
      const message = top5AlertMessage(alert, payload.picks, payload.breadth50);
      await notifyOwner(message.subject, message.lines);
    }
    writeState(state);
  } catch (error) {
    console.error("[top5-alert] check failed:", error instanceof Error ? error.message : error);
  } finally {
    store.running = false;
  }
}

export function startTop5Alert() {
  if (store.timer) return;
  void check();
  store.timer = setInterval(() => void check(), CHECK_MS);
  store.timer.unref?.();
}
