import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getResultsDates, daysUntil } from "@/lib/market/boardMeetings";
import { getMarketStatus, getActiveSession, isTradingDay, istDateKey } from "@/lib/market/marketHours";
import { getUniverseSnapshot } from "@/lib/market/universeSnapshot";
import { movingAverageBreadth } from "@/lib/screen/breadth";
import { readyToRun } from "@/lib/screen/readyToRun";
import { scanUniverse } from "@/lib/screen/scan";
import { notifyOwner, ownerAlertAddress } from "./personal";
import { decideReadyAlert, EMPTY_READY_STATE, readyAlertMessage, type ReadyAlertState } from "./readyAlertRules";

/**
 * Emails the owner (PERSONAL_ALERT_EMAIL) when a "Ready to run" stock breaks out, and after the close when new stocks join the list.
 * Checked every 15 minutes on trading days. Never sent to the customer list.
 */
const FILE = join(process.cwd(), ".cache", "ready-alert.json");
const CHECK_MS = 15 * 60_000;
const store = ((globalThis as { __readyAlert?: { timer: ReturnType<typeof setInterval> | null; running: boolean } }).__readyAlert ??= { timer: null, running: false });

function readState(): ReadyAlertState {
  try {
    return { ...EMPTY_READY_STATE, ...(JSON.parse(readFileSync(FILE, "utf8")) as Partial<ReadyAlertState>) };
  } catch {
    return { ...EMPTY_READY_STATE };
  }
}

function writeState(state: ReadyAlertState) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
}

async function check(now = Date.now()) {
  if (store.running || !ownerAlertAddress() || !isTradingDay(now)) return;
  const shifted = new Date(now + 19_800_000);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  if (minutes < 9 * 60 + 30 || minutes > 16 * 60 + 30) return;
  store.running = true;
  try {
    const snapshot = getUniverseSnapshot();
    if (snapshot.status !== "ready") return;
    const scan = scanUniverse(snapshot.snapshot);
    const eligible = scan.metrics.filter((row) => row.passesFloor);
    const ready = readyToRun(eligible).map((r) => ({ symbol: r.row.symbol, rs: r.row.rs ?? 0, underPivot: r.underPivot }));
    const broke = eligible
      .filter((row) => row.stage === "breakout" && row.rs != null && row.rs >= 85 && row.ext != null && row.ext > 0 && row.ext <= 5 && row.vs50 != null && row.vs50 > 0)
      .map((row) => ({ symbol: row.symbol, rs: row.rs ?? 0, ext: row.ext ?? 0 }));
    const live = getMarketStatus(now).isLive;
    const reading = { day: shifted.toISOString().slice(0, 10), afterClose: !live && getActiveSession(now).progress === 1, ready, broke };
    const { state: next, alerts } = decideReadyAlert(readState(), reading);
    if (alerts.length) {
      const today = istDateKey(now);
      const calendar = await getResultsDates(today);
      const resultsInDays = Object.fromEntries(Object.entries(calendar?.dates ?? {}).map(([symbol, date]) => [symbol, daysUntil(date, today)]));
      const breadth50 = movingAverageBreadth(eligible, "vs50").percent;
      for (const alert of alerts) {
        const message = readyAlertMessage(alert, { breadth50, resultsInDays });
        await notifyOwner(message.subject, message.lines);
      }
    }
    writeState(next);
  } catch (error) {
    console.error("[ready-alert] check failed:", error instanceof Error ? error.message : error);
  } finally {
    store.running = false;
  }
}

export function startReadyAlert() {
  if (store.timer) return;
  void check();
  store.timer = setInterval(() => void check(), CHECK_MS);
  store.timer.unref?.();
}
