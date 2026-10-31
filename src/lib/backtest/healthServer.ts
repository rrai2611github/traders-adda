import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { notifyOwner, ownerAlertAddress } from "@/lib/alerts/personal";
import { isTradingDay } from "../market/marketHours.ts";
import { assessHealth, healthLines, isLastSessionOfMonth, type HealthReport } from "./health.ts";
import { getBacktest, startBacktest } from "./jobs.ts";
import { readTracker, trackerSettings, trackerState } from "./tracker.ts";

const FILE = join(process.cwd(), ".cache", "health-note.json");

export type HealthState =
  | { status: "running"; message: string }
  | { status: "failed"; message: string }
  | { status: "done"; report: HealthReport; lastDay: string; liveTrades: number | null };

/** The rules' own backtest from the start of the history, with the live check's settings (Nifty gate, 12% stop) when one is running. */
function baselineSettings() {
  const config = readTracker();
  return trackerSettings({ startDate: "2016-12-01", startedAt: 0, capital: config?.capital ?? 1_000_000, niftyGate: config?.niftyGate ?? false, stopPercent: config?.stopPercent ?? 8 });
}

/** Starts (or reads) the baseline backtest and the live check, and compares them. Cheap to call: both are cached per price update. */
export function currentHealth(): HealthState {
  const job = startBacktest(baselineSettings());
  const base = job.status === "done" ? job : getBacktest(job.id);
  if (!base || base.status === "running") return { status: "running", message: base && base.status === "running" ? base.message : "starting" };
  if (base.status === "failed") return { status: "failed", message: base.error };
  const config = readTracker();
  let live: Parameters<typeof assessHealth>[0]["live"] = null;
  if (config) {
    const state = trackerState();
    if (state.job.status === "done") {
      const r = state.job.result;
      live = { trades: r.trades.filter((t) => t.exitReason !== "end"), maxDrawdownPercent: r.stats.maxDrawdownPercent, sessions: r.data.sessions, startDate: config.startDate };
    }
  }
  const b = base.result;
  const report = assessHealth({
    baseline: { trades: b.trades.filter((t) => t.exitReason !== "end"), account: b.equity.account, maxDrawdownPercent: b.stats.maxDrawdownPercent, lastDay: b.data.lastDay },
    live,
    liveStartedOn: config?.startDate ?? null,
  });
  return { status: "done", report, lastDay: b.data.lastDay, liveTrades: live ? live.trades.length : null };
}

function lastMonth(): string | null {
  try { return JSON.parse(readFileSync(FILE, "utf8")).lastMonth ?? null; } catch { return null; }
}

/** On the last session of each month, once the prices are refreshed, emails the owner (PERSONAL_ALERT_EMAIL only) the health report. Once a month. */
export async function sendHealthIfDue(): Promise<void> {
  if (!readTracker() || !ownerAlertAddress()) return;
  let state = currentHealth();
  for (let i = 0; i < 90 && state.status === "running"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    state = currentHealth();
  }
  if (state.status !== "done") return;
  if (!isLastSessionOfMonth(state.lastDay, (day) => isTradingDay(Date.parse(`${day}T12:00:00+05:30`)))) return;
  const month = state.lastDay.slice(0, 7);
  if (lastMonth() === month) return;
  await notifyOwner(`Strategy health · ${state.report.verdict === "on-track" ? "no sign the edge has faded" : state.report.verdict === "early" ? "too early to judge" : state.report.verdict === "watch" ? "watch" : "review the rules"} · ${month}`, healthLines(state.report));
  mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
  writeFileSync(FILE, JSON.stringify({ lastMonth: month }));
}
