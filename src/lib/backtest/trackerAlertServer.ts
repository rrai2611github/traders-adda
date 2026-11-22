import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner, ownerAlertAddress } from "@/lib/alerts/personal";
import { getQuotes } from "@/lib/market/engine";
import { getMarketStatus, isTradingDay, istDateKey } from "@/lib/market/marketHours";
import { trackerState } from "./tracker";
import { deliverTrackerAlerts, observeTrackerDay, trackerStopAlerts, type TrackerAlertState } from "./trackerAlerts";

const FILE = join(process.cwd(), ".cache", "tracker-alerts.json");
const runtime = ((globalThis as typeof globalThis & {
  __trackerAlerts?: { timer?: ReturnType<typeof setInterval>; running: boolean; status: string };
}).__trackerAlerts ??= { running: false, status: "Starting owner-email practice alerts." });

function readState(): TrackerAlertState | null {
  try {
    const state: TrackerAlertState = JSON.parse(readFileSync(FILE, "utf8"));
    if (state.version !== 1 || typeof state.generation !== "string" ||
        typeof state.observedDay !== "string" || !Array.isArray(state.sent) ||
        !state.sent.every(k => typeof k === "string") || !Array.isArray(state.pending) ||
        !state.pending.every(a => typeof a.key === "string" && typeof a.subject === "string" &&
          Array.isArray(a.lines) && a.lines.every(line => typeof line === "string") &&
          (a.stopDay === undefined || typeof a.stopDay === "string"))) {
      throw new Error("Invalid practice alert state; inspect .cache/tracker-alerts.json.");
    }
    return state;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function save(state: TrackerAlertState) {
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(state));
  renameSync(`${FILE}.tmp`, FILE);
}

export function trackerAlertStatus(): string {
  return ownerAlertAddress() ? runtime.status : "Practice email alerts blocked: owner email or email API settings are not configured.";
}

export async function checkTrackerAlerts(now = Date.now()) {
  if (runtime.running) return;
  runtime.running = true;
  try {
    if (!ownerAlertAddress()) { runtime.status = trackerAlertStatus(); return; }
    const tracker = trackerState();
    if (!tracker.config || tracker.job.status !== "done") {
      runtime.status = !tracker.config ? "Practice alerts paused: no active practice portfolio."
        : tracker.job.status === "failed" ? `Practice alerts blocked: ${tracker.job.error}`
        : "Practice alerts waiting for a completed daily replay.";
      return;
    }
    const result = tracker.job.result;
    const today = istDateKey(now);
    if (result.data.lastDay > today) throw new Error("Practice alert replay has a future date.");
    const market = getMarketStatus(now);
    if (result.data.lastDay === today && market.isLive) {
      runtime.status = "Practice alerts waiting: today's daily candle is not complete.";
      return;
    }
    const generation = JSON.stringify(tracker.config);
    const previous = readState();
    const state = observeTrackerDay(previous, generation, result);
    const baseline = !previous || previous.generation !== generation;
    const live = isTradingDay(now) && market.isLive && !market.label.includes("simulated");
    let priorSession = now - 86_400_000;
    while (!isTradingDay(priorSession)) priorSession -= 86_400_000;
    const holdingsCurrent = result.data.lastDay >= istDateKey(priorSession);
    const blocked: string[] = [];
    // Drop old or no-longer-confirmed stop warnings rather than sending them after recovery.
    state.pending = state.pending.filter(a => a.stopDay === undefined);
    save(state);
    if (!(await deliverTrackerAlerts(state, notifyOwner, save))) {
      runtime.status = `Practice email delivery failed; ${state.pending.length} alert(s) queued for retry.`;
      return;
    }
    if (live && !holdingsCurrent) blocked.push(`Daily holdings are stale (through ${result.data.lastDay}); stop watch paused.`);
    if (live && holdingsCurrent && result.openPositions.length) {
      const observed = trackerStopAlerts(result, await getQuotes(result.openPositions.map(p => p.symbol)), now, today);
      blocked.push(...observed.blocked);
      const sent = new Set(state.sent);
      state.pending.push(...observed.alerts.filter(a => !sent.has(a.key)));
    }
    save(state);
    const delivered = await deliverTrackerAlerts(state, notifyOwner, save);
    runtime.status = !delivered ? `Practice email delivery failed; ${state.pending.length} alert(s) queued for retry.`
      : blocked.length ? `Stop-review alerts blocked: ${blocked.join(" ")} Daily-event emails remain enabled.`
      : baseline ? "Practice emails enabled. Existing history baselined without sending old alerts."
      : `Practice emails enabled; checked ${new Date(now).toISOString()}. ${live ? "Stop warnings require verified recent trade times." : "Intraday stop watch waits for the market to open."}`;
  } catch (error) {
    runtime.status = `Practice alerts failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[tracker-alerts]", runtime.status);
  } finally {
    runtime.running = false;
  }
}

export function startTrackerAlerts() {
  if (runtime.timer) return;
  void checkTrackerAlerts();
  runtime.timer = setInterval(() => void checkTrackerAlerts(), 30_000);
  runtime.timer.unref?.();
}
